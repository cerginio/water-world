// Symbolic places for the scene's commands (STORY-QUEST-SPEC §4.4): every story lies elsewhere
// around the island, so a card says 'shallow' or 'open-sea', and the scene finds it for the
// story it has. Pure: the world is passed in (ground, the field's centre, the frames, the decks).
import { EmbedError } from './protocol.js';

export const ANCHOR = Object.freeze({
  openSea: 1300,   // m from the island centre: past the shore map's edge (900, spec §4.3) and the bed (1200)
  land: 1,         // m: ground this high is the beach the march from the field stops at
  wade: -0.45,     // m: the wading point — the last step before ground this deep (the line is −0.5)
  beside: 6,       // m rim to rim between a frame and the one put beside it (probe-story-q5b)
  step: 0.1,       // m: the march's step
});

/**
 * @typedef {{ x: number, z: number, yaw?: number }} Place
 * @typedef {{ index: number, id: any, x: number, z: number }} FramePlace
 * @typedef {{ id: any, x: number, z: number, ux: number, uz: number, hu: number, hv: number }} DeckLike
 * @typedef {{ ground: (x: number, z: number) => ({ height: number } | null),
 *   spawn: () => Place, center: () => ({ x: number, z: number }),
 *   frames: () => FramePlace[], decks: () => DeckLike[] }} AnchorWorld
 */

const heightAt = (world, x, z) => world.ground(x, z)?.height ?? -Infinity;

/** The n-th frame of the story (the frame registry's order) or EmbedError 'unknown-frame'. */
export function frameOf(world, n) {
  const i = Number(n);
  const f = Number.isInteger(i) ? world.frames()[i] : undefined;
  if (!f) throw new EmbedError('unknown-frame', `no frame ${String(n)} in this story`);
  return f;
}

/**
 * The wading point off the beach facing the field: from the field's centre in to the island
 * until the ground is land, then back out to the last step before the wading line.
 * @param {AnchorWorld} world @returns {Place}
 */
export function shallowPoint(world) {
  const c = world.center();
  const l = Math.hypot(c.x, c.z) || 1, ox = c.x / l, oz = c.z / l;   // out to sea
  let x = c.x, z = c.z;
  for (let i = 0; i < 1e5 && heightAt(world, x, z) < ANCHOR.land; i++) { x -= ox * ANCHOR.step; z -= oz * ANCHOR.step; }
  if (heightAt(world, x, z) < ANCHOR.land) throw new EmbedError('no-anchor', 'no beach between the field and the island centre');
  for (let i = 0; i < 1e5 && heightAt(world, x + ox * ANCHOR.step, z + oz * ANCHOR.step) >= ANCHOR.wade; i++) {
    x += ox * ANCHOR.step; z += oz * ANCHOR.step;
  }
  return { x, z, yaw: Math.atan2(ox, oz) };
}

/**
 * A place by name: 'beach' (the walker's spawn), 'shallow', 'open-sea' (the field's bearing,
 * ANCHOR.openSea m out), 'frame:<n>' (where frame n is now), 'over:<n>' (the same, for the air
 * or the water above it), 'beside:<n>' (ANCHOR.beside m rim to rim off deck n along its u axis;
 * `deck` — the deck to be put there, for its half size).
 * @param {string} name @param {AnchorWorld} world @param {{ deck?: DeckLike }} [options]
 * @returns {Place}
 */
export function resolveAnchor(name, world, { deck } = {}) {
  if (typeof name !== 'string') throw new EmbedError('bad-args', 'an anchor is a string');
  if (name === 'beach') return world.spawn();
  if (name === 'shallow') return shallowPoint(world);
  if (name === 'open-sea') {
    const c = world.center(), l = Math.hypot(c.x, c.z) || 1;
    return { x: c.x / l * ANCHOR.openSea, z: c.z / l * ANCHOR.openSea, yaw: Math.atan2(c.x, c.z) };
  }
  const m = /^(frame|over|beside):(\d+)$/.exec(name);
  if (!m) throw new EmbedError('unknown-anchor', `unknown anchor: ${name}`);
  const f = frameOf(world, m[2]);
  if (m[1] !== 'beside') return { x: f.x, z: f.z };
  const a = world.decks().find((d) => d.id === f.id);
  if (!a) throw new EmbedError('not-on-water', `frame ${m[2]} is not on the water`);
  const off = a.hu + (deck?.hu ?? 0) + ANCHOR.beside;
  return { x: a.x + a.ux * off, z: a.z + a.uz * off, yaw: Math.atan2(a.ux, a.uz) };
}
