import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { resolveTilecraft } from '../build/tilecraft-config.js';
import { WALK, clearOfWater, isWater, nearestWater, walkOnGround } from '../src/walker/groundWalk.js';
import { createWalker, PACE } from '../src/walker/walker.js';
import { axis, keyIntent } from '../src/walker/keyboard.js';
import { CameraRig } from '../src/scene/cameraRig.js';
import { stickVector, STICK } from '../src/walker/stick.js';

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

  test('slides along a shore oblique to any grid, at every course that has a component along it', () => {
    // deep water for x + 0.6·z ≥ 10 (oblique, gently sloping bed): the cell grid of Q2a
    // made a staircase here and the body stuck in its inner corners at 15..30° (probe)
    const ground = groundOf((x, z) => 1 - 0.2 * (x + 0.6 * z - 10) - 0.5);
    const seaward = Math.atan2(1, 0.6);
    for (const deg of [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75]) {
      const w = createWalker({ moveOnSheet, ground });
      w.place(0, 0, seaward);
      for (let i = 0; i < 600; i++) w.step(1 / 60, { forward: 1 });   // to the edge
      const edge = { x: w.state.x, z: w.state.z };
      w.state.yaw = seaward + deg * Math.PI / 180;
      for (let i = 0; i < 60; i++) w.step(1 / 60, { forward: 1 });
      const along = Math.hypot(w.state.x - edge.x, w.state.z - edge.z);
      // the share of the step along the shore is |sin(deg)|; allow 15 % off it
      expect(along, `course ${deg}°`).toBeGreaterThan(PACE.walk * Math.abs(Math.sin(deg * Math.PI / 180)) * 0.85);
      expect(w.state.y, `course ${deg}°`).toBeGreaterThanOrEqual(-WALK.wade - 1e-3);
    }
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

  test('a corner of the shore (165°, as on the island): slides past it at the courses that lead along', () => {
    // x along the shore, z seawards; water where max(z, z + x·tan15°) > 0 — the line turns
    // 15° into the land at x = 0 (map of the probe's shore at (−399.8, −212.6))
    const T = Math.tan(15 * Math.PI / 180);
    const corner = groundOf((x, z) => -0.5 - 0.2 * Math.max(z, z + x * T));
    for (const [deg, least] of [[30, 0.15], [45, 0.4], [60, 0.6], [-30, 0.4]]) {
      const w = createWalker({ moveOnSheet, ground: corner });
      w.place(-0.3, -2, 0);
      for (let i = 0; i < 120; i++) w.step(1 / 60, { forward: 1 });
      const edge = { x: w.state.x, z: w.state.z };
      w.state.yaw = deg * Math.PI / 180;
      for (let i = 0; i < 60; i++) w.step(1 / 60, { forward: 1 });
      expect(Math.hypot(w.state.x - edge.x, w.state.z - edge.z), `course ${deg}°`).toBeGreaterThan(least);
      expect(w.state.y, `course ${deg}°`).toBeGreaterThanOrEqual(-WALK.wade - 1e-5);
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
