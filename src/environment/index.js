import * as THREE from 'three';
import { SkyBake } from './skyBake.js';
import { createSkyBackground } from './skyBackground.js';
import { updateSun } from './sun.js';

export { measureEnvironment } from './measure.js';
export { MOOD_MAP_V1, SUN_PATH_V1, sampleMood, sunAt } from './mood.js';

// scene-environment: sky, sun and the baked environment cube for any three host
// (SCENE-ENVIRONMENT-SPEC §5). Imports only three and its own folder (guard BOUNDARY-2); no RAF,
// no camera, no DOM — the host calls update() when the params change and lights its own scene
// from env.sun (src/environment-bindings/hostBinding.js in Ultra-Water).
//
// One writer (guard OWNER-4): the host changes the params only through env.set(), which marks
// the sky dirty; the host calls update() once per frame while env.dirty.
//
// Identity is the contract: env.cube, env.sun.direction and env.sun.color are created once and
// written in place, so materials hold them as uniforms.

/** @typedef {{ elevation: number, azimuth: number, turbidity: number, rayleigh: number, cloudCoverage: number, sunIntensity: number }} SkyParams */

export const DEFAULT_SKY_PARAMS = Object.freeze({
  elevation: 3.5, azimuth: 205, turbidity: 2, rayleigh: 1, cloudCoverage: 0.38, sunIntensity: 9,
});

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ cubeSize?: number, params?: Partial<SkyParams> }} [options]
 */
export function createEnvironment(renderer, { cubeSize = 1024, params } = {}) {
  const direction = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Vector3(1, 1, 1);
  /** @type {SkyParams} */
  const p = { ...DEFAULT_SKY_PARAMS, ...params };
  const bake = new SkyBake(renderer, cubeSize, direction, color);
  const cube = bake.cubeRT.texture;

  const env = {
    /** the sky params, read-only for the host: write through set() */
    params: /** @type {Readonly<SkyParams>} */ (p),
    /** set() since the last update() */
    dirty: true,
    /** the only writer of the sky params; unknown keys are ignored */
    set(/** @type {Partial<SkyParams>} */ next) {
      for (const k of /** @type {(keyof SkyParams)[]} */ (Object.keys(DEFAULT_SKY_PARAMS))) {
        if (next[k] !== undefined && Number.isFinite(next[k])) p[k] = next[k];
      }
      env.dirty = true;
    },
    sun: { direction, color },
    cube,
    cubeTarget: bake.cubeRT,
    cubeSize,
    background: createSkyBackground(cube, direction, color),

    // one sky change = the three steps below (split so measureEnvironment can time them apart)
    update() { env.bakeLuts(env.updateSun()); env.bakeCube(); env.dirty = false; },
    /** CPU only: sun direction and colour from params; returns the atmosphere coefficients */
    updateSun: () => updateSun(p, direction, color),
    /** @param {ReturnType<typeof updateSun>} c */
    bakeLuts: (c) => bake.bakeLuts(c, p.sunIntensity),
    bakeCube: () => bake.bakeCubeInto(bake.cubeRT, p.cloudCoverage),
    /** the same bake into any cube target (E0 measures PMREM from a smaller copy) */
    bakeCubeInto: (/** @type {THREE.WebGLCubeRenderTarget} */ rt) => bake.bakeCubeInto(rt, p.cloudCoverage),

    dispose() {
      bake.dispose();
      env.background.geometry.dispose();
      /** @type {THREE.Material} */ (env.background.material).dispose();
    },
  };
  return env;
}

/** @typedef {ReturnType<typeof createEnvironment>} Environment */
