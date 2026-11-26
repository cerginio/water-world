import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { WALK, clearOfWater, isWater, nearestWater, walkOnGround } from '../src/walker/groundWalk.js';
import { createWalker, PACE, WADE_IN } from '../src/walker/walker.js';
import { SWIM } from '../src/walker/swim.js';
import { axis, keyIntent } from '../src/walker/keyboard.js';
import { CameraRig } from '../src/scene/cameraRig.js';
import { stickVector, STICK, LABELS } from '../src/walker/stick.js';
import { ICONS, NO_SUBJECT, SUBJECTS, iconOf } from '../src/walker/icons.js';

// story-quest Q2a (STORY-QUEST-SPEC §4.1 «Персонаж»): the wrapper over Tilecraft's own
// moveOnSheet — the real function from TILECRAFT_ROOT, not a stand-in, so the calling
// convention (sheet, bodyScale, candidates) is the one the browser runs.
const root = resolveTilecraft('development');
const { moveOnSheet } = await import(pathToFileURL(`${root}/viewer/engines/three/core/gamifier/sheet-motion.js`).href);

/** A ground from a height function, with a normal, like TerrainContact.at; NaN = off the terrain. */
const groundOf = (h) => (x, z) => {
  const e = 1e-3, height = h(x, z);
  if (!Number.isFinite(height)) return null;
  const n = new THREE.Vector3(-(h(x + e, z) - h(x - e, z)) / (2 * e), 1, -(h(x, z + e) - h(x, z - e)) / (2 * e)).normalize();
  return { height, normal: n };
};
const radius = 0.15 * WALK.bodyScale;
const walkSteps = (ground, start, offset, n) => {
  const world = { moveOnSheet, ground };
  let p = { ...start, y: ground(start.x, start.z).height };
  const trace = [p];
  for (let i = 0; i < n; i++) trace.push(p = walkOnGround(p, offset, world));
  return trace;
};

