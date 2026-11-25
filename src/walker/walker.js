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
//
// Q4b: off a deck, the rim's jump also reaches another deck ahead (a miniature put down
// from the raft, unfolded beside it). The board: `takeOff()` from a deck into the air,
// `fly(dt, course)` once a frame instead of step() (flight.js), `land()` onto a deck under
// the board; over wadeable ground the board lands by itself. `state.flight` — null, or the
// board's { vx, vz, t }.
//
// Q5b: the water (swim.js). `state.swim` — null, or { depth, target } of the eyes under the
// mean level; `state.y` is then the eyes' height less `eye`, so eyes() is the same. Into it:
// land() over deep water, `jumpIn()` off a deck, or the deck under the feet gone (ride()).
// step() strokes instead of walking; out onto wadeable ground or onto a deck at the surface.
// `dive()` / `rise()` set the depth to go to. `world.water(x, z)` — the water's height there.
import { WALK, clearOfWater, walkOnGround } from './groundWalk.js';
import { clampToDeck, deckAt, fromDeck, nearestOnDeck, onDeck, toDeck } from './deck.js';
import { landing, stepFlight } from './flight.js';
import { SWIM, eyeLevel, stepSwim } from './swim.js';

const SETTLE = 0.06;   // s: the feet follow a deck's height (it bobs, and is read 1–3 frames late)
export const DECK_JUMP = 4;   // m: the farthest jump onto a deck from the water, or off it onto the shallows
const GLIDE = 0.15;   // s: the eyes' offset after a jump dies away with this time constant
const JUMP_CONE = Math.cos(Math.PI / 4);   // off a rim, another deck's nearest point within 45° of the step

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
 *   decks?: () => import('./deck.js').Deck[], water?: (x: number, z: number) => number }} world
 * @param {{ bodyScale?: number, eye?: number, wade?: number }} [options]
 */
