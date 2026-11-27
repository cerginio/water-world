import { fbm, ridged } from './noise.js';

// The bay map's relief (ISLAND-MAPS-SPEC §2, §3; terra T2): a wide island round (0, 0) with a
// round bay cut into its coast along LAGOON.bearing. The bay's rim is land on both sides, two
// capes reaching out round the mouth; the horseshoe beach is the bay's inner shore, the mouth
// opens straight along the bearing, so the ray from the centre through the beach runs on through
// the bay and out of the mouth into the open sea (the story's channel).
export const LAGOON = Object.freeze({
  // the bay's axis (world bearing, rad): atan2(z, x) of the way out of the mouth. The island's
  // story coast faces the same way (SET_BEARING + 1.2 = -46.25°), so the sunset frames the field.
  bearing: -46.25 * (Math.PI / 180),
  island: 430,       // m: the main land's radius round the centre
  bayAt: 335,        // m out along the axis: the bay's centre
  bay: 190,          // m: the bay's water radius
  rim: 265,          // m: the capes' outer radius round the bay's centre
  mouth: 1.05,       // rad: half the mouth's opening, seen from the bay's centre
});

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// smooth min / max (k m of blend) so the joins of the shapes read as one coast
const smin = (a, b, k) => { const h = smooth(0, 1, 0.5 + 0.5 * (b - a) / k); return b + (a - b) * h - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);

const C = Math.cos(LAGOON.bearing), S = Math.sin(LAGOON.bearing);

/**
 * How far in from the coast (m, > 0 on land, < 0 at sea): the main land and the bay's rim, the
 * bay and its mouth carved out. Not an exact distance, but ~1 m per metre near the coast.
 */
export function lagoonLand(x, z) {
  const u = x * C + z * S, v = -x * S + z * C;           // along the axis, across it
  const warp = fbm(x * 0.004 + 3.7, z * 0.004 - 8.2, 4, 21);
  const main = LAGOON.island * (1 + 0.1 * warp) - Math.hypot(x, z);
  const bu = u - LAGOON.bayAt, bd = Math.hypot(bu, v), phi = Math.atan2(v, bu);
  // the capes: the rim round the bay, cut where the mouth opens out along the axis; the cut's
  // edge is in metres across (the angle past the mouth times the radius) so the tips are round
  const rim = LAGOON.rim * (1 + 0.04 * warp) - bd;
  const cut = (Math.abs(phi) - LAGOON.mouth) * bd;
  const land = smin(smax(main, rim, 40), cut, 30);
  // the bay's water, a touch of noise on the beach line
  const bay = bd - LAGOON.bay * (1 + 0.03 * fbm(x * 0.02, z * 0.02, 2, 5));
  return smin(land, bay, 25);
}

/** In the bay, its mouth or the channel beyond (`margin` m wider): no rocks there (spec §3, §4.1). */
export function inBay(x, z, margin = 0) {
  const u = x * C + z * S, v = -x * S + z * C;
  const bu = u - LAGOON.bayAt, bd = Math.hypot(bu, v);
  if (bd < LAGOON.bay + margin) return true;
  // the mouth's wedge out to the shelf's end, widened by `margin` m across
  return bu > 0 && Math.abs(Math.atan2(v, bu)) * bd < LAGOON.mouth * bd + margin && bd < 450;
}

// Height above sea level: a long sand beach on the bay (1 m at ~25 m in), a green hill inland
// with a rocky top, a turquoise shelf down to -14 m some 150 m off the coast, then the seabed.
export function lagoonHeight(x, z) {
  const L = lagoonLand(x, z);
  let h;
  if (L >= 0) {
    h = 0.04 * L + 0.0006 * L * L;
    const r = Math.hypot(x, z);
    h += 48 * Math.exp(-((r / 210) ** 2)) * smooth(40, 160, L);
    const hill = smooth(8, 40, h);
    h += hill * 18 * (ridged(x * 0.009, z * 0.009, 5, 13) - 0.45);
  } else {
    const d = -L;
    h = -14 * Math.pow(Math.min(d, 150) / 150, 1.35) - 30 * smooth(150, 420, d);
  }
  h += 0.8 * fbm(x * 0.05, z * 0.05, 3, 9) * smooth(-30, 2, h) * smooth(-0.5, 1.5, Math.abs(h));
  return h;
}