describe('walkOnGround', () => {
  test('up a 17° slope the feet stay on the ground after every step', () => {
    const ground = groundOf((x) => 0.3 * x);
    const trace = walkSteps(ground, { x: 0, z: 0 }, { x: 0.5, z: 0 }, 20);
    for (const p of trace) expect(Math.abs(p.y - ground(p.x, p.z).height)).toBeLessThan(1e-9);
    expect(trace.at(-1).x).toBeCloseTo(10, 6);
    expect(trace.at(-1).y).toBeCloseTo(3, 6);
    expect(trace.at(-1).normal.y).toBeCloseTo(1 / Math.hypot(1, 0.3), 3);
  });

  test('a long move is walked in pieces: deep water mid-way is not jumped over', () => {
    // land, a 1 m strip of deep water at x 2..3, land again
    const ground = groundOf((x) => (x > 2 && x < 3 ? -3 : 1));
    const [, p] = walkSteps(ground, { x: 0, z: 0 }, { x: 6, z: 0 }, 1);
    expect(p.x).toBeLessThan(2);
  });

  test('slides along the shore, does not cross it', () => {
    // deep water for z ≥ 5, land below
    const ground = groundOf((x, z) => (z >= 5 ? -2 : 1));
    const trace = walkSteps(ground, { x: 0, z: 0 }, { x: 0.3, z: 0.3 }, 40);
    for (const p of trace) expect(p.z).toBeLessThanOrEqual(5 - radius + 1e-3);
    const end = trace.at(-1);
    expect(end.z).toBeGreaterThan(5 - radius - 0.01);   // at the edge
    expect(end.x).toBeGreaterThan(0.3 * 40 * 0.95);      // and kept going along it
  });

  test('slides along a shore oblique to any grid at the courses that lead along it; into the sea it swims (Q8)', () => {
    // deep water for x + 0.6·z ≥ 10 (oblique, gently sloping bed): the cell grid of Q2a
    // made a staircase here and the body stuck in its inner corners at 15..30° (probe)
    const ground = groundOf((x, z) => 1 - 0.2 * (x + 0.6 * z - 10) - 0.5);
    const seaward = Math.atan2(1, 0.6), n = Math.hypot(1, 0.6);
    // the wading line is x + 0.6·z = 15; a body at the line, its radius and a bit off it
    const edge = { x: 15 - (radius + 0.01) * n, z: 0 };
    // a step aims into the sea when a body's length ahead crosses the line: past ~27° off it
    const along = Math.asin(radius / (radius + WADE_IN)) * 180 / Math.PI;
    for (const deg of [-85, -75, -65, 65, 75, 85]) {
      const w = createWalker({ moveOnSheet, ground });
      w.place(edge.x, edge.z, seaward + deg * Math.PI / 180);
      for (let i = 0; i < 60; i++) w.step(1 / 60, { forward: 1 });
      const moved = Math.hypot(w.state.x - edge.x, w.state.z - edge.z);
      expect(90 - Math.abs(deg), `course ${deg}°`).toBeLessThan(along);
      expect(w.state.swim, `course ${deg}°`).toBe(null);
      // the share of the step along the shore is |sin(deg)|; allow 15 % off it
      expect(moved, `course ${deg}°`).toBeGreaterThan(PACE.walk * Math.abs(Math.sin(deg * Math.PI / 180)) * 0.85);
      expect(w.state.y, `course ${deg}°`).toBeGreaterThanOrEqual(-WALK.wade - 1e-3);
    }
    for (const deg of [-45, -30, 0, 30, 45]) {
      const w = createWalker({ moveOnSheet, ground });
      w.place(edge.x, edge.z, seaward + deg * Math.PI / 180);
      w.step(1 / 60, { forward: 1 });
      expect(w.state.swim, `course ${deg}°`).not.toBe(null);
      expect(isWater(ground, w.state.x, w.state.z), `course ${deg}°`).toBe(true);
      // in just past the line, not thrown out to sea
      expect((w.state.x + 0.6 * w.state.z - 15) / n, `course ${deg}°`).toBeLessThan(WADE_IN + 0.01);
    }
  });

  test('from the island straight into the sea: walks to the line, goes in, swims on (Q8)', () => {
    const ground = groundOf((x) => 2 - 0.1 * x);   // −0.5 m at x = 25
    const w = createWalker({ moveOnSheet, ground });
    w.place(0, 0, Math.PI / 2);
    let t = 0;
    while (!w.state.swim && t < 20) { w.step(1 / 60, { forward: 1 }); t += 1 / 60; }
    expect(w.state.swim).not.toBe(null);
    expect(w.state.x).toBeGreaterThan(25);
    expect(w.state.x).toBeLessThan(25 + PACE.walk / 60 + 0.01);   // just past the line
    expect(t).toBeLessThan(25 / PACE.walk + 0.2);
    for (let i = 0; i < 120; i++) w.step(1 / 60, { forward: 1 });
    expect(w.state.x).toBeGreaterThan(25 + 1.5 * SWIM.pace);   // strokes, not steps
    // back to the shore: up on the feet
    w.state.yaw = -Math.PI / 2;
    for (let i = 0; i < 300 && w.state.swim; i++) w.step(1 / 60, { forward: 1 });
    expect(w.state.swim).toBe(null);
    expect(w.state.y).toBeGreaterThanOrEqual(-WALK.wade);
  });

  test('wades into the shallows, no deeper than WALK.wade', () => {
    const ground = groundOf((x) => 2 - 0.1 * x);   // −0.5 m at x = 25
    const trace = walkSteps(ground, { x: 0, z: 0.25 }, { x: 0.4, z: 0 }, 150);
    for (const p of trace) expect(p.y).toBeGreaterThanOrEqual(-WALK.wade - 1e-3);
    expect(trace.at(-1).x).toBeGreaterThan(25 - radius - 0.01);
    expect(trace.at(-1).x).toBeLessThan(25);
  });

  test('stops at the edge of the terrain', () => {
    const ground = groundOf((x) => (x > 10 ? NaN : 1));
    expect(isWater(ground, 11, 0)).toBe(true);
    const end = walkSteps(ground, { x: 0, z: 0 }, { x: 1, z: 0 }, 30).at(-1);
    expect(end.x).toBeLessThan(10);
  });

  test('standing in deep water already, walks out rather than freezing — and not further in', () => {
    const ground = groundOf((x) => (x < 0 ? -3 + 0.5 * x : 1));   // the bed falls away seawards
    expect(walkSteps(ground, { x: -1, z: 0 }, { x: 0.5, z: 0 }, 4).at(-1).x).toBeGreaterThan(0.99);   // 1 m, + a push off the line
    expect(walkSteps(ground, { x: -1, z: 0 }, { x: -0.5, z: 0 }, 4).at(-1).x).toBeGreaterThan(-1.3);
  });
});

