// The walker on the board under the kite (STORY-QUEST-SPEC §2 п.6 «Вихід з плоту», §4.2
// v1.5–v1.6; story-quest Q4b, Q9). Pure: no three.js, no DOM.
//
// Q9 (§4.2 v1.6): the board rides the water and gets airborne only as a reward for speed. Its
// phase, by the speed in units of the raft's (× = RAFT.speed, 8 m/s):
//   'sit'   < 1.5×  — sunk ankle-deep, barely moving; «forward» gets it planing in ~1.5 s;
//   'plane' 1.5–3.5× — on the surface, riding the wave (the water's height under the feet, as a
//                      swimmer's); «forward» speeds it to 7× in ~2.5 s, without it the water
//                      brakes it to 'sit' in ~4 s;
//   'rise' → 'air' → 'fall' — off the water: up to a plateau ~3 m over the mean level along a
//                      smootherstep, nearly level there (± 0.15 m, 7 s), down to the water the
//                      same way, the touch eats 20 % of the speed and dips the eyes ≤ 0.15 m.
// A hill, not a sine: lift-off after ≥ 0.6 s at ≥ 3.5× with «forward» and ≥ 1.5 s of planing
// since the last touch; down when the speed falls under 3.5× (or «forward» has been let go > 1 s
// at < 4×), but not before 3 s in the air unless it is under 2.5×. `calm` (prefers-reduced-motion)
// — planing only, no lift-off. The course turns the heading smoothly; the camera is the eyes,
// it never rolls or pitches with the board (nothing here tilts).
//
// Landing: over ground the walker can wade on (≥ −wade) — at once, on the feet; over a deck —
// when the person lands (walker.land()), and the deck becomes the raft; over deep water — when
// the person lets the kite go, into the water (swim.js, Q5b).

const UNIT = 8;   // m/s, RAFT.speed (tests hold the two equal; walker/ does not import tiles/)

/** @type {Readonly<Record<string, any>>} */
export const FLIGHT = Object.freeze({
  unit: UNIT,          // m/s: × in the spec
  speed: 7 * UNIT,     // m/s: the ceiling, 56 (Q8, the owner)
  sit: 1.5 * UNIT,     // m/s: under it the board sits in the water
  start: 2 * UNIT,     // m/s at least, put on the water off a raft: planing ~1 s without «forward»
                       // (at 1.5× — the threshold itself — it sat at once, probe-story-q4b)
  air: 3.5 * UNIT,     // m/s: from it (with «forward») the board gets airborne; under it, down
  early: 2.5 * UNIT,   // m/s: under it the board comes down before its 3 s in the air
  slackHigh: 4 * UNIT, // m/s: «forward» let go > `slack` s under this — down
  accel: Object.freeze({ sit: 8, plane: 17.6, air: 17.6 }),   // m/s²: 0→1.5× in 1.5 s, 1.5×→7× in 2.5 s
  // m/s²: 3.5×→1.5× in 4 s on the water; 7×→3.5× in 5.6 s aloft; gliding down softer, so the touch
  // (−20 %) lands planing, not sinking (at 5 it touched under 1.5× and sat at once, Q9 probe)
  brake: Object.freeze({ sit: 2, plane: 4, air: 5, fall: 2 }),
  turn: 3,             // 1/s: how fast the heading swings round to the course (1.5: a ~37 m arc at 7×
                       // overshot a raft by the beach onto the shallows, probe-story-q4b)
  sink: 0.15,          // m the feet are under the surface in 'sit' (ankle-deep)
  lift: 0.4,           // s: the time constant the board comes up onto the surface / sinks with
  surf: 0.2,           // s + speed / skim: the water under the board, smoothed — the GPU read is 1–3
  skim: 40,            // frames late and steps (6.4 m/s spikes raw at 56 m/s, Q9 probe), and a fast
                       // board meets a wave every ~1.5 s: it skims the crests, follows only the swell
  height: 3,           // m over the mean water level: the plateau…
  sway: 0.15,          // …± this…
  period: 7,           // …slowly (s)
  rise: 2.4,           // s at least, up and down: a smootherstep, ≤ 2.5 m/s and ~3 m/s² over 3 m
  vmax: 2.2,           // m/s the rise and the fall are planned under (a longer one when the wave is low)…
  vlimit: 2.5,         // …and never exceed off the water: the wave under a fall adds its own (3.5 m/s seen)
  ready: 0.6,          // s at ≥ 3.5× with «forward» before lift-off
  glide: 1.5,          // s of planing since the touch before the next lift-off
  plateau: 3,          // s in the air before the fall (unless under `early`)
  slack: 1,            // s without «forward» that bring it down at < 4×
  touch: 0.8,          // the speed kept when the board touches the water
  dip: 0.15,           // m the eyes give at the touch…
  dipTime: 0.3,        // …and come back within (s)
  limit: 1500,         // m from the island centre: no speed outwards past it (RAFT.limit)
});

