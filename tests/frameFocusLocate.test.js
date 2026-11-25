import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { createFrameFocus } from '../src/scene/frameFocus.js';

// story-quest Q5 review: «Мить» flew to where the field's frame lay before the story was laid
// out as miniatures on the shore (the field's frame is hidden then). `locate` gives the box of
// what is drawn; a placed frame (a raft, a fate) is followed on the CPU.
function fakeTiles(mode = 'inherited') {
  const entry = { id: 'a', bounds: new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(10, 6)),
    offset: new THREE.Vector3(), mode, selectionHeight: 0.3 };
  const group = new THREE.Group();
  group.position.set(200, 0, 0);
  return { loaded: true, frames: ['a'], params: { frame: 'all', mode: 'anchored', fieldYaw: 0 }, group,
    frameRegistry: { byId: new Map([['a', entry]]), entries: [entry] } };
}
const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1e5);

describe('frameFocus locate', () => {
  test('the field\'s frame: the pose looks at its rest centre; anchored and not placed — nothing to follow', async () => {
    const focus = createFrameFocus({ tiles: fakeTiles(), camera });
    const pose = await focus.pose(0);
    expect(pose.target.x).toBeCloseTo(205, 6);
    expect(pose.target.z).toBeCloseTo(3, 6);
    expect(focus.aim(0)).toBeNull();
  });

  test('a miniature: the pose and the aim go to the box drawn, at its height, close enough to fill the view', async () => {
    const box = new THREE.Box3(new THREE.Vector3(-30.6, 4, 49.6), new THREE.Vector3(-29.4, 4.1, 50.4));
    const focus = createFrameFocus({ tiles: fakeTiles(), camera, locate: () => box });
    const pose = await focus.pose(0);
    expect(pose.target.toArray().map((v) => +v.toFixed(3))).toEqual([-30, 4.05, 50]);
    expect(pose.position.distanceTo(pose.target)).toBeLessThan(10);
    expect(pose.position.y).toBeGreaterThan(4.05);
    expect(focus.aim(0).toArray().map((v) => +v.toFixed(3))).toEqual([-30, 4.05, 50]);
  });

  test('an empty box counts as none; a placed frame is followed where it is now', async () => {
    const tiles = fakeTiles('placed');
    const focus = createFrameFocus({ tiles, camera, locate: () => new THREE.Box3() });
    expect((await focus.pose(0)).target.x).toBeCloseTo(205, 6);
    tiles.frameRegistry.entries[0].offset.set(40, 0, -7);
    expect(focus.aim(0).toArray()).toEqual([245, 0, -4]);
  });
});