describe('nearestWater / clearOfWater', () => {
  const ground = groundOf((x) => (x > 1 ? -1 : -0.2));   // the wading line at x = 1
  test('the nearest point of the wading line, to 1e-5 m; none out of reach; the point itself in the water', () => {
    const q = nearestWater(ground, 0.8, 0.3, radius);
    expect(q.distance).toBeCloseTo(0.2, 5);
    expect([q.x, q.z]).toEqual([expect.closeTo(1, 5), expect.closeTo(0.3, 5)]);
    expect(nearestWater(ground, 0, 0, radius)).toBeNull();
    expect(nearestWater(ground, 2, 0, radius)).toEqual({ x: 2, z: 0, distance: 0 });
  });

  test('pushes the body to its radius from the line, along the normal of the line; null in the water', () => {
    const p = clearOfWater(ground, 0.9, 0.4, radius);
    expect(p.x).toBeCloseTo(1 - radius, 5);
    expect(p.z).toBeCloseTo(0.4, 5);
    expect(clearOfWater(ground, 0, 0, radius)).toEqual({ x: 0, z: 0 });
    expect(clearOfWater(ground, 1.5, 0, radius)).toBeNull();
  });

  test('a corner of the shore (165°, as on the island): slides past it along the shore', () => {
    // x along the shore, z seawards; water where max(z, z + x·tan15°) > 0 — the line turns
    // 15° into the land at x = 0 (map of the probe's shore at (−399.8, −212.6)). Q8: a course
    // into the sea goes into the water, so the corner is passed along the shore, both ways.
    const T = Math.tan(15 * Math.PI / 180);
    const corner = groundOf((x, z) => -0.5 - 0.2 * Math.max(z, z + x * T));
    for (const [from, yaw] of [[{ x: -3, z: -(radius + 0.02) }, Math.PI / 2],
      [{ x: 3, z: -3 * T - (radius + 0.03) / Math.cos(15 * Math.PI / 180) }, -Math.PI / 2 - 15 * Math.PI / 180]]) {
      const w = createWalker({ moveOnSheet, ground: corner });
      w.place(from.x, from.z, yaw);
      for (let i = 0; i < 90; i++) w.step(1 / 60, { forward: 1 });
      expect(w.state.swim, `from x ${from.x}`).toBe(null);
      expect(Math.sign(w.state.x), `from x ${from.x}: past the corner`).toBe(-Math.sign(from.x));
      expect(w.state.y, `from x ${from.x}`).toBeGreaterThanOrEqual(-WALK.wade - 1e-5);
    }
  });
});