export function createWalker(world, { bodyScale = WALK.bodyScale, eye = WALK.eye, wade = WALK.wade } = {}) {
  /** deck: null on the ground, or { id, u, v } — where the feet are on that deck */
  const state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, normal: null, moving: false, walked: 0,
    /** @type {{ id: any, u: number, v: number } | null} */ deck: null,
    /** the eyes' offset from the feet's place after a jump (eyes() adds it) */ jump: { x: 0, y: 0, z: 0 },
    /** @type {{ vx: number, vz: number, t: number } | null} on the board in the air */ flight: null,
    /** @type {{ depth: number, target: number } | null} in the water (Q5b) */ swim: null };
  const move = { moveOnSheet: world.moveOnSheet, ground: world.ground, bodyScale, wade };
  const radius = 0.15 * bodyScale;   // Tilecraft avatarBodyOf, as walkOnGround
  const decks = () => world.decks?.() ?? [];
  const deckOf = (id) => decks().find((d) => d.id === id) ?? null;
  const water = (x, z) => world.water?.(x, z) ?? 0;
  const UP = { x: 0, y: 1, z: 0 };

  /** Into the water at (x, z), at the surface; the eyes glide down to it. */
  const enterWater = (x, z) => {
    state.flight = null;
    state.deck = null;
    state.swim = { depth: 0, target: 0 };
    jumpTo(x, eyeLevel(0, water(x, z)) - eye, z);
    state.normal = UP;
  };

  /** From the water (or deep ground), a deck within a jump along `offset` boards it. */
  const jumpOntoDeck = (offset) => {
    const l = Math.hypot(offset.x, offset.z), dx = offset.x / l, dz = offset.z / l;
    for (let t = l; t <= DECK_JUMP + 1e-9; t = t < 0.25 ? 0.25 : t + 0.25) {
      const x = state.x + dx * t, z = state.z + dz * t, onto = deckAt(decks(), x, z);
      if (!onto) continue;
      boardAt(onto, x, z);
      state.moving = true;
      state.walked += t;
      return t;
    }
    return 0;
  };

  /** One stroke in the water (swim.js); out onto wadeable ground, or onto a deck ahead. */
  const swimStep = (dt, { forward = 0, strafe = 0, run = false }) => {
    const sw = state.swim;
    const length = Math.hypot(forward, strafe);
    if (length > 1e-6 && sw.depth < SWIM.board) {
      const h = heading(forward, strafe), jumped = jumpOntoDeck({ x: h.x * 0.01, z: h.z * 0.01 });
      if (jumped) return jumped;
    }
    const next = stepSwim({ x: state.x, z: state.z, depth: sw.depth, target: sw.target }, dt,
      { forward, strafe, yaw: state.yaw, pitch: state.pitch, run }, { ground: world.ground, water });
    const g = world.ground(next.x, next.z);
    if (g && g.height >= -wade) {
      // the shallows: stand up there, pushed clear of the wading line as a walker is
      const p = clearOfWater(world.ground, next.x, next.z, radius, { wade }), at = p && world.ground(p.x, p.z);
      if (at) {
        state.swim = null;
        jumpTo(p.x, at.height, p.z);
        state.normal = at.normal;
        state.moving = true;
        state.walked += next.moved;
        return next.moved;
      }
    }
    sw.depth = next.depth; sw.target = next.target;
    Object.assign(state, { x: next.x, z: next.z, y: eyeLevel(next.depth, water(next.x, next.z)) - eye,
      moving: next.moved > 1e-4 });
    state.walked += next.moved;
    return next.moved;
  };

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

  /** The feet onto `deck` where world (x, z) falls, clamped inside its rim; the eyes glide. */
  const boardAt = (deck, x, z, y = state.y) => {
    const { u, v } = toDeck(deck, x, z), c = clampToDeck(deck, u, v, radius), p = fromDeck(deck, c.u, c.v);
    jumpTo(p.x, y, p.z);   // ride() settles the feet onto the deck
    state.deck = { id: deck.id, u: c.u, v: c.v };
    state.normal = UP;
    state.swim = null;
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
      const others = decks().filter((d) => d.id !== deck.id);
      for (let t = 0.25; t <= DECK_JUMP + 1e-9; t += 0.25) {
        const x = rim.x + dx * t, z = rim.z + dz * t, onto = deckAt(others, x, z);
        if (onto) { boardAt(onto, x, z); return t; }
        const g = world.ground(x, z);
        if (deckAt(decks(), x, z) || !g || g.height < -wade) continue;
        state.deck = null;
        jumpTo(x, g.height, z);
        state.normal = g.normal;
        return t;
      }
      // no deck straight ahead (a step aimed at a frame's centre from a corner): the nearest
      // point of another deck within a jump and within 45° of the step (Q4b)
      let best = null, bd = DECK_JUMP;
      for (const other of others) {
        const p = nearestOnDeck(other, rim.x, rim.z, radius), ex = p.x - rim.x, ez = p.z - rim.z, d = Math.hypot(ex, ez);
        if (d <= bd && d > 1e-6 && (ex * dx + ez * dz) / d >= JUMP_CONE) { best = { other, p }; bd = d; }
      }
      if (best) { boardAt(best.other, best.p.x, best.p.z); return bd; }
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
        jump: { x: 0, y: 0, z: 0 }, flight: null, swim: null });
    },
    /**
     * Onto a deck at its (u, v) — clamped inside the rim; the feet at the deck's height.
     * @param {import('./deck.js').Deck} deck
     */
    board(deck, u = 0, v = 0, yaw = state.yaw) {
      const c = clampToDeck(deck, u, v, radius), p = fromDeck(deck, c.u, c.v);
      Object.assign(state, { x: p.x, y: deck.y, z: p.z, yaw, normal: UP, moving: false, deck: { id: deck.id, u: c.u, v: c.v },
        jump: { x: 0, y: 0, z: 0 }, flight: null, swim: null });
    },
    /**
     * Once a frame, in any mode: on a deck, the feet go where the deck has carried them and
     * settle to its height; a deck that is gone (the frame left the water, or went to its
     * fate) drops the walker onto wadeable ground under it, or into the water (Q5b). In the
     * water the eyes ride the wave at the surface. On the ground: nothing.
     * @param {number} dt seconds
     */
    ride(dt) {
      const fade = Math.exp(-Math.max(0, dt) / GLIDE), j = state.jump;
      j.x *= fade; j.y *= fade; j.z *= fade;
      if (Math.hypot(j.x, j.y, j.z) < 1e-3) j.x = j.y = j.z = 0;
      if (state.swim) { state.y = eyeLevel(state.swim.depth, water(state.x, state.z)) - eye; return; }
      if (!state.deck) return;
      const deck = deckOf(state.deck.id);
      if (!deck) {
        const g = world.ground(state.x, state.z);
        state.deck = null;
        if (g && g.height >= -wade) Object.assign(state, { y: g.height, normal: g.normal });
        else enterWater(state.x, state.z);
        return;
      }
      const p = fromDeck(deck, state.deck.u, state.deck.v);
      const k = 1 - Math.exp(-Math.max(0, dt) / SETTLE);
      Object.assign(state, { x: p.x, z: p.z, y: state.y + (deck.y - state.y) * k, normal: UP });
    },
    /**
     * Off the deck into the air on the board (the kite lifts it, Q4b); `velocity` — the
     * raft's speed to start with. Only from a deck. @returns {boolean} took off
     */
    takeOff(velocity = { x: 0, z: 0 }) {
      if (!state.deck || state.flight) return false;
      state.deck = null;
      state.flight = { vx: velocity.x, vz: velocity.z, t: 0 };
      state.normal = UP;
      return true;
    },
    /**
     * Where the board would come down now: 'ground', 'deck', 'water' (deep: the kite let go,
     * into the water, Q5b), or null when not in the air.
     */
    landing() {
      return state.flight ? landing(world.ground, (x, z) => deckAt(decks(), x, z), state.x, state.z, wade) : null;
    },
    /**
     * Down from the board: onto wadeable ground on the feet, onto the deck under it, or over
     * deep water into it (Q5b). @returns {'ground' | 'deck' | 'water' | null}
     */
    land() {
      const where = walker.landing();
      if (where === 'ground') {
        const g = world.ground(state.x, state.z);
        state.flight = null;
        jumpTo(state.x, g.height, state.z);
        state.normal = g.normal;
      } else if (where === 'deck') {
        state.flight = null;
        boardAt(deckAt(decks(), state.x, state.z), state.x, state.z);
      } else if (where === 'water') enterWater(state.x, state.z);
      return where;
    },
    /**
     * Off a deck into the water (Q5b): over the rim straight ahead, clear of every deck, by the
     * body's radius and a bit more. Onto wadeable ground if that is what lies there; another
     * deck there — no (a step does that). @returns {'water' | 'ground' | null}
     */
    jumpIn() {
      const deck = state.deck && deckOf(state.deck.id);
      if (!deck || state.flight) return null;
      const dx = Math.sin(state.yaw), dz = Math.cos(state.yaw), reach = 2 * Math.hypot(deck.hu, deck.hv) + 1;
      let t = 0;
      while (t <= reach && deckAt(decks(), state.x + dx * t, state.z + dz * t)) t += 0.25;
      t += radius + 0.3;
      const x = state.x + dx * t, z = state.z + dz * t;
      if (deckAt(decks(), x, z)) return null;
      const g = world.ground(x, z);
      if (g && g.height >= -wade) {
        state.deck = null;
        jumpTo(x, g.height, z);
        state.normal = g.normal;
        return 'ground';
      }
      enterWater(x, z);
      return 'water';
    },
    /** In the water: the depth to go to SWIM.dive m deeper. @returns {boolean} */
    dive() {
      if (!state.swim) return false;
      state.swim.target = Math.min(SWIM.depth, Math.max(state.swim.target, state.swim.depth) + SWIM.dive);
      return true;
    },
    /**
     * Into the water at (x, z) at once, `depth` m under the surface (≤ SWIM.depth; the bed
     * stops the next stroke): the scene's contract puts a walker there (src/embed/, QDa).
     */
    swimAt(x, z, depth = 0) {
      enterWater(x, z);
      const d = Math.min(SWIM.depth, Math.max(0, depth));
      state.swim.depth = state.swim.target = d;
      state.y = eyeLevel(d, water(x, z)) - eye;
      state.jump = { x: 0, y: 0, z: 0 };
    },
    /** In the water: up to the surface. @returns {boolean} */
    rise() {
      if (!state.swim) return false;
      state.swim.target = 0;
      return true;
    },
    /** In the water and not at the surface (going there or below it): «Surface» rather than «Dive». */
    get under() {
      return !!state.swim && (state.swim.depth > SWIM.under || state.swim.target > SWIM.under);
    },
    /**
     * Once a frame in the air, instead of step(): the board along `course` (a unit {x, z} or
     * null), the head turns by the intent; over wadeable ground it lands by itself.
     * @param {number} dt @param {{ x: number, z: number } | null} course @param {WalkIntent} [intent]
     * @returns {'ground' | null} 'ground' when it landed
     */
    fly(dt, course, intent = {}) {
      if (!state.flight) return null;
      const { turn = 0, pitch = 0, look } = intent;
      state.yaw += turn * PACE.turn * dt + (look?.yaw ?? 0);
      state.pitch = Math.max(-PACE.maxPitch, Math.min(PACE.maxPitch,
        state.pitch + pitch * PACE.pitch * dt + (look?.pitch ?? 0)));
      const f = state.flight;
      const next = stepFlight({ x: state.x, y: state.y, z: state.z, vx: f.vx, vz: f.vz, t: f.t }, dt, course);
      const moved = Math.hypot(next.x - state.x, next.z - state.z);
      Object.assign(state, { x: next.x, y: next.y, z: next.z, moving: false });
      Object.assign(f, { vx: next.vx, vz: next.vz, t: next.t });
      state.walked += moved;
      if (walker.landing() !== 'ground') return null;
      walker.land();
      return 'ground';
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
      if (state.swim) return swimStep(dt, intent);
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
        const jumped = jumpOntoDeck(offset);
        if (jumped) return jumped;
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
