// The board under the walker in the air (story-quest Q8, after the owner's sheet «Дошка для
// кайту»): a twin-tip kiteboard, not a box. 134 × 41 cm, tips rounded, a rocker of a few cm,
// the deck in waves of rust, terracotta and cream, two foot pads with straps, a handle in the
// middle, four fins under the tips. Procedural, no textures and no DOM: the colours are vertex
// colours, so it is the same in the scene and in a unit test.
//
// Local frame: the long side along +z (the flight course, index.js), +x across, +y up; the
// origin is the middle of the top of the deck — where the feet stand.
import * as THREE from 'three';

/** m; rocker — how much the tips rise over the middle. */
export const KITEBOARD = Object.freeze({
  length: 1.34, width: 0.41, thick: 0.025, rocker: 0.04,
  tip: 0.16,          // m of each end over which the outline rounds off
  stance: 0.3,        // m from the middle to each foot pad
  segments: { along: 128, across: 32 },   // fine enough that the colour waves do not step
});

const COLORS = {
  rust: new THREE.Color(0xa9482a), terra: new THREE.Color(0xc96a3e), cream: new THREE.Color(0xead2b4),
  rim: new THREE.Color(0x6b3a26), pad: new THREE.Color(0x2b2b2d), strap: new THREE.Color(0x3a3a3c),
  fin: new THREE.Color(0xcbb79a),
};

/** Half the width at `t` (m from the middle along the board): straight rails, rounded tips. */
export function halfWidth(t) {
  const { length, width, tip } = KITEBOARD, end = length / 2, a = Math.abs(t);
  if (a <= end - tip) return width / 2;
  const k = Math.min(1, (a - (end - tip)) / tip);
  // rounded shoulders (a superellipse) down to a flattened tip 45 % of the width (twin-tip outline)
  const flat = 0.45;
  return width / 2 * (flat + (1 - flat) * Math.pow(1 - Math.pow(k, 2.6), 1 / 2.6));
}

/** The deck's height over the middle at `t`: the rocker. */
export function rockerAt(t) {
  const u = (2 * t) / KITEBOARD.length;
  return KITEBOARD.rocker * u * u;
}

/** The deck's colour at (s across -1..1, t along, m): waves running diagonally over it. */
export function deckColor(s, t, out = new THREE.Color()) {
  const w = Math.sin(t * 5.2 + 1.6 * Math.sin(s * 1.9 + t * 2.4) + s * 1.1);
  if (w > 0.35) return out.copy(COLORS.cream).lerp(COLORS.terra, (1 - w) * 0.35);
  if (w > -0.3) return out.copy(COLORS.terra).lerp(COLORS.rust, (0.35 - w) * 0.5);
  return out.copy(COLORS.rust).lerp(COLORS.terra, (w + 1) * 0.2);
}

/** The deck as one closed mesh: top, bottom and the rail, vertex-coloured. */
export function deckGeometry() {
  const { length, thick, segments: { along, across } } = KITEBOARD;
  const pos = [], col = [], idx = [], c = new THREE.Color();
  const rows = along + 1, cols = across + 1;
  const vertex = (x, y, z, color) => { pos.push(x, y, z); col.push(color.r, color.g, color.b); return pos.length / 3 - 1; };
  const grid = (dy, flip) => {
    const base = pos.length / 3;
    for (let j = 0; j < rows; j++) {
      const t = -length / 2 + (length * j) / along, h = halfWidth(t), y = rockerAt(t) + dy;
      for (let i = 0; i < cols; i++) {
        const s = -1 + (2 * i) / across;
        vertex(s * h, y, t, deckColor(flip ? -s : s, t, c));
      }
    }
    for (let j = 0; j < along; j++) for (let i = 0; i < across; i++) {
      const a = base + j * cols + i, b = a + 1, d = a + cols, e = d + 1;
      if (flip) idx.push(a, b, d, b, e, d); else idx.push(a, d, b, b, d, e);
    }
    return base;
  };
  const top = grid(0, false), bottom = grid(-thick, true);
  // the rail: around the outline (s = +1 forward along t, s = −1 back), top to bottom
  const ring = [];
  for (let j = 0; j < rows; j++) ring.push(j * cols + across);
  for (let j = rows - 1; j >= 0; j--) ring.push(j * cols);
  const railTop = [], railBottom = [];
  for (const k of ring) {
    railTop.push(vertex(pos[(top + k) * 3], pos[(top + k) * 3 + 1], pos[(top + k) * 3 + 2], COLORS.rim));
    railBottom.push(vertex(pos[(bottom + k) * 3], pos[(bottom + k) * 3 + 1], pos[(bottom + k) * 3 + 2], COLORS.rim));
  }
  for (let k = 0; k < ring.length; k++) {
    const n = (k + 1) % ring.length;
    idx.push(railTop[k], railBottom[k], railTop[n], railTop[n], railBottom[k], railBottom[n]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A fin: a swept triangle, thin, in the (z, y) plane, pointing down. */
function finGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.025, 0);
  shape.lineTo(0.022, 0);
  shape.quadraticCurveTo(0.012, -0.02, -0.012, -0.045);
  shape.lineTo(-0.025, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false });
  g.translate(0, 0, -0.002);
  g.rotateY(Math.PI / 2);   // the shape's x along the board (z)
  return g;
}

/**
 * The board: a Group named 'walker-board', hidden, in the reflection layer (1) as the kite.
 * @returns {THREE.Group}
 */
export function createKiteboard() {
  const group = new THREE.Group();
  group.name = 'walker-board';
  const material = (color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });
  const deck = new THREE.Mesh(deckGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }));
  deck.name = 'kiteboard-deck';
  group.add(deck);

  const { stance, thick, length } = KITEBOARD;
  const padMat = material(COLORS.pad, 0.9), strapMat = material(COLORS.strap, 0.8);
  for (const side of [-1, 1]) {
    const t = side * stance, y = rockerAt(t);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.12), padMat);
    pad.name = 'kiteboard-pad';
    pad.position.set(0, y + 0.006, t);
    group.add(pad);
    // the strap: half a torus across the board over the pad
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20, Math.PI), strapMat);
    strap.name = 'kiteboard-strap';
    strap.scale.set(1, 0.8, 2.6);   // flattened, a broad band
    strap.position.set(0, y + 0.012, t);
    group.add(strap);
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 12, Math.PI), strapMat);
  handle.name = 'kiteboard-handle';
  handle.rotation.y = Math.PI / 2;   // along the board
  handle.position.set(0, 0.002, 0);
  group.add(handle);

  const fin = finGeometry(), finMat = material(COLORS.fin, 0.5);
  for (const end of [-1, 1]) for (const side of [-1, 1]) {
    const t = end * (length / 2 - 0.07), m = new THREE.Mesh(fin, finMat);
    m.name = 'kiteboard-fin';
    m.position.set(side * KITEBOARD.width * 0.3, rockerAt(t) - thick, t);
    if (end < 0) m.rotation.y = Math.PI;   // the sweep points to the tip
    group.add(m);
  }
  group.traverse((o) => { o.layers.enable(1); });   // in the planar reflection, as the kite's sail
  group.visible = false;
  return group;
}

/** Frees the board's geometries and materials. @param {THREE.Group} group */
export function disposeKiteboard(group) {
  const seen = new Set();
  group.traverse((o) => {
    const m = /** @type {THREE.Mesh} */ (o);
    for (const x of [m.geometry, m.material]) if (x && !seen.has(x)) { seen.add(x); /** @type {any} */ (x).dispose(); }
  });
}