describe('createWalker', () => {
  const flat = groundOf(() => 2);
  test('yaw 0 walks along +z, a positive turn goes left (towards +x)', () => {
    const w = createWalker({ moveOnSheet, ground: flat });
    w.place(0, 0, 0);
    w.step(1, { forward: 1 });
    expect(w.state.z).toBeCloseTo(PACE.walk, 6);
    expect(w.state.x).toBeCloseTo(0, 6);
    w.step(Math.PI / 2 / 1.8, { turn: 1 });
    expect(w.state.yaw).toBeCloseTo(Math.PI / 2, 6);
    w.step(1, { forward: 1 });
    expect(w.state.x).toBeCloseTo(PACE.walk, 6);
  });

  test('strafe right at yaw 0 is −x; a diagonal is no faster than straight; Shift runs', () => {
    const w = createWalker({ moveOnSheet, ground: flat });
    w.place(0, 0, 0);
    w.step(1, { strafe: 1 });
    expect(w.state.x).toBeCloseTo(-PACE.walk, 6);
    w.place(0, 0, 0);
    expect(w.step(1, { forward: 1, strafe: 1 })).toBeCloseTo(PACE.walk, 6);
    expect(w.step(1, { forward: 1, run: true })).toBeCloseTo(PACE.run, 6);
  });

  test('eyes 1.6 m over the feet; pitch clamps', () => {
    const w = createWalker({ moveOnSheet, ground: flat });
    w.place(3, 4, 0);
    const { position, target } = w.eyes();
    expect(position).toEqual({ x: 3, y: 3.6, z: 4 });
    expect(target.z - position.z).toBeCloseTo(1, 9);
    w.step(10, { pitch: 1 });
    expect(w.state.pitch).toBeCloseTo(1.3, 9);
  });

  test('place off the terrain throws', () => {
    const w = createWalker({ moveOnSheet, ground: groundOf(() => NaN) });
    expect(() => w.place(0, 0)).toThrow(/off the terrain/);
  });
});

describe('keyIntent', () => {
  test('WASD, arrows, Q/E and R/F sum and clamp per axis', () => {
    expect(keyIntent(new Set(['KeyW', 'ArrowUp', 'KeyD', 'ArrowLeft', 'KeyR']), true))
      .toEqual({ forward: 1, strafe: 1, turn: 1, pitch: 1, run: true });
    expect(keyIntent(new Set(['KeyW', 'KeyS'])).forward).toBe(0);
    expect(axis(new Set(['KeyE']), { KeyE: -1 })).toBe(-1);
  });
});

describe('CameraRig.ride', () => {
  const rig = () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    const controls = { target: new THREE.Vector3(10, 0, 0), enabled: true, enableDamping: true, update() { camera.lookAt(this.target); } };
    return new CameraRig({ camera, controls, ground: () => 0.8 });
  };
  const eye = { position: { x: 1, y: 3.6, z: 2 }, target: { x: 1, y: 3.6, z: 3 } };

  test('the camera is the eyes every frame; the controls are off under "eyes"', () => {
    const r = rig();
    r.ride(() => eye);
    r.update(1 / 60);
    expect(r.camera.position.toArray()).toEqual([1, 3.6, 2]);
    expect(r.controls.target.toArray()).toEqual([1, 3.6, 3]);
    expect([r.eyes, r.controls.enabled, r.reasons]).toEqual([true, false, ['eyes']]);
  });

  test('the ground clamp does not lift the eyes (islandHeight lies above the drawn mesh on ridges)', () => {
    const r = rig();
    r.ground = () => 10;
    r.ride(() => eye);
    r.update(1 / 60);
    expect(r.camera.position.y).toBe(3.6);
  });

  test('interrupt() keeps the ride; dismount() frees the controls where the eyes were, once', () => {
    const r = rig();
    let ended = 0;
    r.ride(() => eye, { onEnd: () => ended++ });
    r.interrupt();
    expect(r.eyes).toBe(true);
    r.dismount();
    r.dismount();
    expect([r.eyes, r.controls.enabled, ended]).toEqual([false, true, 1]);
    expect(r.camera.position.toArray()).toEqual([1, 3.6, 2]);
  });

  test('place() and flyTo() end the ride first', () => {
    const r = rig();
    let ended = 0;
    r.ride(() => eye, { onEnd: () => ended++ });
    r.place(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, 0, 10));
    expect([r.eyes, ended, r.reasons]).toEqual([false, 1, []]);
    r.ride(() => eye, { onEnd: () => ended++ });
    r.flyTo({ position: new THREE.Vector3(0, 60, 0), target: new THREE.Vector3(0, 0, 0) });
    expect([r.eyes, ended, r.reasons]).toEqual([false, 2, ['flight']]);
  });
});

