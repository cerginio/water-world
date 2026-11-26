import * as THREE from 'three';
import { frameKey, UNFRAMED } from './TileFrames.js';
import { layoutMiniatures } from './miniatureLayout.js';

// A story's frames as miniatures on the island (STORY-QUEST-SPEC §2 п.3–4, §4.1 «Мініатюра й
// гідратація»; story-quest Q3). A miniature is a rigid copy of the frame's tiles at their
// rest pose, scaled by MINI.scale, lying on the drawn terrain; the walker takes it and
// carries it; put down where the ground is under the sea, it unfolds to the frame's rest
// size on the water and the frame of the field takes over (moveFrame → 'placed').
//
// The frame itself never leaves the field's GPU simulation: while its miniature is on the
// land or in the hands, the frame's meshes are hidden (render only, like a promotion) and
// its tiles go on floating where they were. No scale enters TileSim: unfolding is the
// miniature growing to scale 1 over the spot the frame is moved to, then the swap.
//
// States of an item: 'ground' → 'carried' → 'ground' | 'unfolding' → 'water'; 'carried' ⇄
// 'packed' (Q7, spec §4.1 «Персонаж»: one in the hands, the rest in the backpack — taking
// another with full hands stows the one held; only the one in the hands is put down).
// Q10 (spec §4.2a «Меню малюнку»): 'water' → 'carried' — `lift` folds the frame on the water
// back into the miniature in the hands, the way back of hydration; `thumbnail` draws a
// miniature from above for the menu's slots.
// Events (EventTarget): 'take', 'put', 'unfold', 'hydrate', 'pack', 'unpack', 'lift' — detail { frameId, x, z }.

export const MINI = Object.freeze({
  scale: 1 / 8,      // of the rest size; the starting value, tuned on the owner's phone
  reach: 2.5,        // m from the walker's feet to a miniature's centre to take it
  unfold: 1.2,       // s from the hands to the rest size on the water
  sea: 0,            // m: ground under this is under the sea, a miniature put there unfolds
  depth: 1,          // m of water wanted under the unfolded frame's centre…
  rimDepth: 0.3,     // …and under 8 points of its rim
  tilt: 0.45,        // rad: a carried miniature leans its far edge up, towards the eyes
  below: 0.35,       // rad under the line of sight where it is carried
  clear: 0.5,        // m: a frame unfolds at least its radius + this from the holder (not over the walker, Q10)
});

/** The menu's slot drawings (Q10): CSS px of the image, rendered once per miniature. */
export const THUMB = Object.freeze({ width: 128, height: 96, margin: 0.08 });

const UP = new THREE.Vector3(0, 1, 0);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * @param {any} field a TileField
 * @param {{ ground: (x: number, z: number) => any, scene: any, scale?: number, eye?: number,
 *   freeAt?: (x: number, z: number, r: number) => boolean }} options
 *   `freeAt` — no other frame on the water within r of (x, z): an unfold does not lie over a raft (Q4b)
 */
export class TileMiniatures extends EventTarget {
  constructor(field, { ground, scene, scale = MINI.scale, eye = 1.6, freeAt = /** @type {(x: number, z: number, r: number) => boolean} */ (() => true) }) {
    super();
    this.field = field;
    this.ground = ground;
    this.freeAt = freeAt;
    this.scene = scene;
    this.scale = scale;
    this.eye = eye;
    this.group = new THREE.Group();
    this.group.name = 'tile-miniatures';
    scene.add(this.group);
    /** @type {Map<any, any>} frame key → item */
    this.byId = new Map();
    this.items = [];
    this.storyId = null;
    this.rest = null;   // the field rest the meshes were built from
    this.packSeq = 0;
    /** @type {Map<any, string>} frame key → the slot drawing (a data URL), until the meshes change */
    this.thumbs = new Map();
    this.thumbScene = null;
  }

  get active() { return this.items.length > 0; }