/** @typedef {'sit' | 'plane' | 'rise' | 'air' | 'fall'} BoardPhase */
/**
 * @typedef {{ x: number, y: number, z: number, vx: number, vz: number, t: number,
 *   phase: BoardPhase, hx: number, hz: number, since: number, fast: number, slack: number,
 *   aloft: number, lift: number, from: number, span: number, touched: number, surf: number | null }} BoardState
 */

/** The state of the spec's table: 'sit', 'plane' or 'air' (rising, aloft and falling). */
export function boardState(phase) {
  return phase === 'sit' || phase === 'plane' ? phase : 'air';
}

const smootherstep = (p) => { const q = Math.min(1, Math.max(0, p)); return q * q * q * (q * (q * 6 - 15) + 10); };
const plateau = (t) => FLIGHT.height + FLIGHT.sway * Math.sin((t / FLIGHT.period) * Math.PI * 2);
/** The rise / fall over `dy` m: ≥ FLIGHT.rise, longer so the peak speed (1.875 × the mean) stays ≤ vmax. */
const spanOf = (dy) => Math.max(FLIGHT.rise, Math.abs(dy) * 1.875 / FLIGHT.vmax);

/**
 * The board put on the water (Q9: «Onto the board»): 'plane' at the raft's speed (at least
 * 2×, so it planes for a while), or 'sit' from the water at a standstill. Feet at the water's height.
 * @param {{ x: number, z: number }} velocity @param {number} yaw @param {'plane' | 'sit'} [phase]
 * @returns {Omit<BoardState, 'x' | 'y' | 'z'>}
 */
export function boardOn(velocity, yaw, phase = 'plane') {
  const v = Math.hypot(velocity.x, velocity.z);
  const hx = v > 0.1 ? velocity.x / v : Math.sin(yaw), hz = v > 0.1 ? velocity.z / v : Math.cos(yaw);
  const s = phase === 'plane' ? Math.max(v, FLIGHT.start) : 0;
  return { vx: hx * s, vz: hz * s, t: 0, phase, hx, hz, since: 0, fast: 0, slack: 0, aloft: 0,
    lift: phase === 'plane' ? 1 : 0, from: 0, span: FLIGHT.rise, touched: Infinity, surf: null };
}

/**
 * One step of the board. `course` — a unit {x, z} («forward»: the kite pulls), or null.
 * `water(x, z)` — the water's height there (the surface the board rides); `calm` — no lift-off;
 * `limit` — m from the island centre with no speed outwards past it.
 * @param {BoardState} state @param {number} dt @param {{ x: number, z: number } | null} course
 * @param {{ water?: (x: number, z: number) => number, calm?: boolean, limit?: number }} [world]
 * @returns {BoardState}
 */
