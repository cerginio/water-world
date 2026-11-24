import * as THREE from 'three';
import { CLOUD_WIND, CLOUD_WIND_DIR } from './clouds.js';
import { SkyBake } from './skyBake.js';
import { createSkyBackground } from './skyBackground.js';
import { createLdrLights, ldrLighting } from './ldr.js';
import { createSkyState } from './state.js';
import { updateSun } from './sun.js';

export { measureEnvironment } from './measure.js';
export { LDR_FLOOR, LDR_REFERENCE, THREE_LIGHTS, ldrLighting } from './ldr.js';
export { flowDay, MOOD_MAP_V1, MOOD_TAU, moodTau, QUIET, REDUCED_MOTION, SUN_PATH_V1, sampleMood, stepToward, sunAt, worldArousal } from './mood.js';

// scene-environment: sky, sun and the baked environment cube for any three host
// (SCENE-ENVIRONMENT-SPEC §5). Imports only three and its own folder (guard BOUNDARY-2); no RAF,
// no camera, no DOM — the host ticks update(dt) every frame while env.dirty and lights its own
// scene from env.sun (src/environment-bindings/hostBinding.js in Ultra-Water).
//
// One writer (guard OWNER-4): the host changes the params only through setState() / set().
// setState(next, { tau }) moves the sky there smoothly (state.js); set(next) = τ 0, at once.
//
// Time (spec §4, DECISIONS «Оточення: оновлення неба в часі»): while the sky moves, the 1024²
// cube is re-baked one face per frame (the water and the background read it), and after each
// full cycle of six faces the IBL is re-made: a PMREM of a small (envSize²) bake of the same sky,
// with its own generator (three's shared one breaks on a second size). At rest — the six faces
// from the final state and one more IBL. set() bakes everything in the same update.
// E2 QA: an IBL kept still while moving made the sand under shallow water jump at rest.
//
// Clouds (spec §3.3, E2b): the deck drifts by cloudSpeed × CLOUD_WIND every update(dt). The
// background draws it live; the cube keeps the offset of its last bake, and once the live clouds
// are CLOUD_STEP away it re-bakes its six faces one a frame from the newest offset (a drift run),
// the IBL only once they are CLOUD_IBL_STEP away. A drift run is not a sky change: env.dirty stays
// false (the mood is at rest while its clouds move); env.active tells the host to keep ticking.
//
// Output (spec §5.4, E3): 'hdr' — radiance for Ultra-Water's HDR target and PostFX; 'ldr' — for a
// host on an sRGB canvas with NoToneMapping (three): the background does its own exposure and AgX,
// the cube (and so the IBL) is scaled so that the IBL can stand in for the hemisphere light, the
// lower hemisphere is ground, and env.ldrLights() gives the HemisphereLight + DirectionalLight for
// the state (ldr.js). The module
// never touches renderer.toneMapping.
//
// Identity is the contract: env.cube, env.envMap, env.sun.direction and env.sun.color are created
// once and written in place, so materials hold them as uniforms.

/** @typedef {{ elevation: number, azimuth: number, turbidity: number, rayleigh: number, cloudCoverage: number, sunIntensity: number, cloudSpeed: number }} SkyParams */
/** @typedef {{ sunChanged: boolean, cubeChanged: boolean, moving: boolean, faces: number, pmrem: boolean, drift: boolean }} EnvUpdate */

export const DEFAULT_SKY_PARAMS = Object.freeze({
  elevation: 3.5, azimuth: 205, turbidity: 2, rayleigh: 1, cloudCoverage: 0.38, sunIntensity: 9,
  cloudSpeed: 1,
});

/** the drift (deck units) after which the cube re-bakes: ~1/3 s at cloudSpeed 1, a hair of the finest octave */
export const CLOUD_STEP = 0.001;
/** the drift after which a drift run also re-makes the IBL: ~7 s at cloudSpeed 1 */
export const CLOUD_IBL_STEP = 0.02;

const cubeTarget = (size) => new THREE.WebGLCubeRenderTarget(size, {
  type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
  minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
});

/**
 * @typedef {{ cubeSize?: number, envSize?: number, params?: Partial<SkyParams>, output?: 'hdr' | 'ldr',
 *   lowerHemisphere?: 'sea' | 'ground', background?: 'sky' | 'gradient' }} EnvironmentOptions
 */

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {EnvironmentOptions} [options]
 *   cubeSize — the sky cube (water, background); envSize — the cube the IBL PMREM is made from;
 *   output 'hdr' (default) | 'ldr'; lowerHemisphere — 'sea' for hdr, 'ground' for ldr by default;
 *   background — 'sky' (clouds, sun disc; hdr default) | 'gradient' (restrained; ldr default)
 */
