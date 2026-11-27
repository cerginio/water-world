// The map profiles (ISLAND-MAPS-SPEC §4.1): the one source of everything that leans on the relief
// and on a round island centred on (0, 0) — the height, the story's coast, the surf rock, the
// coastal rocks' rule and an explicit open-sea point where a ray from the centre would not do.
// The scene picks one before it builds anything; only the 'island' profile reads islandHeight.
import { islandHeight } from './islandHeight.js';
import { inBay, LAGOON, lagoonHeight } from './lagoonHeight.js';

/**
 * @typedef {{ x: number, z: number }} XZ
 * @typedef {{
 *   id: string,
 *   heightAt: (x: number, z: number) => number,
 *   storyBearing: (setBearing: number) => number,
 *   heroRock: () => XZ,
 *   openSea: { x: number, z: number, yaw: number } | null,
 *   viewRadius?: number,
 *   rocks?: (x: number, z: number) => boolean,
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

/** Coming in along `bearing` (rad) from `from` m out: the last point at `below` or lower before the bed rises above it. */
export function rayIn(heightAt, bearing, { from = 900, to = 100, step = 1, below = 0 } = {}) {
  const c = Math.cos(bearing), s = Math.sin(bearing);
  let r = from;
  while (r > to && heightAt(c * (r - step), s * (r - step)) <= below) r -= step;
  return { x: c * r, z: s * r };
}

/** @type {MapProfile} */
const lagoon = Object.freeze({
  id: 'lagoon',
  heightAt: lagoonHeight,
  // the bay's axis: the ray from the centre crosses the horseshoe beach, the bay and the mouth
  storyBearing: () => LAGOON.bearing,
  // the surf rock on the swell side (bearing -15°) of the cape: coming in from the sea, since a
  // ray out from the centre on that bearing ends on the bay's beach
  heroRock: once(() => rayIn(lagoonHeight, -15 * (Math.PI / 180), { below: -2.5 })),
  // the field's ray from the centre runs out of the mouth: the ray's point will do
  openSea: null,
  // the overview holds both capes: rays from the centre end on the bay's beach before them
  viewRadius: 540,
  // no rocks in the bay, its mouth and 25 m round them
  rocks: (x, z) => !inBay(x, z, 25),
});

export const MAPS = Object.freeze({ island, lagoon });
export const DEFAULT_MAP = 'island';

/** The profile for `id`; missing or unknown → 'island' (spec §2). @returns {MapProfile} */
export function pickMap(id) {
  return Object.hasOwn(MAPS, id ?? '') ? MAPS[/** @type {keyof typeof MAPS} */ (id)] : MAPS[DEFAULT_MAP];
}
