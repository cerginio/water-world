import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { KITEBOARD, createKiteboard, deckColor, deckGeometry, disposeKiteboard, halfWidth, rockerAt } from '../src/walker/kiteboard.js';

// story-quest Q8 (the owner's sheet «Дошка для кайту»): the board in the air is a twin-tip
// kiteboard — outline, rocker, pads and straps, a handle, four fins — not a box.
describe('kiteboard', () => {
  test('the deck: 134 × 41 cm, rails straight, tips rounded, a rocker of a few cm', () => {
    const box = new THREE.Box3().setFromBufferAttribute(/** @type {any} */ (deckGeometry().getAttribute('position')));
    expect(box.max.z - box.min.z).toBeCloseTo(KITEBOARD.length, 3);
    expect(box.max.x - box.min.x).toBeCloseTo(KITEBOARD.width, 3);
    expect(halfWidth(0)).toBe(KITEBOARD.width / 2);
    expect(halfWidth(KITEBOARD.length / 2 - KITEBOARD.tip)).toBe(KITEBOARD.width / 2);
    const tip = halfWidth(KITEBOARD.length / 2);
    expect(tip).toBeLessThan(KITEBOARD.width / 2 * 0.6);      // rounded off, not a rectangle's end
    expect(tip).toBeGreaterThan(KITEBOARD.width / 2 * 0.3);   // a flattened tip, not a point
    expect(halfWidth(KITEBOARD.length / 2 - KITEBOARD.tip / 2)).toBeGreaterThan(tip);
    expect(rockerAt(0)).toBe(0);
    expect(rockerAt(KITEBOARD.length / 2)).toBeCloseTo(KITEBOARD.rocker, 9);
    expect(box.min.y).toBeCloseTo(-KITEBOARD.thick, 6);
  });

  test('the deck is coloured in waves of at least three tones', () => {
    const tones = new Set();
    for (let t = -0.6; t <= 0.6; t += 0.05) for (const s of [-1, 0, 1]) tones.add(deckColor(s, t).getHexString().slice(0, 2));
    expect(tones.size).toBeGreaterThanOrEqual(3);
    expect(deckGeometry().getAttribute('color')).toBeTruthy();
  });

  test('pads and straps for two feet, a handle, four fins under the tips; in the reflection layer', () => {
    const board = createKiteboard();
    const named = (n) => board.children.filter((c) => c.name === n);
    expect(board.name).toBe('walker-board');
    expect(board.visible).toBe(false);
    expect(named('kiteboard-deck')).toHaveLength(1);
    expect(named('kiteboard-pad')).toHaveLength(2);
    expect(named('kiteboard-strap')).toHaveLength(2);
    expect(named('kiteboard-handle')).toHaveLength(1);
    const fins = named('kiteboard-fin');
    expect(fins).toHaveLength(4);
    for (const f of fins) {
      expect(f.position.y).toBeLessThanOrEqual(rockerAt(f.position.z) - KITEBOARD.thick + 1e-9);   // under the deck
      expect(Math.abs(f.position.z)).toBeGreaterThan(KITEBOARD.length / 2 - 0.15);
    }
    const layer = new THREE.Layers();
    layer.set(1);
    board.traverse((o) => expect(o.layers.test(layer), o.name).toBe(true));
    disposeKiteboard(board);
  });
});
