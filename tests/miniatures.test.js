import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { LAYOUT, isDryLand, layoutMiniatures, random, seedOf } from '../src/tiles/miniatureLayout.js';
import { MINI, TileMiniatures } from '../src/tiles/TileMiniatures.js';
import { TileFrames } from '../src/tiles/TileFrames.js';

// story-quest Q3 (STORY-QUEST-SPEC §2 п.3–4, §4.1 «Мініатюра й гідратація»).

/** A ground from a height function, with a normal, like TerrainContact.at; NaN = off the terrain. */
const groundOf = (h) => (x, z) => {
  const e = 1e-3, height = h(x, z);
  if (!Number.isFinite(height)) return null;
  const n = new THREE.Vector3(-(h(x + e, z) - h(x - e, z)) / (2 * e), 1, -(h(x, z + e) - h(x, z - e)) / (2 * e)).normalize();
  return { height, normal: n };
};
// a beach: land rises with -x (2 m per 10 m), the sea is x > 0
const beach = groundOf((x) => -x * 0.2);
// a round island of radius 100 m, a hill of 20 m in the middle
const island = groundOf((x, z) => 20 * (1 - Math.hypot(x, z) / 100));

describe('miniature layout', () => {
  test('the seed is the story id: the same id, the same points; another id, others', () => {
    const o = { ground: island, center: { x: 0, z: 0 } };
    const a = layoutMiniatures('test-2025/my-day-3-moments', 8, o);
    expect(layoutMiniatures('test-2025/my-day-3-moments', 8, o)).toEqual(a);
    expect(layoutMiniatures('public-test/frog-fairy-full', 8, o)).not.toEqual(a);
    expect(seedOf('a')).not.toBe(seedOf('b'));
    const r = random(42), s = random(42);
    expect([r(), r(), r()]).toEqual([s(), s(), s()]);
  });

  test('every point on dry land, ≥ minDistance apart, within the radius, clear of the spawn', () => {
    const center = { x: 10, z: -5 };
    const points = layoutMiniatures('story-8-frames-hibrid', 10, { ground: island, center });
    expect(points).toHaveLength(10);
    for (const [i, p] of points.entries()) {
      expect(isDryLand(island, p.x, p.z)).toBe(true);
      expect(island(p.x, p.z).height).toBeGreaterThanOrEqual(LAYOUT.minHeight);
      const r = Math.hypot(p.x - center.x, p.z - center.z);
      expect(r).toBeLessThanOrEqual(LAYOUT.radius);
      expect(r).toBeGreaterThanOrEqual(LAYOUT.clear);
      for (const q of points.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(LAYOUT.minDistance);
    }
  });

  test('half the disc under the sea (a beach): no point in the water or in the shallows', () => {
    const points = layoutMiniatures('x', 10, { ground: beach, center: { x: 0, z: 0 } });
    expect(points).toHaveLength(10);
    for (const p of points) expect(p.x).toBeLessThanOrEqual(-LAYOUT.minHeight / 0.2 + 1e-9);
  });

  test('too little land for minDistance: it relaxes and still fits them all', () => {
    const strip = groundOf((x, z) => (Math.abs(z) < 3 && x < 0 ? 2 : -5));
    const points = layoutMiniatures('x', 10, { ground: strip, center: { x: 0, z: 0 }, radius: 60 });
    expect(points).toHaveLength(10);
    for (const p of points) expect(isDryLand(strip, p.x, p.z)).toBe(true);
  });

  test('no dry land at all: no points, no endless search', () => {
    const sea = groundOf(() => -10);
    expect(layoutMiniatures('x', 5, { ground: sea, center: { x: 0, z: 0 }, tries: 50 })).toEqual([]);
  });

  test('a cliff is not a place to lie', () => {
    const cliff = groundOf((x) => 5 + x * 3);   // 72°
    expect(isDryLand(cliff, 0, 0)).toBe(false);
  });
});

// A field of two frames, each one instanced 4 × 2 m tile, enough for TileMiniatures: the
// registry, the rest parts, moveFrame and the meshes it hides and shows.
function fakeField() {
  const tiles = { count: 2, x: new Float32Array([0, 30]), z: new Float32Array([0, 0]), y0: new Float32Array([0.1, 0.1]),
    thickness: new Float32Array([0.2, 0.2]), surfaceOffset: new Float32Array(2),
    footprints: [[new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 0, 1)], [new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 0, 1)]] };
  const matrix = (x) => new THREE.Matrix4().makeTranslation(x, 0.1, 0).multiply(new THREE.Matrix4().makeScale(4, 0.2, 2)).toArray();
  const polygon = ['a', 'b'].map((frameId, i) => ({ frameId, tile: [i], count: 1, matrices: Float32Array.from(matrix(tiles.x[i])),
    geometry: new THREE.BoxGeometry(1, 1, 1), colors: null }));
  const rest = { tiles, polygon, polyline: [] };
  const group = new THREE.Group();
  group.updateWorldMatrix(true, false);
  const frameRegistry = new TileFrames();
  frameRegistry.rebuild(rest, group.matrixWorld);
  frameRegistry.assign(rest);
  const boundsEntries = polygon.map((part) => ({ mesh: new THREE.Mesh(part.geometry), frameIndex: part.frameIndex }));
  const moves = [];
  return { rest, group, frameRegistry, boundsEntries, moves,
    material: () => new THREE.MeshBasicMaterial(),
    moveFrame(id, x, z) { moves.push({ id, x, z }); const f = frameRegistry.get(id); f.world.set(x, 0, z); f.mode = 'placed'; } };
}

