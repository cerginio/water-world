import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { deckClear, fromDeck } from '../src/walker/deck.js';
import { createWalker, DECK_JUMP } from '../src/walker/walker.js';
import { WALK } from '../src/walker/groundWalk.js';
import { FLIGHT, landing, stepFlight } from '../src/walker/flight.js';
import { RAFT } from '../src/tiles/raftMotion.js';

// story-quest Q4b (STORY-QUEST-SPEC §2 п.6, §4.2 v1.5): the board under the kite — its speed,
// its height over the mean water, landing on the ground, on a deck, into deep water (Q5b);
// a jump from one deck to another. The real Tilecraft moveOnSheet, as in raft.test.js.
const root = resolveTilecraft('development');
const { moveOnSheet } = await import(pathToFileURL(`${root}/viewer/engines/three/core/gamifier/sheet-motion.js`).href);
const UP = { x: 0, y: 1, z: 0 };
// a beach: dry land for x < 0, the wading line (−0.5 m) at x = 5, 20 m deep from x = 200
const beach = (x, z) => ({ height: Math.max(-20, -0.1 * x), normal: UP });
const deckOf = (id, x, z, hu = 5, hv = 3) => ({ id, x, z, ux: 1, uz: 0, vx: 0, vz: 1, hu, hv, y: 0.2 });
const dt = 1 / 60;

describe('stepFlight', () => {
  test('takes on 56 m/s along the course, seven times the raft (Q8)', () => {
    expect(FLIGHT.speed).toBe(7 * RAFT.speed);
    let s = { x: 0, y: 0.2, z: 0, vx: 0, vz: 0, t: 0 };
    for (let i = 0; i < 8 * 60; i++) s = stepFlight(s, dt, { x: 0, z: 1 });
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(0.99 * FLIGHT.speed);
    expect(Math.abs(s.vx)).toBeLessThan(1e-9);
    expect(s.z).toBeGreaterThan(130);
  });

  test('without a course it slows to a hover', () => {
    let s = { x: 0, y: 3, z: 0, vx: 24, vz: 0, t: 0 };
    for (let i = 0; i < 10 * 60; i++) s = stepFlight(s, dt, null);
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(0.01);
  });

  test('rises off the deck into the band 2–4 m over the mean water and keeps to it', () => {
    let s = { x: 0, y: 0.2, z: 0, vx: 0, vz: 0, t: 0 };
    for (let i = 0; i < 3 * 60; i++) s = stepFlight(s, dt, { x: 1, z: 0 });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 20 * 60; i++) {
      s = stepFlight(s, dt, { x: 1, z: 0 });
      lo = Math.min(lo, s.y); hi = Math.max(hi, s.y);
    }
    expect(lo).toBeGreaterThanOrEqual(2);
    expect(hi).toBeLessThanOrEqual(4);
    expect(hi - lo).toBeGreaterThan(0.3);   // it bobs, it is not a rail
  });

  test('no speed outwards past the limit', () => {
    let s = { x: FLIGHT.limit + 10, y: 3, z: 0, vx: 24, vz: 0, t: 0 };
    for (let i = 0; i < 60; i++) s = stepFlight(s, dt, { x: 1, z: 0 });
    expect(s.vx).toBeLessThanOrEqual(1e-9);
  });
});

describe('landing', () => {
  const decks = [deckOf('raft', 300, 0)];
  const at = (x, z) => decks.find((d) => Math.abs(x - d.x) <= d.hu && Math.abs(z - d.z) <= d.hv) ?? null;
  test('wadeable ground, a deck, or the water over deep water (Q5b)', () => {
    expect(landing(beach, at, 4.9, 0, WALK.wade)).toBe('ground');
    expect(landing(beach, at, 5.2, 0, WALK.wade)).toBe('water');
    expect(landing(beach, at, 300, 0, WALK.wade)).toBe('deck');
    expect(landing(beach, at, 250, 0, WALK.wade)).toBe('water');
    expect(landing(() => null, at, 2000, 0, WALK.wade)).toBe('water');   // off the terrain: deep
  });
});

