// How a raft moves (STORY-QUEST-SPEC §2 п.5, §4.2, §4.3; story-quest Q4). Kite v1: the
// person sets a course and the kite pulls the raft along it with a constant force, whatever
// the wind; let go of the kite, the raft drifts as a frame does by default (windage of the
// wind, the field's drift model without the water's orbit). Pure: no three.js, no DOM.
//
// A raft is a placed frame (TileField.moveFrame), so its offset is not bound by the field's
// uTileMotionLimit (that clamps the tiles' spring offsets only): the raft has its own limit,
// a soft wall RAFT.limit from the island's centre. It never runs aground: a step whose deck
// would stand over shallow water is not taken (`open`).

/** @type {Readonly<{ speed: number, drag: number, limit: number, seaEdge: number, depth: number, rimDepth: number }>} */
export const RAFT = Object.freeze({
  speed: 8,        // m/s the kite pulls the raft up to (its force over `drag`)
  drag: 0.5,       // 1/s: how fast the raft takes on the kite's or the drift's speed
  limit: 1500,     // m from the island centre: the raft's own limit (the Open ocean shot's distance)
  seaEdge: 900,    // m: |x| or |z| beyond it is open sea — the edge of the shore map (spec §4.3)
  // m of water under the deck's centre and under 8 points of its rim: shallower, the raft does
  // not go. Not the unfold's 1 m / 0.3 m: off the story beach a bar 1.0–1.14 m deep runs 10–25 m
  // out (my-day, Q4), and at 1 m the raft ran aground on it.
  depth: 0.6,
  rimDepth: 0.1,
});

/** Beyond the edge of the shore map: |x| or |z| over `edge` (spec §4.3, a square). */
export function inOpenSea(x, z, edge = RAFT.seaEdge) {
  return Math.max(Math.abs(x), Math.abs(z)) > edge;
}

/**
 * Deep enough under a deck of radius `radius` centred at (x, z): the centre deeper than
 * RAFT.depth and 8 rim points deeper than RAFT.rimDepth; no terrain counts as deep.
 * @param {(x: number, z: number) => ({ height: number } | null)} ground
 */
export function openWater(ground, x, z, radius) {
  const deep = (px, pz, depth) => { const g = ground(px, pz); return !g || g.height < -depth; };
  if (!deep(x, z, RAFT.depth)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (!deep(x + Math.cos(a) * radius, z + Math.sin(a) * radius, RAFT.rimDepth)) return false;
  }
  return true;
}

/**
 * One step of a raft. `state` = { x, z, vx, vz } (the deck centre in world XZ, m and m/s).
 * `pull` — the kite's course, a unit {x, z}, or null (slack or let go); `drift` — the speed
 * {x, z} m/s a let-go raft takes on (the wind × the field's windage, as TileSim's drift);
 * `open(x, z)` — whether the deck may stand there.
 * @param {{ x: number, z: number, vx: number, vz: number }} state @param {number} dt
 * @param {{ pull?: { x: number, z: number } | null, drift?: { x: number, z: number },
 *   open?: (x: number, z: number) => boolean }} [options]
 * @returns {{ x: number, z: number, vx: number, vz: number, blocked: boolean }}
 */
export function stepRaft(state, dt, { pull = null, drift = { x: 0, z: 0 }, open = () => true } = {}) {
  const tx = pull ? pull.x * RAFT.speed : drift.x;
  const tz = pull ? pull.z * RAFT.speed : drift.z;
  // the constant force F = drag · speed, solved exactly: v relaxes to the target speed
  const k = Math.exp(-RAFT.drag * dt);
  let vx = tx + (state.vx - tx) * k, vz = tz + (state.vz - tz) * k;
  // the raft's limit: no speed outwards past it
  const r = Math.hypot(state.x, state.z);
  if (r > RAFT.limit) {
    const nx = state.x / r, nz = state.z / r, out = vx * nx + vz * nz;
    if (out > 0) { vx -= out * nx; vz -= out * nz; }
  }
  const x = state.x + vx * dt, z = state.z + vz * dt;
  // aground: stop short (from shallow water already, it may still go out)
  if (!open(x, z) && open(state.x, state.z)) return { x: state.x, z: state.z, vx: 0, vz: 0, blocked: true };
  return { x, z, vx, vz, blocked: false };
}