// story-quest Q2b: into the eyes without a cut, the free camera on the stick
describe('CameraRig.ride({ approach })', () => {
  const rig = (ground = () => 0.8) => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(300, 200, 300);
    const controls = { target: new THREE.Vector3(0, 0, 0), enabled: true, enableDamping: true, update() { camera.lookAt(this.target); } };
    camera.lookAt(controls.target);
    return new CameraRig({ camera, controls, ground });
  };
  const eye = { position: { x: 1, y: 3.6, z: 2 }, target: { x: 1, y: 3.6, z: 3 } };
  const run = (r, seconds, dt = 1 / 60) => {
    const path = [];
    for (let t = 0; t < seconds; t += dt) {
      r.update(dt);
      path.push({ p: r.camera.position.clone(), q: r.camera.quaternion.clone(), boarding: r.boarding });
    }
    return path;
  };

  test('starts where the camera is, arrives in the eyes, onArrive once; controls off all the way', () => {
    const r = rig();
    let arrived = 0;
    r.ride(() => eye, { approach: 2, onArrive: () => arrived++ });
    expect(r.camera.position.toArray()).toEqual([300, 200, 300]);
    expect([r.boarding, r.controls.enabled, r.reasons, arrived]).toEqual([true, false, ['eyes'], 0]);
    const path = run(r, 2.2);
    expect(r.boarding).toBe(false);
    expect(arrived).toBe(1);
    expect(r.camera.position.distanceTo(new THREE.Vector3(1, 3.6, 2))).toBeLessThan(1e-9);
    expect(r.controls.target.distanceTo(new THREE.Vector3(1, 3.6, 3))).toBeLessThan(1e-9);
    expect(path.every((s) => s.boarding || s.p.distanceTo(new THREE.Vector3(1, 3.6, 2)) < 1e-9)).toBe(true);
  });

  test('no jump: per-frame step is bounded and the view turns by small angles', () => {
    const r = rig();
    const start = r.camera.position.clone();
    r.ride(() => eye, { approach: 3 });
    const path = run(r, 3.1);
    const total = start.distanceTo(new THREE.Vector3(1, 3.6, 2));
    let prev = { p: start, q: path[0].q }, step = 0, turn = 0;
    for (const s of path) {
      step = Math.max(step, s.p.distanceTo(prev.p));
      turn = Math.max(turn, s.q.angleTo(prev.q));
      prev = s;
    }
    // smootherstep peaks at 1.875 × the mean speed; 180 frames
    expect(step).toBeLessThan((total / 180) * 1.9);
    expect(turn).toBeLessThan(0.05);
  });

  test('stays over the terrain floor on the way, reaches eyes below it at the end', () => {
    const r = rig(() => 40);   // a ridge everywhere 40 m: the eyes (3.6) lie under the floor
    r.ride(() => eye, { approach: 2 });
    const path = run(r, 2.1);
    const early = path.filter((_, i) => i < path.length * 0.6);
    expect(early.every((s) => s.p.y >= 40 - 1e-9)).toBe(true);
    expect(r.camera.position.y).toBeCloseTo(3.6, 9);
  });

  test('approach: true lasts flightDuration(distance); dismount mid-way frees the camera there', () => {
    const r = rig();
    let ended = 0;
    r.ride(() => eye, { approach: true, onEnd: () => ended++ });
    expect(r.riding.approach.duration).toBeGreaterThan(1.2);
    run(r, 0.5);
    const here = r.camera.position.clone();
    r.dismount();
    expect([r.eyes, r.boarding, r.controls.enabled, ended]).toEqual([false, false, true, 1]);
    expect(r.camera.position.toArray()).toEqual(here.toArray());
  });

  test('without approach: a cut, onArrive at once', () => {
    const r = rig();
    let arrived = 0;
    r.ride(() => eye, { onArrive: () => arrived++ });
    expect([r.boarding, arrived]).toEqual([false, 1]);
    expect(r.camera.position.toArray()).toEqual([1, 3.6, 2]);
  });
});