describe('the walker on the board', () => {
  const setup = (list) => createWalker({ moveOnSheet, ground: beach, decks: () => list });

  test('takes off only from a deck; flies the course; lands by itself on the shallows', () => {
    const list = [deckOf('raft', 300, 0)];
    const w = setup(list);
    w.place(0, 0, -Math.PI / 2);
    expect(w.takeOff()).toBe(false);   // on the ground
    w.board(list[0], 0, 0, -Math.PI / 2);   // facing −x, the beach
    expect(w.takeOff({ x: -8, z: 0 })).toBe(true);
    expect(w.state.deck).toBe(null);
    expect(w.landing()).toBe('deck');   // still over the raft
    let landed = null, t = 0;
    while (!landed && t < 60) { landed = w.fly(dt, w.direction({ forward: 1 })); t += dt; }
    expect(landed).toBe('ground');
    expect(w.state.flight).toBe(null);
    expect(w.state.x).toBeLessThan(5.01);   // over the wading line, not past it
    expect(w.state.y).toBe(beach(w.state.x, 0).height);
    expect(t).toBeLessThan(300 / FLIGHT.speed + 4);
    // on the feet again: a step walks
    expect(w.step(0.1, { forward: 1 })).toBeGreaterThan(0.3);
  });

  test('lands on a deck under the board; the kite holds until it is asked to', () => {
    const list = [deckOf('raft', 300, 0), deckOf('other', 340, 0)];
    const w = setup(list);
    w.board(list[0], 0, 0, Math.PI / 2);   // facing +x, out to sea
    w.takeOff();
    for (let i = 0; i < 60; i++) w.fly(dt, { x: 1, z: 0 });
    while (w.state.x < 320) w.fly(dt, { x: 1, z: 0 });
    expect(w.landing()).toBe('water');   // deep water between the decks: nothing lands by itself
    expect(w.state.flight).not.toBe(null);
    while (w.state.x < 338) w.fly(dt, { x: 1, z: 0 });
    expect(w.land()).toBe('deck');
    expect(w.state.deck?.id).toBe('other');
    expect(w.state.flight).toBe(null);
    for (let i = 0; i < 60; i++) w.ride(dt);
    expect(w.state.y).toBeCloseTo(0.2, 2);
  });
});

describe('another frame beside the raft', () => {
  test('off the rim, a deck within a jump ahead boards it', () => {
    const list = [deckOf('raft', 300, 0), deckOf('mini', 300 + 5 + DECK_JUMP - 0.5 + 3, 0, 3, 3)];
    const w = createWalker({ moveOnSheet, ground: beach, decks: () => list });
    w.board(list[0], 4, 0, Math.PI / 2);
    for (let i = 0; i < 30 && w.state.deck?.id === 'raft'; i++) w.step(0.1, { forward: 1 });
    expect(w.state.deck?.id).toBe('mini');
  });

  test('aimed at its centre from a corner: the nearest point within a jump and 45°', () => {
    // a wide frame across the raft's +z side, 3 m off: from the raft's corner the line to its
    // centre meets it 6.7 m away, its nearest point is 3.8 m away, 38° off that line
    const list = [deckOf('raft', 300, 0), deckOf('wide', 316, 9, 10, 3)];
    const w = createWalker({ moveOnSheet, ground: beach, decks: () => list });
    w.board(list[0], 5, 3, Math.atan2(316 - 304.7, 9 - 2.7));   // clamped into the corner
    let moved = 0;
    for (let i = 0; i < 30 && w.state.deck?.id === 'raft'; i++) moved = w.step(0.1, { forward: 1 });
    expect(w.state.deck?.id).toBe('wide');
    expect(moved).toBeLessThanOrEqual(DECK_JUMP);
    // facing more than 45° away from it: the rim holds
    const v = createWalker({ moveOnSheet, ground: beach, decks: () => list });
    v.board(list[0], 5, 3, Math.PI / 2);   // facing +x, along the gap
    for (let i = 0; i < 30; i++) v.step(0.1, { forward: 1 });
    expect(v.state.deck?.id).toBe('raft');
  });

  test('a deck farther than a jump: the rim holds', () => {
    const list = [deckOf('raft', 300, 0), deckOf('far', 300 + 5 + DECK_JUMP + 1 + 3, 0, 3, 3)];
    const w = createWalker({ moveOnSheet, ground: beach, decks: () => list });
    w.board(list[0], 4, 0, Math.PI / 2);
    for (let i = 0; i < 30; i++) w.step(0.1, { forward: 1 });
    expect(w.state.deck?.id).toBe('raft');
  });

  test('deckClear: no deck within r of a point', () => {
    const d = deckOf('raft', 0, 0);   // |u| ≤ 5, |v| ≤ 3
    expect(deckClear([d], 0, 0, 1)).toBe(false);
    expect(deckClear([d], 9, 0, 3.9)).toBe(true);
    expect(deckClear([d], 9, 0, 4.1)).toBe(false);
    const corner = fromDeck(d, 5 + 3, 3 + 4);   // 5 m from the corner
    expect(deckClear([d], corner.x, corner.z, 4.9)).toBe(true);
    expect(deckClear([d], corner.x, corner.z, 5.1)).toBe(false);
  });
});
