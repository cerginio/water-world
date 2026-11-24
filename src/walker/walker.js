// The walker's state (story-quest Q2a): where the feet are, where the body faces, where
// the eyes look. Steps it by an intent — forward / strafe / turn / look — through
// walkOnGround. Pure: no three.js, no DOM; the host turns it into a figure and a camera.
import { WALK, walkOnGround } from './groundWalk.js';

export const PACE = Object.freeze({
  walk: 1.4,     // m/s
  run: 4,        // m/s with Shift
  turn: 1.8,     // rad/s, keys
  pitch: 1.2,    // rad/s, keys
  maxPitch: 1.3, // rad, up and down
});

/**
 * @typedef {{ forward?: number, strafe?: number, turn?: number, pitch?: number, run?: boolean,
 *   look?: { yaw: number, pitch: number } }} WalkIntent
 *   forward / strafe / turn / pitch in -1..1 (keys or a stick); `look` — radians this
 *   frame from a drag, added as is. Positive turn = to the left, positive pitch = up.
 */

/**
 * @param {{ moveOnSheet: Function, ground: (x: number, z: number) => any }} world
 * @param {{ bodyScale?: number, eye?: number, wade?: number }} [options]
 */
export function createWalker(world, { bodyScale = WALK.bodyScale, eye = WALK.eye, wade = WALK.wade } = {}) {
  const state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, normal: null, moving: false, walked: 0 };
  const move = { moveOnSheet: world.moveOnSheet, ground: world.ground, bodyScale, wade };

  return {
    state,
    bodyScale,
    /** Puts the feet on the ground at (x, z), facing yaw (0 = +z, π/2 = +x). */
    place(x, z, yaw = state.yaw) {
      const g = world.ground(x, z);
      if (!g) throw new Error(`walker: (${x.toFixed(1)}, ${z.toFixed(1)}) is off the terrain`);
      Object.assign(state, { x, y: g.height, z, yaw, pitch: 0, normal: g.normal, moving: false });
    },
    /** @param {number} dt seconds @param {WalkIntent} intent */
    step(dt, intent = {}) {
      const { forward = 0, strafe = 0, turn = 0, pitch = 0, run = false, look } = intent;
      state.yaw += turn * PACE.turn * dt + (look?.yaw ?? 0);
      state.pitch = Math.max(-PACE.maxPitch, Math.min(PACE.maxPitch,
        state.pitch + pitch * PACE.pitch * dt + (look?.pitch ?? 0)));
      const length = Math.hypot(forward, strafe);
      if (length < 1e-6) { state.moving = false; return 0; }
      const scale = Math.min(1, length) / length * (run ? PACE.run : PACE.walk) * dt;
      const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
      // facing (sin yaw, cos yaw); right of it (-cos yaw, sin yaw)
      const offset = { x: (forward * s - strafe * c) * scale, z: (forward * c + strafe * s) * scale };
      const next = walkOnGround(state, offset, move);
      const moved = Math.hypot(next.x - state.x, next.z - state.z);
      Object.assign(state, { x: next.x, y: next.y, z: next.z, normal: next.normal, moving: moved > 1e-4 });
      state.walked += moved;
      return moved;
    },
    /** Eye point and a point straight ahead of it, as plain {x, y, z}. */
    eyes() {
      const cp = Math.cos(state.pitch);
      const position = { x: state.x, y: state.y + eye, z: state.z };
      const target = { x: position.x + Math.sin(state.yaw) * cp, y: position.y + Math.sin(state.pitch),
        z: position.z + Math.cos(state.yaw) * cp };
      return { position, target };
    },
  };
}
