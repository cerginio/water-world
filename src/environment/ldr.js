import * as THREE from 'three';
import { atmosphereCoefficients, OBSERVER_ALTITUDE, transmittance } from './atmosphere.js';
import { MOOD_MAP_V1, SUN_PATH_V1, sunAt } from './mood.js';
import { updateSun } from './sun.js';

// The LDR adapter (SCENE-ENVIRONMENT-SPEC §5.4, E3) for hosts without an HDR pipeline — three's
// viewer: sRGB canvas, NoToneMapping, a HemisphereLight + a DirectionalLight, frames on
// MeshBasicMaterial. CPU only, no GPU readback: the light of the current sky state is estimated
// from the same transmittance integral the sun colour comes from (sun.js), plus a cloud model.
//
// Normalisation: at the reference state — a clear noon, LDR_REFERENCE — the lights are exactly
// three's current ones (THREE_LIGHTS: hemisphere white/0x596778 × 2, sun white × 2.5). Any other
// state keeps its colour relative to that noon and its brightness relative to it compressed
// (r^LDR_GAMMA, within [LDR_GAIN_MIN, LDR_GAIN_MAX]): a sunset is darker and warmer, a storm darker
// and greyer, but never by the full physical ratio — there is no auto-exposure after it. The
// readability floor (spec §5.4, MOOD-WEATHER §6 п.5): a white sheet on the side away from the sun,
// lit by the hemisphere alone, stays at LDR_FLOOR sRGB or brighter.

/** three's viewer lights today (tilecraft viewer/engines/three/shell/viewer-session.js) */
export const THREE_LIGHTS = Object.freeze({ sky: 0xffffff, ground: 0x596778, hemisphere: 2, sun: 2.5 });

/** the clear noon the LDR lights equal THREE_LIGHTS at: the day's middle and the warm-sun anchor (A6) */
export const LDR_REFERENCE = Object.freeze({
  ...(({ elevation, azimuth }) => ({ elevation, azimuth }))(sunAt(SUN_PATH_V1, 0.5)),
  ...MOOD_MAP_V1.grid[1][2].sky, rayleigh: 1,
});

/** brightness (the light on level ground) against the noon is compressed as ratio^GAMMA */
export const LDR_GAMMA = 0.5;
export const LDR_GAIN_MIN = 0.45;
export const LDR_GAIN_MAX = 1.1;
/** how much of the colour shift against the noon the lights keep (0 = always white) */
export const LDR_TINT = 0.75;
/** sRGB of the white sheet in the hemisphere light alone, at the least */
export const LDR_FLOOR = 0.58;
/** the sheet's albedo the floor is computed for (three's frame paper: white) */
const PAPER = 1;
/** the GPU sky against skyLight's estimate: the IBL at the noon gives a standing white sheet what
 *  the hemisphere does (env-demo, E3: 0.62 sRGB; without it 2.4× brighter) */
export const LDR_IBL_K = 0.42;
/** the sky background's brightness (linear, before its AgX curve) at the reference noon */
export const LDR_SKY_KEY = 0.35;