  /**
   * Lays the field's frames out as miniatures around `center` (miniatureLayout.js, seed =
   * the story id). Replaces any earlier layout; every frame goes back to a miniature.
   * @param {string} storyId @param {{ x: number, z: number }} center
   */
  layout(storyId, center, options = {}) {
    this.clear();
    const frames = this.field.frameRegistry.entries.filter((f) => f.id !== UNFRAMED);
    const points = layoutMiniatures(storyId, frames.length, { ground: this.ground, center, ...options });
    this.storyId = storyId;
    frames.forEach((frame, i) => {
      const p = points[i];
      if (!p) return;
      const item = { frameId: frame.id, state: 'ground', found: false, home: p, yaw: p.yaw, relYaw: 0, packedAt: 0,
        root: new THREE.Group(), body: new THREE.Group(), radius: 0, fullRadius: 0, half: new THREE.Vector2(),
        unfold: null, fold: null, contactGap: 0 };
      item.root.name = `miniature-f${String(frame.id)}`;
      item.root.add(item.body);
      this.group.add(item.root);
      this.items.push(item);
      this.byId.set(frameKey(frame.id), item);
    });
    this.rest = null;
    this.ensureMeshes();
    for (const item of this.items) this.lay(item, item.home.x, item.home.z, item.home.yaw);
    this.syncFrames();
    return this.items;
  }

  /** The item of a frame id, or null. */
  get(frameId) { return this.byId.get(frameKey(frameId)) ?? null; }

  get carried() { return this.items.find((i) => i.state === 'carried') ?? null; }

  /** The backpack, in the order the miniatures went in. */
  get packed() { return this.items.filter((i) => i.state === 'packed').sort((a, b) => a.packedAt - b.packedAt); }

  /** found: ever taken; water: unfolded on the sea (spec §3.1). */
  counts() {
    return { total: this.items.length, found: this.items.filter((i) => i.found).length,
      water: this.items.filter((i) => i.state === 'water').length };
  }

  /**
   * The nearest miniature on the ground within `reach` of (x, z), or null.
   * @param {number} x @param {number} z @param {number} [reach]
   */
  nearest(x, z, reach = MINI.reach) {
    let best = null, bd = reach;
    for (const item of this.items) {
      if (item.state !== 'ground') continue;
      const d = Math.hypot(item.root.position.x - x, item.root.position.z - z);
      if (d <= bd) { best = item; bd = d; }
    }
    return best;
  }

  /**
   * Into the hands; one held already goes into the backpack first. `holder` — the walker's
   * state, for the relative yaw.
   */
  take(frameId, holder) {
    const item = this.get(frameId);
    if (!item || item.state !== 'ground') return null;
    this.stow();
    item.state = 'carried';
    item.found = true;
    item.relYaw = item.yaw - (holder?.yaw ?? 0);
    this.emit('take', item);
    return item;
  }

  /** The one in the hands into the backpack; the item, or null with empty hands. */
  stow() {
    const item = this.carried;
    if (!item) return null;
    item.state = 'packed';
    item.packedAt = ++this.packSeq;
    item.root.visible = false;
    this.emit('pack', item);
    return item;
  }

  /** A miniature out of the backpack into the hands (the one held goes in instead). */
  unpack(frameId) {
    const item = this.get(frameId);
    if (!item || item.state !== 'packed') return null;
    this.stow();
    item.state = 'carried';
    item.root.visible = true;
    this.emit('unpack', item);
    return item;
  }

  /**
   * Puts the carried miniature down in front of the holder: on the ground, or — where the
   * ground there is under the sea (or there is no terrain) — it unfolds onto the water.
   * @returns {'ground' | 'unfolding' | null}
   */
  put(holder) {
    const item = this.carried;
    if (!item) return null;
    // Q10: from the board it goes down behind — ahead, the board would run onto it while it unfolds
    const back = holder.flight ? -1 : 1;
    const f = { x: back * Math.sin(holder.yaw), z: back * Math.cos(holder.yaw) };
    const d = item.radius + 0.5;
    const x = holder.x + f.x * d, z = holder.z + f.z * d;
    const g = this.ground(x, z);
    const yaw = holder.yaw + item.relYaw;
    if (g && g.height >= MINI.sea) {
      item.state = 'ground';
      item.fold = null;
      this.lay(item, x, z, yaw);
      this.emit('put', item);
      return 'ground';
    }
    this.unfold(item, x, z, f, holder);
    return 'unfolding';
  }

