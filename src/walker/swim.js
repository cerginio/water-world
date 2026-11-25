// The walker in the water (STORY-QUEST-SPEC §2 п.6 «Плавання й пірнання»; story-quest Q5b).
// Into the water: from the board over deep water (the kite let go there), off a deck with the
// kite down, or when the deck under the feet is gone. The walker swims at the surface and
// dives; the camera is the eyes as everywhere (CameraRig.ride, OWNER-3), so under the water
// it is under the water (UnderwaterPass in main.js does the rest). Out: onto wadeable ground
// (≥ −wade) — the walker stands and walks; onto a deck within a jump at the surface.
// Pure: no three.js, no DOM.
//
// Depth is of the eyes under the mean water level (y = 0). At the surface the eyes ride the
// wave (`water` — the height of the water there), deeper they leave it: the swell's share
// dies away over SWIM.wave m, so a diver is not rocked 40 m down.
//
// Going down and up: forward follows the gaze under the water, or at the surface when the
// gaze is down past SWIM.gaze — look down and swim, and the walker dives; without input the
// depth goes to `target` (neutral: where the last stroke left it). «Dive» (Space, a button)
// puts the target SWIM.dive m deeper, «Surface» puts it at 0. No breath, no drowning.

/** @type {Readonly<{ pace: number, run: number, surface: number, dive: number, vertical: number,
 *   gaze: number, under: number, floor: number, depth: number, wave: number, board: number, limit: number }>} */
export const SWIM = Object.freeze({
  pace: 3,         // m/s: slower than the walk (PACE.walk 4.2), ×3 a real swimmer as the walk is
  run: 6,          // m/s with Shift or the stick at the rim
  surface: 0.35,   // m: the eyes over the water at the surface (UnderwaterPass: under at −0.3)
  dive: 3,         // m: one «Dive» deeper
  vertical: 1.5,   // m/s towards the target depth without input
  gaze: 0.35,      // rad: at the surface, looking down past this, forward goes down
  under: 0.2,      // m: deeper than this (or going there) the button says «Surface», not «Dive»
  floor: 0.6,      // m: the eyes keep this far over the bed
  depth: 50,       // m: the deepest the eyes go (a sunk frame lies 40 m down, FATE.sink.depth)
  wave: 1.5,       // m: the depth over which the eyes stop riding the wave
  board: 1,        // m: shallower than this a deck within a jump ahead boards it
  limit: 1500,     // m from the island centre: no stroke outwards past it (RAFT.limit, FLIGHT.limit)
});

/** Where the eyes are at `depth` under the mean level, with the water at `water` there. */
export function eyeLevel(depth, water = 0) {
  return water * Math.exp(-depth / SWIM.wave) + SWIM.surface - depth;
}

/**
 * One stroke. `pose` = { x, z, depth, target }; `intent` — forward / strafe (-1..1), the
 * walker's yaw and pitch (rad), run. `ground(x, z)` — the bed ({ height } or null: no bed);
 * `water(x, z)` — the water height (0 without one).
 * @param {{ x: number, z: number, depth: number, target: number }} pose
 * @param {number} dt
 * @param {{ forward?: number, strafe?: number, yaw?: number, pitch?: number, run?: boolean }} intent
 * @param {{ ground: (x: number, z: number) => ({ height: number } | null), water?: (x: number, z: number) => number }} world
 * @returns {{ x: number, z: number, depth: number, target: number, moved: number }}
 */
export function stepSwim(pose, dt, intent, { ground, water = () => 0 }) {
  const { forward = 0, strafe = 0, yaw = 0, pitch = 0, run = false } = intent;
  let { x, z, depth, target } = pose;
  const length = Math.hypot(forward, strafe);
  let moved = 0;
  if (length > 1e-6) {
    const scale = Math.min(1, length) / length * (run ? SWIM.run : SWIM.pace) * dt;
    const f = forward * scale, r = strafe * scale;
    // under the water at all (a stroke up goes all the way to the surface), or a look down
    const gaze = depth > 1e-6 || pitch < -SWIM.gaze;
    const along = gaze ? f * Math.cos(pitch) : f;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    let dx = along * s - r * c, dz = along * c + r * s;
    const radius = Math.hypot(x, z);
    if (radius > SWIM.limit) {
      const nx = x / radius, nz = z / radius, out = dx * nx + dz * nz;
      if (out > 0) { dx -= out * nx; dz -= out * nz; }
    }
    x += dx; z += dz;
    moved = Math.hypot(dx, dz);
    if (gaze) {
      const down = -f * Math.sin(pitch);
      depth += down;
      if (Math.abs(down) > 1e-9) target = depth;
      moved = Math.hypot(moved, down);
    }
  }
  // towards the target (a stroke down or up has just put it where the eyes are)
  const rate = SWIM.vertical * dt;
  depth += Math.max(-rate, Math.min(rate, target - depth));
  depth = depth < 1e-6 ? 0 : Math.min(SWIM.depth, depth);
  target = Math.max(0, Math.min(SWIM.depth, target));
  // over the bed
  const bed = ground(x, z);
  if (bed) {
    const w = water(x, z);
    const lowest = bed.height + SWIM.floor;
    if (eyeLevel(depth, w) < lowest) {
      // the deepest depth whose eyes stay over the bed (eyeLevel falls with depth)
      let lo = 0, hi = depth;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (eyeLevel(m, w) < lowest) hi = m; else lo = m; }
      depth = lo;
      target = Math.min(target, depth);
    }
  }
  return { x, z, depth, target, moved };
}