export function createEnvironment(renderer, { cubeSize = 1024, envSize = 64, params, output = 'hdr',
  lowerHemisphere = output === 'ldr' ? 'ground' : 'sea', background = output === 'ldr' ? 'gradient' : 'sky' } = {}) {
  if (output !== 'hdr' && output !== 'ldr') throw new Error(`createEnvironment: output 'hdr' | 'ldr', got ${output}`);
  if (lowerHemisphere !== 'sea' && lowerHemisphere !== 'ground') throw new Error(`createEnvironment: lowerHemisphere 'sea' | 'ground', got ${lowerHemisphere}`);
  if (background !== 'sky' && background !== 'gradient') throw new Error(`createEnvironment: background 'sky' | 'gradient', got ${background}`);
  const ldr = output === 'ldr';
  const direction = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Vector3(1, 1, 1);
  /** @type {SkyParams} */
  const p = { ...DEFAULT_SKY_PARAMS, ...params };
  const state = createSkyState(p);
  const bake = new SkyBake(renderer, cubeSize, direction, color, { lowerHemisphere });
  // LDR: the lights and the exposure follow the sun (refreshed with it, before the bake reads it)
  const lights = createLdrLights();
  const outScale = bake.cubePass.material.uniforms.uOutScale;
  const sunStep = () => {
    const c = updateSun(p, direction, color);
    if (ldr) { ldrLighting(p, color, direction, lights); outScale.value = lights.iblExposure; }
    return c;
  };
  const cube = bake.cubeRT.texture;
  const clouds = new THREE.Vector2();         // the live deck offset (the background)
  const baked = bake.cloudOffset;             // the offset of the faces being baked (the cube)
  const iblClouds = new THREE.Vector2();      // the offset the IBL was made from

  // the IBL target exists from the start (its texture is env.envMap): a cleared small cube through
  // the generator once allocates it; the first update() fills it
  const small = cubeTarget(envSize);
  const target0 = renderer.getRenderTarget();
  for (let f = 0; f < 6; f++) { renderer.setRenderTarget(small, f); renderer.clear(); }
  renderer.setRenderTarget(target0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromCubemap(small.texture);

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map([['sun-changed', new Set()]]);
  let full = true;        // the next update bakes everything (start, set(), restoreContext())
  let facesLeft = 0;      // faces of the 1024² cube still older than the current state
  let nextFace = 0;
  let driftRun = false;   // the faces left are a drift run, not a sky change
  const drifting = () => p.cloudCoverage > 0 && p.cloudSpeed > 0;

  const env = {
    /** the current (smoothed) sky params, read-only for the host: write through setState()/set() */
    params: /** @type {Readonly<SkyParams>} */ (p),
    /** where the params are going */
    target: state.target,
    /** update() has work: a set() not baked yet, a move, or cube faces behind the state */
    get dirty() { return full || state.moving || (facesLeft > 0 && !driftRun); },
    /** update() must tick this frame: dirty, or the clouds drift (or a drift run is unfinished) */
    get active() { return env.dirty || facesLeft > 0 || drifting(); },
    /** the deck offsets: `offset` the background's (live), `cube` the cube's, `ibl` the IBL's */
    clouds: { offset: clouds, cube: baked, ibl: iblClouds },
    /**
     * The only writer of the sky params; unknown keys are ignored.
     * @param {Partial<SkyParams>} next
     * @param {{ tau?: number }} [options] τ in seconds (95 % after 3τ); 0 = at once, like set()
     */
    setState(next, { tau = 0 } = {}) {
      if (!(tau >= 0)) throw new Error(`env.setState: tau must be ≥ 0, got ${tau}`);
      state.setTarget(next, tau);
      if (tau === 0) full = true;
    },
    /** at once: the next update() re-bakes the sky, the cube and the IBL */
    set(/** @type {Partial<SkyParams>} */ next) { env.setState(next, { tau: 0 }); },
    /** @param {'sun-changed'} name @param {() => void} fn @returns {() => void} off */
    on(name, fn) {
      const set = listeners.get(name);
      if (!set) throw new Error(`env.on: unknown event ${name}`);
      set.add(fn);
      return () => set.delete(fn);
    },
    sun: { direction, color },
    output,
    /**
     * The LDR host's lights for the current state (output 'ldr'; spec §5.4): written in place on
     * every sun change — read them on 'sun-changed'. Equal to three's lights at the clear noon.
     * @returns {import('./ldr.js').LdrLights}
     */
    ldrLights() {
      if (!ldr) ldrLighting(p, color, direction, lights);
      return lights;
    },
    cube,
    cubeTarget: bake.cubeRT,
    cubeSize,
    /** the IBL for scene.environment (PMREM, CubeUV mapping) */
    envMap: envTarget.texture,
    envSize,
    background: createSkyBackground({
      ...bake.atmosphere.uniforms,
      uSunDir: { value: direction }, uSunColor: { value: color },
      uCloudCoverage: { get value() { return p.cloudCoverage; } }, uCloudOffset: { value: clouds },
      uExposure: { get value() { return lights.exposure; } },
    }, { ldr, gradient: background === 'gradient' }),

    /**
     * One tick of the host's frame (no RAF of its own). dt 0 only bakes what set() asked for.
     * @param {number} [dt] seconds since the last tick
     * @returns {EnvUpdate} the host re-lights (and re-draws its shadow) on sunChanged
     */
    update(dt = 0) {
      const moved = state.step(dt);
      if (dt > 0 && drifting()) {
        const s = CLOUD_WIND * p.cloudSpeed * dt;
        clouds.x += CLOUD_WIND_DIR[0] * s; clouds.y += CLOUD_WIND_DIR[1] * s;
      }
      /** @type {EnvUpdate} */
      const out = { sunChanged: false, cubeChanged: false, moving: state.moving, faces: 0, pmrem: false, drift: false };
      if (full || moved) {
        env.bakeLuts(env.updateSun());
        out.sunChanged = true;
      }
      if (full) {
        baked.copy(clouds);
        env.bakeCube();
        out.faces = 6;
        facesLeft = 0; nextFace = 0; full = false; driftRun = false;
      } else if (moved) {
        facesLeft = 6; driftRun = false;   // every face again, from the newest state
      } else if (facesLeft === 0 && drifting() && clouds.distanceTo(baked) >= CLOUD_STEP) {
        facesLeft = 6; driftRun = true;
      }
      if (out.faces === 0 && facesLeft > 0) {
        // a run of six faces starts from the newest clouds (while the sky moves: every frame)
        if (facesLeft === 6) baked.copy(clouds);
        out.drift = driftRun;
        facesLeft--;
        // the mip chain after face 5 and after the last face of a cycle
        bake.bakeFaceInto(bake.cubeRT, nextFace, p.cloudCoverage, nextFace === 5 || facesLeft === 0);
        nextFace = (nextFace + 1) % 6;
        out.faces = 1;
      }
      // the IBL from a small bake of the same sky: after every whole cycle of faces (while moving
      // that is every sixth frame) and once at rest; after a drift run only once the clouds have
      // gone CLOUD_IBL_STEP from the IBL's
      const runDone = out.faces > 0 && facesLeft === 0;
      const cycleDone = out.faces === 6 || (out.faces === 1 && nextFace === 0);
      const ibl = out.drift
        ? runDone && baked.distanceTo(iblClouds) >= CLOUD_IBL_STEP
        : cycleDone || (runDone && !state.moving);
      if (ibl) {
        bake.bakeCubeInto(small, p.cloudCoverage);
        pmrem.fromCubemap(small.texture, envTarget);
        iblClouds.copy(baked);
        out.pmrem = true;
      }
      if (runDone) driftRun = false;
      out.cubeChanged = out.faces > 0;
      if (out.sunChanged) listeners.get('sun-changed')?.forEach((fn) => fn());
      return out;
    },
    /** after webglcontextrestored: the render targets lost their contents */
    restoreContext() { full = true; },

    // the steps of one sky change, apart (measureEnvironment times them)
    /** CPU only: sun direction and colour from params; returns the atmosphere coefficients */
    updateSun: sunStep,
    /** @param {ReturnType<typeof updateSun>} c */
    bakeLuts: (c) => bake.bakeLuts(c, p.sunIntensity),
    bakeCube: () => bake.bakeCubeInto(bake.cubeRT, p.cloudCoverage),
    /** one face of the sky cube, without the mip chain (the per-frame cost of a move) */
    bakeFace: (/** @type {number} */ f) => bake.bakeFaceInto(bake.cubeRT, f, p.cloudCoverage, false),
    /** the same bake into any cube target (E0 measures PMREM from a smaller copy) */
    bakeCubeInto: (/** @type {THREE.WebGLCubeRenderTarget} */ rt) => bake.bakeCubeInto(rt, p.cloudCoverage),

    dispose() {
      bake.dispose();
      small.dispose();
      envTarget.dispose();
      pmrem.dispose();
      listeners.forEach((s) => s.clear());
      env.background.geometry.dispose();
      /** @type {THREE.Material} */ (env.background.material).dispose();
    },
  };
  return env;
}

/** @typedef {ReturnType<typeof createEnvironment>} Environment */
