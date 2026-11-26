import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { createWalker } from '../src/walker/walker.js';
import { WALK } from '../src/walker/groundWalk.js';
import { SWIM, eyeLevel, stepSwim } from '../src/walker/swim.js';

// story-quest Q5b (STORY-QUEST-SPEC §2 п.6 «Плавання й пірнання»): the walker in the water — a
// stroke at the surface and down along the gaze, the depth to go to, the bed under it; into the
// water from the board, off a deck, a deck gone; out onto the shallows and onto a deck. The
// real Tilecraft moveOnSheet, as in flight.test.js.
const root = resolveTilecraft('development');
const { moveOnSheet } = await import(pathToFileURL(`${root}/viewer/engines/three/core/gamifier/sheet-motion.js`).href);
const UP = { x: 0, y: 1, z: 0 };
// a beach: dry land for x < 0, the wading line (−0.5 m) at x = 5, 60 m deep from x = 600
const beach = (x, z) => ({ height: Math.max(-60, -0.1 * x), normal: UP });
const deckOf = (id, x, z, hu = 5, hv = 3) => ({ id, x, z, ux: 1, uz: 0, vx: 0, vz: 1, hu, hv, y: 0.2 });
const dt = 1 / 60;
const deep = () => null;   // no bed (past the island's end)
const run = (pose, seconds, intent, world = { ground: deep }) => {
  for (let i = 0; i < seconds * 60; i++) pose = stepSwim(pose, dt, intent, world);
  return pose;
};
const at = (x, z) => ({ x, z, depth: 0, target: 0 });

describe('stepSwim', () => {
  test('at the surface, looking ahead or up: along the water at the pace, no deeper', () => {
    const s = run(at(0, 0), 2, { forward: 1, yaw: Math.PI / 2, pitch: 0.3 });
    expect(s.x).toBeCloseTo(2 * SWIM.pace, 6);
    expect(s.depth).toBe(0);
    expect(run(at(0, 0), 1, { forward: 1, run: true }).z).toBeCloseTo(SWIM.run, 6);
    expect(SWIM.pace).toBeLessThan(4.2);   // slower than the walk (PACE.walk)
  });

  test('looking down past the gaze threshold dives along it; level under the water holds the depth', () => {
    const shallow = run(at(0, 0), 1, { forward: 1, pitch: -SWIM.gaze + 0.05 });
    expect(shallow.depth).toBe(0);   // a glance down is not a dive
    const pitch = -0.8, s = run(at(0, 0), 2, { forward: 1, pitch });
    expect(s.depth).toBeCloseTo(2 * SWIM.pace * Math.sin(-pitch), 3);
    expect(s.z).toBeCloseTo(2 * SWIM.pace * Math.cos(pitch), 3);
    expect(s.target).toBeCloseTo(s.depth, 9);   // neutral: it stays where the stroke left it
    const level = run(s, 3, { forward: 1, pitch: 0 });
    expect(level.depth).toBeCloseTo(s.depth, 9);
    const idle = run(level, 5, {});
    expect(idle.depth).toBeCloseTo(s.depth, 9);
    const up = run(level, 10, { forward: 1, pitch: 0.8 });
    expect(up.depth).toBe(0);   // up along the gaze, not out of the water
  });

  test('without a stroke the depth goes to the target at SWIM.vertical', () => {
    const s = run({ ...at(0, 0), target: SWIM.dive }, 1, {});
    expect(s.depth).toBeCloseTo(SWIM.vertical, 6);
    expect(run(s, 5, {}).depth).toBeCloseTo(SWIM.dive, 9);
    expect(run({ x: 0, z: 0, depth: 10, target: 0 }, 10, {}).depth).toBe(0);
  });

  test('the eyes keep over the bed and never past SWIM.depth', () => {
    const world = { ground: () => ({ height: -6, normal: UP }) };
    const s = run(at(0, 0), 10, { forward: 1, pitch: -1.2 }, world);
    expect(eyeLevel(s.depth)).toBeCloseTo(-6 + SWIM.floor, 4);
    expect(s.target).toBeLessThanOrEqual(s.depth + 1e-9);
    expect(run(at(0, 0), 60, { forward: 1, pitch: -1.3, run: true }).depth).toBe(SWIM.depth);
    expect(SWIM.depth).toBeGreaterThan(40);   // a sunk frame (FATE.sink.depth) is in reach
  });

  test('at the surface the eyes ride the wave; deeper the swell lets them go', () => {
    expect(eyeLevel(0, 0.8)).toBeCloseTo(0.8 + SWIM.surface, 9);
    expect(Math.abs(eyeLevel(10, 0.8) - eyeLevel(10, 0))).toBeLessThan(0.01);
    // over the camera's underwater line (UnderwaterPass: camera under the water by 0.3 m)
    expect(SWIM.surface).toBeGreaterThan(0.3);
  });

  test('no stroke outwards past the limit', () => {
    const s = run(at(SWIM.limit + 5, 0), 1, { forward: 1, yaw: Math.PI / 2 });
    expect(s.x).toBeCloseTo(SWIM.limit + 5, 9);
  });
});

