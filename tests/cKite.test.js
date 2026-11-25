import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { C_KITE, createCKite, wingPoint } from '../src/tiles/cKite.js';

// The C-kite (story-quest Q5a): the four lines stay on their corners, the node and the ends
// of the bar on their own side; the sway moves the wing, not the bar; the billow leaves the
// frame (leading edge, struts, trailing edge) where it is.

const pose = (kite, dt, { along = new THREE.Vector3(0, 0, 1), wind = 9, bar = new THREE.Vector3(0, 1, 0.45) } = {}) => {
  const at = { kite: bar.clone().addScaledVector(along, 28).add(new THREE.Vector3(0, 8, 0)), bar, along, wind };
  kite.pose(dt, at);
  return at;
};

describe('C-kite', () => {
  test('the lines end on the wing corners, the node and the ends of the bar on their own side', () => {
    const group = new THREE.Group();
    const kite = createCKite(group);
    for (const along of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.6, 0, -0.8)]) {
      for (let k = 0; k < 40; k++) pose(kite, 0.25, { along });
      const { wing, bar } = kite.anchors();
      const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), along);
      const lines = group.children.filter((o) => o instanceof THREE.LineSegments);
      const [power, steer] = lines.map((l) => l.geometry.attributes.position);
      // power: LE tips → node; steer: TE tips → the bar end on the same side
      expect(new THREE.Vector3().fromBufferAttribute(power, 0).distanceTo(wing[0])).toBeLessThan(1e-5);
      expect(new THREE.Vector3().fromBufferAttribute(power, 1).distanceTo(bar[2])).toBeLessThan(1e-5);
      expect(new THREE.Vector3().fromBufferAttribute(steer, 1).distanceTo(bar[0])).toBeLessThan(1e-5);
      expect(new THREE.Vector3().fromBufferAttribute(steer, 3).distanceTo(bar[1])).toBeLessThan(1e-5);
      // never crossed: the wing's − side and the bar's − end are on the same side of the pull
      const mid = bar[2];
      expect(wing[2].clone().sub(mid).dot(across)).toBeLessThan(0);
      expect(bar[0].clone().sub(mid).dot(across)).toBeLessThan(0);
      expect(wing[3].clone().sub(mid).dot(across)).toBeGreaterThan(0);
      expect(bar[1].clone().sub(mid).dot(across)).toBeGreaterThan(0);
    }
    kite.dispose();
    expect(group.children.length).toBe(0);
  });

  test('the sway moves the wing, the bar stays where the walker holds it', () => {
    const group = new THREE.Group();
    const kite = createCKite(group);
    const wings = [], bars = [];
    for (let k = 0; k < 60; k++) {
      pose(kite, 0.125);
      wings.push(kite.wing.position.clone());
      bars.push(kite.anchors().bar[0]);
    }
    const spread = (ps) => Math.max(...ps.map((p) => p.distanceTo(ps[0])));
    expect(spread(wings)).toBeGreaterThan(1);
    expect(spread(bars)).toBeLessThan(1e-6);
  });

  test('the billow bulges the canopy between the struts, the frame stays put', () => {
    for (const u of [-1, ...C_KITE.struts, 1]) {
      for (const v of [0, 0.3, 0.7, 1]) expect(wingPoint(u, v, 1).distanceTo(wingPoint(u, v, 0))).toBeLessThan(1e-9);
    }
    for (const v of [0, 1]) expect(wingPoint(0.3, v, 1).distanceTo(wingPoint(0.3, v, 0))).toBeLessThan(1e-9);
    expect(wingPoint(0.3, 0.5, 1).distanceTo(wingPoint(0.3, 0.5, 0))).toBeGreaterThan(0.15);
  });

  test('a C of about 3 : 1 flat span to mean chord', () => {
    let span = 0, chord = 0;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const u = -1 + (2 * i + 1) / n;
      span += wingPoint(u - 1 / n, 0).distanceTo(wingPoint(u + 1 / n, 0));
      chord += wingPoint(u, 0).distanceTo(wingPoint(u, 1)) / n;
    }
    expect(span / chord).toBeGreaterThan(2.6);
    expect(span / chord).toBeLessThan(3.6);
  });
});
