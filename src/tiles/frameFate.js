// A frame's fate at sea (STORY-QUEST-SPEC §2 п.6, §4.1 «Долі кадру»; Edge §4.4; story-quest Q5).
// Three fates and their way back: release — the frame drifts off over the horizon / call it
// back; sink — it goes slowly down to the bed / raise it; break — it comes apart into its
// tiles and they sink one by one, like paper / gather them. Every fate goes back until the
// person says «Leave it so» (keep): then it is part of the world and has no way back here.
//
// Pure: no three.js, no DOM. A fate is a clock: `t` 0..1 runs forward (dir 1) while the fate
// happens, backwards (dir -1) while it is undone; at 0 the frame is afloat again, the fate
// gone. Everything a frame looks like at a moment is a function of `t` (fateLook), and a
// broken frame's tiles are a function of the break clock and the tile's id (TILE_FATE_GLSL),
// so undoing is the same path run back: the frame comes back to the pose it left.

/** @typedef {'release' | 'sink' | 'break'} FateKind */
/**
 * @typedef {{ kind: FateKind | null, t: number, dir: number, kept: boolean,
 *   origin: { x: number, z: number } | null, away: { x: number, z: number } | null }} Fate
 */

export const FATE = Object.freeze({
  // away from the island, out to sea: `distance` m in `seconds`; the last quarter it dips
  // `dip` m under the surface (over the horizon, out of the fog), then it is gone
  release: Object.freeze({ seconds: 60, distance: 600, dip: 3 }),
  // down `depth` m (or to the bed, which holds it: TileSim's terrain floor); past 1200 m
  // from the island there is no bed (spec §4.3), and it stops at `depth`
  sink: Object.freeze({ seconds: 30, depth: 40 }),
  // each tile starts within `stagger` s of the break (by its id), drifts up to `spread` m
  // from its place and sinks `depth` m in `tile` s, slow at first, like wet paper
  break: Object.freeze({ seconds: 24, stagger: 16, tile: 8, spread: 2.5, depth: 25 }),
  back: 2,      // the way back runs this many times faster than the fate went
  near: 10,     // m from deck rim to deck rim: another frame a fate can be given to from a deck
});

/** The way back of each fate (Edge §4.4: «Покликати», «Підняти», «Зібрати»). */
export const UNDO = Object.freeze({ release: 'call', sink: 'raise', break: 'gather' });
export const KINDS = Object.freeze(/** @type {FateKind[]} */ (['release', 'sink', 'break']));

/** @returns {Fate} afloat, no fate */
export function afloat() {
  return { kind: null, t: 0, dir: 0, kept: false, origin: null, away: null };
}

/**
 * A fate begins: only for a frame afloat. `origin` — where the frame is now (world XZ),
 * `away` — a unit direction out to sea (release only).
 * @param {Fate} fate @param {FateKind} kind
 * @param {{ origin?: { x: number, z: number }, away?: { x: number, z: number } }} [at]
 * @returns {Fate | null} null when it may not begin
 */
export function begin(fate, kind, { origin = { x: 0, z: 0 }, away = { x: 1, z: 0 } } = {}) {
  if (!KINDS.includes(kind) || fate.kind !== null || fate.kept) return null;
  const l = Math.hypot(away.x, away.z) || 1;
  return { kind, t: 0, dir: 1, kept: false, origin: { ...origin }, away: { x: away.x / l, z: away.z / l } };
}

/** The way back (call / raise / gather), from wherever the fate has got to. @returns {Fate | null} */
export function undo(fate) {
  if (fate.kind === null || fate.kept || fate.dir === -1) return null;
  return { ...fate, dir: -1 };
}

/** «Leave it so»: the fate runs to its end and stays. Not while it is being undone. @returns {Fate | null} */
export function keep(fate) {
  if (fate.kind === null || fate.kept || fate.dir === -1) return null;
  return { ...fate, kept: true, dir: fate.t >= 1 ? 0 : 1 };
}

