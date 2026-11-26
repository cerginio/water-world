import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { deckClear, fromDeck } from '../src/walker/deck.js';
import { createWalker, DECK_JUMP } from '../src/walker/walker.js';
import { WALK } from '../src/walker/groundWalk.js';
import { FLIGHT, boardOn, boardState, landing, stepFlight } from '../src/walker/flight.js';
import { RAFT } from '../src/tiles/raftMotion.js';

// story-quest Q4b (STORY-QUEST-SPEC §2 п.6, §4.2 v1.5): the board under the kite — its speed,
// Q9 (§4.2 v1.6): its phases on the water and in the air as invariants of the states; landing on the ground, on a deck, into deep water (Q5b);
// a jump from one deck to another. The real Tilecraft moveOnSheet, as in raft.test.js.
const root = resolveTilecraft('development');
const { moveOnSheet } = await import(pathToFileURL(`${root}/viewer/engines/three/core/gamifier/sheet-motion.js`).href);
const UP = { x: 0, y: 1, z: 0 };
// a beach: dry land for x < 0, the wading line (−0.5 m) at x = 5, 20 m deep from x = 200
const beach = (x, z) => ({ height: Math.max(-20, -0.1 * x), normal: UP });
const deckOf = (id, x, z, hu = 5, hv = 3) => ({ id, x, z, ux: 1, uz: 0, vx: 0, vz: 1, hu, hv, y: 0.2 });
const dt = 1 / 60;

