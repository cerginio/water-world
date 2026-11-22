import { describe, expect, test } from 'vitest';
import { TripleTap, panelsFromUrl } from '../src/ui/techPanels.js';

// SCENE-UI-SPEC §3.1 / §3.2: which panels a URL opens, and the three-finger tap rule.

describe('panelsFromUrl', () => {
  const at = (q) => panelsFromUrl(new URLSearchParams(q));
  test('no parameters: both hidden', () => expect(at('')).toEqual({ controls: false, fps: false }));
  test('?tiles alone changes nothing', () => expect(at('tiles=story')).toEqual({ controls: false, fps: false }));
  test('?fps: only FPS', () => expect(at('fps')).toEqual({ controls: false, fps: true }));
  test('?controls: only Controls', () => expect(at('controls')).toEqual({ controls: true, fps: false }));
  test('?debug: both', () => expect(at('debug')).toEqual({ controls: true, fps: true }));
});

describe('TripleTap', () => {
  const make = () => {
    const tap = { n: 0 };
    tap.d = new TripleTap(() => tap.n++);
    return tap;
  };
  const three = (d, { gaps = [0, 50, 100], lift = 200, moveBy = 0 } = {}) => {
    gaps.forEach((t, i) => d.down(i, 100 * i, 100, t));
    const t3 = gaps[2];
    [0, 1, 2].forEach((i) => d.up(i, 100 * i + moveBy, 100, t3 + lift));
  };

  test('three quick still touches fire once', () => {
    const t = make(); three(t.d); expect(t.n).toBe(1);
  });
  test('the next tap fires again (toggles back)', () => {
    const t = make(); three(t.d); three(t.d, { gaps: [1000, 1010, 1020] }); expect(t.n).toBe(2);
  });
  test('third touch later than 300 ms does not fire', () => {
    const t = make(); three(t.d, { gaps: [0, 100, 301] }); expect(t.n).toBe(0);
  });
  test('lift later than 500 ms does not fire', () => {
    const t = make(); three(t.d, { lift: 501 }); expect(t.n).toBe(0);
  });
  test('a finger moved 10 px does not fire', () => {
    const t = make(); three(t.d, { moveBy: 10 }); expect(t.n).toBe(0);
  });
  test('9 px of jitter still fires', () => {
    const t = make(); three(t.d, { moveBy: 9 }); expect(t.n).toBe(1);
  });
  test('two fingers do not fire', () => {
    const t = make();
    t.d.down(0, 0, 0, 0); t.d.down(1, 50, 0, 10); t.d.up(0, 0, 0, 100); t.d.up(1, 50, 0, 100);
    expect(t.n).toBe(0);
  });
  test('a fourth finger voids the tap', () => {
    const t = make();
    [0, 1, 2, 3].forEach((i) => t.d.down(i, 50 * i, 0, 10 * i));
    [0, 1, 2, 3].forEach((i) => t.d.up(i, 50 * i, 0, 100));
    expect(t.n).toBe(0);
  });
  test('a cancelled touch voids the tap and the detector recovers', () => {
    const t = make();
    [0, 1, 2].forEach((i) => t.d.down(i, 50 * i, 0, 10 * i));
    t.d.cancel(1); t.d.up(0, 0, 0, 100); t.d.up(2, 100, 0, 100);
    expect(t.n).toBe(0);
    three(t.d, { gaps: [500, 510, 520] });
    expect(t.n).toBe(1);
  });
});
