import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { clampToDeck, deckAt, fromDeck, onDeck, toDeck } from '../src/walker/deck.js';
import { createWalker, PACE } from '../src/walker/walker.js';
import { WALK } from '../src/walker/groundWalk.js';
import { RAFT, inOpenSea, openWater, stepRaft } from '../src/tiles/raftMotion.js';

// story-quest Q4 (STORY-QUEST-SPEC §2 п.5, §4.2, §4.3): the deck a walker stands on, the
// walker boarding / riding / leaving it, and the raft's motion under the kite. The real
// Tilecraft moveOnSheet, as in walker.test.js.
const root = resolveTilecraft('development');
const { moveOnSheet } = await import(pathToFileURL(`${root}/viewer/engines/three/core/gamifier/sheet-motion.js`).href);
const radius = 0.15 * WALK.bodyScale;
const UP = { x: 0, y: 1, z: 0 };
// a beach: dry land for x < 0, the shallows to −0.5 m at x = 5, deeper beyond
const beach = (x, z) => ({ height: Math.max(-20, -0.1 * x), normal: UP });
// a deck: a 10 × 6 m frame turned 30°, centred at (14, 0), its top at 0.2 m
const yawed = (a, id = 'f1', x = 14, z = 0) => ({ id, x, z, ux: Math.cos(a), uz: -Math.sin(a), vx: Math.sin(a), vz: Math.cos(a), hu: 5, hv: 3, y: 0.2 });

describe('deck', () => {
  test('world ↔ deck coordinates round-trip on a yawed deck', () => {
    const d = yawed(0.5);
    for (const [u, v] of [[0, 0], [4, -2], [-5, 3]]) {
      const p = fromDeck(d, u, v), q = toDeck(d, p.x, p.z);
      expect(q.u).toBeCloseTo(u, 12);
      expect(q.v).toBeCloseTo(v, 12);
    }
  });

  test('inside the rim, clamped to it, and the deck under a point', () => {
    const d = yawed(0.5);
    expect(onDeck(d, 4.7, 0, radius)).toBe(true);
    expect(onDeck(d, 4.8, 0, radius)).toBe(false);
    expect(clampToDeck(d, 9, -9, radius)).toEqual({ u: 5 - radius, v: -(3 - radius) });
    const p = fromDeck(d, 4, 2);
    expect(deckAt([d], p.x, p.z)?.id).toBe('f1');
    const out = fromDeck(d, 5.1, 0);
    expect(deckAt([d], out.x, out.z)).toBe(null);
    // two decks overlapping: the one whose rim is farther
    const e = yawed(0.5, 'f2', 22, 0);
    const near = fromDeck(e, -2, 0);
    expect(deckAt([d, e], near.x, near.z)?.id).toBe('f2');
  });
});

