import * as THREE from 'three';
import { compileTileSource, fetchTileSource } from './tilecraftLoader.js';
import { collectTileRest } from './tileRest.js';
import { TerrainContact } from '../scene/TerrainContact.js';
import { TileSim } from './TileSim.js';
import { TileFrames } from './TileFrames.js';
import { TileInteraction } from './TileInteraction.js';
import { TileFrameQuery } from './TileFrameQuery.js';
import { TilePromotion, bindTilePromotion } from './TilePromotion.js';
import { patchTileMaterial } from './TileMaterial.js';
import { tileMotionLimit, tileBounds, applyTileBounds, fieldShadowBody } from './tileBounds.js';

const MIN_DEPTH = 5;   // open water under the whole field (spec.md §6.5)

// A live Tilecraft model on the water (spec.md §5).
export class TileField {
  constructor({ scene, renderer, surface, patchMaterial, heightAt, terrainGeometry, mobile = false, floaters, camera, rig }) {
    this.scene = scene;
    this.rig = rig;   // the camera owner: TileInteraction locks the controls through it
    this.promotion = floaters ? new TilePromotion(this, floaters) : null;
    this.camera = camera;
    this.profile = mobile ? 'mobile' : 'desktop';
    this.shadowScene = new THREE.Scene();
    this.shadowGroup = new THREE.Group();
    this.shadowScene.add(this.shadowGroup);
    this.shadowBody = { pos: new THREE.Vector3(), radius: 1 };
    this.boundsEntries = [];
    this.renderer = renderer;
    this.surface = surface;
    this.patchMaterial = patchMaterial;
    this.heightAt = heightAt;
    this.terrainGeometry = terrainGeometry;
    this.group = new THREE.Group();
    this.group.name = 'tile-field';
    scene.add(this.group);
    this.params = { metersPerSourceUnit: 0.05, frame: 'all', fieldYaw: 0,
      density: 500, buoyancy: 1, drag: 1.6, angularDrag: 0.8, orbit: 1, anchorPeriod: 4,
      mode: 'anchored', windage: 0.02, driftRadius: 400 };
    this.source = 'none';
    this.status = '—';
    this.payload = null;   // fetched source, kept so frame / scale changes rebuild without a refetch
    this.compiled = null;
    this.rest = null;
    this.frames = [];
    this.frameRegistry = new TileFrames();
    this.frameMatrix = new THREE.Matrix4();
    this.extent = new THREE.Vector2(85, 30);   // rest bounds in metres; story-sized until a model is loaded
    this.radius = 45;      // circumscribed circle: the open-water test in place()
    this.center = new THREE.Vector3();
    this.epoch = 0;
    this.cpuMs = 0;
  }

  get loaded() { return this.rest !== null; }

