// Where a story's miniatures lie on the island (STORY-QUEST-SPEC §2 п.3, §4.1 «Мініатюра й
// гідратація»; story-quest Q3): random points of dry land above the shallows, at least
// `minDistance` apart, from a generator seeded by the story's id — the same story always
// lies the same way, and the story itself carries no layout data.
//
// Pure: no three.js, no DOM. `ground(x, z)` is TerrainContact.at — the mesh as drawn, the
// same surface the walker's feet and the miniatures stand on.

export const LAYOUT = Object.freeze({
  radius: 70,        // m around the walker's spawn: the beach of the story coast and behind it
  clear: 6,          // m kept free around the spawn, so the walker never starts on a miniature
  minDistance: 12,   // m between two miniatures
  minHeight: 0.8,    // m above sea level: dry land, above the shallows and the surf
  minNormalY: 0.85,  // ≤ ~32° slope: a miniature lies, it does not slide off a cliff
  tries: 4000,       // candidates per pass; a pass that does not fit them all relaxes minDistance
});

/** FNV-1a of a string → a 32-bit seed. */
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a seeded generator of [0, 1). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dry land a miniature may lie on.
 * @param {(x: number, z: number) => any} ground @param {number} x @param {number} z
 * @param {{ minHeight?: number, minNormalY?: number }} [options]
 */
export function isDryLand(ground, x, z, { minHeight = LAYOUT.minHeight, minNormalY = LAYOUT.minNormalY } = {}) {
  const g = ground(x, z);
  return !!g && g.height >= minHeight && (g.normal?.y ?? 1) >= minNormalY;
}

/**
 * `count` points { x, z, yaw } of dry land within `radius` of `center`, ≥ `minDistance`
 * apart and ≥ `clear` from the centre. Deterministic in (id, ground, options). When a pass
 * of `tries` candidates cannot fit them all, minDistance shrinks by 0.8 and the search
 * goes on from where it was (the points found so far stay); at most 8 passes, then the
 * points found are returned (fewer than `count` only on an island with no such land).
 * `blocked(x, z)` — the map's zones closed to miniatures (ISLAND-MAPS-SPEC §3: vegetation, the
 * hut); checked after the candidate is drawn, so a map without zones lies as it always did.
 * @param {string} id the story id (seed)
 * @param {number} count
 * @param {{ ground: (x: number, z: number) => any, center: { x: number, z: number },
 *   radius?: number, clear?: number, minDistance?: number, minHeight?: number,
 *   minNormalY?: number, tries?: number, blocked?: (x: number, z: number) => boolean }} options
 * @returns {{ x: number, z: number, yaw: number }[]}
 */
export function layoutMiniatures(id, count, options) {
  const { ground, center, radius = LAYOUT.radius, clear = LAYOUT.clear, tries = LAYOUT.tries, blocked } = options;
  let minDistance = options.minDistance ?? LAYOUT.minDistance;
  const land = { minHeight: options.minHeight ?? LAYOUT.minHeight, minNormalY: options.minNormalY ?? LAYOUT.minNormalY };
  const next = random(seedOf(String(id)));
  const points = [];
  for (let pass = 0; pass < 8 && points.length < count; pass++, minDistance *= 0.8) {
    for (let i = 0; i < tries && points.length < count; i++) {
      // uniform over the disc: r = R·√u
      const r = radius * Math.sqrt(next()), a = next() * Math.PI * 2, yaw = next() * Math.PI * 2;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (r < clear || !isDryLand(ground, x, z, land) || blocked?.(x, z)) continue;
      if (points.some((p) => Math.hypot(p.x - x, p.z - z) < minDistance)) continue;
      points.push({ x, z, yaw });
    }
  }
  return points;
}
