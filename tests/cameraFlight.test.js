import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { createFlight, flightDuration, liftHeight, smootherstep } from '../src/scene/cameraFlight.js';
import { CameraRig } from '../src/scene/cameraRig.js';
import { islandHeight } from '../src/scene/islandHeight.js';
import { islandRadius, islandPose, shorePose, storyPose } from '../src/scene/stationPoses.js';
import { onStation, railLanguage } from '../src/ui/stationRail.js';

// SCENE-UI-SPEC §4.4: duration, lift, bounds and zero speed at the ends of a flight;
// the camera owner's locks (TD2); the station poses of §4.2.

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const pose = (p, t) => ({ position: p, target: t });

describe('flightDuration', () => {
  test('1.2 s floor for short hops', () => expect(flightDuration(0)).toBe(1.2));
  test('1.2 + 0.9·log2(1 + d/50)', () => expect(flightDuration(150)).toBeCloseTo(1.2 + 0.9 * 2, 10));
  test('5 s ceiling', () => expect(flightDuration(1e6)).toBe(5));
  test('grows with distance', () => expect(flightDuration(400)).toBeGreaterThan(flightDuration(100)));
});

describe('liftHeight', () => {
  test('no lift up to 100 m', () => expect(liftHeight(100)).toBe(0));
  test('a quarter of the hop', () => expect(liftHeight(400)).toBe(100));
  test('300 m at most', () => expect(liftHeight(5000)).toBe(300));
});

describe('smootherstep', () => {
  test('ends and middle', () => expect([smootherstep(0), smootherstep(0.5), smootherstep(1)]).toEqual([0, 0.5, 1]));
  test('clamped', () => expect([smootherstep(-1), smootherstep(2)]).toEqual([0, 1]));
});

describe('createFlight', () => {
  const from = pose(v(0, 50, 0), v(10, 0, 0)), to = pose(v(800, 50, 0), v(810, 0, 0));
  const f = createFlight(from, to);

  test('starts and ends exactly on the poses', () => {
    const a = f.sample(0), b = f.sample(f.duration);
    expect(a.position.distanceTo(from.position)).toBeLessThan(1e-9);
    expect(b.position.equals(to.position) && b.target.equals(to.target)).toBe(true);
  });

  test('zero speed at both ends, fastest in the middle', () => {
    const h = f.duration / 1000;
    const speed = (t) => f.sample(t + h).position.distanceTo(f.sample(t).position) / h;
    const middle = speed(f.duration / 2);
    expect(speed(0)).toBeLessThan(middle * 0.01);
    expect(speed(f.duration - h)).toBeLessThan(middle * 0.01);
  });

  test('a long hop rises by its lift at the middle', () => {
    expect(f.lift).toBe(200);
    expect(f.sample(f.duration / 2).position.y).toBeCloseTo(50 + 200, 6);
  });

  test('a short hop does not rise', () => {
    const g = createFlight(pose(v(0, 20, 0), v(0, 0, 0)), pose(v(60, 20, 0), v(60, 0, 0)));
    for (let i = 0; i <= 20; i++) expect(g.sample((g.duration * i) / 20).position.y).toBeCloseTo(20, 9);
  });

  test('never below the ground floor', () => {
    const ground = (x) => (x > 100 && x < 300 ? 400 : -Infinity);   // a wall higher than the lift
    const g = createFlight(from, to, { ground });
    for (let i = 0; i <= 200; i++) {
      const p = g.sample((g.duration * i) / 200).position;
      expect(p.y).toBeGreaterThanOrEqual(ground(p.x));
    }
  });

  test('1 m over the water in the middle; an underwater start rises through the surface without a jump', () => {
    const g = createFlight(pose(v(0, -3, 0), v(20, -2, 0)), pose(v(60, 10, 0), v(80, 0, 0)), { water: () => 0 });
    const ys = Array.from({ length: 101 }, (_, i) => g.sample((g.duration * i) / 100).position.y);
    expect(ys[0]).toBeCloseTo(-3, 9);
    expect(Math.min(...ys.slice(25, 76))).toBeGreaterThanOrEqual(1);
    const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
    expect(Math.max(...steps)).toBeLessThan(1);   // 13 m over 100 samples, no single leap
  });
});

