// A deck: the box of a frame on the water a walker stands on (STORY-QUEST-SPEC §2 п.5;
// story-quest Q4). The raft (tiles/TileRaft.js) builds one per frame on the water, every
// frame of the scene, in world space; the walker keeps its feet in the deck's own
// coordinates, so a moving raft carries it.
//
// Pure: no three.js, no DOM. A deck is a rectangle: centre (x, z), unit axes u = (ux, uz)
// and v = (vx, vz) in world XZ (the field's x and z), half sizes hu and hv, deck height y.

/**
 * @typedef {{ id: any, x: number, z: number, ux: number, uz: number, vx: number, vz: number,
 *   hu: number, hv: number, y: number }} Deck
 */

/** World (x, z) → the deck's (u, v). @param {Deck} deck */
export function toDeck(deck, x, z) {
  const dx = x - deck.x, dz = z - deck.z;
  return { u: dx * deck.ux + dz * deck.uz, v: dx * deck.vx + dz * deck.vz };
}

/** The deck's (u, v) → world (x, z). @param {Deck} deck */
export function fromDeck(deck, u, v) {
  return { x: deck.x + u * deck.ux + v * deck.vx, z: deck.z + u * deck.uz + v * deck.vz };
}

/** (u, v) at least `margin` inside the deck's rim. @param {Deck} deck */
export function onDeck(deck, u, v, margin = 0) {
  return Math.abs(u) <= deck.hu - margin && Math.abs(v) <= deck.hv - margin;
}

/** (u, v) clamped to `margin` inside the rim (the centre line when the deck is narrower). */
export function clampToDeck(deck, u, v, margin = 0) {
  const cu = Math.max(0, deck.hu - margin), cv = Math.max(0, deck.hv - margin);
  return { u: Math.max(-cu, Math.min(cu, u)), v: Math.max(-cv, Math.min(cv, v)) };
}

/**
 * The deck under world (x, z), or null; of several, the one whose rim is farthest away.
 * @param {Deck[]} decks
 */
export function deckAt(decks, x, z) {
  let best = null, depth = 0;
  for (const deck of decks) {
    const { u, v } = toDeck(deck, x, z);
    const inside = Math.min(deck.hu - Math.abs(u), deck.hv - Math.abs(v));
    if (inside >= 0 && (!best || inside > depth)) { best = deck; depth = inside; }
  }
  return best;
}

/**
 * No deck within `r` of world (x, z) (the distance to each deck's rectangle): where a frame
 * of radius r may unfold without lying over another (Q4b: a miniature put down from a raft).
 * @param {Deck[]} decks
 */
export function deckClear(decks, x, z, r) {
  for (const deck of decks) {
    const { u, v } = toDeck(deck, x, z);
    const du = Math.max(0, Math.abs(u) - deck.hu), dv = Math.max(0, Math.abs(v) - deck.hv);
    if (Math.hypot(du, dv) < r) return false;
  }
  return true;
}

/** World (x, z) to the deck's rectangle, m; 0 on or inside it. @param {Deck} deck */
export function rimDistance(deck, x, z) {
  const { u, v } = toDeck(deck, x, z);
  return Math.hypot(Math.max(0, Math.abs(u) - deck.hu), Math.max(0, Math.abs(v) - deck.hv));
}

const corners = (d) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => fromDeck(d, a * d.hu, b * d.hv));

/**
 * The gap between two decks, rim to rim (m; 0 when they touch or overlap): for two convex
 * rectangles apart, the least distance is from a corner of one to the other.
 * @param {Deck} a @param {Deck} b
 */
export function deckGap(a, b) {
  if (rimDistance(a, b.x, b.z) === 0 || rimDistance(b, a.x, a.z) === 0) return 0;
  let gap = Infinity;
  for (const p of corners(a)) gap = Math.min(gap, rimDistance(b, p.x, p.z));
  for (const p of corners(b)) gap = Math.min(gap, rimDistance(a, p.x, p.z));
  return gap;
}

/**
 * The frame a fate would go to now (STORY-QUEST-SPEC §2 п.6; story-quest Q5), or null. In the
 * air — the deck within `near` m of the board (the frame below). On a deck — another deck
 * within `near` m rim to rim («another frame»: the walker stays where it is), else the deck
 * underfoot (`own`: the walker takes off first). In the water (Q10) — as in the air, the deck
 * within `near` m. On the ground — none.
 * @param {Deck[]} decks @param {{ deckId: any, flying: boolean, swimming?: boolean, x: number, z: number }} walker
 * @returns {{ id: any, own: boolean } | null}
 */
export function deckAtHand(decks, { deckId, flying, swimming = false, x, z }, near) {
  if (flying || swimming) {
    let best = null, gap = near;
    for (const d of decks) { const g = rimDistance(d, x, z); if (g <= gap) { best = d; gap = g; } }
    return best && { id: best.id, own: false };
  }
  const own = deckId === null || deckId === undefined ? null : decks.find((d) => d.id === deckId);
  if (!own) return null;
  let other = null, gap = near;
  for (const d of decks) {
    if (d.id === own.id) continue;
    const g = deckGap(own, d);
    if (g <= gap) { other = d; gap = g; }
  }
  return other ? { id: other.id, own: false } : { id: own.id, own: true };
}

/**
 * The frame on the water «Take into the hands» would fold back into a miniature (STORY-QUEST-SPEC
 * §4.2a «Меню малюнку»; Q10): the deck nearest to (x, z) within `reach` m of its rim, never the
 * one underfoot (`deckId`) — the walker would lose its floor. Decks under a fate are no decks.
 * @param {Deck[]} decks @param {{ deckId: any, x: number, z: number }} walker
 * @returns {any} the deck's id, or null
 */
export function liftAtHand(decks, { deckId, x, z }, reach) {
  let best = null, gap = reach;
  for (const d of decks) {
    if (d.id === deckId) continue;
    const g = rimDistance(d, x, z);
    if (g <= gap) { best = d; gap = g; }
  }
  return best ? best.id : null;
}

/** The point of `deck` nearest to world (x, z), `margin` inside its rim. @param {Deck} deck */
export function nearestOnDeck(deck, x, z, margin = 0) {
  const { u, v } = toDeck(deck, x, z), c = clampToDeck(deck, u, v, margin);
  return fromDeck(deck, c.u, c.v);
}
