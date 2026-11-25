// The walker's state (story-quest Q2a): where the feet are, where the body faces, where
// the eyes look. Steps it by an intent — forward / strafe / turn / look — through
// walkOnGround. Pure: no three.js, no DOM; the host turns it into a figure and a camera.
//
// Q4: decks. `world.decks()` gives the frames on the water as decks (deck.js); a step whose
// target lies on one boards it, and from then on the feet are kept in the deck's own (u, v),
// so a moving raft carries the walker (`ride`, once a frame in any mode). A frame on the
// water floats where its rim is ≥ 0.3 m deep (TileMiniatures.unfoldCenter), 2–3 m past the
// wading line, so the walker jumps: from the water, a deck within DECK_JUMP ahead boards it;
// off the rim, wadeable ground within DECK_JUMP leaves it; otherwise the rim holds. The eyes
// glide over a jump (`state.jump`, an offset that dies away), the feet do not.
import { WALK, walkOnGround } from './groundWalk.js';
import { clampToDeck, deckAt, fromDeck, onDeck, toDeck } from './deck.js';

const SETTLE = 0.06;   // s: the feet follow a deck's height (it bobs, and is read 1–3 frames late)
export const DECK_JUMP = 4;   // m: the farthest jump onto a deck from the water, or off it onto the shallows
const GLIDE = 0.15;   // s: the eyes' offset after a jump dies away with this time constant

