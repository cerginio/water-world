// The selection outline is the authored frame (model frame.points), not the tiles' box:
// my-day-3-moments frame 2 has tiles over 145 of its 196 source units in y, so an
// outline from the tiles stopped ~2 m short of the frame (owner, story-quest Q1 review).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TileFrames } from '../src/tiles/TileFrames.js';

// a rest with one polyline tile per frame at the given rest x/z
function rest(tiles) {
  const n = tiles.length;
  return {
    tiles: { count: n, x: Float32Array.from(tiles, (t) => t.x), z: Float32Array.from(tiles, (t) => t.z), footprints: [] },
    polygon: [],
    polyline: tiles.map((t, i) => ({ frameId: t.f, aTile: [i] })),
  };
}
const space = { origin: { x: 1000, y: 500 }, unit: 0.05 };

describe('TileFrames.setQuads', () => {
  it('maps frame.points with the tile mapping: (p - origin) * unit, source y → rest z', () => {
    const frames = new TileFrames();
    frames.rebuild(rest([{ x: 0, z: 0, f: 2 }]), new THREE.Matrix4());
    frames.setQuads([{ id: 2, points: [{ x: 538, y: 497 }, { x: 797, y: 497 }, { x: 797, y: 692 }, { x: 538, y: 692 }] }], space);
    const quad = frames.get(2).quad.map((c) => [+c.x.toFixed(2), +c.y.toFixed(2)]);
    expect(quad).toEqual([[-23.1, -0.15], [-10.15, -0.15], [-10.15, 9.6], [-23.1, 9.6]]);
  });

  it('keeps the authored corners of a turned frame, and the tiles box in bounds', () => {
    const frames = new TileFrames();
    frames.rebuild(rest([{ x: 1, z: 1, f: 1 }]), new THREE.Matrix4());
    const points = [{ x: 1000, y: 500 }, { x: 1020, y: 498 }, { x: 1022, y: 518 }, { x: 1002, y: 520 }];
    frames.setQuads([{ id: 1, points }], space);
    expect(frames.get(1).quad[1].toArray().map((v) => +v.toFixed(2))).toEqual([1, -0.1]);
    expect(frames.get(1).bounds.min.toArray()).toEqual([1, 1]);
  });

  it('no quad for a frame without four finite points, or a frame with no tiles', () => {
    const frames = new TileFrames();
    frames.rebuild(rest([{ x: 0, z: 0, f: 1 }, { x: 5, z: 0, f: 3 }]), new THREE.Matrix4());
    frames.setQuads([{ id: 1, points: [{ x: 0, y: 0 }] }, { id: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: NaN }, { x: 0, y: 1 }] },
      { id: 9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }], space);
    expect(frames.get(1).quad).toBeNull();
    expect(frames.get(3).quad).toBeNull();
  });
});