describe('miniatures', () => {
  const setup = () => {
    const field = fakeField(), scene = new THREE.Scene();
    const minis = new TileMiniatures(field, { ground: island, scene });
    minis.layout('story', { x: 0, z: 0 });
    return { field, minis };
  };

  test('every frame becomes a miniature on dry land; the field hides the frames', () => {
    const { field, minis } = setup();
    expect(minis.items.map((i) => i.state)).toEqual(['ground', 'ground']);
    for (const item of minis.items) {
      expect(item.root.scale.x).toBeCloseTo(MINI.scale);
      expect(island(item.root.position.x, item.root.position.z).height).toBeGreaterThanOrEqual(LAYOUT.minHeight);
      expect(item.contactGap).toBeGreaterThanOrEqual(-1e-9);   // no corner under the ground
      expect(item.contactGap).toBeLessThan(0.05);
      expect(item.radius).toBeCloseTo(Math.hypot(2, 1) * MINI.scale);
    }
    expect(field.boundsEntries.map((e) => e.mesh.visible)).toEqual([false, false]);
    expect(minis.counts()).toEqual({ total: 2, found: 0, water: 0 });
  });

  test('take within reach; put on the land lies again', () => {
    const { minis } = setup();
    const a = minis.items[0], p = a.root.position;
    const holder = { x: p.x + 1, y: island(p.x + 1, p.z).height, z: p.z, yaw: 0, pitch: 0 };
    expect(minis.nearest(holder.x, holder.z)?.frameId).toBe('a');
    expect(minis.nearest(p.x + MINI.reach + 0.1, p.z)).toBe(null);
    minis.take('a', holder);
    minis.update(1 / 60, holder);
    expect(a.root.position.y).toBeGreaterThan(holder.y + 1);   // in front of the eyes
    expect(minis.put(holder)).toBe('ground');
    expect(a.state).toBe('ground');
    expect(minis.counts().found).toBe(1);
  });

  test('put where the ground is under the sea: it unfolds to the rest size over deep water', () => {
    const { field, minis } = setup();
    const events = [];
    for (const type of ['take', 'unfold', 'hydrate']) minis.addEventListener(type, (e) => events.push([type, e.detail.frameId]));
    // at the waterline of the island (r = 100), facing out to sea along +x
    const holder = { x: 100, y: 0, z: 0, yaw: Math.PI / 2, pitch: 0 };
    minis.take('b', holder);
    expect(minis.put(holder)).toBe('unfolding');
    const [move] = field.moves;
    expect(move.id).toBe('b');
    // the centre and 8 rim points over water deeper than MINI.depth / rimDepth
    const item = minis.get('b');
    expect(island(move.x, move.z).height).toBeLessThan(-MINI.depth);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      expect(island(move.x + Math.cos(a) * item.fullRadius, move.z + Math.sin(a) * item.fullRadius).height).toBeLessThan(-MINI.rimDepth);
    }
    expect(field.boundsEntries[1].mesh.visible).toBe(false);   // hidden while it grows
    for (let t = 0; t < MINI.unfold + 0.1; t += 1 / 30) minis.update(1 / 30, holder);
    expect(item.state).toBe('water');
    expect(item.root.visible).toBe(false);
    expect(field.boundsEntries.map((e) => e.mesh.visible)).toEqual([false, true]);
    expect(events).toEqual([['take', 'b'], ['unfold', 'b'], ['hydrate', 'b']]);
    expect(minis.counts()).toEqual({ total: 2, found: 1, water: 1 });
  });

  test('the backpack (Q7): a take with full hands stows the one held; unpack swaps; only the hands put down', () => {
    const { minis } = setup();
    const events = [];
    for (const type of ['take', 'pack', 'unpack']) minis.addEventListener(type, (e) => events.push([type, e.detail.frameId]));
    const holder = { x: 0, y: 10, z: 0, yaw: 0, pitch: 0 };
    expect(minis.stow()).toBe(null);   // empty hands
    minis.take('a', holder);
    minis.take('b', holder);
    expect(minis.carried.frameId).toBe('b');
    expect(minis.packed.map((i) => i.frameId)).toEqual(['a']);
    expect(minis.get('a').root.visible).toBe(false);
    minis.update(1 / 60, { ...holder, x: 5 });
    expect(minis.get('a').root.position.x).toBe(5);   // goes where the walker goes
    expect(minis.unpack('b')).toBe(null);   // not in the backpack
    minis.unpack('a');
    expect([minis.carried.frameId, minis.packed.map((i) => i.frameId)]).toEqual(['a', ['b']]);
    expect(minis.get('a').root.visible).toBe(true);
    expect(minis.counts()).toEqual({ total: 2, found: 2, water: 0 });
    expect(events).toEqual([['take', 'a'], ['pack', 'a'], ['take', 'b'], ['pack', 'b'], ['unpack', 'a']]);
  });

  test('Q10: a frame on the water folds back into the hands — the way back of hydration', () => {
    const { field, minis } = setup();
    const events = [];
    for (const type of ['lift', 'pack']) minis.addEventListener(type, (e) => events.push([type, e.detail.frameId]));
    const holder = { x: 100, y: 0, z: 0, yaw: Math.PI / 2, pitch: 0 };
    minis.take('b', holder);
    minis.put(holder);
    for (let t = 0; t < MINI.unfold + 0.1; t += 1 / 30) minis.update(1 / 30, holder);
    expect(minis.lift('a', holder)).toBe(null);   // not on the water
    minis.take('a', holder);
    const item = minis.get('b'), at = field.frameRegistry.get('b').world.clone();
    expect(minis.lift('b', holder)).toBe(item);
    expect([item.state, minis.packed.map((i) => i.frameId)]).toEqual(['carried', ['a']]);   // the one held → backpack
    expect(field.boundsEntries[1].mesh.visible).toBe(false);   // the frame of the field hidden at once
    expect(item.root.scale.x).toBe(1);                          // it starts at the frame's size, on its place
    expect(item.root.position.x).toBeCloseTo(at.x);
    minis.update(MINI.unfold / 2, holder);
    expect(item.root.scale.x).toBeLessThan(1);
    expect(item.root.scale.x).toBeGreaterThan(MINI.scale);
    for (let t = 0; t < MINI.unfold; t += 1 / 30) minis.update(1 / 30, holder);
    expect(item.root.scale.x).toBeCloseTo(MINI.scale);          // in the hands
    expect(item.fold).toBe(null);
    expect(minis.counts()).toEqual({ total: 2, found: 2, water: 0 });
    expect(events).toEqual([['pack', 'a'], ['lift', 'b']]);
  });

  test('Q10: put down in the water, the frame unfolds ahead, not over the walker', () => {
    const { field, minis } = setup();
    // a swimmer 30 m out to sea (the bed at −6 m), facing along +z: the sea is deep all round
    const holder = { x: 130, y: -0.4, z: 0, yaw: 0, pitch: 0, swim: {} };
    minis.take('b', holder);
    expect(minis.put(holder)).toBe('unfolding');
    const [move] = field.moves, r = minis.get('b').fullRadius;
    expect(Math.hypot(move.x - holder.x, move.z - holder.z)).toBeGreaterThanOrEqual(r + MINI.clear - 1e-9);
    expect(move.z).toBeGreaterThan(holder.z);   // ahead
  });

  test('Q10: put down from the board, the frame unfolds behind it', () => {
    const { field, minis } = setup();
    const holder = { x: 130, y: 0.3, z: 0, yaw: 0, pitch: 0, flight: { phase: 'plane' } };
    minis.take('b', holder);
    expect(minis.put(holder)).toBe('unfolding');
    const [move] = field.moves;
    expect(move.z).toBeLessThan(holder.z - minis.get('b').fullRadius);   // behind, clear of the board
  });

  test('Q10: the slot drawing is null without a renderer or meshes', () => {
    const { minis } = setup();
    expect(minis.thumbnail('a', null)).toBe(null);
    expect(minis.thumbnail('zz', {})).toBe(null);
  });

  test('clear gives every frame back to the field', () => {
    const { field, minis } = setup();
    minis.clear();
    expect(minis.active).toBe(false);
    expect(field.boundsEntries.map((e) => e.mesh.visible)).toEqual([true, true]);
  });
});
