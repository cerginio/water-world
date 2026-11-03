import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TileFrames, UNFRAMED } from '../src/tiles/TileFrames.js';

// Identity and world-space invariants, including ids that Int32Array loses.
const makeRest = scale => ({
  tiles: { count: 5, x: [0, 2, 10, 20, 30].map(x => x * scale), z: [0, 0, 0, 0, 0] },
  polygon: [{ frameId: 2, tile: [0] }, { frameId: '2', tile: [2] },
    { frameId: 0, tile: [3] }, { tile: [4] }],
  polyline: [{ frameId: 2, aTile: [1, 1] }],
});
const registry = new TileFrames(), matrix = new THREE.Matrix4().makeTranslation(100, 0, 200);
const rest = makeRest(1);
registry.rebuild(rest, matrix); registry.assign(rest);
assert.equal(registry.entries.length, 4);
assert.notEqual(registry.get(2), registry.get('2'));
assert.notEqual(registry.get(0), registry.get(null));
assert.equal(registry.get(null).id, UNFRAMED);
assert.equal(rest.polygon[0].frameIndex, rest.polyline[0].frameIndex);
assert.deepEqual([...rest.tiles.frameIndex], [0, 0, 1, 2, 3]);
const frame = registry.get(2);
frame.world.set(150, 0, 250); frame.mode = 'placed'; registry.sync(matrix);
const world = frame.world.clone();
matrix.makeRotationY(Math.PI / 4).setPosition(-40, 0, 80);
registry.sync(matrix);
assert.ok(frame.pivot.clone().add(frame.offset).applyMatrix4(matrix).distanceTo(world) < 1e-10);
registry.rebuild(makeRest(2), matrix);
assert.ok(registry.get(2).world.distanceTo(world) < 1e-10);
assert.equal(registry.get(2).mode, 'placed');
const released = registry.get(2);
released.mode = 'inherited'; registry.sync(matrix);
assert.ok(released.world.distanceTo(world) < 1e-10);
matrix.elements[12] += 20; registry.sync(matrix);
assert.ok(released.world.distanceTo(world.clone().add(new THREE.Vector3(20, 0, 0))) < 1e-10);
registry.reset(matrix);
for (const entry of registry.entries) {
  assert.equal(entry.mode, 'inherited');
  assert.equal(entry.offset.length(), 0);
  assert.ok(entry.world.distanceTo(entry.pivot.clone().applyMatrix4(matrix)) < 1e-10);
}
assert.throws(() => registry.get('missing'), /Unknown frame/);
console.log('PASS FD1 identity/world: numeric/string/missing ids, shared polygon/run index, yaw/translation, scale, release, reset');