describe('CameraRig.steer', () => {
  const rig = () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    const controls = { target: new THREE.Vector3(0, 0, 10), enabled: true, enableDamping: false, update() { camera.lookAt(this.target); camera.updateMatrix(); } };
    controls.update();
    return new CameraRig({ camera, controls, ground: () => 0.8 });
  };

  test('full forward: the keys speed along the view on the ground; half: a quarter of it', () => {
    const r = rig();
    r.steer(1, 0);
    r.update(0.1);
    expect(r.camera.position.z).toBeCloseTo(10, 6);   // 100 m/s × 0.1 s towards +z
    expect(r.camera.position.y).toBeCloseTo(10, 6);
    r.steer(0.5, 0);
    r.update(0.1);
    expect(r.camera.position.z).toBeCloseTo(12.5, 6);
    expect(r.controls.target.z).toBeCloseTo(22.5, 6);
  });

  test('no steering under a lock (the eyes)', () => {
    const r = rig();
    r.steer(1, 1);
    r.lock('eyes');
    r.update(0.1);
    expect(r.camera.position.toArray()).toEqual([0, 10, 0]);
  });
});

describe('stickVector', () => {
  test('dead zone gives 0; the rim and past it give length 1; screen down is back', () => {
    expect(stickVector(STICK.radius * 0.1, 0)).toEqual({ x: 0, y: 0 });
    const rim = stickVector(0, -STICK.radius);
    expect(rim.x).toBeCloseTo(0, 12);
    expect(rim.y).toBeCloseTo(1, 12);
    const far = stickVector(STICK.radius * 3, STICK.radius * 3);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 12);
    expect(far.x).toBeGreaterThan(0);
    expect(far.y).toBeLessThan(0);
  });

  test('length grows from 0 at the dead-zone rim, without a jump', () => {
    const at = (share) => Math.hypot(...Object.values(stickVector(STICK.radius * share, 0)));
    expect(at(STICK.dead + 1e-6)).toBeLessThan(1e-4);
    expect(at(0.56)).toBeCloseTo((0.56 - STICK.dead) / (1 - STICK.dead), 12);
  });
});

// story-quest Q9 (STORY-QUEST-SPEC §4.2a): every command button of the scene says what it acts on
describe('subject icons of the scene buttons', () => {
  test('every button of LABELS has a subject of the closed list, in both languages', () => {
    for (const locale of Object.keys(LABELS)) {
      for (const name of Object.keys(LABELS[locale])) {
        if (NO_SUBJECT.has(name)) continue;
        expect([name, SUBJECTS[name]]).toEqual([name, expect.stringMatching(/^(frame|raft|walker|kite)$/)]);
      }
    }
    expect(Object.keys(ICONS).sort()).toEqual(['frame', 'kite', 'raft', 'walker']);
  });
  test('the §4.2a table: the raft lands, the walker goes onto the board, the kite is the kite', () => {
    expect([SUBJECTS.land, SUBJECTS.fly, SUBJECTS.water, SUBJECTS.kite, SUBJECTS.unkite, SUBJECTS.take, SUBJECTS.keep])
      .toEqual(['raft', 'walker', 'walker', 'kite', 'kite', 'frame', 'frame']);
    expect(LABELS.uk.fly).toBe('На дошку');
    for (const svg of Object.values(ICONS)) {
      expect(svg).toMatch(/^<svg [^>]*stroke="currentColor"[^>]*aria-hidden="true"/);
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i);   // one colour: the button's
    }
    expect(iconOf('keepNote')).toBe(null);
  });
});
