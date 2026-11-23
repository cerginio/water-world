import { describe, expect, it, test } from 'vitest';
import { MOOD_MAP_V1, SUN_PATH_V1, sampleMood, stepToward, sunAt } from '../src/environment/mood.js';
import { WATER_PRESETS, mixWater } from '../src/environment-bindings/seaBinding.js';

// MOOD-WEATHER M1a: the matrix of spec §3.2 and the sun path of spec §2.2 as data.

// spec §3.2, one row per channel, columns A1…A9
const TABLE = {
  'sky.sunIntensity': [7, 9, 10, 8, 9, 9.5, 8, 8.5, 9],
  'sky.cloudCoverage': [0.95, 0.45, 0.2, 0.88, 0.38, 0.15, 0.6, 0.55, 0.12],
  'sky.turbidity': [5, 2, 1.5, 4, 2, 1.8, 8, 2.5, 1.6],
  'sky.cloudSpeed': [4, 3, 2, 1, 1, 0.8, 0.3, 0.5, 0.2],
  'sea.windSpeed': [22, 15, 10, 6, 7, 5, 2, 2.5, 1.5],
  'sea.waveScale': [0.45, 0.3, 0.18, 0.1, 0.12, 0.1, 0.05, 0.06, 0.04],
  'sea.swellScale': [1.2, 0.9, 0.7, 0.5, 0.6, 0.6, 0.35, 0.4, 0.3],
  'sea.choppiness': [1.5, 1.15, 0.9, 0.7, 0.8, 0.7, 0.5, 0.5, 0.4],
  'sea.shore': [1.6, 1.3, 1.0, 0.8, 0.9, 0.8, 0.5, 0.5, 0.4],
  'sea.spray': [2.5, 1.6, 1.0, 0.6, 0.8, 0.6, 0.3, 0.3, 0.2],
  'sea.clarity': [0.5, 1, 1.3, 0.6, 1, 1.1, 0.7, 0.9, 1.5],
  'sea.fog': [6, 1.5, 0.8, 3, 1, 0.9, 8, 1.5, 0.8],
  'grade.keyValue': [0.12, 0.18, 0.22, 0.14, 0.18, 0.2, 0.15, 0.16, 0.2],
  'grade.contrast': [1.2, 1.15, 1.12, 1.0, 1.1, 1.12, 0.92, 1.02, 1.08],
  'grade.saturation': [0.8, 1.25, 1.4, 0.8, 1.25, 1.35, 0.7, 1.0, 1.3],
};
const WATER = [{ clear: 0.5, 'murky brown': 0.5 }, { clear: 1 }, { tropical: 1 }, { clear: 1 }, { clear: 1 }, { clear: 1 }, { clear: 1 }, { clear: 1 }, { tropical: 1 }];
// A1…A9 → (v, a), spec §3.1
const AT = [[-1, 1], [0, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
const get = (o, path) => path.split('.').reduce((x, k) => x[k], o);
const flat = (s) => Object.keys(TABLE).map((k) => get(s, k));

describe('sampleMood', () => {
  test('the grid is 3×3, rows by arousal, columns by valence', () => {
    expect(MOOD_MAP_V1.version).toBe('mood@1');
    expect(MOOD_MAP_V1.grid.map((r) => r.map((m) => m.id))).toEqual([['A7', 'A8', 'A9'], ['A4', 'A5', 'A6'], ['A1', 'A2', 'A3']]);
  });

  AT.forEach(([v, a], i) => test(`A${i + 1} at (${v}, ${a}) = spec §3.2`, () => {
    const s = sampleMood(MOOD_MAP_V1, v, a);
    expect(s.anchor).toBe(`A${i + 1}`);
    for (const [k, row] of Object.entries(TABLE)) expect(get(s, k), k).toBeCloseTo(row[i], 10);
    const water = Object.fromEntries(Object.entries(s.sea.water).filter(([, wt]) => wt > 0));
    expect(water).toEqual(WATER[i]);
  }));

  test('A9 words: calm · peace', () => {
    expect(sampleMood(MOOD_MAP_V1, 1, -1).words).toEqual(['calm', 'peace']);
  });

  test('the centre of a cell is the mean of its four corners', () => {
    for (const [v, a, corners] of [[-0.5, -0.5, [7, 8, 4, 5]], [0.5, 0.5, [5, 6, 2, 3]], [0.5, -0.5, [8, 9, 5, 6]], [-0.5, 0.5, [4, 5, 1, 2]]]) {
      const got = flat(sampleMood(MOOD_MAP_V1, v, a));
      const want = Object.values(TABLE).map((row) => corners.reduce((sum, n) => sum + row[n - 1], 0) / 4);
      got.forEach((x, j) => expect(x).toBeCloseTo(want[j], 10));
    }
  });

  test('continuous across the cell borders and inside', () => {
    const eps = 1e-6;
    for (let a = -1; a <= 1; a += 0.125) {
      for (let v = -1; v <= 1; v += 0.125) {
        const p = flat(sampleMood(MOOD_MAP_V1, v, a));
        for (const [dv, da] of [[eps, 0], [-eps, 0], [0, eps], [0, -eps]]) {
          const q = flat(sampleMood(MOOD_MAP_V1, v + dv, a + da));
          // the steepest channel (wind, 22 − 7 over one cell) moves < 2e-5 for 1e-6
          q.forEach((x, j) => expect(Math.abs(x - p[j])).toBeLessThan(2e-5));
        }
      }
    }
  });

  test('water weights sum to 1 everywhere', () => {
    for (const [v, a] of [[-0.75, 0.6], [0.3, -0.2], [-1, 0.5], [0.9, 0.9]]) {
      const sum = Object.values(sampleMood(MOOD_MAP_V1, v, a).sea.water).reduce((x, y) => x + y, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  test('out of range and NaN clamp to the edge, never throw', () => {
    expect(flat(sampleMood(MOOD_MAP_V1, 5, -7))).toEqual(flat(sampleMood(MOOD_MAP_V1, 1, -1)));
    expect(flat(sampleMood(MOOD_MAP_V1, NaN, NaN))).toEqual(flat(sampleMood(MOOD_MAP_V1, 0, 0)));
  });

  test('the storm is bounded: wind 22, not the engine max 25', () => {
    let max = 0;
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) max = Math.max(max, sampleMood(MOOD_MAP_V1, j / 20 - 1, i / 20 - 1).sea.windSpeed);
    expect(max).toBeCloseTo(22, 10);
  });
});

describe('sunAt', () => {
  // spec §2.2
  test.each([
    [0, -2, 25], [0.1, -2 + 62 * Math.sin(Math.PI * 0.1), 43], [0.5, 60, 115], [1, -2, 205],
  ])('t = %s → elevation %s°, azimuth %s°', (t, el, az) => {
    const s = sunAt(SUN_PATH_V1, t);
    expect(s.elevation).toBeCloseTo(el, 10);
    expect(s.azimuth).toBeCloseTo(az, 10);
  });

  test('morning t = 0.1 is ≈ 17°', () => {
    expect(Math.round(sunAt(SUN_PATH_V1, 0.1).elevation)).toBe(17);
  });

  test('never below −2°, never past sunrise or sunset', () => {
    for (const t of [-1, -0.01, 1.01, 3, NaN]) {
      const s = sunAt(SUN_PATH_V1, t);
      expect(s.elevation).toBeGreaterThanOrEqual(-2);
      expect(s.azimuth).toBeGreaterThanOrEqual(25);
      expect(s.azimuth).toBeLessThanOrEqual(205);
    }
  });

  test('sets on the 205° the shots are built around', () => {
    expect(SUN_PATH_V1.setAzimuth).toBe(205);
    expect(sunAt(SUN_PATH_V1, 1).azimuth).toBe(205);
  });
});

describe('mixWater', () => {
  test('a single preset is the preset', () => {
    expect(mixWater({ tropical: 1 })).toEqual({ ...WATER_PRESETS.tropical });
  });
  test('murky ½ is the channel-wise mean of clear and murky brown', () => {
    const m = mixWater({ clear: 0.5, 'murky brown': 0.5 }), c = WATER_PRESETS.clear, b = WATER_PRESETS['murky brown'];
    for (const k of ['absorption', 'scatter', 'foam']) m[k].forEach((x, i) => expect(x).toBeCloseTo((c[k][i] + b[k][i]) / 2, 12));
    expect(m.turbidity).toBeCloseTo((c.turbidity + b.turbidity) / 2, 12);
  });
  test('no known preset falls back to clear', () => {
    expect(mixWater({ nonsuch: 1 })).toEqual({ ...WATER_PRESETS.clear });
  });
});

describe('stepToward (spec §4.4)', () => {
  it('is monotonic and 95 % done after 3τ', () => {
    const cur = { x: 0, rgb: [1, 0, 0.5] }, to = { x: 10, rgb: [0, 1, 0.5] };
    let prev = 0, t = 0;
    while (t < 30 - 1e-9) {
      stepToward(cur, to, 1 / 60, 10);
      t += 1 / 60;
      expect(cur.x).toBeGreaterThanOrEqual(prev);
      prev = cur.x;
    }
    expect(cur.x / 10).toBeCloseTo(1 - Math.exp(-3), 6);
    expect(cur.x / 10).toBeGreaterThan(0.95);
    expect(cur.rgb[0]).toBeCloseTo(Math.exp(-3), 6);
    expect(cur.rgb[2]).toBe(0.5);
  });

  it('does not depend on how the time is cut', () => {
    const a = { x: 0 }, b = { x: 0 };
    for (let i = 0; i < 60; i++) stepToward(a, { x: 1 }, 1 / 60, 6);
    stepToward(b, { x: 1 }, 1, 6);
    expect(a.x).toBeCloseTo(b.x, 12);
  });

  it('snaps at τ 0, arrives and reports rest', () => {
    const cur = { x: 3, o: { y: 1 } };
    expect(stepToward(cur, { x: 5, o: { y: 2 } }, 0, 0)).toBe(false);
    expect(cur).toEqual({ x: 5, o: { y: 2 } });
    const c = { x: 0 };
    let n = 0;
    while (stepToward(c, { x: 1 }, 1 / 60, 1)) n++;
    expect(c.x).toBe(1);
    expect(n / 60).toBeGreaterThan(8);   // ln(1e4) ≈ 9.2 τ to within 1e-4
    expect(n / 60).toBeLessThan(10);
  });

  it('takes the target for a key the current state lacks', () => {
    const cur = {};
    stepToward(cur, { x: 2, v: [1, 2] }, 1 / 60, 6);
    expect(cur).toEqual({ x: 2, v: [1, 2] });
  });
});