  /**
   * Q10: the frame on the water folds back into its miniature in the hands (the one held goes
   * into the backpack) — the way back of hydration. The frame of the field is hidden at once
   * (syncFrames), its tiles float on where they were, as before the first hydration; the
   * miniature shrinks from the frame's place into the hands over MINI.unfold s.
   * @returns {any} the item, or null when the frame is not on the water
   */
  lift(frameId, holder) {
    const item = this.get(frameId);
    if (!item || item.state !== 'water') return null;
    const frame = this.field.frameRegistry.get(item.frameId);
    if (!frame) return null;
    this.stow();
    const q = this.field.group.getWorldQuaternion(new THREE.Quaternion());
    const fieldYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    item.state = 'carried';
    item.relYaw = fieldYaw - (holder?.yaw ?? 0);
    item.fold = { t: 0, from: { p: new THREE.Vector3(frame.world.x, MINI.sea, frame.world.z), q, s: 1 } };
    item.root.position.copy(item.fold.from.p);
    item.root.quaternion.copy(q);
    item.root.scale.setScalar(1);
    item.root.visible = true;
    this.syncFrames();
    this.emit('lift', item, item.fold.from.p);
    return item;
  }

  /**
   * Where the frame unfolds: from (x, z) on along `dir` in 0.5 m steps until the sea under
   * its centre is deeper than MINI.depth and under 8 rim points deeper than MINI.rimDepth;
   * none within 4 radii — (x, z) moved out by one radius. Clear of the frames already on the
   * water (`freeAt`): put down from a raft, it unfolds beside it (Q4b), within the same 4 radii.
   * Q10: clear of the holder too (`away`, its radius + MINI.clear) — put down by a walker in the
   * water or on the board, the frame does not unfold over it.
   */
  unfoldCenter(item, x, z, dir, away = null) {
    const r = item.fullRadius;
    const deep = (px, pz, depth) => { const g = this.ground(px, pz); return !g || g.height < -depth; };
    for (let s = 0; s <= 4 * r; s += 0.5) {
      const cx = x + dir.x * s, cz = z + dir.z * s;
      if (away && Math.hypot(cx - away.x, cz - away.z) < r + MINI.clear) continue;
      let ok = deep(cx, cz, MINI.depth) && this.freeAt(cx, cz, r);
      for (let k = 0; ok && k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ok = deep(cx + Math.cos(a) * r, cz + Math.sin(a) * r, MINI.rimDepth);
      }
      if (ok) return { x: cx, z: cz, open: true };
    }
    if (away) {
      const out = Math.max(r, r + MINI.clear - ((x - away.x) * dir.x + (z - away.z) * dir.z));
      return { x: x + dir.x * out, z: z + dir.z * out, open: false };
    }
    return { x: x + dir.x * r, z: z + dir.z * r, open: false };
  }

  unfold(item, x, z, dir, away = null) {
    const c = this.unfoldCenter(item, x, z, dir, away);
    this.field.moveFrame(item.frameId, c.x, c.z);
    const fieldQuat = this.field.group.getWorldQuaternion(new THREE.Quaternion());
    item.state = 'unfolding';
    item.fold = null;
    item.unfold = { t: 0, open: c.open,
      from: { p: item.root.position.clone(), q: item.root.quaternion.clone(), s: item.root.scale.x },
      to: { p: new THREE.Vector3(c.x, MINI.sea, c.z), q: fieldQuat, s: 1 } };
    this.emit('unfold', item, c);
  }