/**
 * One step of the clock. @param {Fate} fate @param {number} dt s
 * @returns {Fate} the same object when nothing moves; afloat() once undone to the start
 */
export function stepFate(fate, dt) {
  if (fate.kind === null || fate.dir === 0 || !(dt > 0)) return fate;
  const rate = (fate.dir > 0 ? 1 : FATE.back) / FATE[fate.kind].seconds;
  const t = Math.max(0, Math.min(1, fate.t + fate.dir * rate * dt));
  if (t <= 0 && fate.dir < 0) return afloat();
  return { ...fate, t, dir: t >= 1 ? 0 : fate.dir };
}

const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * What the frame looks like now: `at` — its world XZ (release moves it; otherwise where it
 * was), `sink` — m under the surface for the whole frame, `clock` — s since the break began
 * (0 — whole), `hidden` — gone over the horizon.
 * @param {Fate} fate
 * @returns {{ at: { x: number, z: number } | null, sink: number, clock: number, hidden: boolean }}
 */
export function fateLook(fate) {
  const none = { at: null, sink: 0, clock: 0, hidden: false };
  if (fate.kind === null) return none;
  const { t } = fate;
  if (fate.kind === 'release') {
    const r = FATE.release, d = r.distance * smooth(0, 1, t);
    return { at: { x: fate.origin.x + fate.away.x * d, z: fate.origin.z + fate.away.z * d },
      sink: r.dip * smooth(0.75, 1, t), clock: 0, hidden: t >= 1 };
  }
  if (fate.kind === 'sink') return { ...none, sink: FATE.sink.depth * smooth(0, 1, t) };
  return { ...none, clock: t * FATE.break.seconds };
}

/** Settled: the fate has run to its end (gone / on the bed / all sunk). */
export const settled = (fate) => fate.kind !== null && fate.t >= 1;

// The tiles of a frame under its fate, the same in TileSim (where the water is sampled and the
// height goes) and in the tile material (where the tile is drawn). uFates: one texel per
// frame — x sink (m), y break clock (s), w hidden. A broken tile's direction and start come
// from its id alone (no pivot in the vertex shader), so the gather is the break run back.
export const TILE_FATE_GLSL = /* glsl */`
uniform highp sampler2D uFates;
uniform vec4 uBreak;   // stagger s, tile s, spread m, depth m
vec4 frameFate(int frame) { return texelFetch(uFates, ivec2(0, frame), 0); }
float fateHash(int id) {
  uint h = uint(id) * 2654435761u;
  h ^= h >> 15u; h *= 2246822519u; h ^= h >> 13u; h *= 3266489917u; h ^= h >> 16u;
  return float(h & 0xffffu) / 65535.0;
}
// What comes apart as one piece: a polygon tile on its own; a polyline strip whole (its run,
// rest1.z) — its ribbon's triangles join neighbouring tiles, and torn apart they stretched
// into 20 m streaks down into the sea (Q5)
int fatePiece(int tileId, vec4 rest1) { return (int(rest1.w) & 1) != 0 ? 0x40000000 + int(rest1.z) : tileId; }
// xz: the piece's drift from its place (field axes, m); y: m under the surface; w: hidden
vec4 tileFate(int piece, vec4 fate) {
  float sink = fate.x;
  vec2 spread = vec2(0.0);
  if (fate.y > 0.0) {
    float p = clamp((fate.y - fateHash(piece) * uBreak.x) / uBreak.y, 0.0, 1.0);
    float a = 6.283185307 * fateHash(piece + 7919);
    spread = vec2(cos(a), sin(a)) * uBreak.z * (0.4 + 0.6 * fateHash(piece + 104729)) * smoothstep(0.0, 0.4, p);
    sink += uBreak.w * p * p;
  }
  return vec4(spread.x, sink, spread.y, fate.w);
}
`;

/** The uBreak uniform's value: [stagger, tile, spread, depth]. */
export const BREAK_UNIFORM = Object.freeze([FATE.break.stagger, FATE.break.tile, FATE.break.spread, FATE.break.depth]);