  // source: 'none', a Tilecraft fixture id, a File, or a fetched payload { id, model }
  // (the story catalog). Errors land in the status; the scene stays as it was (spec.md §3.4).
  async load(source) {
    const epoch = ++this.epoch;
    this.source = source instanceof File ? source.name : typeof source === 'object' ? source.id : source;
    this.clear();
    this.frameRegistry = new TileFrames();
    this.frames = [];
    this.payload = null;
    if (source === 'none') { this.status = '—'; return; }
    this.status = 'loading…';
    try {
      const payload = await fetchTileSource(source);
      if (epoch !== this.epoch) return;
      this.payload = payload;
      this.frames = (payload.model.frames ?? []).map((f) => f.id);
      const matches = this.frames.filter(id => String(id) === String(this.params.frame));
      if (!this.frames.includes(this.params.frame)) this.params.frame = matches.length === 1 ? matches[0] : 'all';
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
    if (this.renderer.getContext().isContextLost()) { this.bindLifecycle(); return; }
    this.clear();
    const compiled = await compileTileSource(this.payload, { metersPerSourceUnit: this.params.metersPerSourceUnit });
    if (epoch !== this.epoch) { compiled.scope.dispose(); return; }
    if (this.renderer.getContext().isContextLost()) { compiled.scope.dispose(); this.bindLifecycle(); return; }
    const t0 = performance.now();
    // Build identity and pivots from the WHOLE source, even with a frame filter.
    this.group.updateWorldMatrix(true, false);
    const all = collectTileRest(compiled);
    this.frameRegistry.rebuild(all, this.group.matrixWorld);
    this.frameRegistry.setQuads(this.payload.model.frames, compiled.space);
    const rest = this.params.frame === 'all' ? all : collectTileRest(compiled, { frame: this.params.frame });
    if (rest !== all) for (const part of [...all.polygon, ...all.polyline]) part.geometry.dispose();
    this.frameRegistry.assign(rest);
    compiled.scope.dispose();   // the Tilecraft meshes are spent; ours are copies
    this.compiled = { compileMs: compiled.compileMs, restMs: performance.now() - t0, sameThree: compiled.sameThree, space: compiled.space };
    this.rest = rest;
    this.build(rest);
    this.extent.set(all.bounds.max.x - all.bounds.min.x, all.bounds.max.y - all.bounds.min.y);
    this.radius = Math.max(this.extent.length() / 2, 1);
    this.status = this.describe();
  }

  describe() {
    const r = this.rest;
    const kinds = [r.polygon.length && 'polygon', r.polyline.length && 'polyline'].filter(Boolean).join(' + ');
    return (r.maxPolylineLength > 1 ? `Warning: polyline tile ${r.maxPolylineLength.toFixed(3)} m > 1 m; terrain contact accuracy not guaranteed · ` : '') +
      `${r.tiles.count} tiles · ${r.groups} groups · ${kinds || 'empty'}`;
  }

  build(rest) {
    if (!rest.tiles.count) return;
    this.bindLifecycle();
    this.terrainContact = this.terrainGeometry ? new TerrainContact(this.terrainGeometry, this.terrainGeometry.parameters.width) : null;
    this.sim = new TileSim(this.renderer, this.surface, rest.tiles, rest.runs, this.profile, this.frameRegistry.entries, this.terrainContact);
    this.sim.uniforms.uTileMotionLimit = { value: tileMotionLimit(this.params.driftRadius) };
    for (const part of rest.polygon) {
      part.geometry.setAttribute('aSurfaceOffset', new THREE.InstancedBufferAttribute(
        Float32Array.from(part.tile, id => rest.tiles.surfaceOffset[id]), 1));
      const material = this.material(part, false);
      patchTileMaterial(material, this.sim.uniforms, part.tile[0]);
      const mesh = new THREE.InstancedMesh(part.geometry, material, part.count);
      mesh.instanceMatrix.array.set(part.matrices);
      if (part.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(part.colors, 3);
      mesh.computeBoundingSphere();
      mesh.name = `tiles-polygon-${part.layerIndex}-f${part.frameId}`;
      this.group.add(mesh);
      this.prepareMesh(mesh, part);
    }
    for (const part of rest.polyline) {
      part.geometry.setAttribute('aTile', new THREE.Float32BufferAttribute(part.aTile, 1));
      part.geometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(part.aOffset, 3));
      part.geometry.setAttribute('aSurfaceOffset', new THREE.Float32BufferAttribute(
        Float32Array.from(part.aTile, id => rest.tiles.surfaceOffset[id]), 1));
      const mesh = new THREE.Mesh(part.geometry, this.material(part, true));
      patchTileMaterial(mesh.material, this.sim.uniforms);
      mesh.name = `tiles-polyline-${part.layerIndex}-f${part.frameId}`;
      this.group.add(mesh);
      this.prepareMesh(mesh, part);
    }
    const b = rest.bounds;
    this.extent.set(b.max.x - b.min.x, b.max.y - b.min.y);
    this.radius = Math.max(this.extent.length() / 2, 1);
    this.updateBounds();
    this.syncFrames(true);
    if (this.camera && this.rig) this.interaction = new TileInteraction(this, this.scene, this.camera, this.rig);
    if (this.promotion && this.camera) this.unbindPromotion = bindTilePromotion(this.renderer.domElement, this, this.camera,
      () => this.interaction?.canPromote() ?? true);
  }

  prepareMesh(mesh, part) {
    mesh.layers.enable(1); // same GPU material in planar reflection
    if (!mesh.isInstancedMesh) mesh.geometry.computeBoundingSphere();
    const restSphere = (mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry.boundingSphere).clone();
    // Road source positions omit the layer's object-space elevation. The GPU
    // reconstructs it via y0 + aOffset; include that translation in CPU bounds.
    if (!mesh.isInstancedMesh) restSphere.center.y += part.baseY ?? 0;
    let maxOffset = 0, surfaceOffset = 0;
    if (mesh.isInstancedMesh) {
      const proto = mesh.geometry.boundingSphere;
      const matrix = new THREE.Matrix4(), center = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
      for (let i = 0; i < mesh.count; i++) {
        matrix.fromArray(part.matrices, i * 16).decompose(center, rotation, scale);
        maxOffset = Math.max(maxOffset, (proto.radius + proto.center.length()) * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
      }
    } else {
      for (let i = 0; i < part.aOffset.length; i += 3) maxOffset = Math.max(maxOffset, Math.hypot(part.aOffset[i], part.aOffset[i + 1], part.aOffset[i + 2]));
    }
    for (const v of mesh.geometry.getAttribute('aSurfaceOffset').array) surfaceOffset = Math.max(surfaceOffset, Math.abs(v));
    const entry = { mesh, restSphere, maxOffset, surfaceOffset, frameIndex: part.frameIndex };
    if (this.sim.profile.fieldShadow) {
      // Shared buffers + uniform objects; only the depth material is owned here.
      const proxy = mesh.clone();
      proxy.material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
      patchTileMaterial(proxy.material, this.sim.uniforms, part.tile?.[0] ?? 0);
      entry.proxy = proxy;
      this.shadowGroup.add(proxy);
    }
    this.boundsEntries.push(entry);
  }

  updateBounds() {
    // Retain the drift envelope during anchored recovery; reset starts compact.
    this.hasDrift ||= this.params.mode === 'drift';
    const limit = tileMotionLimit(this.params.driftRadius, this.hasDrift);
    if (this.boundsLimit === limit) return;
    this.boundsLimit = limit;
    this.sim.uniforms.uTileMotionLimit.value = limit;
    for (const e of this.boundsEntries) {
      const sphere = tileBounds(e.restSphere, limit, e.maxOffset, e.surfaceOffset);
      applyTileBounds(e.mesh, sphere);
      if (e.proxy) applyTileBounds(e.proxy, sphere.clone());
    }
  }

  get castsShadow() { return !!this.sim?.profile.fieldShadow; }

  syncShadow() {
    this.shadowGroup.matrixAutoUpdate = false;
    this.shadowGroup.matrix.copy(this.group.matrixWorld);
    this.shadowGroup.matrixWorldNeedsUpdate = true;
    return fieldShadowBody(this.boundsEntries, this.shadowBody);
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
    this.interaction?.cancel();
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
    this.syncFrames();
    return this.center;
  }

  syncFrames(force = false) {
    this.group.updateWorldMatrix(true, false);
    if (!force && this.frameMatrix.equals(this.group.matrixWorld)) return;
    if (!force) this.interaction?.cancel();
    this.frameMatrix.copy(this.group.matrixWorld);
    this.frameRegistry.sync(this.group.matrixWorld);
    for (const e of this.boundsEntries) {
      const frame = this.frameRegistry.entries[e.frameIndex];
      if (!frame) continue;
      e.mesh.position.copy(frame.offset);
      e.mesh.renderOrder = frame.rank;
      e.mesh.material.polygonOffset = !e.mesh.material.transparent && frame.rank > 0;
      e.mesh.material.polygonOffsetFactor = 0;
      e.mesh.material.polygonOffsetUnits = -frame.rank;
      if (e.proxy) e.proxy.position.copy(frame.offset);
    }
    this.sim?.syncFrames();
  }

  placeFrameOnTop(frame) {
    frame.rank = Math.max(0, ...this.frameRegistry.entries.map(f => f.rank)) + 1;
    this.syncFrames(true);
  }

  moveFrame(frameId, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Frame position must be finite');
    this.syncFrames();
    const frame = this.frameRegistry.get(frameId);
    frame.world.set(x, 0, z);
    frame.mode = 'placed';
    this.syncFrames(true);
    return frame;
  }

  /**
   * World XZ box of a frame's tiles as the GPU has them now (drift included), or null
   * when no model is built. One 1×1 async readback; reads queue one after another.
   * @returns {Promise<{ minX: number, maxX: number, minZ: number, maxZ: number } | null>}
   */
  frameFootprint(frame) {
    const read = async () => {
      if (!this.sim || !this.rest) return null;
      this.footprintQuery ??= new TileFrameQuery(this, 2);
      const b = await this.footprintQuery.query(frame);
      if (!b || b[0] < -1e19) return null;
      return { minX: -b[0], minZ: -b[1], maxX: b[2], maxZ: b[3] };
    };
    const next = (this.footprintRead ?? Promise.resolve()).then(read, read);
    this.footprintRead = next.catch(() => null);
    return next;
  }

  releaseFrame(frameId) {
    this.syncFrames();
    const frame = this.frameRegistry.get(frameId);
    frame.mode = 'inherited';
    frame.held = false;
    this.syncFrames(true);
    return frame;
  }

  bindLifecycle() {
    if (this.lifecycle || typeof window === 'undefined' || !this.renderer.domElement) return;
    this.lifecycle = new AbortController();
    const options = { signal: this.lifecycle.signal };
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', () => {
      // Keep only the restoration/page lifecycle hooks. clear() restores the
      // captured pose before discarding GPU state; late reads are invalidated.
      ++this.epoch;
      this.clear({ keepLifecycle: true });
      this.status = 'WebGL context lost';
    }, options);
    canvas.addEventListener('webglcontextrestored', () => {
      this.rebuild().catch(error => {
        this.status = `error: ${error.message}`;
        console.error('[tiles restore]', error);
      });
    }, options);
    window.addEventListener('pagehide', event => {
      // A BFCache entry is a suspended live page, not an unload. Keep its
      // resources/listeners so Back can resume it, but never retain a gesture.
      if (event.persisted) { this.interaction?.cancel(); return; }
      ++this.epoch;
      this.clear();
    }, options);
  }

