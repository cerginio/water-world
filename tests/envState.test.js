import { describe, expect, test } from 'vitest';
import { SKY_EPS, createSkyState } from '../src/environment/state.js';

// SCENE-ENVIRONMENT E2: τ-smoothing of the sky state (spec §4, §5.3 setState/update).

const params = () => ({ elevation: 3.5, azimuth: 205, turbidity: 2, rayleigh: 1, cloudCoverage: 0.38, sunIntensity: 9 });
const run = (s, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) s.step(dt); };

describe('createSkyState', () => {
  test('τ 0 puts the key there at once and reports the snap', () => {
    const p = params(), s = createSkyState(p);
    expect(s.setTarget({ elevation: 40 }, 0)).toBe(true);
    expect(p.elevation).toBe(40);
    expect(s.moving).toBe(false);
    expect(s.setTarget({ elevation: 40 }, 0)).toBe(false);   // same value: nothing to bake
  });

  test('a move is monotonic and 95 % done after 3τ', () => {
    const p = params(), s = createSkyState(p), tau = 2;
    s.setTarget({ elevation: 53.5, cloudCoverage: 0.95 }, tau);
    expect(p.elevation).toBe(3.5);
    expect(s.moving).toBe(true);
    let prev = p.elevation;
    for (let t = 0; t < 3 * tau - 1e-9; t += 1 / 60) {
      s.step(1 / 60);
      expect(p.elevation).toBeGreaterThan(prev);
      prev = p.elevation;
    }
    expect((p.elevation - 3.5) / 50).toBeCloseTo(1 - Math.exp(-3), 2);
    expect((p.elevation - 3.5) / 50).toBeGreaterThanOrEqual(0.95);
  });

  test('arrives exactly and stops', () => {
    const p = params(), s = createSkyState(p);
    s.setTarget({ sunIntensity: 7, turbidity: 5 }, 0.5);
    run(s, 10);
    expect(s.moving).toBe(false);
    expect(p.sunIntensity).toBe(7);
    expect(p.turbidity).toBe(5);
    expect(s.step(1 / 60)).toBe(false);
  });

  test('azimuth goes the short way round and stays in [0, 360)', () => {
    const p = { ...params(), azimuth: 350 }, s = createSkyState(p);
    s.setTarget({ azimuth: 10 }, 1);
    const seen = [];
    for (let i = 0; i < 600; i++) { s.step(1 / 60); seen.push(p.azimuth); }
    expect(seen.every((a) => a >= 0 && a < 360)).toBe(true);
    // never through 180: the short way is 20° across north
    expect(seen.every((a) => a >= 350 || a <= 10)).toBe(true);
    expect(p.azimuth).toBe(10);
    s.setTarget({ azimuth: -155 }, 0);
    expect(p.azimuth).toBe(205);
  });

  test('keys keep their own τ; unknown keys and NaN are ignored', () => {
    const p = params(), s = createSkyState(p);
    s.setTarget({ elevation: 13.5 }, 0.1);
    s.setTarget({ cloudCoverage: 0.88, nonsuch: 1, sunIntensity: Number.NaN }, 10);
    run(s, 1);
    expect(p.elevation).toBe(13.5);
    expect(p.cloudCoverage).toBeLessThan(0.88 - 0.4);
    expect(p.sunIntensity).toBe(9);
    expect(s.target).not.toHaveProperty('nonsuch');
  });

  test('a target within EPS snaps without a move', () => {
    const p = params(), s = createSkyState(p);
    s.setTarget({ elevation: 3.5 + SKY_EPS.elevation / 2 }, 6);
    expect(s.moving).toBe(false);
    expect(p.elevation).toBe(3.5 + SKY_EPS.elevation / 2);
  });
});