describe('the walker in the water', () => {
  const setup = (list = [], ground = beach) => createWalker({ moveOnSheet, ground, decks: () => list, water: () => 0 });

  test('out of the water onto the board (Q8): from the surface only, the board starts at the water', () => {
    const w = createWalker({ moveOnSheet, ground: beach });
    w.swimAt(100, 0, 0);
    w.dive();
    for (let i = 0; i < 120; i++) w.step(dt, {});
    expect(w.under).toBe(true);
    expect(w.takeOff()).toBe(false);   // under the water: no
    w.rise();
    for (let i = 0; i < 600 && w.state.swim.depth > 0; i++) w.step(dt, {});
    expect(w.takeOff({ x: 0, z: 0 })).toBe(true);
    expect(w.state.swim).toBe(null);
    expect(w.state.flight).not.toBe(null);
    // Q9 (§4.2 v1.6): out of the sea the board sits, the feet ankle-deep in the (still) water
    expect(w.boardPhase).toBe('sit');
    expect(w.state.y).toBeCloseTo(-0.15, 6);
    expect(w.landing()).toBe('water');
    for (let i = 0; i < 120; i++) w.fly(dt, { x: 1, z: 0 });
    expect(w.boardPhase).toBe('plane');   // «forward» 2 s: planing on the surface, not yet off it
    expect(Math.abs(w.state.y)).toBeLessThan(0.05);   // up out of the ankle-deep sit (FLIGHT.lift 0.4 s)
    for (let i = 0; i < 360; i++) w.fly(dt, { x: 1, z: 0 });
    expect(w.boardPhase).toBe('air');
    expect(w.state.flight).not.toBe(null);
  });

  test('from the board over deep water: into the water at the surface, the kite gone with it', () => {
    const list = [deckOf('raft', 300, 0)];
    const w = setup(list);
    w.board(list[0], 0, 0, Math.PI / 2);
    w.takeOff();
    while (w.state.x < 320) w.fly(dt, { x: 1, z: 0 });
    expect(w.landing()).toBe('water');
    expect(w.land()).toBe('water');
    expect(w.state.flight).toBe(null);
    expect(w.state.swim).toEqual({ depth: 0, target: 0 });
    for (let i = 0; i < 120; i++) w.ride(dt);   // the eyes glide down to the water
    expect(w.eyes().position.y).toBeCloseTo(SWIM.surface, 2);
  });

  test('swims to the beach and stands up on the shallows, walking again', () => {
    const w = setup();
    w.place(0, 0);
    Object.assign(w.state, { x: 60, y: eyeLevel(0) - WALK.eye, swim: { depth: 0, target: 0 } });
    w.state.yaw = -Math.PI / 2;   // facing −x, the beach
    let t = 0;
    while (w.state.swim && t < 60) { w.step(dt, { forward: 1 }); t += dt; }
    expect(w.state.swim).toBe(null);
    expect(t).toBeLessThan(55 / SWIM.pace + 1);
    expect(w.state.x).toBeLessThan(5);   // on wadeable ground, clear of the wading line
    expect(w.state.y).toBeCloseTo(beach(w.state.x, 0).height, 6);
    expect(w.step(0.1, { forward: 1 })).toBeGreaterThan(0.3);   // walking
  });

  test('a dive under the water and back: dive() 3 m deeper, rise() to the surface', () => {
    const w = setup();
    w.place(0, 0);
    Object.assign(w.state, { x: 400, swim: { depth: 0, target: 0 } });
    expect(w.under).toBe(false);
    expect(w.dive()).toBe(true);
    expect(w.under).toBe(true);   // going down: the button says «Surface»
    for (let i = 0; i < 4 * 60; i++) w.step(dt, {});
    expect(w.state.swim.depth).toBeCloseTo(SWIM.dive, 6);
    expect(w.eyes().position.y).toBeCloseTo(SWIM.surface - SWIM.dive, 6);
    w.dive();
    for (let i = 0; i < 4 * 60; i++) w.step(dt, {});
    expect(w.state.swim.depth).toBeCloseTo(2 * SWIM.dive, 6);
    w.rise();
    for (let i = 0; i < 6 * 60; i++) w.step(dt, {});
    expect(w.state.swim.depth).toBe(0);
    expect(w.under).toBe(false);
    expect(setup().dive()).toBe(false);   // not in the water
  });

  test('off a deck with the kite down: over the rim ahead into the water; onto a deck at the surface', () => {
    const list = [deckOf('raft', 300, 0)];
    const w = setup(list);
    w.board(list[0], 0, 0, Math.PI / 2);   // facing +x
    expect(w.jumpIn()).toBe('water');
    expect(w.state.deck).toBe(null);
    expect(w.state.x).toBeGreaterThan(305 + 0.255);   // past the rim by the body
    expect(w.state.x).toBeLessThan(306.5);
    // back: a stroke towards the raft boards it from the water
    w.state.yaw = -Math.PI / 2;
    for (let i = 0; i < 60 && !w.state.deck; i++) w.step(dt, { forward: 1 });
    expect(w.state.deck?.id).toBe('raft');
    expect(w.state.swim).toBe(null);
    // under the water a deck above does not board it
    w.jumpIn();
    Object.assign(w.state.swim, { depth: 5, target: 5 });
    for (let i = 0; i < 30; i++) w.step(dt, { forward: 1 });
    expect(w.state.deck).toBe(null);
    expect(w.state.swim).not.toBe(null);
  });

  test('off a deck in the shallows: onto the ground, not into the water', () => {
    const list = [deckOf('raft', 7, 0, 2, 2)];   // rim at x = 5..9, −0.5…−0.9 m
    const w = setup(list);
    w.board(list[0], 0, 0, -Math.PI / 2);   // facing −x, the beach: past the rim at x ≈ 4.4
    expect(w.jumpIn()).toBe('ground');
    expect(w.state.swim).toBe(null);
    expect(w.state.x).toBeLessThan(5);
  });

  test('the deck under the feet gone over deep water: into the water, not onto the bed', () => {
    const list = [deckOf('raft', 300, 0)];
    const w = setup(list);
    w.board(list[0]);
    list.length = 0;
    w.ride(dt);
    expect(w.state.swim).toEqual({ depth: 0, target: 0 });
    for (let i = 0; i < 60; i++) w.ride(dt);
    expect(w.eyes().position.y).toBeCloseTo(SWIM.surface, 2);
  });

  test('at the surface the eyes ride the water there', () => {
    let wave = 0.7;
    const w = createWalker({ moveOnSheet, ground: beach, decks: () => [], water: () => wave });
    w.place(0, 0);
    Object.assign(w.state, { x: 400, swim: { depth: 0, target: 0 }, jump: { x: 0, y: 0, z: 0 } });
    w.ride(dt);
    expect(w.eyes().position.y).toBeCloseTo(0.7 + SWIM.surface, 9);
    wave = -0.4;
    w.ride(dt);
    expect(w.eyes().position.y).toBeCloseTo(-0.4 + SWIM.surface, 9);
  });
});