  /** Lies on the drawn terrain at (x, z): tilted to its normal, lifted over 4 corners. */
  lay(item, x, z, yaw) {
    const g = this.ground(x, z);
    const n = new THREE.Vector3(g?.normal?.x ?? 0, g?.normal?.y ?? 1, g?.normal?.z ?? 0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n)
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    let y = g?.height ?? 0, lowest = Infinity;
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) =>
      new THREE.Vector3(sx * item.half.x * this.scale, 0, sz * item.half.y * this.scale).applyQuaternion(q));
    // the plane through (x, y, z) with normal n must stay over the ground at every corner
    for (const c of corners) {
      const h = this.ground(x + c.x, z + c.z)?.height;
      if (h === undefined) continue;
      y = Math.max(y, h - c.y);
    }
    for (const c of corners) {
      const h = this.ground(x + c.x, z + c.z)?.height;
      if (h !== undefined) lowest = Math.min(lowest, y + c.y - h);
    }
    item.contactGap = Number.isFinite(lowest) ? lowest : 0;   // the lowest corner over the ground, m
    item.yaw = yaw;
    item.root.position.set(x, y, z);
    item.root.quaternion.copy(q);
    item.root.scale.setScalar(this.scale);
  }

  /** In front of the eyes, below the line of sight, leaning towards them. */
  hold(item, holder) {
    const pitch = (holder.pitch ?? 0) - MINI.below;
    const d = Math.max(1, 2.4 * item.radius);   // a 1/8 frame (~1–1.5 m across) fills the lower third
    const cp = Math.cos(pitch);
    item.root.position.set(holder.x + Math.sin(holder.yaw) * cp * d, holder.y + this.eye + Math.sin(pitch) * d,
      holder.z + Math.cos(holder.yaw) * cp * d);
    item.root.quaternion.setFromAxisAngle(UP, holder.yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -MINI.tilt))
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, item.relYaw));
    item.root.scale.setScalar(this.scale);
    item.yaw = holder.yaw + item.relYaw;
    // Q10: lifted off the water, it shrinks from the frame's place into the hands
    const fold = item.fold;
    if (fold) {
      const k = smoother(fold.t);
      item.root.position.lerpVectors(fold.from.p, item.root.position, k);
      item.root.quaternion.slerpQuaternions(fold.from.q, item.root.quaternion.clone(), k);
      item.root.scale.setScalar(fold.from.s + (this.scale - fold.from.s) * k);
    }
  }

  /**
   * The miniature of `frameId` drawn from above for the menu's slots (Q10), as a data URL; null
   * before its meshes are built. Rendered once into a small target (the frame's meshes are
   * borrowed for the one draw), kept until the field's rest changes.
   * @param {any} frameId @param {any} renderer a THREE.WebGLRenderer
   */
  thumbnail(frameId, renderer) {
    const item = this.get(frameId);
    if (!item || !renderer || !item.body.children.length || renderer.getContext().isContextLost()) return null;
    const key = frameKey(item.frameId);
    const kept = this.thumbs.get(key);
    if (kept) return kept;
    const { width: w, height: h, margin } = THUMB;
    if (!this.thumbScene) {
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xffffff, 0x556677, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(0.4, 1, 0.3);
      s.add(sun);
      this.thumbScene = s;
    }
    const scene = this.thumbScene, body = item.body, parent = body.parent;
    scene.add(body);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    // the drawing as the author drew it: field x to the right, field z (the source's y) down
    const half = Math.max(size.x / 2, (size.z / 2) * (w / h), 0.01) * (1 + margin);
    const cam = new THREE.OrthographicCamera(-half, half, half * h / w, -half * h / w, 0.01, size.y + 20);
    cam.position.set(c.x, box.max.y + 10, c.z);
    cam.up.set(0, 0, -1);
    cam.lookAt(c.x, c.y, c.z);
    cam.updateMatrixWorld(true);
    const target = new THREE.WebGLRenderTarget(w, h);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const pixels = new Uint8Array(w * h * 4);
    const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    try {
      renderer.autoClear = true;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.setClearColor(color, alpha);
      renderer.autoClear = autoClear;
      parent?.add(body);
      target.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // GL rows bottom up
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    this.thumbs.set(key, url);
    return url;
  }

  /** Builds (again) the miniature meshes when the field's rest changed: load, rebuild, restore. */
  ensureMeshes() {
    const rest = this.field.rest;
    if (rest === this.rest) return;
    this.rest = rest;
    this.thumbs.clear();
    for (const item of this.items) {
      for (const mesh of [...item.body.children]) { mesh.material.dispose(); item.body.remove(mesh); }
      item.root.visible = false;
    }
    if (!rest) return;
    const registry = this.field.frameRegistry;
    for (const item of this.items) {
      const frame = registry.byId.get(frameKey(item.frameId));
      if (!frame) continue;
      const parts = [...rest.polygon, ...rest.polyline].filter((p) => p.frameIndex === frame.index);
      let bottom = Infinity;
      for (const part of parts) {
        for (const id of part.tile ?? new Set(part.aTile)) {
          bottom = Math.min(bottom, rest.tiles.y0[id] - rest.tiles.thickness[id] / 2);
        }
        const polyline = !part.tile;
        const material = this.field.material(part, polyline);
        let mesh;
        if (polyline) {
          mesh = new THREE.Mesh(part.geometry, material);
          mesh.position.y = part.baseY ?? 0;
        } else {
          mesh = new THREE.InstancedMesh(part.geometry, material, part.count);
          mesh.instanceMatrix.array.set(part.matrices);
          if (part.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(part.colors, 3);
          mesh.computeBoundingSphere();
        }
        mesh.layers.enable(1);   // in the planar reflection, as the field
        item.body.add(mesh);
      }
      if (!parts.length) continue;
      const b = frame.bounds;
      item.half.set((b.max.x - b.min.x) / 2, (b.max.y - b.min.y) / 2);
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.y + b.max.y) / 2;
      // the body's origin: the frame's pivot at the bottom of its lowest tile
      item.body.position.set(-frame.pivot.x, -bottom, -frame.pivot.z);
      item.fullRadius = Math.max(item.half.length() + Math.hypot(cx - frame.pivot.x, cz - frame.pivot.z), 0.5);
      item.radius = item.fullRadius * this.scale;
      item.root.visible = item.state !== 'water' && item.state !== 'packed';
    }
  }

  /** The field draws a frame only once it is on the water; its miniature stands for it before. */
  syncFrames() {
    const registry = this.field.frameRegistry;
    for (const e of this.field.boundsEntries) {
      const frame = registry.entries[e.frameIndex];
      const item = frame ? this.byId.get(frameKey(frame.id)) : null;
      const visible = !item || item.state === 'water';
      e.mesh.visible = visible;
      if (e.proxy) e.proxy.visible = visible;
    }
  }

  /**
   * Once a frame: the carried one follows the holder, an unfolding one grows to the rest
   * size and hands over to the field. `holder` — the walker's state (x, y, z, yaw, pitch).
   */
  update(dt, holder) {
    if (!this.items.length) return;
    this.ensureMeshes();
    for (const item of this.items) {
      if (item.fold) {
        item.fold.t = Math.min(1, item.fold.t + dt / MINI.unfold);
        if (item.state !== 'carried') item.fold = null;
      }
      if (item.state === 'carried' && holder) this.hold(item, holder);
      if (item.fold?.t >= 1) item.fold = null;
      // in the backpack it goes where the walker goes (the contract reads where a frame is)
      if (item.state === 'packed' && holder) item.root.position.set(holder.x, holder.y, holder.z);
      if (item.state !== 'unfolding') continue;
      const u = item.unfold;
      u.t = Math.min(1, u.t + dt / MINI.unfold);
      const k = smoother(u.t);
      item.root.position.lerpVectors(u.from.p, u.to.p, k);
      item.root.quaternion.slerpQuaternions(u.from.q, u.to.q, k);
      item.root.scale.setScalar(u.from.s + (u.to.s - u.from.s) * k);
      if (u.t >= 1) {
        item.state = 'water';
        item.root.visible = false;
        this.emit('hydrate', item);
      }
    }
    this.syncFrames();
  }

  emit(type, item, at = item.root.position) {
    this.dispatchEvent(new CustomEvent(type, { detail: { frameId: item.frameId, x: at.x, z: at.z } }));
  }

  /** Every frame back to the field as it is; no miniatures. */
  clear() {
    for (const item of this.items) {
      for (const mesh of item.body.children) mesh.material.dispose();
      this.group.remove(item.root);
    }
    this.items = [];
    this.byId.clear();
    this.thumbs.clear();
    this.rest = null;
    this.storyId = null;
    this.syncFrames();
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
