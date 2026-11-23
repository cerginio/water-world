import * as THREE from 'three';
import { SkyBake } from './skyBake.js';
import { createSkyBackground } from './skyBackground.js';
import { createSkyState } from './state.js';
import { updateSun } from './sun.js';

export { measureEnvironment } from './measure.js';
export { MOOD_MAP_V1, SUN_PATH_V1, sampleMood, sunAt } from './mood.js';

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
// Identity is the contract: env.cube, env.envMap, env.sun.direction and env.sun.color are created
// once and written in place, so materials hold them as uniforms.

/** @typedef {{ elevation: number, azimuth: number, turbidity: number, rayleigh: number, cloudCoverage: number, sunIntensity: number }} SkyParams */
/** @typedef {{ sunChanged: boolean, cubeChanged: boolean, moving: boolean, faces: number, pmrem: boolean }} EnvUpdate */

export const DEFAULT_SKY_PARAMS = Object.freeze({
  elevation: 3.5, azimuth: 205, turbidity: 2, rayleigh: 1, cloudCoverage: 0.38, sunIntensity: 9,
});

const cubeTarget = (size) => new THREE.WebGLCubeRenderTarget(size, {
  type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
  minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
});

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ cubeSize?: number, envSize?: number, params?: Partial<SkyParams> }} [options]
 *   cubeSize — the sky cube (water, background); envSize — the cube the IBL PMREM is made from
 */
export function createEnvironment(renderer, { cubeSize = 1024, envSize = 64, params } = {}) {
  const direction = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Vector3(1, 1, 1);
  /** @type {SkyParams} */
  const p = { ...DEFAULT_SKY_PARAMS, ...params };
  const state = createSkyState(p);
  const bake = new SkyBake(renderer, cubeSize, direction, color);
  const cube = bake.cubeRT.texture;

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

  const env = {
    /** the current (smoothed) sky params, read-only for the host: write through setState()/set() */
    params: /** @type {Readonly<SkyParams>} */ (p),
    /** where the params are going */
    target: state.target,
    /** update() has work: a set() not baked yet, a move, or cube faces behind the state */
    get dirty() { return full || state.moving || facesLeft > 0; },
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
    cube,
    cubeTarget: bake.cubeRT,
    cubeSize,
    /** the IBL for scene.environment (PMREM, CubeUV mapping) */
    envMap: envTarget.texture,
    envSize,
    background: createSkyBackground(cube, direction, color),

    /**
     * One tick of the host's frame (no RAF of its own). dt 0 only bakes what set() asked for.
     * @param {number} [dt] seconds since the last tick
     * @returns {EnvUpdate} the host re-lights (and re-draws its shadow) on sunChanged
     */
    update(dt = 0) {
      const moved = state.step(dt);
      /** @type {EnvUpdate} */
      const out = { sunChanged: false, cubeChanged: false, moving: state.moving, faces: 0, pmrem: false };
      if (full || moved) {
        env.bakeLuts(env.updateSun());
        out.sunChanged = true;
      }
      if (full) {
        env.bakeCube();
        out.faces = 6;
        facesLeft = 0; nextFace = 0; full = false;
      } else if (moved) facesLeft = 6;   // every face again, from the newest state
      if (out.faces === 0 && facesLeft > 0) {
        facesLeft--;
        // the mip chain after face 5 and after the last face of a cycle
        bake.bakeFaceInto(bake.cubeRT, nextFace, p.cloudCoverage, nextFace === 5 || facesLeft === 0);
        nextFace = (nextFace + 1) % 6;
        out.faces = 1;
      }
      // the IBL from a small bake of the same sky: after every whole cycle of faces (while moving
      // that is every sixth frame) and once at rest
      const cycleDone = out.faces === 6 || (out.faces === 1 && nextFace === 0);
      const settled = out.faces > 0 && facesLeft === 0 && !state.moving;
      if (cycleDone || settled) {
        bake.bakeCubeInto(small, p.cloudCoverage);
        pmrem.fromCubemap(small.texture, envTarget);
        out.pmrem = true;
      }
      out.cubeChanged = out.faces > 0;
      if (out.sunChanged) listeners.get('sun-changed')?.forEach((fn) => fn());
      return out;
    },
    /** after webglcontextrestored: the render targets lost their contents */
    restoreContext() { full = true; },

    // the steps of one sky change, apart (measureEnvironment times them)
    /** CPU only: sun direction and colour from params; returns the atmosphere coefficients */
    updateSun: () => updateSun(p, direction, color),
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
