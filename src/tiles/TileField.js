import * as THREE from 'three';
import { compileTileSource, fetchTileSource } from './tilecraftLoader.js';
import { collectTileRest } from './tileRest.js';

const MIN_DEPTH = 5;   // open water under the whole field (spec.md §6.5)

// A live Tilecraft model on the water (spec.md §5). T0: the rest pose drawn statically
// on y=0 with the props' material; the GPU simulation arrives in T1/T2.
export class TileField {
  constructor({ scene, patchMaterial, heightAt }) {
    this.patchMaterial = patchMaterial;
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'tile-field';
    scene.add(this.group);
    this.params = { metersPerSourceUnit: 0.05, frame: 'all', fieldYaw: 0 };
    this.source = 'none';
    this.status = '—';
    this.payload = null;   // fetched source, kept so frame / scale changes rebuild without a refetch
    this.compiled = null;
    this.rest = null;
    this.frames = [];
    this.extent = new THREE.Vector2(85, 30);   // rest bounds in metres; story-sized until a model is loaded
    this.radius = 45;      // circumscribed circle: the open-water test in place()
    this.center = new THREE.Vector3();
    this.epoch = 0;
  }

  get loaded() { return this.rest !== null; }

  // source: 'none', a Tilecraft fixture id, or a File. Errors land in the status; the
  // scene stays as it was (spec.md §3.4).
  async load(source) {
    const epoch = ++this.epoch;
    this.source = source instanceof File ? source.name : source;
    this.clear();
    this.payload = null;
    if (source === 'none') { this.status = '—'; return; }
    this.status = 'loading…';
    try {
      const payload = await fetchTileSource(source);
      if (epoch !== this.epoch) return;
      this.payload = payload;
      this.frames = (payload.model.frames ?? []).map((f) => f.id);
      await this.rebuild(epoch);
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.status = `error: ${e.message}`;
      console.error('[tiles]', e);
    }
  }

  // metersPerSourceUnit or frame changed: compile and collect again (spec.md §6.4)
  async rebuild(epoch = ++this.epoch) {
    if (!this.payload) return;
    this.clear();
    const compiled = await compileTileSource(this.payload, { metersPerSourceUnit: this.params.metersPerSourceUnit });
    if (epoch !== this.epoch) { compiled.scope.dispose(); return; }
    const t0 = performance.now();
    const rest = collectTileRest(compiled, { frame: this.params.frame });
    compiled.scope.dispose();   // the Tilecraft meshes are spent; ours are copies
    this.compiled = { compileMs: compiled.compileMs, restMs: performance.now() - t0, sameThree: compiled.sameThree, space: compiled.space };
    this.rest = rest;
    this.build(rest);
    this.status = this.describe();
  }

  describe() {
    const r = this.rest;
    const kinds = [r.polygon.length && 'polygon', r.polyline.length && 'polyline'].filter(Boolean).join(' + ');
    return `${r.tiles.count} tiles · ${r.groups} groups · ${kinds || 'empty'}`;
  }

  build(rest) {
    for (const part of rest.polygon) {
      const material = this.material(part, false);
      const mesh = new THREE.InstancedMesh(part.geometry, material, part.count);
      mesh.instanceMatrix.array.set(part.matrices);
      if (part.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(part.colors, 3);
      mesh.computeBoundingSphere();
      mesh.name = `tiles-polygon-${part.layerIndex}-f${part.frameId}`;
      this.group.add(mesh);
    }
    for (const part of rest.polyline) {
      const mesh = new THREE.Mesh(part.geometry, this.material(part, true));
      mesh.position.y = part.baseY;
      mesh.name = `tiles-polyline-${part.layerIndex}-f${part.frameId}`;
      this.group.add(mesh);
    }
    const b = rest.bounds;
    this.extent.set(b.max.x - b.min.x, b.max.y - b.min.y);
    this.radius = Math.max(this.extent.length() / 2, 1);
  }

  // the props' path (spec.md §7.1): atmosphere, underwater fog and the floater shadow
  material(part, polyline) {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: polyline, roughness: part.roughness ?? 0.8, metalness: 0,
      transparent: part.transparent, depthWrite: !part.transparent, opacity: part.opacity ?? 1,
      side: polyline ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.patchMaterial(m);
    return m;
  }

  // centre on open water: from `start` outwards along `out` in 5 m steps until the
  // bed under the centre and 8 points on the field's rim is deeper than MIN_DEPTH
  place(start, out) {
    const dir = new THREE.Vector2(out.x, out.y).normalize();
    for (let d = 0; d < 2000; d += 5) {
      const x = start.x + dir.x * d, z = start.y + dir.y * d;
      let ok = this.heightAt(x, z) < -MIN_DEPTH;
      for (let k = 0; ok && k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ok = this.heightAt(x + Math.cos(a) * this.radius, z + Math.sin(a) * this.radius) < -MIN_DEPTH;
      }
      if (ok) { this.center.set(x, 0, z); break; }
    }
    this.group.position.copy(this.center);
    this.group.rotation.y = this.params.fieldYaw * Math.PI / 180;
    return this.center;
  }

  clear() {
    for (const mesh of [...this.group.children]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose?.();
      this.group.remove(mesh);
    }
    this.rest = null;
  }

  update() {}
}
