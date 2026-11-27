import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The map's decorations as meshes (ISLAND-MAPS-SPEC §3, §4.4; terra T3): procedural geometry,
// no model files and no requests. One InstancedMesh per palm silhouette, the hut with its piles,
// floor, roof and boardwalk as one mesh — four draw calls a pass. Leaves are solid geometry
// (no blending, no alpha test), colours are vertex colours, the materials go through
// terrain.patchProp (underwater light, caustics, fog) like every other prop.

// a palm silhouette: trunk height (m), lean (m at the top, along +x), radius at the foot,
// fronds, their length (m) and droop
const PALMS = [
  { height: 12.5, lean: 2.6, radius: 0.26, fronds: 9, frond: 4.6, droop: 1.15 },   // tall, slender
  { height: 8.5, lean: 3.6, radius: 0.24, fronds: 8, frond: 4.0, droop: 1.3 },     // leaning out
  { height: 4.2, lean: 0.8, radius: 0.22, fronds: 10, frond: 3.4, droop: 0.9 },    // short, bushy
];

const lerp3 = (out, a, b, t) => out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

/** A seeded generator of [0, 1) (decorations are the same every load). */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Paint every vertex of `g` one colour (vertex colours, so the parts merge into one mesh). */
function paint(g, rgb, vary = 0, rand = Math.random) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = 1 + (rand() - 0.5) * vary;
    col.set([rgb[0] * k, rgb[1] * k, rgb[2] * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** The trunk: a tapered ring tube along a curve bending out to +x, ring marks in the colour. */
function trunk(p, rand) {
  const rings = 10, sides = 6, pos = [], col = [], idx = [];
  const dark = [0.30, 0.22, 0.15], light = [0.47, 0.37, 0.26], c = new THREE.Color();
  const at = (t) => new THREE.Vector3(p.lean * t * t, p.height * t, 0);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, o = at(t);
    const tan = at(Math.min(1, t + 0.01)).sub(at(Math.max(0, t - 0.01))).normalize();
    const side = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3().crossVectors(tan, side).normalize();
    const r = p.radius * (1.35 - 0.6 * t) * (i === 0 ? 1.4 : 1);
    lerp3(c, dark, light, 0.35 + 0.5 * rand());
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const d = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
      pos.push(o.x + d.x * r, o.y + d.y * r - (i === 0 ? 0.4 : 0), o.z + d.z * r);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides, d = a + sides, e = b + sides;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, top: at(1) };
}

/**
 * One frond: a spine arching out and drooping, the leaf a V across it (the rib raised, the
 * edges down) narrowing to the tip; solid, two-sided through the material.
 */
function frond(p, top, yaw, lift, rand) {
  const segs = 6, pos = [], col = [], idx = [];
  const len = p.frond * (0.8 + 0.4 * rand()), droop = p.droop * (0.8 + 0.4 * rand());
  const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)), across = new THREE.Vector3(-dir.z, 0, dir.x);
  const base = lerp3(new THREE.Color(), [0.16, 0.33, 0.09], [0.22, 0.42, 0.12], rand());
  const tip = lerp3(new THREE.Color(), [0.40, 0.48, 0.16], [0.52, 0.50, 0.20], rand());
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // up first (lift), then over and down: a parabola in the frond's own plane
    const out = len * t, up = len * (lift * t - droop * t * t);
    const o = top.clone().addScaledVector(dir, out).add(new THREE.Vector3(0, up, 0));
    const w = 0.85 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (len / 4.5);
    const fold = 0.35 * w;
    for (const s of [-1, 0, 1]) {
      const q = o.clone().addScaledVector(across, s * w).add(new THREE.Vector3(0, s === 0 ? 0 : -fold, 0));
      pos.push(q.x, q.y, q.z);
      const c = base.clone().lerp(tip, t * t).multiplyScalar(s === 0 ? 0.9 : 1.05);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** One palm silhouette (variant `v`): foot at the origin, the lean out along +x. */
export function palmGeometry(v) {
  const p = PALMS[v], rand = rng(91 + v * 17);
  const { geometry, top } = trunk(p, rand);
  const parts = [geometry];
  for (let k = 0; k < p.fronds; k++) {
    const yaw = (k / p.fronds) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    parts.push(frond(p, top, yaw, 0.35 + 0.35 * rand(), rand));
  }
  // a few short young fronds standing up in the crown
  for (let k = 0; k < 2; k++) parts.push(frond({ ...p, frond: p.frond * 0.45, droop: 0.2 }, top, rand() * Math.PI * 2, 1.2, rand));
  // coconuts under the crown
  for (let k = 0; k < 2; k++) {
    const nut = paint(new THREE.IcosahedronGeometry(0.2, 0), [0.33, 0.25, 0.10], 0.2, rand);
    nut.deleteAttribute('uv');   // the trunk and fronds carry position, normal, colour only
    const a = k * Math.PI + 0.6;
    nut.translate(top.x + Math.cos(a) * 0.28, top.y - 0.3, top.z + Math.sin(a) * 0.28);
    parts.push(nut);
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** A box part of the hut (local frame: +z toward the shore, floor at y = 0). */
function box(w, h, d, x, y, z, rgb, rand, rotZ = 0, rotX = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return paint(g, rgb, 0.12, rand);
}
function post(r, from, to, x, z, rgb, rand) {
  const g = new THREE.CylinderGeometry(r * 0.9, r, to - from, 6, 1).toNonIndexed();
  g.translate(x, (from + to) / 2, z);
  return paint(g, rgb, 0.15, rand);
}

/**
 * The hut on piles with its boardwalk, in world coordinates (`heightAt` for the piles' feet):
 * an open floor on a 3 × 3 grid of piles, corner posts, a back wall of planks, a pitched roof
 * of thatch with an overhang, the boardwalk out to the sand on its own short piles.
 * @param {import('./lagoonDecor.js').Hut} hut
 */
export function hutGeometry(hut, heightAt) {
  const rand = rng(4242), parts = [];
  const W = hut.width, D = hut.depth, F = hut.floor;
  const wood = [0.42, 0.30, 0.19], pile = [0.30, 0.22, 0.15], plank = [0.55, 0.42, 0.28], thatch = [0.62, 0.52, 0.30];
  const c = Math.cos(hut.yaw), s = Math.sin(hut.yaw);
  const ground = (lx, lz) => heightAt(hut.x + lx * c + lz * s, hut.z - lx * s + lz * c);
  // piles from under the bed to the floor
  for (const lx of [-W / 2 + 0.3, 0, W / 2 - 0.3]) for (const lz of [-D / 2 + 0.3, 0, D / 2 - 0.3]) {
    parts.push(post(0.13, ground(lx, lz) - 0.5, F, lx, lz, pile, rand));
  }
  // the floor: planks across, a beam under each row of piles
  for (let i = 0; i < 9; i++) parts.push(box(W, 0.08, D / 9 - 0.04, 0, F + 0.04, -D / 2 + (i + 0.5) * D / 9, plank, rand));
  for (const lz of [-D / 2 + 0.3, 0, D / 2 - 0.3]) parts.push(box(W + 0.2, 0.18, 0.18, 0, F - 0.1, lz, wood, rand));
  // corner and middle posts up to the eaves, a rail on three sides, the back wall to the sea
  const eaves = F + 2.3, ridge = eaves + 1.9;
  for (const lx of [-W / 2 + 0.15, W / 2 - 0.15]) for (const lz of [-D / 2 + 0.15, D / 2 - 0.15]) parts.push(post(0.1, F, eaves, lx, lz, wood, rand));
  parts.push(post(0.1, F, ridge, 0, -D / 2 + 0.15, wood, rand), post(0.1, F, ridge, 0, D / 2 - 0.15, wood, rand));
  for (let i = 0; i < 8; i++) parts.push(box(W / 8 - 0.05, 2.2, 0.06, -W / 2 + (i + 0.5) * W / 8, F + 1.15, -D / 2 + 0.15, plank, rand));
  for (const lx of [-W / 2 + 0.15, W / 2 - 0.15]) parts.push(box(0.08, 0.08, D - 0.3, lx, F + 0.9, 0, wood, rand));
  // the roof: two thatch slopes from the ridge along x out past the long sides, an overhang
  const half = W / 2 + 0.7, slope = Math.atan2(ridge - eaves + 0.25, half), len = Math.hypot(half, ridge - eaves + 0.25);
  for (const sx of [-1, 1]) {
    parts.push(box(len, 0.22, D + 1.2, sx * half / 2, (ridge + eaves - 0.25) / 2 + 0.05, 0, thatch, rand, -sx * slope));
  }
  parts.push(box(0.2, 0.2, D + 1.3, 0, ridge + 0.08, 0, wood, rand));
  // the boardwalk: from the floor's shore edge out to the sand, planks on pairs of short piles
  const wx = hut.walk.to.x - hut.walk.from.x, wz = hut.walk.to.z - hut.walk.from.z, wl = Math.hypot(wx, wz);
  const ww = hut.walk.width;
  for (let d = 0.2; d < wl; d += 0.45) parts.push(box(ww, 0.06, 0.38, 0, F - 0.02, D / 2 + d, plank, rand));
  for (let d = 2; d < wl; d += 3) for (const sx of [-1, 1]) {
    const lx = sx * (ww / 2 - 0.08), foot = ground(lx, D / 2 + d);
    if (foot < F - 0.2) parts.push(post(0.08, foot - 0.4, F - 0.05, lx, D / 2 + d, pile, rand));
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  // local → world: yaw round y, then the hut's spot (the floor stays at world y = F)
  merged.rotateY(hut.yaw);
  merged.translate(hut.x, 0, hut.z);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * The decorations of `map` (none on 'island'): palms by silhouette and the hut, added to the
 * returned group; `stats` — what a frame draws of them in one pass.
 * @param {{ map: import('./maps.js').MapProfile, patchProp: (m: THREE.Material) => void, reflectionLayer?: number }} options
 */
export function createDecor({ map, patchProp, reflectionLayer = 1 }) {
  const group = new THREE.Group();
  group.name = 'decor';
  const decor = map.decor?.();
  if (!decor) return { group, stats: { meshes: 0, triangles: 0, palms: 0 } };
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.8 });
  patchProp(leafMat);
  patchProp(woodMat);
  let triangles = 0;
  const meshes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let v = 0; v < PALMS.length; v++) {
    const list = decor.palms.filter((x) => x.variant === v);
    if (!list.length) continue;
    const geometry = palmGeometry(v);
    const mesh = new THREE.InstancedMesh(geometry, leafMat, list.length);
    mesh.name = `palms-${v}`;
    list.forEach((palm, i) => {
      m.compose(p.set(palm.x, palm.y, palm.z), q.setFromAxisAngle(up, palm.yaw), sc.setScalar(palm.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.computeBoundingSphere();
    triangles += (geometry.attributes.position.count / 3) * list.length;
    meshes.push(mesh);
  }
  const hut = new THREE.Mesh(hutGeometry(decor.hut, map.heightAt), woodMat);
  hut.name = 'hut';
  triangles += hut.geometry.attributes.position.count / 3;
  meshes.push(hut);
  for (const o of meshes) {
    o.castShadow = o.receiveShadow = true;
    o.layers.enable(reflectionLayer);
    group.add(o);
  }
  return { group, stats: { meshes: meshes.length, triangles, palms: decor.palms.length } };
}