  clear({ keepLifecycle = false } = {}) {
    if (!keepLifecycle) { this.lifecycle?.abort(); this.lifecycle = null; }
    this.interaction?.dispose();
    this.interaction = null;
    this.footprintQuery?.dispose();
    this.footprintQuery = null;
    this.unbindPromotion?.();
    this.unbindPromotion = null;
    this.promotion?.clear();
    for (const proxy of [...this.shadowGroup.children]) {
      proxy.material.dispose();
      proxy.dispose?.();
      this.shadowGroup.remove(proxy);
    }
    this.boundsEntries = [];
    this.boundsLimit = undefined;
    this.hasDrift = false;
    this.cpuMs = 0;
    this.sim?.dispose();
    this.sim = null;
    this.terrainContact?.dispose();
    this.terrainContact = null;
    for (const mesh of [...this.group.children]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose?.();
      this.group.remove(mesh);
    }
    this.rest = null;
  }

  reset() {
    this.interaction?.cancel();
    if (this.interaction) this.interaction.selected = null;
    this.promotion?.clear();
    this.group.updateWorldMatrix(true, false);
    this.frameRegistry.reset(this.group.matrixWorld);
    this.syncFrames(true);
    this.sim?.reset();
    this.hasDrift = false;
    if (this.sim) this.updateBounds();
  }

  setMode(mode) {
    if (mode !== 'anchored' && mode !== 'drift') throw new Error(`Unknown tiles mode: ${mode}`);
    this.params.mode = mode;
  }

  update(dt = 1 / 60, timer) {
    if (!this.sim) return;
    const start = performance.now();
    this.syncFrames();
    this.updateBounds();
    this.interaction?.update(dt);
    this.sim.update(this.group.matrixWorld, dt, this.params, timer);
    this.cpuMs += (performance.now() - start - this.cpuMs) * 0.05;
  }
}