describe('stepFlight: the board on the water and the hills (§4.2 v1.6, Q9)', () => {
  const X = FLIGHT.unit;
  /** Runs the board `seconds` with `course(t)`; records the phase, the height, the speed each step. */
  const run = (seconds, course, start = { x: 0, y: 0, z: 0, ...boardOn({ x: 0, z: 0 }, 0, 'sit') }, world = {}) => {
    let s = start;
    const log = [];
    for (let i = 0; i < seconds * 60; i++) {
      const prev = s;
      s = stepFlight(s, dt, course(i * dt, s), { limit: Infinity, ...world });   // long straight runs
      log.push({ t: i * dt, phase: s.phase, y: s.y, vy: (s.y - prev.y) / dt, speed: Math.hypot(s.vx, s.vz) });
    }
    return { s, log };
  };
  const ahead = () => ({ x: 0, z: 1 });
  const first = (log, phase) => log.find((l) => l.phase === phase) ?? null;

  test('× is the raft speed; the ceiling is 7× (56 m/s, Q8)', () => {
    expect(X).toBe(RAFT.speed);
    expect(FLIGHT.speed).toBe(7 * RAFT.speed);
    const { log } = run(12, ahead);
    expect(Math.max(...log.map((l) => l.speed))).toBeLessThanOrEqual(FLIGHT.speed + 1e-9);
    expect(log.at(-1).speed).toBeGreaterThan(0.99 * FLIGHT.speed);
  });

  test('«forward» from sitting: planing in ~1.5 s, 7× in ~2.5 s more, then off the water', () => {
    const { log } = run(10, ahead);
    const plane = first(log, 'plane'), rise = first(log, 'rise');
    expect(plane.t).toBeGreaterThan(1.3);
    expect(plane.t).toBeLessThan(1.7);
    const top = log.find((l) => l.speed >= 0.99 * FLIGHT.speed);
    expect(top.t - plane.t).toBeGreaterThan(2.2);
    expect(top.t - plane.t).toBeLessThan(2.8);
    // lift-off: ≥ 0.6 s at 3.5× with «forward»
    const fast = log.find((l) => l.speed >= FLIGHT.air);
    expect(rise.t - fast.t).toBeGreaterThanOrEqual(FLIGHT.ready - dt);
    // sitting: ankle-deep under the surface (water 0); planing: on it
    expect(log[0].y).toBeCloseTo(-FLIGHT.sink, 2);
    expect(Math.abs(log.find((l) => l.t > plane.t + 1.5).y)).toBeLessThan(0.01);
  });

  test('the plateau: ~3 m over the mean level, nearly level, held while «forward» is', () => {
    const { log } = run(40, ahead);
    const aloft = log.filter((l) => l.phase === 'air');
    expect(aloft.length).toBeGreaterThan(30 * 60);   // it holds
    expect(log.some((l) => l.phase === 'fall')).toBe(false);
    const ys = aloft.map((l) => l.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(FLIGHT.height - FLIGHT.sway - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(FLIGHT.height + FLIGHT.sway + 1e-9);
    expect(FLIGHT.period).toBeGreaterThanOrEqual(6);
  });

  test('up and down gently: vertical speed ≤ 2.5 m/s, acceleration ~3 m/s² (flat water)', () => {
    // forward 12 s, let go, forward again: a rise, a fall and the next rise
    const { log } = run(40, (t) => (t < 12 || t > 22 ? { x: 0, z: 1 } : null));
    expect(log.some((l) => l.phase === 'fall')).toBe(true);
    expect(log.filter((l, i) => l.phase === 'rise' && log[i - 1]?.phase !== 'rise').length).toBe(2);
    expect(Math.max(...log.slice(1).map((l) => Math.abs(l.vy)))).toBeLessThanOrEqual(2.5);
    let acc = 0;
    for (let i = 2; i < log.length; i++) {
      if (log[i].phase === 'sit' || log[i].phase === 'plane' || log[i - 1].phase !== log[i].phase) continue;
      acc = Math.max(acc, Math.abs(log[i].vy - log[i - 1].vy) / dt);
    }
    expect(acc).toBeLessThan(3.5);
  });

  test('over a rough sea too: off the water never faster than 2.5 m/s up or down', () => {
    const sea = (x, z) => 1.8 * Math.sin(z / 9) + 0.6 * Math.sin(x / 4 + z / 5);
    const { log } = run(60, (t) => (t % 20 < 12 ? { x: 0, z: 1 } : null), undefined, { water: sea });
    expect(log.some((l) => l.phase === 'fall')).toBe(true);
    const off = log.filter((l, i) => i > 0 && !['sit', 'plane'].includes(l.phase) && !['sit', 'plane'].includes(log[i - 1].phase));
    expect(Math.max(...off.map((l) => Math.abs(l.vy)))).toBeLessThanOrEqual(FLIGHT.vlimit + 1e-9);
    // and it comes down onto the water every time, not hanging over a trough
    expect(log.filter((l, i) => l.phase === 'plane' && log[i - 1]?.phase === 'fall').length)
      .toBe(log.filter((l, i) => l.phase === 'fall' && log[i - 1]?.phase !== 'fall').length);
  });

  test('let go in the air: 7× → 3.5× takes ≥ 4 s, then a glide down; the touch eats ~20 %', () => {
    const { log } = run(40, (t) => (t < 14 ? { x: 0, z: 1 } : null));
    const fall = log.find((l) => l.t > 14 && l.phase === 'fall');
    expect(fall.t - 14).toBeGreaterThanOrEqual(4);
    const i = log.findIndex((l) => l.t > fall.t && l.phase === 'plane');
    expect(log[i].t - fall.t).toBeGreaterThanOrEqual(FLIGHT.rise - 2 * dt);
    expect(log[i].speed / log[i - 1].speed).toBeCloseTo(FLIGHT.touch * (1 - FLIGHT.brake.fall * dt / log[i - 1].speed), 2);
    expect(log[i].speed).toBeGreaterThanOrEqual(FLIGHT.sit);   // let go aloft: it lands planing, then sits
    // the dip: the eyes give ≤ 0.15 m and are back within ~0.3 s
    const dip = log.slice(i, i + 40).map((l) => l.y);
    expect(Math.min(...dip)).toBeGreaterThanOrEqual(-FLIGHT.dip - 1e-9);
    expect(Math.min(...dip)).toBeLessThan(-0.1);
    expect(Math.abs(log[i + Math.ceil(0.35 / dt)].y)).toBeLessThan(1e-9);
  });

  test('without «forward» on the water: 3.5× brakes to sitting in ~4 s', () => {
    const start = { x: 0, y: 0, z: 0, ...boardOn({ x: 0, z: FLIGHT.air - 0.01 }, 0, 'plane') };
    const { log } = run(8, () => null, start);
    const sit = first(log, 'sit');
    expect(sit.t).toBeGreaterThan(3.5);
    expect(sit.t).toBeLessThan(4.5);
    expect(log.some((l) => l.phase === 'rise')).toBe(false);
  });

  test('no see-saw: lift-offs at least ~5 s apart whatever the thumb does', () => {
    // «forward» flickers on and off at random intervals for two minutes
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let on = true, next = 0;
    const { log } = run(120, (t) => {
      if (t >= next) { on = rnd() < 0.7; next = t + 0.2 + rnd() * 1.5; }
      return on ? { x: 0, z: 1 } : null;
    });
    const rises = log.filter((l, i) => l.phase === 'rise' && log[i - 1]?.phase !== 'rise').map((l) => l.t);
    expect(rises.length).toBeGreaterThan(1);
    for (let i = 1; i < rises.length; i++) expect(rises[i] - rises[i - 1]).toBeGreaterThan(5);
    // from a lift-off to a fall ≥ 3 s aloft, unless under 2.5×
    for (let i = 1; i < log.length; i++) {
      if (log[i].phase !== 'fall' || log[i - 1].phase === 'fall') continue;
      const air = log.slice(0, i).reverse().findIndex((l) => l.phase !== 'air');
      expect(air * dt >= FLIGHT.plateau - dt || log[i].speed < FLIGHT.early).toBe(true);
    }
  });

  test('prefers-reduced-motion: planing only, never off the water', () => {
    const { log } = run(30, ahead, undefined, { calm: true });
    expect(log.every((l) => l.phase === 'sit' || l.phase === 'plane')).toBe(true);
    expect(log.at(-1).speed).toBeGreaterThan(0.99 * FLIGHT.speed);
  });

  test('planing rides the swell, skims the chop (the water under it smoothed by speed)', () => {
    // a long swell, at whatever speed: the feet keep to the water
    const swell = (x, z) => 0.5 * Math.sin(z / 800);   // ~5 km long
    const slow = run(4, () => ({ x: 0, z: 1 }), { x: 0, y: 0, z: 0, ...boardOn({ x: 0, z: 12 }, 0, 'plane') }, { water: swell, calm: true });
    expect(slow.s.phase).toBe('plane');
    expect(Math.abs(slow.s.y - swell(slow.s.x, slow.s.z))).toBeLessThan(0.1);
    // a short chop at 7×: the board stays within a hand of the mean, the wave does not shake the eyes
    const chop = (x, z) => 0.5 * Math.sin(z / 3);
    const fast = run(6, () => ({ x: 0, z: 1 }), { x: 0, y: 0, z: 0, ...boardOn({ x: 0, z: FLIGHT.speed }, 0, 'plane') }, { water: chop, calm: true });
    const late = fast.log.slice(-120).map((l) => l.y);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.1);
  });

  test('the course turns the heading smoothly, not at once', () => {
    let s = { x: 0, y: 0, z: 0, ...boardOn({ x: 0, z: 30 }, 0, 'plane') };
    s = stepFlight(s, dt, { x: 1, z: 0 });
    expect(Math.abs(s.vx)).toBeLessThan(0.1 * Math.hypot(s.vx, s.vz));
    for (let i = 0; i < 5 * 60; i++) s = stepFlight(s, dt, { x: 1, z: 0 });
    expect(s.vx / Math.hypot(s.vx, s.vz)).toBeGreaterThan(0.99);
  });

  test('no speed outwards past the limit', () => {
    let s = { x: FLIGHT.limit + 10, y: 0, z: 0, ...boardOn({ x: 24, z: 0 }, 0, 'plane') };
    for (let i = 0; i < 60; i++) s = stepFlight(s, dt, { x: 1, z: 0 });
    expect(s.vx).toBeLessThanOrEqual(1e-9);
  });

  test('boardOn: off a raft planing at ≥ 2×, out of the water sitting still', () => {
    const raft = boardOn({ x: RAFT.speed, z: 0 }, 0, 'plane');
    expect(raft.phase).toBe('plane');
    expect(Math.hypot(raft.vx, raft.vz)).toBe(FLIGHT.start);
    // without «forward» it planes for a while before it sits (not at once)
    let b = { x: 0, y: 0, z: 0, ...raft }, t = 0;
    while (b.phase === 'plane' && t < 5) { b = stepFlight(b, dt, null); t += dt; }
    expect(t).toBeGreaterThan(0.8);
    expect(raft.vx).toBeGreaterThan(0);
    const sea = boardOn({ x: 0, z: 0 }, Math.PI / 2, 'sit');
    expect([sea.phase, sea.vx, sea.vz]).toEqual(['sit', 0, 0]);
    expect(sea.hx).toBeCloseTo(1, 9);
    expect([boardState('sit'), boardState('plane'), boardState('rise'), boardState('air'), boardState('fall')])
      .toEqual(['sit', 'plane', 'air', 'air', 'air']);
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
