// Walking on the island (STORY-QUEST-SPEC §4.1 «Персонаж», story-quest Q2a): a wrapper
// over Tilecraft's moveOnSheet, not a change to it. moveOnSheet moves a body over a flat
// sheet (constant y, rectangular bounds) and slides it along Tilecraft obstacles; the
// island is not flat, so the wrapper walks in short pieces and puts the feet back on the
// ground after each one.
//
// The wading line (ground at −wade) is not a Tilecraft obstacle: after each piece the body
// is pushed out of it to its own radius from the nearest point of the line. Two shapes for
// the line were tried as moveOnSheet obstacles and both stopped the body (Q2a): a grid of
// cells makes a staircase along an oblique shore (0–0.2 m/s at 15–30° to it), and discs
// tangent to the line, oriented by the mesh triangle under each hit, disagree by ~1° and
// cut ~1 mm into the body — moveOnSheet cannot start inside an obstacle. The push-out
// depends on positions only, so it slides along straight shores and corners alike.
//
// Pure: no three.js, no DOM. `ground(x, z)` is TerrainContact.at — the mesh as drawn —
// and `moveOnSheet` comes from the Tilecraft entry (tilecraftWalker.js).

/** @type {Readonly<{ bodyScale: number, eye: number, wade: number, piece: number, rays: number }>} */
export const WALK = Object.freeze({
  bodyScale: 1.7,   // Tilecraft avatar unit = body height, m; radius 0.15 × that = 0.255 m
  eye: 1.6,         // eye height above the feet, m
  wade: 0.5,        // deepest water the walker steps into, m below sea level
  piece: 0.25,      // longest move between two ground lookups, m
  rays: 48,         // directions searched for the nearest point of the wading line (7.5°)
});

/** Deeper than the walker wades, or off the terrain. */
export function isWater(ground, x, z, wade = WALK.wade) {
  const g = ground(x, z);
  return !g || g.height < -wade;
}

/**
 * The nearest point of the wading line within `reach` of (x, z), found along `rays`
 * directions to 1e-6 m; the point itself when it is in the water; null when there is none.
 * @param {(x: number, z: number) => any} ground
 * @returns {{ x: number, z: number, distance: number } | null}
 */
export function nearestWater(ground, x, z, reach, { wade = WALK.wade, rays = WALK.rays } = {}) {
  if (isWater(ground, x, z, wade)) return { x, z, distance: 0 };
  const step = Math.min(0.05, reach / 4);
  let best = null;
  for (let k = 0; k < rays; k++) {
    const a = k * 2 * Math.PI / rays, dx = Math.sin(a), dz = Math.cos(a);
    const far = best ? best.distance : reach;
    let dry = 0, wet = -1;
    for (let t = step; t <= far + step; t += step) {
      if (isWater(ground, x + dx * t, z + dz * t, wade)) { wet = t; break; }
      dry = t;
    }
    if (wet < 0) continue;
    for (let i = 0; i < 16; i++) {
      const t = (dry + wet) / 2;
      if (isWater(ground, x + dx * t, z + dz * t, wade)) wet = t; else dry = t;
    }
    if (wet <= reach && (!best || wet < best.distance)) best = { x: x + dx * wet, z: z + dz * wet, distance: wet };
  }
  return best;
}

/**
 * The body at (x, z) pushed to `radius` from the wading line: up to four times off the
 * nearest point (a corner takes two). Null when it cannot stand there — in the water, or
 * wedged where no push clears it.
 */
export function clearOfWater(ground, x, z, radius, options = {}) {
  let p = { x, z };
  for (let i = 0; i < 4; i++) {
    const q = nearestWater(ground, p.x, p.z, radius, options);
    if (!q) return p;
    if (q.distance < 1e-9) return null;
    const k = (radius + 1e-6) / q.distance;
    p = { x: q.x + (p.x - q.x) * k, z: q.z + (p.z - q.z) * k };
  }
  const q = nearestWater(ground, p.x, p.z, radius - 1e-4, options);
  return q ? null : p;
}

/**
 * One move of the walker. `pose` = { x, y, z }; `offset` = { x, z } on the ground plane.
 * Returns { x, y, z, normal } with y and normal from `ground` at the new point.
 * @param {{ moveOnSheet: Function, ground: (x: number, z: number) => ({ height: number, normal: any } | null),
 *   bodyScale?: number, wade?: number, piece?: number, candidates?: Function }} world
 *   `candidates` — Tilecraft obstacles for moveOnSheet (none on the island yet).
 */
export function walkOnGround(pose, offset, world) {
  const { moveOnSheet, ground, bodyScale = WALK.bodyScale, wade = WALK.wade, piece = WALK.piece,
    candidates = () => [] } = world;
  const radius = 0.15 * bodyScale;   // Tilecraft avatarBodyOf
  const length = Math.hypot(offset.x, offset.z);
  const pieces = Math.max(1, Math.ceil(length / piece));
  let p = { x: pose.x, y: pose.y, z: pose.z };
  let normal = ground(p.x, p.z)?.normal ?? null;
  for (let k = 0; k < pieces; k++) {
    const sheet = { y: p.y, bounds: { min: { x: p.x - 2 * piece - 1, z: p.z - 2 * piece - 1 },
      max: { x: p.x + 2 * piece + 1, z: p.z + 2 * piece + 1 } } };
    const moved = moveOnSheet(p, { x: offset.x / pieces, z: offset.z / pieces }, sheet, bodyScale, candidates);
    // Standing in deep water already (a spawn, a dropped pose): walk freely, never deeper.
    const wet = isWater(ground, p.x, p.z, wade);
    const next = wet ? moved : clearOfWater(ground, moved.x, moved.z, radius, { wade });
    const g = next && ground(next.x, next.z);
    if (!g || (wet && g.height < p.y)) break;   // off the terrain, wedged, or deeper: stop where it was
    p = { x: next.x, y: g.height, z: next.z };
    normal = g.normal;
  }
  return { ...p, normal };
}
