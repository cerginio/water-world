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
