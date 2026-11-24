import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { LDR_FLOOR, LDR_GAIN_MAX, LDR_GAIN_MIN, LDR_REFERENCE, THREE_LIGHTS, ldrLighting, skyLight } from '../src/environment/ldr.js';
import { MOOD_MAP_V1, SUN_PATH_V1, sampleMood, sunAt } from '../src/environment/mood.js';
import { updateSun } from '../src/environment/sun.js';

// SCENE-ENVIRONMENT E3: the LDR lights (spec §5.4) — three's lights at the clear noon, the
// readability floor under every anchor at dawn, noon and dusk (MOOD-WEATHER §6 п.5 points).

const ANCHORS = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((v) => ({ v, a })));
const DAY = [0.05, 0.5, 0.95];

function lightsAt(sky, t) {
  const p = { ...sky, ...sunAt(SUN_PATH_V1, t), rayleigh: 1 };
  const dir = new THREE.Vector3(), col = new THREE.Vector3();
  updateSun(p, dir, col);
  return { p, l: ldrLighting(p, col, dir), dir, col };
}
const clum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const toSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
/** a white sheet on the side away from the sun: the hemisphere at weight 0.5, Lambert */
const sideWhite = (l) => toSrgb(l.hemisphere.intensity * 0.5 * (clum(l.hemisphere.sky) + clum(l.hemisphere.ground)) / Math.PI);

describe('ldrLighting', () => {
  test('the reference is the clear noon: the day\'s middle and the warm-sun anchor', () => {
    const { elevation, azimuth } = sunAt(SUN_PATH_V1, 0.5);
    expect(LDR_REFERENCE).toMatchObject({ elevation, azimuth, ...MOOD_MAP_V1.grid[1][2].sky });
  });

  test('at the reference the lights are three\'s current ones', () => {
    const { l } = lightsAt(MOOD_MAP_V1.grid[1][2].sky, 0.5);
    expect(l.sun.intensity).toBeCloseTo(THREE_LIGHTS.sun, 6);
    expect(l.hemisphere.intensity).toBeCloseTo(THREE_LIGHTS.hemisphere, 6);
    expect(l.sun.color.getHex()).toBe(0xffffff);
    expect(l.hemisphere.sky.getHex()).toBe(THREE_LIGHTS.sky);
    expect(l.hemisphere.ground.getHex()).toBe(THREE_LIGHTS.ground);
    expect(l.gain).toBeCloseTo(1, 6);
  });

  test.each(ANCHORS.flatMap(({ v, a }) => DAY.map((t) => [v, a, t])))(
    'mood (%d, %d) at t %d: the side-lit white sheet ≥ the floor, the gain inside its bounds',
    (v, a, t) => {
      const { l } = lightsAt(sampleMood(MOOD_MAP_V1, v, a).sky, t);
      expect(sideWhite(l)).toBeGreaterThanOrEqual(LDR_FLOOR - 1e-9);
      expect(l.gain).toBeGreaterThanOrEqual(LDR_GAIN_MIN);
      expect(l.gain).toBeLessThanOrEqual(LDR_GAIN_MAX);
      expect(l.exposure).toBeGreaterThan(0);
      expect(Number.isFinite(l.sun.intensity)).toBe(true);
    });

  test('dawn is warmer and dimmer than the noon, a storm dimmer, its sky light greyed by the clouds', () => {
    const noon = lightsAt(MOOD_MAP_V1.grid[1][2].sky, 0.5).l;
    const dawn = lightsAt(MOOD_MAP_V1.grid[1][2].sky, 0.05).l;
    expect(dawn.sun.color.r / dawn.sun.color.b).toBeGreaterThan(1.2);
    expect(dawn.gain).toBeLessThan(noon.gain);
    const storm = lightsAt(MOOD_MAP_V1.grid[2][0].sky, 0.5).l;   // A1
    expect(storm.sun.intensity).toBeLessThan(noon.sun.intensity * 0.6);
    // the clouds grey the sky light of the same state
    const sat = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    const stormClear = lightsAt({ ...MOOD_MAP_V1.grid[2][0].sky, cloudCoverage: 0 }, 0.5).l;
    expect(sat(storm.hemisphere.sky)).toBeLessThan(sat(stormClear.hemisphere.sky) * 0.4);
  });

  test('the clouds move the direct sun into the sky light', () => {
    const base = { ...LDR_REFERENCE };
    const dir = new THREE.Vector3(), col = new THREE.Vector3();
    updateSun(base, dir, col);
    const clear = skyLight({ ...base, cloudCoverage: 0 }, col, dir);
    const overcast = skyLight({ ...base, cloudCoverage: 0.95 }, col, dir);
    expect(overcast.direct[1]).toBeLessThan(clear.direct[1] * 0.4);
    expect(overcast.diffuse[1]).toBeGreaterThan(clear.diffuse[1]);
  });
});
