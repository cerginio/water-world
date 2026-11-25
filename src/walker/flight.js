// The walker on the board under the kite (STORY-QUEST-SPEC §2 п.6 «Вихід з плоту», §4.2
// v1.5; story-quest Q4b). Off a raft with the kite up, the kite lifts the walker on the board
// it always has with it, and the board flies over the waves: 2–4 m over the mean water level
// (y = 0), not on the wave's profile (an exact height on the CPU is HANDOFF п.8), three times
// the raft's speed, along the course of the walk input; no input — the kite slackens and the
// board slows to a hover. Pure: no three.js, no DOM.
//
// Landing: over ground the walker can wade on (≥ −wade) — at once, on the feet; over a deck —
// when the person lands (walker.land()), and the deck becomes the raft; over deep water there
// is no landing: the kite is not let go there before swimming (Q5b).

/** @type {Readonly<{ speed: number, drag: number, height: number, bob: number, period: number, rise: number, limit: number }>} */
export const FLIGHT = Object.freeze({
  speed: 24,     // m/s: three times the raft (RAFT.speed 8)
  drag: 0.8,     // 1/s: how fast the board takes on the kite's speed, or slows without it
  height: 3,     // m over the mean water level the board flies at…
  bob: 0.4,      // …± this, slowly (the band 2–4 m holds with a margin)
  period: 3.2,   // s of one bob
  rise: 0.6,     // s: the time constant the board rises (takeoff) and keeps to the bob with
  limit: 1500,   // m from the island centre: no speed outwards past it (RAFT.limit)
});

/**
 * One step of the board. `state` = { x, y, z, vx, vz, t } (feet on the board, m, m/s, s in the
 * air); `course` — a unit {x, z} or null (slack).
 * @param {{ x: number, y: number, z: number, vx: number, vz: number, t: number }} state
 * @param {number} dt @param {{ x: number, z: number } | null} course
 * @returns {{ x: number, y: number, z: number, vx: number, vz: number, t: number }}
 */
export function stepFlight(state, dt, course) {
  const tx = course ? course.x * FLIGHT.speed : 0, tz = course ? course.z * FLIGHT.speed : 0;
  const k = Math.exp(-FLIGHT.drag * dt);
  let vx = tx + (state.vx - tx) * k, vz = tz + (state.vz - tz) * k;
  const r = Math.hypot(state.x, state.z);
  if (r > FLIGHT.limit) {
    const nx = state.x / r, nz = state.z / r, out = vx * nx + vz * nz;
    if (out > 0) { vx -= out * nx; vz -= out * nz; }
  }
  const t = state.t + dt;
  const target = FLIGHT.height + FLIGHT.bob * Math.sin((t / FLIGHT.period) * Math.PI * 2);
  const y = target + (state.y - target) * Math.exp(-dt / FLIGHT.rise);
  return { x: state.x + vx * dt, y, z: state.z + vz * dt, vx, vz, t };
}

/**
 * Where the walker would land at (x, z): 'ground' — wadeable ground (≥ −wade), 'deck' — a
 * deck there (`deckAt`), or null — deep water (no landing before Q5b). Ground first: a deck
 * over the shallows is still land under the feet.
 * @param {(x: number, z: number) => ({ height: number } | null)} ground
 * @param {(x: number, z: number) => any} deckAt
 */
export function landing(ground, deckAt, x, z, wade) {
  const g = ground(x, z);
  if (g && g.height >= -wade) return 'ground';
  return deckAt(x, z) ? 'deck' : null;
}