const lum = (/** @type {number[]} */ v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const clum = (/** @type {THREE.Color} */ c) => lum([c.r, c.g, c.b]);
const clamp01 = (/** @type {number} */ x) => Math.min(1, Math.max(0, x));
const toLinear = (/** @type {number} */ s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);

/**
 * The light at the ground under sky params p, in the sun's units (irradiance; sun.js).
 * direct — the sun at normal incidence after the clouds; diffuse — the sky on a level surface;
 * ground — what lights the ground (level); white — a white level sheet in both.
 * @param {{ elevation: number, turbidity: number, rayleigh: number, cloudCoverage: number, sunIntensity: number }} p
 * @param {{ x: number, y: number, z: number }} color      env.sun.color for p
 * @param {{ y: number }} direction                        env.sun.direction for p
 */
export function skyLight(p, color, direction) {
  const mu = Math.max(direction.y, 0);
  const c = clamp01(p.cloudCoverage);
  const block = 0.8 * c ** 1.5;                         // of the direct sun, the clouds take
  const sun = [color.x, color.y, color.z].map((v) => Math.PI * v);
  const direct = sun.map((v) => v * (1 - block));
  // the sky: half of what the air took out of the sunlight comes down (the twilight glow lingers
  // as if the sun stood 0.9° high); blue where the air takes most
  const T = transmittance(atmosphereCoefficients(p), OBSERVER_ALTITUDE, mu);
  const fade = THREE.MathUtils.smoothstep(p.elevation, -2, 2);
  const top = Math.PI * p.sunIntensity * Math.max(fade, 0.25);
  const muS = Math.max(mu, 0.015);
  const clear = T.map((t) => 0.5 * top * muS * (1 - t));
  let diffuse = clear;
  // the clouds scatter what they block, grey, and grey the sky they cover
  const scattered = 0.6 * lum(sun) * block * muS;
  const gray = lum(diffuse);
  diffuse = diffuse.map((v) => v + (gray - v) * 0.8 * c + scattered);
  const ground = direct.map((v, k) => v * mu + diffuse[k]);
  // clear — the sky's colour without the clouds (the lights' tint; the clouds grey it after)
  return { sun, direct, diffuse, clear, ground, pass: 1 - block, white: lum(ground) };
}

let reference = null;
function referenceLight() {
  if (!reference) {
    const dir = new THREE.Vector3(), col = new THREE.Vector3();
    updateSun(LDR_REFERENCE, dir, col);
    reference = skyLight(LDR_REFERENCE, col, dir);
  }
  return reference;
}

/** x's colour against ref's, luminance 1, LDR_TINT of the shift kept */
function tint(/** @type {number[]} */ x, /** @type {number[]} */ ref, /** @type {THREE.Color} */ out) {
  const rel = x.map((v, k) => v / Math.max(ref[k], 1e-9));
  const l = lum(rel);
  if (!(l > 1e-9)) return out.setRGB(1, 1, 1);
  const k = (/** @type {number} */ v) => 1 + (v / l - 1) * LDR_TINT;
  return out.setRGB(k(rel[0]), k(rel[1]), k(rel[2]));
}

/**
 * @typedef {{ sun: { color: THREE.Color, intensity: number },
 *   hemisphere: { sky: THREE.Color, ground: THREE.Color, intensity: number },
 *   exposure: number, iblExposure: number, gain: number }} LdrLights
 *   intensities as three's lights take them; exposure — the scale of the sky's radiance into the
 *   LDR background; iblExposure — into the cube and env.envMap, which then stands in for the
 *   hemisphere (a host with scene.environment sets the hemisphere's intensity to 0); gain — the
 *   compressed brightness against the noon (1 at the noon)
 */

/** @returns {LdrLights} */
export const createLdrLights = () => ({
  sun: { color: new THREE.Color(1, 1, 1), intensity: THREE_LIGHTS.sun },
  hemisphere: { sky: new THREE.Color(THREE_LIGHTS.sky), ground: new THREE.Color(THREE_LIGHTS.ground), intensity: THREE_LIGHTS.hemisphere },
  exposure: 1, iblExposure: 1, gain: 1,
});

const threeGround = new THREE.Color(THREE_LIGHTS.ground);
const groundTint = new THREE.Color();
const white = new THREE.Color(1, 1, 1);

/**
 * The LDR lights for sky params p, written into `out` in place.
 * @param {Parameters<typeof skyLight>[0]} p
 * @param {Parameters<typeof skyLight>[1]} color
 * @param {Parameters<typeof skyLight>[2]} direction
 * @param {LdrLights} [out]
 */
export function ldrLighting(p, color, direction, out = createLdrLights()) {
  const ref = referenceLight(), now = skyLight(p, color, direction);
  const ratio = Math.max(now.white / ref.white, 1e-6);
  const gain = THREE.MathUtils.clamp(ratio ** LDR_GAMMA, LDR_GAIN_MIN, LDR_GAIN_MAX);
  // one brightness for both lights (three's split of 2 : 2.5 is far from the physical one, so each
  // light is not scaled by its own physical ratio): the sun keeps its share by how much of it the
  // air (a low sun) and the clouds let through; what the clouds take, the sky light gets half back
  const through = Math.min(1, lum(now.sun) / lum(ref.sun)), cloudPass = now.pass / ref.pass;
  tint(now.direct, ref.direct, out.sun.color);
  out.sun.intensity = THREE_LIGHTS.sun * gain * through * Math.min(1, cloudPass);
  // a grey sky against a blue noon would read as orange: tint by the clear sky, then the clouds
  // take the colour out toward white
  const grey = 0.8 * clamp01(p.cloudCoverage);
  tint(now.clear, ref.clear, out.hemisphere.sky).lerp(white, grey);
  tint(now.ground, ref.ground, groundTint).lerp(white, grey);
  out.hemisphere.ground.copy(threeGround).multiply(groundTint);
  let hemi = THREE_LIGHTS.hemisphere * gain * (1 + 0.5 * Math.max(0, 1 - cloudPass));
  // the floor: a vertical white sheet facing away from the sun (hemisphere weight 0.5)
  const side = PAPER * (0.5 * (clum(out.hemisphere.sky) + clum(out.hemisphere.ground))) / Math.PI;
  hemi = Math.max(hemi, toLinear(LDR_FLOOR) / Math.max(side, 1e-6));
  out.hemisphere.intensity = hemi;
  // the background: the clear sky's radiance (≈ clear/π) brought to LDR_SKY_KEY × gain
  out.exposure = LDR_SKY_KEY * gain * Math.PI / Math.max(lum(now.clear), 1e-9);
  // the IBL (env.envMap) replaces the hemisphere, not adds to it: the cube's mean radiance (≈ the
  // sky light / π) is brought to what the hemisphere gives a level white sheet (hemi / π)
  out.iblExposure = LDR_IBL_K * hemi / Math.max(lum(now.diffuse), 1e-9);
  out.gain = gain;
  return out;
}
