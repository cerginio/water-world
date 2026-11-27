// Where the bay's decorations stand (ISLAND-MAPS-SPEC §3, §4.1; terra T3): palm groups behind
// the horseshoe beach and on the capes, one hut on piles in the shallows by the northern cape
// with a short boardwalk to its sand, and the zones closed to miniatures — the vegetation band,
// the cape groups and the hut with its boardwalk. Deterministic (a fixed seed), pure: no three.js.
//
// Coordinates round the bay are polar from its centre: `bd` m out, `phi` rad from the mouth's
// axis (0 = out of the mouth, ±π = the story's beach). Measured on lagoonHeight: the bay's water
// line ≈ 190 m, h = 1 m ≈ 210 m, h = 2.5 m ≈ 230 m, the capes (|phi| < 100°) no higher than 2.5 m.
import { LAGOON } from './lagoonHeight.js';

const DEG = Math.PI / 180;
const C = Math.cos(LAGOON.bearing), S = Math.sin(LAGOON.bearing);

export const DECOR = Object.freeze({
  seed: 0x7a1e5,
  // the vegetation band behind the beach: closed to miniatures from `inner` m out, round the bay
  // from `from` rad off the mouth's axis on both sides. Palms grow in groups inside it.
  band: Object.freeze({ inner: 233, outer: 320, from: 97 * DEG }),
  palmBd: [239, 272],     // m: group centres behind the beach
  palmH: [2.6, 20],       // m: the heights a trunk may stand on
  spacing: 3.2,           // m between two trunks
  margin: 2,              // m round a cape group and the hut, closed to miniatures
  // the hut: in ~1.2 m of water on the inner side of the cape at +phi, its boardwalk out
  // radially onto the cape's sand
  hut: Object.freeze({ bd: 171, phi: 70 * DEG, width: 6.4, depth: 5.2, floor: 1.5, walkTo: 204, walkWidth: 1.5 }),
  variants: 3,            // palm silhouettes: tall and slender, leaning, short and bushy
});

/** Bay-polar → world xz. */
export function bayPoint(bd, phi) {
  const bu = Math.cos(phi) * bd, v = Math.sin(phi) * bd, u = bu + LAGOON.bayAt;
  return { x: u * C - v * S, z: u * S + v * C };
}
/** World xz → bay-polar { bd, phi }. */
export function bayPolar(x, z) {
  const u = x * C + z * S, v = -x * S + z * C, bu = u - LAGOON.bayAt;
  return { bd: Math.hypot(bu, v), phi: Math.atan2(v, bu) };
}

function random(seed) {
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
 * @typedef {{ x: number, z: number, y: number, variant: number, scale: number, yaw: number }} Palm
 * @typedef {{ x: number, z: number, r: number, cape: boolean }} PalmGroup
 * @typedef {{ x: number, z: number, yaw: number, width: number, depth: number, floor: number,
 *   walk: { from: { x: number, z: number }, to: { x: number, z: number }, width: number } }} Hut
 * @typedef {{ palms: Palm[], groups: PalmGroup[], hut: Hut }} LagoonDecor
 */

/** The bay's palms, their groups and the hut, on the relief `heightAt`. @returns {LagoonDecor} */
export function lagoonDecor(heightAt) {
  const rand = random(DECOR.seed);
  const span = (a, b) => a + (b - a) * rand();
  /** @type {{ bd: number, phi: number, r: number, n: number, cape: boolean }[]} */
  const plan = [];
  // behind the beach, both sides: a group every 6–11°, about one in seven skipped (the gaps between)
  for (const side of [1, -1]) {
    for (let a = 103 + span(0, 4); a < 178; a += span(6, 11)) {
      if (rand() < 0.15) continue;
      plan.push({ bd: span(DECOR.palmBd[0], DECOR.palmBd[1]), phi: side * a * DEG, r: span(7, 15), n: Math.round(span(5, 12)), cape: false });
    }
  }
  // the capes: two small groups on the hut's, one on the other
  plan.push({ bd: 222, phi: 84 * DEG, r: 8, n: 4, cape: true }, { bd: 226, phi: 95 * DEG, r: 7, n: 3, cape: true },
    { bd: 224, phi: -88 * DEG, r: 9, n: 5, cape: true });

  /** @type {Palm[]} */
  const palms = [];
  /** @type {PalmGroup[]} */
  const groups = [];
  for (const g of plan) {
    const c = bayPoint(g.bd, g.phi);
    groups.push({ x: c.x, z: c.z, r: g.r, cape: g.cape });
    for (let i = 0, placed = 0; i < g.n * 12 && placed < g.n; i++) {
      const rr = g.r * Math.sqrt(rand()), aa = rand() * Math.PI * 2;
      const x = c.x + Math.cos(aa) * rr, z = c.z + Math.sin(aa) * rr;
      const h = heightAt(x, z), p = bayPolar(x, z);
      const minH = g.cape ? 1.1 : DECOR.palmH[0], minBd = g.cape ? 212 : DECOR.band.inner + 2;
      if (h < minH || h > DECOR.palmH[1] || p.bd < minBd) continue;
      if (palms.some((q) => Math.hypot(q.x - x, q.z - z) < DECOR.spacing)) continue;
      // the tall ones nearer the sand, the bushy ones further in and on the capes
      const w = rand();
      const variant = g.cape ? (w < 0.6 ? 1 : 0) : p.bd < 258 ? (w < 0.55 ? 0 : 1) : (w < 0.5 ? 2 : w < 0.8 ? 1 : 0);
      // the lean (the geometry's +x) toward the bay's water, ±35°
      const toBay = Math.atan2(-(z - bayPoint(0, 0).z), -(x - bayPoint(0, 0).x));
      const yaw = -toBay + (rand() - 0.5) * 70 * DEG;
      palms.push({ x, z, y: h - 0.3, variant, scale: 0.85 + rand() * 0.35, yaw });
      placed++;
    }
  }

  const H = DECOR.hut, at = bayPoint(H.bd, H.phi);
  const out = { x: Math.cos(LAGOON.bearing + H.phi), z: Math.sin(LAGOON.bearing + H.phi) };   // radially out of the bay
  const from = { x: at.x + out.x * H.depth / 2, z: at.z + out.z * H.depth / 2 };
  const to = bayPoint(H.walkTo, H.phi);
  /** @type {Hut} */
  const hut = { x: at.x, z: at.z, yaw: Math.atan2(out.x, out.z), width: H.width, depth: H.depth, floor: H.floor,
    walk: { from, to, width: H.walkWidth } };
  return { palms, groups, hut };
}

const segDist = (px, pz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
};

/** The zones closed to miniatures (spec §3) for `decor`: (x, z) → true where none may lie. */
export function decorBlocked(decor) {
  const B = DECOR.band, m = DECOR.margin, hut = decor.hut;
  const capes = decor.groups.filter((g) => g.cape);
  const hutR = Math.hypot(hut.width, hut.depth) / 2 + m;
  return (x, z) => {
    const p = bayPolar(x, z);
    if (Math.abs(p.phi) >= B.from && p.bd >= B.inner && p.bd <= B.outer) return true;
    if (capes.some((g) => Math.hypot(x - g.x, z - g.z) < g.r + m)) return true;
    if (Math.hypot(x - hut.x, z - hut.z) < hutR) return true;
    return segDist(x, z, hut.walk.from, hut.walk.to) < hut.walk.width / 2 + m;
  };
}
