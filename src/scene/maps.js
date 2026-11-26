// The map profiles (ISLAND-MAPS-SPEC §4.1): the one source of everything that leans on the relief
// and on a round island centred on (0, 0) — the height, the story's coast, the surf rock, the
// coastal rocks' rule and an explicit open-sea point where a ray from the centre would not do.
// The scene picks one before it builds anything; only the 'island' profile reads islandHeight.
import { islandHeight } from './islandHeight.js';

/**
 * @typedef {{ x: number, z: number }} XZ
 * @typedef {{
 *   id: string,
 *   heightAt: (x: number, z: number) => number,
 *   storyBearing: (setBearing: number) => number,
 *   heroRock: () => XZ,
 *   openSea: { x: number, z: number, yaw: number } | null,
 * }} MapProfile
 */

/** The first point along `bearing` (rad) from `from` m out where the height drops to `below` or lower. */
export function rayTo(heightAt, bearing, { from = 100, to = 800, step = 2, below = 0 } = {}) {
  const c = Math.cos(bearing), s = Math.sin(bearing);
  let r = from;
  while (r < to && heightAt(c * r, s * r) > below) r += step;
  return { x: c * r, z: s * r };
}

const once = (fn) => { let v; return () => (v ??= fn()); };

/** @type {MapProfile} */
const island = Object.freeze({
  id: 'island',
  heightAt: islandHeight,
  // the story's coast: 1.2 rad round from the sunset bearing (the Flotsam shot's coast)
  storyBearing: (setBearing) => setBearing + 1.2,
  // one big rock in the surf on the swell-exposed coast (the default swell comes from bearing
  // -15 deg), in ~2.5 m of water so the swash wraps round it
  heroRock: once(() => rayTo(islandHeight, -15 * (Math.PI / 180), { to: 900, step: 1, below: -2.5 })),
  // the field's bearing, ANCHOR.openSea m out (src/embed/anchors.js)
  openSea: null,
});

export const MAPS = Object.freeze({ island });
export const DEFAULT_MAP = 'island';

/** The profile for `id`; missing or unknown → 'island' (spec §2). @returns {MapProfile} */
export function pickMap(id) {
  return Object.hasOwn(MAPS, id ?? '') ? MAPS[/** @type {keyof typeof MAPS} */ (id)] : MAPS[DEFAULT_MAP];
}