export function stepFlight(state, dt, course, { water = () => 0, calm = false, limit = FLIGHT.limit } = {}) {
  const F = FLIGHT;
  let { phase, hx, hz, since, fast, slack, aloft, lift, from, span, touched, surf } = { ...boardOn({ x: state.vx, z: state.vz }, 0), ...state };
  const kind = phase === 'sit' || phase === 'plane' ? phase : 'air';
  const brake = phase === 'fall' ? F.brake.fall : F.brake[kind];
  let s = Math.hypot(state.vx, state.vz);
  if (course) {
    const cross = hx * course.z - hz * course.x, dot = hx * course.x + hz * course.z;
    const a = -Math.atan2(cross, dot) * (1 - Math.exp(-F.turn * dt));
    const c = Math.cos(a), n = Math.sin(a);
    [hx, hz] = [hx * c + hz * n, -hx * n + hz * c];
    s = Math.min(F.speed, s + F.accel[kind] * dt);
  } else s = Math.max(0, s - brake * dt);
  let vx = hx * s, vz = hz * s;
  const r = Math.hypot(state.x, state.z);
  if (r > limit) {
    const nx = state.x / r, nz = state.z / r, out = vx * nx + vz * nz;
    if (out > 0) { vx -= out * nx; vz -= out * nz; }
  }
  const x = state.x + vx * dt, z = state.z + vz * dt, t = state.t + dt, raw = water(x, z);
  surf = surf === null || surf === undefined ? raw : surf + (raw - surf) * (1 - Math.exp(-dt / (F.surf + s / F.skim)));
  const w = surf;
  since += dt; touched += dt;
  fast = course && s >= F.air ? fast + dt : 0;
  slack = course ? 0 : slack + dt;
  if (phase === 'rise' || phase === 'air') aloft += dt;
  let y = state.y;
  // the phase: one change a step at most
  if (phase === 'sit' && s >= F.sit) { phase = 'plane'; since = 0; }
  else if (phase === 'plane' && s < F.sit) { phase = 'sit'; since = 0; }
  else if (phase === 'plane' && !calm && fast >= F.ready && touched >= F.glide) {
    phase = 'rise'; since = 0; aloft = 0; from = state.y; span = spanOf(plateau(t) - from);
  } else if (phase === 'rise' && since >= span) { phase = 'air'; since = 0; }
  else if (phase === 'rise' || phase === 'air') {
    const down = s < F.air || (slack > F.slack && s < F.slackHigh);
    if ((down && phase === 'air' && since >= F.plateau) || s < F.early) {
      phase = 'fall'; since = 0; from = state.y; span = spanOf(from - w);
    }
  } else if (phase === 'fall' && since >= span && Math.abs(state.y - w) < 0.05) {
    phase = 'plane'; since = 0; touched = 0; lift = 1;
    s *= F.touch; vx *= F.touch; vz *= F.touch;
  }
  if (phase === 'sit' || phase === 'plane') {
    lift += ((phase === 'plane' ? 1 : 0) - lift) * (1 - Math.exp(-dt / F.lift));
    const dip = touched < F.dipTime ? F.dip * Math.sin(Math.PI * touched / F.dipTime) : 0;
    y = w - F.sink * (1 - lift) - dip;
  } else {
    const target = phase === 'rise' ? from + (plateau(t) - from) * smootherstep(since / span)
      : phase === 'air' ? plateau(t) : from + (w - from) * smootherstep(since / span);
    const step = F.vlimit * dt;
    y = Math.min(state.y + step, Math.max(state.y - step, target));
  }
  return { x, y, z, vx, vz, t, phase, hx, hz, since, fast, slack, aloft, lift, from, span, touched, surf };
}

/**
 * Where the walker would land at (x, z): 'ground' — wadeable ground (≥ −wade), 'deck' — a
 * deck there (`deckAt`), or 'water' — deep water, or off the terrain (swim.js, Q5b). Ground
 * first: a deck over the shallows is still land under the feet.
 * @returns {'ground' | 'deck' | 'water'}
 * @param {(x: number, z: number) => ({ height: number } | null)} ground
 * @param {(x: number, z: number) => any} deckAt
 */
export function landing(ground, deckAt, x, z, wade) {
  const g = ground(x, z);
  if (g && g.height >= -wade) return 'ground';
  return deckAt(x, z) ? 'deck' : 'water';
}