describe('CameraRig', () => {
  const make = () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 80000);
    camera.position.set(0, 50, 0);
    const controls = { target: v(10, 0, 0), enabled: true, enableDamping: true, update() { camera.lookAt(this.target); } };
    return new CameraRig({ camera, controls, ground: () => 0.8 });
  };

  test('controls are on exactly when no lock is held', () => {
    const rig = make();
    const a = rig.lock('frame-drag'), b = rig.lock('fade');
    expect(rig.controls.enabled).toBe(false);
    rig.release(a);
    expect([rig.controls.enabled, rig.reasons]).toEqual([false, ['fade']]);
    rig.release(b);
    rig.release(b);   // a second release of the same token is harmless
    expect(rig.controls.enabled).toBe(true);
  });

  test('a flight locks the controls and hands them back on arrival', async () => {
    const rig = make();
    const done = rig.flyTo(pose(v(300, 60, 0), v(310, 0, 0)));
    expect([rig.flying, rig.reasons, rig.controls.enabled]).toEqual([true, ['flight'], false]);
    for (let i = 0; i < 400 && rig.flying; i++) rig.update(1 / 60);
    expect(await done).toBe(true);
    expect(rig.controls.enabled).toBe(true);
    expect(rig.camera.position.distanceTo(v(300, 60, 0))).toBeLessThan(1e-6);
  });

  test('interrupting mid-flight leaves the camera where it is, controls on at once', async () => {
    const rig = make();
    const done = rig.flyTo(pose(v(300, 60, 0), v(310, 0, 0)));
    for (let i = 0; i < 30; i++) rig.update(1 / 60);
    const mid = rig.camera.position.clone();
    rig.interrupt();
    expect(await done).toBe(false);
    expect(rig.controls.enabled).toBe(true);
    rig.update(1 / 60);
    expect(rig.camera.position.distanceTo(mid)).toBeLessThan(1e-6);
  });

  test('a frame drag that starts during a flight does not leave the controls stuck', () => {
    const rig = make();
    rig.flyTo(pose(v(300, 60, 0), v(310, 0, 0)));
    rig.update(1 / 60);
    rig.interrupt();                 // pointerdown on the canvas
    const drag = rig.lock('frame-drag');
    expect(rig.controls.enabled).toBe(false);
    rig.release(drag);               // pointerup
    expect([rig.controls.enabled, rig.reasons]).toEqual([true, []]);
  });

  test('a new flight during a flight starts from the current pose, no jump, one lock', () => {
    const rig = make();
    rig.flyTo(pose(v(300, 60, 0), v(310, 0, 0)));
    for (let i = 0; i < 30; i++) rig.update(1 / 60);
    const here = rig.camera.position.clone();
    rig.flyTo(pose(v(-200, 60, 0), v(-210, 0, 0)));
    rig.update(1e-4);
    expect(rig.camera.position.distanceTo(here)).toBeLessThan(0.01);
    expect(rig.reasons).toEqual(['flight']);
  });

  test('place() ends a flight and releases its lock', () => {
    const rig = make();
    rig.flyTo(pose(v(300, 60, 0), v(310, 0, 0)));
    rig.place(v(5, 5, 5), v(0, 0, 0));
    expect([rig.flying, rig.controls.enabled]).toEqual([false, true]);
  });

  test('the ground clamp holds after every update', () => {
    const rig = make();
    rig.place(v(0, -10, 0), v(10, -10, 0));
    rig.update(1 / 60);
    expect(rig.camera.position.y).toBeCloseTo(0.8, 9);
  });
});

describe('station poses', () => {
  const radius = islandRadius(islandHeight);

  test('the island radius is the far coastline', () => {
    expect(radius).toBeGreaterThan(250);
    expect(radius).toBeLessThan(1200);
  });

  test('island: the whole island fits the view from above', () => {
    const p = islandPose({ radius, field: null, fov: 50, aspect: 16 / 9 });
    const d = p.position.distanceTo(p.target);
    expect(Math.asin(radius / d)).toBeLessThan(THREE.MathUtils.degToRad(25));
    expect(p.position.y).toBeGreaterThan(islandHeight(p.position.x, p.position.z) + 100);
  });

  test('island: a story field farther out widens the view', () => {
    const field = { center: v(radius + 300, 0, 0), extent: { x: 200, y: 120 } };
    const a = islandPose({ radius, field: null, fov: 50, aspect: 1 });
    const b = islandPose({ radius, field, fov: 50, aspect: 1 });
    expect(b.position.length()).toBeGreaterThan(a.position.length());
  });

  test('shore: 1.6 m over the sand of a beach, looking out at the field', () => {
    const a = THREE.MathUtils.degToRad(120);
    const out = new THREE.Vector2(Math.cos(a), Math.sin(a));
    let r = 100;
    while (islandHeight(out.x * r, out.y * r) > 0) r += 2;
    const coast = out.clone().multiplyScalar(r), look = v(out.x * (r + 80), 0, out.y * (r + 80));
    const p = shorePose({ heightAt: islandHeight, coast, out, look });
    const sand = islandHeight(p.position.x, p.position.z);
    expect(sand).toBeGreaterThanOrEqual(0.5);
    expect(p.position.y - sand).toBeCloseTo(1.6, 9);
    expect(p.position.distanceTo(new THREE.Vector3(coast.x, 0, coast.y))).toBeLessThan(200);
    expect(p.target.equals(look)).toBe(true);
  });

  test('story: the Tiles shot math, centred on the field', () => {
    const p = storyPose({ center: v(500, 0, 200), extent: { x: 100, y: 60 }, yawDeg: 0, fov: 50, aspect: 1 });
    expect(p.target.equals(v(500, 0, 200))).toBe(true);
    expect(p.position.x).toBeCloseTo(500, 9);   // yaw 0: from the +z side
    const tilt = Math.atan2(p.position.z - 200, p.position.y);
    expect(THREE.MathUtils.radToDeg(tilt)).toBeCloseTo(35, 9);
  });
});

describe('rail', () => {
  const station = pose(v(0, 10, 100), v(0, 0, 0));
  test('on station at the pose', () => expect(onStation(v(0, 10, 100), v(0, 0, 0), station)).toBe(true));
  test('moved more than 5 % of the distance: off', () => expect(onStation(v(6, 10, 100), v(6, 0, 0), station)).toBe(false));
  test('turned more than 8°: off', () => {
    const turned = v(Math.tan(THREE.MathUtils.degToRad(9)) * 100.5, 0, 0);
    expect(onStation(v(0, 10, 100), turned, station)).toBe(false);
  });
  test('labels: Ukrainian for uk, English otherwise', () => {
    expect(railLanguage(['uk-UA', 'en'])).toBe('uk');
    expect(railLanguage(['en-US'])).toBe('en');
    expect(railLanguage(['de', 'uk'])).toBe('uk');
  });
});
