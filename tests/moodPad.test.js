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

// MOOD-WEATHER M3: the content (spec §4.2) — whose words show under the window, and the locales.
import { MOOD_MAP_V1 } from '../src/environment/mood.js';
import { MOOD_LOCALES, moodColors, nearestCell, wordsCells, wordsText } from '../src/environment/ui/moodPad.js';

const uk = (/** @type {string} */ k) => MOOD_LOCALES.uk.words[k];
const id = (/** @type {{ row: number, col: number }[]} */ cells) => cells.map(({ row, col }) => MOOD_MAP_V1.grid[row][col].id);

describe('emotional words', () => {
  test('A9 shows «спокій · умиротворення» (spec §6 p.7)', () => {
    expect(wordsText(wordsCells(1, -1), uk)).toBe('спокій · умиротворення');
    expect(wordsText(wordsCells(0.8, -0.75), uk)).toBe('спокій · умиротворення');
  });
  test('the nearest anchor inside a cell', () => {
    expect(id(wordsCells(-1, 1))).toEqual(['A1']);
    expect(id(wordsCells(0.1, -0.1))).toEqual(['A5']);
    expect(id(wordsCells(-0.7, -0.2))).toEqual(['A4']);
  });
  test('on the border of A9 and A6 — the first word of each, the nearer first (spec §4.2)', () => {
    expect(id(wordsCells(1, -0.53))).toEqual(['A9', 'A6']);
    expect(wordsText(wordsCells(1, -0.53), uk)).toBe('спокій · задоволення');
    expect(id(wordsCells(1, -0.47))).toEqual(['A6', 'A9']);
    expect(id(wordsCells(1, -0.65))).toEqual(['A9']);
  });
  test('where four cells meet, the nearest two', () => {
    expect(wordsCells(0.52, 0.47)).toHaveLength(2);
    expect(id(wordsCells(0.53, 0.47))[0]).toBe('A6');
  });
  test('nearest cell rounds to the anchor grid', () => {
    expect(nearestCell(1, -1)).toEqual({ row: 0, col: 2 });
    expect(nearestCell(-1, 1)).toEqual({ row: 2, col: 0 });
  });
});

describe('locales', () => {
  test('every name and word key of the map has a string in uk and en', () => {
    for (const lang of ['uk', 'en']) {
      for (const m of MOOD_MAP_V1.grid.flat()) {
        expect(MOOD_LOCALES[lang].names[m.name], `${lang} ${m.name}`).toBeTruthy();
        for (const w of m.words) expect(MOOD_LOCALES[lang].words[w], `${lang} ${w}`).toBeTruthy();
      }
    }
  });
  test('the approved names and words (spec §3.1, §4.2; owner 2026-11-23)', () => {
    const names = (lang) => MOOD_MAP_V1.grid.flat().sort((p, q) => p.id.localeCompare(q.id)).map((m) => MOOD_LOCALES[lang].names[m.name]);
    expect(names('uk')).toEqual(['Шторм', 'Рвані хмари', 'Бриз', 'Похмуро', 'Сонце з-за хмар', 'Тепле сонце', 'Туман', 'Тихо й хмарно', 'Штиль']);
    expect(names('en')).toEqual(['Storm', 'Torn clouds', 'Breeze', 'Overcast', 'Sun through clouds', 'Warm sun', 'Fog', 'Quiet and cloudy', 'Calm']);
    expect(wordsText(wordsCells(-1, 1), (k) => MOOD_LOCALES.en.words[k])).toBe('tension · too much at once');
  });
  test('no digits anywhere in the widget\'s strings (spec §6 p.9)', () => {
    expect(JSON.stringify(MOOD_LOCALES)).not.toMatch(/\d/);
  });
});

describe('thumbnail colours', () => {
  test('clear is bluer than cloudy; the ends of the day are warmer at the horizon', () => {
    const rgb = (s) => s.match(/\d+/g).map(Number);
    const [cr, , cb] = rgb(moodColors(1, -1, 0.5).skyTop), [gr, , gb] = rgb(moodColors(-1, -1, 0.5).skyTop);
    expect(cb - cr).toBeGreaterThan(gb - gr);
    expect(rgb(moodColors(0, 0, 0).skyLow)[0]).toBeGreaterThan(rgb(moodColors(0, 0, 0.5).skyLow)[0]);
  });
});
