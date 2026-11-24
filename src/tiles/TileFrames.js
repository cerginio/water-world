import * as THREE from 'three';

// Missing ids never alias a real id (including 0, -1 or a string).
export const UNFRAMED = Symbol('unframed');
export const frameKey = id => id == null ? UNFRAMED : id;

export class TileFrames {
  constructor() {
    this.entries = [];
    this.byId = new Map();
  }

  rebuild(rest, matrix) {
    const previous = this.byId;
    const boxes = new Map();
    const corners=new Map(),heights=new Map();
    for (const part of [...rest.polygon, ...rest.polyline]) {
      const key = frameKey(part.frameId);
      if (!boxes.has(key)) boxes.set(key, new THREE.Box2());
      if(!corners.has(key))corners.set(key,new THREE.Box2());
      const box = boxes.get(key);
      const ids = part.tile ?? new Set(part.aTile);
      for (const id of ids) {
        const t=rest.tiles;
        box.expandByPoint(new THREE.Vector2(t.x[id], t.z[id]));
        for(const p of t.footprints?.[id]??[new THREE.Vector3()])corners.get(key).expandByPoint(new THREE.Vector2(t.x[id]+p.x,t.z[id]+p.z));
        heights.set(key,Math.max(heights.get(key)??0,(t.surfaceOffset?.[id]??0)+(t.thickness?.[id]??0)/2));
      }
    }
    this.entries = [];
    this.byId = new Map();
    const inverse = matrix.clone().invert();
    for (const [id, box] of boxes) {
      if (box.isEmpty()) continue;
      const center = box.getCenter(new THREE.Vector2());
      const pivot = new THREE.Vector3(center.x, 0, center.y);
      const old = previous.get(id);
      const world = old?.world.clone() ?? pivot.clone().applyMatrix4(matrix);
      const offset = world.clone().applyMatrix4(inverse).sub(pivot).setY(0);
      const entry = { id, index: this.entries.length, pivot, world, offset,
        mode: old?.mode ?? 'inherited', rank: old?.rank ?? 0, bounds:corners.get(id),selectionHeight:heights.get(id)??0,
        held: false, holdAge: 0, pose: new THREE.Vector4() };
      this.entries.push(entry);
      this.byId.set(id, entry);
    }
    this.sync(matrix);
  }

  assign(rest) {
    rest.tiles.frameIndex = new Uint32Array(rest.tiles.count);
    for (const part of [...rest.polygon, ...rest.polyline]) {
      part.frameIndex = this.byId.get(frameKey(part.frameId)).index;
      for (const id of part.tile ?? new Set(part.aTile)) rest.tiles.frameIndex[id] = part.frameIndex;
    }
  }

  // The authored frame: the model's frame.points (4 source-unit corners) in the field's rest
  // coordinates, the same mapping as a tile (tileRest.js: (x - origin.x) * unit, y → z).
  // The selection outline follows it; `bounds` (the tiles' footprint box) stays for contact
  // and placement. A frame's tiles may cover only part of it (my-day frame 2: 145 of 196 units).
  setQuads(frames, space) {
    for (const entry of this.entries) entry.quad = null;
    for (const frame of frames ?? []) {
      const entry = this.byId.get(frameKey(frame?.id));
      const points = frame?.points;
      if (!entry || !Array.isArray(points) || points.length !== 4
        || !points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))) continue;
      entry.quad = points.map(p => new THREE.Vector2((p.x - space.origin.x) * space.unit, (p.y - space.origin.y) * space.unit));
    }
  }

  get(id) {
    const entry = this.byId.get(frameKey(id));
    if (!entry) throw new Error(`Unknown frame: ${String(id)}`);
    return entry;
  }

  sync(matrix) {
    const inverse = matrix.clone().invert();
    for (const entry of this.entries) {
      if (entry.mode === 'placed') entry.offset.copy(entry.world).applyMatrix4(inverse).sub(entry.pivot).setY(0);
      else entry.world.copy(entry.pivot).add(entry.offset).applyMatrix4(matrix);
      entry.pose.set(entry.offset.x, entry.offset.z, entry.mode === 'placed' ? 1 : 0,
        entry.held ? 1 + Math.min(entry.holdAge / 0.125, 1) : 0);
    }
  }

  reset(matrix) {
    for (const entry of this.entries) { entry.mode = 'inherited'; entry.rank = 0; entry.held = false; entry.offset.set(0, 0, 0); }
    this.sync(matrix);
  }
}
