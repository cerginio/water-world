import { describe, expect, test } from 'vitest';
import { ARC_W, arcPoint, arcToDay, moodToPad, padToMood } from '../src/environment/ui/moodPad.js';

// MOOD-WEATHER M1b: the widget's geometry (spec §4.2) — the window maps to (v, a), the arc to t.

describe('weather window', () => {
  test('corners are the corner anchors: top-left A1 storm, bottom-right A9 calm', () => {
    expect(padToMood(0, 0, 240)).toEqual({ v: -1, a: 1 });
    expect(padToMood(240, 240, 240)).toEqual({ v: 1, a: -1 });
    expect(padToMood(240, 0, 240)).toEqual({ v: 1, a: 1 });
    expect(padToMood(120, 120, 240)).toEqual({ v: 0, a: 0 });
  });
  test('outside the window clamps to its edge', () => {
    expect(padToMood(-50, 400, 240)).toEqual({ v: -1, a: -1 });
    expect(padToMood(500, -10, 320)).toEqual({ v: 1, a: 1 });
  });
  test('the pebble round-trips at any window size', () => {
    for (const size of [240, 320, 206]) {
      for (const [v, a] of [[1, -1], [-0.4, 0.7], [0, 0]]) {
        const p = moodToPad(v, a), m = padToMood(p.x * size, p.y * size, size);
        expect(m.v).toBeCloseTo(v, 12);
        expect(m.a).toBeCloseTo(a, 12);
      }
    }
  });
});

describe('sun arc', () => {
  test('dawn on the left, noon on top, sunset on the right', () => {
    const dawn = arcPoint(0), noon = arcPoint(0.5), set = arcPoint(1);
    expect(dawn.x).toBeLessThan(noon.x);
    expect(set.x).toBeGreaterThan(noon.x);
    expect(noon.x).toBeCloseTo(ARC_W / 2, 9);
    expect(noon.y).toBeLessThan(dawn.y);
    expect(dawn.y).toBeCloseTo(set.y, 9);
  });
  test('a point on the arc gives back its day', () => {
    for (const t of [0, 0.05, 0.1, 0.5, 0.73, 1]) {
      const p = arcPoint(t);
      expect(arcToDay(p.x, p.y)).toBeCloseTo(t, 9);
    }
  });
  test('the arc does not go past dawn or sunset (spec §4.3)', () => {
    const dawn = arcPoint(0), set = arcPoint(1);
    expect(arcToDay(dawn.x - 30, dawn.y + 20)).toBe(0);
    expect(arcToDay(set.x + 30, set.y + 20)).toBe(1);
    expect(arcToDay(-100, -100)).toBeGreaterThanOrEqual(0);
    expect(arcToDay(1000, -100)).toBeLessThanOrEqual(1);
  });
});