export const PACE = Object.freeze({
  walk: 4.2,     // m/s; 1.4 (a real pace) felt too slow on the island — ×3, owner 2026-11-24 (Q2b)
  run: 12,       // m/s with Shift or the stick pushed to the rim
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
 * @param {{ moveOnSheet: Function, ground: (x: number, z: number) => any,
 *   decks?: () => import('./deck.js').Deck[] }} world
 * @param {{ bodyScale?: number, eye?: number, wade?: number }} [options]
 */
export function createWalker(world, { bodyScale = WALK.bodyScale, eye = WALK.eye, wade = WALK.wade } = {}) {
  /** deck: null on the ground, or { id, u, v } — where the feet are on that deck */
  const state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, normal: null, moving: false, walked: 0,
    /** @type {{ id: any, u: number, v: number } | null} */ deck: null,
    /** the eyes' offset from the feet's place after a jump (eyes() adds it) */ jump: { x: 0, y: 0, z: 0 } };
  const move = { moveOnSheet: world.moveOnSheet, ground: world.ground, bodyScale, wade };
  const radius = 0.15 * bodyScale;   // Tilecraft avatarBodyOf, as walkOnGround
  const decks = () => world.decks?.() ?? [];
  const deckOf = (id) => decks().find((d) => d.id === id) ?? null;
  const UP = { x: 0, y: 1, z: 0 };

  /** The world offset of an intent's forward / strafe this frame (before the pace). */
  const heading = (forward, strafe) => {
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    // facing (sin yaw, cos yaw); right of it (-cos yaw, sin yaw)
    return { x: forward * s - strafe * c, z: forward * c + strafe * s };
  };

  /** Moves the feet to (x, y, z) at once; the eyes keep where they were and glide after. */
  const jumpTo = (x, y, z) => {
    state.jump.x += state.x - x; state.jump.y += state.y - y; state.jump.z += state.z - z;
    Object.assign(state, { x, y, z });
  };

  /** A step on a deck: inside the rim, off it onto wadeable ground, or along the rim. */
  const stepOnDeck = (deck, offset) => {
    const at = state.deck;
    const du = offset.x * deck.ux + offset.z * deck.uz, dv = offset.x * deck.vx + offset.z * deck.vz;
    const u = at.u + du, v = at.v + dv;
    if (!onDeck(deck, u, v, radius)) {
      // off the rim: the nearest wadeable ground ahead within a jump, clear of every deck
      const l = Math.hypot(offset.x, offset.z), dx = offset.x / l, dz = offset.z / l;
      const c = clampToDeck(deck, u, v, radius), rim = fromDeck(deck, c.u, c.v);
      for (let t = 0.25; t <= DECK_JUMP + 1e-9; t += 0.25) {
        const x = rim.x + dx * t, z = rim.z + dz * t, g = world.ground(x, z);
        if (deckAt(decks(), x, z) || !g || g.height < -wade) continue;
        state.deck = null;
        jumpTo(x, g.height, z);
        state.normal = g.normal;
        return t;
      }
    }
    const c = clampToDeck(deck, u, v, radius);
    const moved = Math.hypot(c.u - at.u, c.v - at.v);
    state.deck = { id: deck.id, u: c.u, v: c.v };
    const p = fromDeck(deck, c.u, c.v);
    Object.assign(state, { x: p.x, z: p.z });
    return moved;
  };

  const walker = {
    state,
    bodyScale,
    pace: PACE,
    /** Puts the feet on the ground at (x, z), facing yaw (0 = +z, π/2 = +x). */
    place(x, z, yaw = state.yaw) {
      const g = world.ground(x, z);
      if (!g) throw new Error(`walker: (${x.toFixed(1)}, ${z.toFixed(1)}) is off the terrain`);
      Object.assign(state, { x, y: g.height, z, yaw, pitch: 0, normal: g.normal, moving: false, deck: null,
        jump: { x: 0, y: 0, z: 0 } });
    },
    /**
     * Onto a deck at its (u, v) — clamped inside the rim; the feet at the deck's height.
     * @param {import('./deck.js').Deck} deck
     */
    board(deck, u = 0, v = 0, yaw = state.yaw) {
      const c = clampToDeck(deck, u, v, radius), p = fromDeck(deck, c.u, c.v);
      Object.assign(state, { x: p.x, y: deck.y, z: p.z, yaw, normal: UP, moving: false, deck: { id: deck.id, u: c.u, v: c.v },
        jump: { x: 0, y: 0, z: 0 } });
    },
    /**
     * Once a frame, in any mode: on a deck, the feet go where the deck has carried them and
     * settle to its height; a deck that is gone (the frame left the water) drops the walker
     * onto the ground under it, if there is any. On the ground: nothing.
     * @param {number} dt seconds
     */
    ride(dt) {
      const fade = Math.exp(-Math.max(0, dt) / GLIDE), j = state.jump;
      j.x *= fade; j.y *= fade; j.z *= fade;
      if (Math.hypot(j.x, j.y, j.z) < 1e-3) j.x = j.y = j.z = 0;
      if (!state.deck) return;
      const deck = deckOf(state.deck.id);
      if (!deck) {
        const g = world.ground(state.x, state.z);
        state.deck = null;
        if (g) Object.assign(state, { y: g.height, normal: g.normal });
        return;
      }
      const p = fromDeck(deck, state.deck.u, state.deck.v);
      const k = 1 - Math.exp(-Math.max(0, dt) / SETTLE);
      Object.assign(state, { x: p.x, z: p.z, y: state.y + (deck.y - state.y) * k, normal: UP });
    },
    /**
     * Where an intent's forward / strafe points in the world now: a unit {x, z}, or null
     * without one (the kite's course, Q4).
     * @param {WalkIntent} intent
     */
    direction(intent = {}) {
      const { forward = 0, strafe = 0 } = intent;
      const h = heading(forward, strafe), l = Math.hypot(h.x, h.z);
      return l < 1e-6 ? null : { x: h.x / l, z: h.z / l };
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
      const h = heading(forward, strafe);
      const offset = { x: h.x * scale, z: h.z * scale };
      const deck = state.deck && deckOf(state.deck.id);
      if (deck) {
        const moved = stepOnDeck(deck, offset);
        state.moving = moved > 1e-4;
        state.walked += moved;
        return moved;
      }
      // from the water, a deck within a jump ahead boards it (where the frame floats)
      const here = world.ground(state.x, state.z);
      if (!here || here.height < 0) {
        const l = Math.hypot(offset.x, offset.z), dx = offset.x / l, dz = offset.z / l;
        for (let t = l; t <= DECK_JUMP + 1e-9; t = t < 0.25 ? 0.25 : t + 0.25) {
          const x = state.x + dx * t, z = state.z + dz * t, onto = deckAt(decks(), x, z);
          if (!onto) continue;
          const { u, v } = toDeck(onto, x, z), c = clampToDeck(onto, u, v, radius), p = fromDeck(onto, c.u, c.v);
          jumpTo(p.x, state.y, p.z);   // ride() settles the feet onto the deck
          state.deck = { id: onto.id, u: c.u, v: c.v };
          state.normal = UP;
          state.moving = true;
          state.walked += t;
          return t;
        }
      }
      const next = walkOnGround(state, offset, move);
      const moved = Math.hypot(next.x - state.x, next.z - state.z);
      Object.assign(state, { x: next.x, y: next.y, z: next.z, normal: next.normal, moving: moved > 1e-4 });
      state.walked += moved;
      return moved;
    },
    /** Eye point and a point straight ahead of it, as plain {x, y, z}. */
    eyes() {
      const cp = Math.cos(state.pitch);
      const j = state.jump;
      const position = { x: state.x + j.x, y: state.y + eye + j.y, z: state.z + j.z };
      const target = { x: position.x + Math.sin(state.yaw) * cp, y: position.y + Math.sin(state.pitch),
        z: position.z + Math.cos(state.yaw) * cp };
      return { position, target };
    },
  };
  return walker;
}