describe('the walker on a deck', () => {
  const setup = (deck) => {
    const list = [deck];
    const w = createWalker({ moveOnSheet, ground: beach, decks: () => list });
    return { w, list };
  };

  test('a step onto the deck boards it; ride() settles the feet to its height', () => {
    const deck = yawed(0);   // u along x: its near rim at x = 9
    const { w } = setup(deck);
    w.place(8.8, 0, Math.PI / 2);   // −0.88 m: in the water already, facing +x
    w.step(0.1, { forward: 1 });    // 0.42 m: onto the deck
    expect(w.state.deck?.id).toBe('f1');
    for (let i = 0; i < 60; i++) w.ride(1 / 60);
    expect(w.state.y).toBeCloseTo(0.2, 2);
  });

  test('from the wading line the walker jumps onto a deck 3 m out; the eyes glide, the feet do not', () => {
    const deck = { ...yawed(0), x: 13 };   // near rim at x = 8 (−0.8 m)
    const { w } = setup(deck);
    w.place(4.9, 0, Math.PI / 2);   // −0.49 m: as deep as the walker wades
    const eyes = w.eyes().position;
    w.step(1 / 60, { forward: 1 });
    expect(w.state.deck?.id).toBe('f1');
    expect(w.state.x).toBeCloseTo(8 + radius, 9);
    const glide = w.eyes().position;
    expect(Math.hypot(glide.x - eyes.x, glide.z - eyes.z)).toBeLessThan(1e-9);
    for (let i = 0; i < 60; i++) w.ride(1 / 60);
    const landed = w.eyes().position;
    expect(landed.x).toBeCloseTo(8 + radius, 2);   // 3.4 m of glide × e^(−1/0.15) = 4 mm left
    expect(landed.y).toBeCloseTo(0.2 + WALK.eye, 2);
    // from dry land, no jump: a deck 3 m out is not reached
    const far = setup({ ...yawed(0), x: 8 }).w;   // near rim at x = 3 (−0.3 m)
    far.place(-0.5, 0, Math.PI / 2);
    far.step(1 / 60, { forward: 1 });
    expect(far.state.deck).toBe(null);
  });

  test('a moving deck carries the walker; the walker keeps its place on it', () => {
    const deck = yawed(0.3);
    const { w } = setup(deck);
    w.board(deck, 1, -1);
    const before = toDeck(deck, w.state.x, w.state.z);
    deck.x += 50; deck.z -= 20;
    w.ride(1 / 60);
    const after = toDeck(deck, w.state.x, w.state.z);
    expect(after.u).toBeCloseTo(before.u, 9);
    expect(after.v).toBeCloseTo(before.v, 9);
  });

  test('walking to the rim over deep water stops at it, inside by the body radius', () => {
    const deck = yawed(0.3, 'f1', 200, 0);   // far out: −20 m under every rim
    const { w } = setup(deck);
    w.board(deck, 0, 0, 0.3 + Math.PI / 2);   // facing +u
    for (let i = 0; i < 100; i++) w.step(0.1, { forward: 1 });
    const p = toDeck(deck, w.state.x, w.state.z);
    expect(w.state.deck?.id).toBe('f1');
    expect(p.u).toBeCloseTo(5 - radius, 9);
    expect(Math.abs(p.v)).toBeLessThan(1e-9);
  });

  test('a step off the rim onto ground it can wade on leaves the deck', () => {
    const deck = yawed(0);
    const { w } = setup(deck);
    w.board(deck, -4.5, 0, -Math.PI / 2);   // facing −x, towards the beach (x 9 is −0.9 m…)
    // …so the step lands on −0.9 m: deeper than the wade, the rim holds
    for (let i = 0; i < 20; i++) w.step(0.1, { forward: 1 });
    expect(w.state.deck?.id).toBe('f1');
    // the deck brought in to the shallows: the near rim at x = 4 (−0.4 m)
    deck.x = 9;
    w.ride(1 / 60);
    for (let i = 0; i < 5; i++) w.step(0.1, { forward: 1 });
    expect(w.state.deck).toBe(null);
    expect(w.state.x).toBeLessThan(4.255);   // the rim, inside by the body radius
    expect(w.state.y).toBeCloseTo(beach(w.state.x, 0).height, 9);
  });

  test('a deck that is gone drops the walker into the water under it (Q5b), or onto the shallows', () => {
    const deck = yawed(0);   // over −1.4 m: deeper than the walker wades
    const { w, list } = setup(deck);
    w.board(deck, 0, 0);
    list.length = 0;
    w.ride(1 / 60);
    expect(w.state.deck).toBe(null);
    expect(w.state.swim).toEqual({ depth: 0, target: 0 });   // not onto the bed 1.4 m down
    const shallow = { ...yawed(0), x: 4 };   // the centre over −0.4 m
    const s = setup(shallow);
    s.w.board(shallow, 0, 0);
    s.list.length = 0;
    s.w.ride(1 / 60);
    expect(s.w.state.swim).toBe(null);
    expect(s.w.state.y).toBeCloseTo(beach(4, 0).height, 9);
  });

  test('direction(): forward along the yaw, strafe to its right, null without input', () => {
    const { w } = setup(yawed(0));
    w.place(0, 0, Math.PI / 2);
    expect(w.direction({ forward: 1 }).x).toBeCloseTo(1, 9);
    expect(w.direction({ strafe: 1 }).z).toBeCloseTo(1, 9);   // right of +x: (−cos yaw, sin yaw)
    expect(w.direction({})).toBe(null);
    expect(PACE.walk).toBeGreaterThan(0);
  });
});

describe('stepRaft', () => {
  const run = (s, seconds, options, dt = 1 / 60) => {
    for (let i = 0; i < seconds / dt; i++) s = stepRaft(s, dt, options);
    return s;
  };

  test('the kite pulls along the course up to its speed, whatever the drift', () => {
    const s = run({ x: 0, z: 0, vx: 0, vz: 0 }, 20, { pull: { x: 0.6, z: 0.8 }, drift: { x: -0.3, z: 0 } });
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(RAFT.speed, 2);
    expect(s.vx / s.vz).toBeCloseTo(0.75, 6);
  });

  test('let go, it slows to the drift', () => {
    const s = run({ x: 0, z: 0, vx: RAFT.speed, vz: 0 }, 20, { drift: { x: 0, z: 0.2 } });
    expect(s.vx).toBeCloseTo(0, 3);
    expect(s.vz).toBeCloseTo(0.2, 3);
  });

  test('no speed outwards past its limit; along it, it still goes', () => {
    const s = stepRaft({ x: RAFT.limit + 1, z: 0, vx: RAFT.speed, vz: 2 }, 1 / 60, { pull: { x: 1, z: 0 } });
    expect(s.vx).toBe(0);
    expect(s.vz).toBeGreaterThan(0);
  });

  test('aground: a step into shallow water is not taken', () => {
    const open = (x) => x < 100;
    const s = stepRaft({ x: 99.99, z: 0, vx: 8, vz: 0 }, 1 / 60, { pull: { x: 1, z: 0 }, open });
    expect(s).toEqual({ x: 99.99, z: 0, vx: 0, vz: 0, blocked: true });
  });
});

describe('the open sea and open water', () => {
  test('the edge of the shore map, a square', () => {
    expect(inOpenSea(899.9, 899.9)).toBe(false);
    expect(inOpenSea(900.1, 0)).toBe(true);
    expect(inOpenSea(0, -900.1)).toBe(true);
  });

  test('deep under the centre and the rim; no terrain is deep', () => {
    expect(openWater(beach, 40, 0, 6)).toBe(true);     // −3.4 m under the near rim
    expect(openWater(beach, 5, 0, 2)).toBe(false);      // −0.5 m under the centre
    expect(openWater(beach, 12, 0, 11.5)).toBe(false);  // −0.05 m under the near rim
    expect(openWater(beach, 12, 0, 10)).toBe(true);     // −0.2 m under it
    expect(openWater(() => null, 1e4, 0, 6)).toBe(true);
  });
});
