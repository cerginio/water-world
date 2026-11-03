import * as THREE from 'three';
import { TilePicker } from './TilePicker.js';
import { patchTileMaterial } from './TileMaterial.js';
import { WaterQuery } from '../water/WaterQuery.js';
import { ISLAND_SIZE } from '../scene/islandHeight.js';

// Shared support cursor: asynchronous water height and exact terrain-cell ray traversal.
export class SurfaceCursor {
  constructor(field, camera) {
    this.field = field;
    this.camera = camera;
    this.ray = new THREE.Raycaster();
    this.height = 0;
    this.query = new WaterQuery(field.renderer, field.surface, 1);
    this.tag = 0;
  }

  point(x, y, height = this.height, waterOnly = false) {
    const renderer = this.field.renderer, rect = renderer.domElement.getBoundingClientRect();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const viewport = renderer.getViewport(new THREE.Vector4()).multiplyScalar(renderer.getPixelRatio());
    const px = (x - rect.left) / rect.width * size.x, py = (y - rect.top) / rect.height * size.y;
    this.ray.setFromCamera(new THREE.Vector2((px - viewport.x) / viewport.z * 2 - 1,
      (size.y - py - viewport.y) / viewport.w * 2 - 1), this.camera);
    const ray = this.ray.ray;
    if (ray.direction.y >= -0.015) return null;
    const t = (height - ray.origin.y) / ray.direction.y;
    if (t < 0 || t > 6000) return null;
    let p = ray.at(t, new THREE.Vector3());
    if (!waterOnly && this.field.terrainContact) {
      const land = this.field.terrainContact.raycast(ray, this.groundOffset ?? 0.005);
      if (land && land.distanceToSquared(ray.origin) < p.distanceToSquared(ray.origin)) p = land;
    }
    return Math.abs(p.x) <= ISLAND_SIZE / 2 && Math.abs(p.z) <= ISLAND_SIZE / 2 ? p : null;
  }

  begin(hit) {
    this.tag++;
    this.height = hit.height;
    this.waterOffset = null;
    const p = this.point(hit.x, hit.y, hit.height, true);
    const ground = p && this.field.terrainContact?.at(p.x,p.z);
    const tiles = this.field.rest.tiles;
    let id = 0;
    while (id < tiles.count && tiles.frameIndex[id] !== hit.frame.index) id++;
    this.groundOffset = ground && hit.height-ground.height < 0.5
      ? Math.max(0.005,hit.height-ground.height)
      : (tiles.thickness[id] ?? 0.01)+0.005+Math.min(tiles.surfaceOffset[id] ?? 0,0.001);
    this.onLand = !!(ground && hit.height-ground.height < 0.5 && hit.height-ground.height <= (tiles.thickness[id] ?? 0.01)+0.02);
    this.sample(p, true);
  }

  sample(p, initial = false) {
    if (!p) return;
    if (this.query.resultTag === this.tag) {
      const water = this.query.result[0];
      if (this.waterOffset === null) this.waterOffset = this.onLand ? this.groundOffset : this.height - water;
      this.height = water + this.waterOffset;
    }
    if (!this.query.inFlight || initial) {
      const r = this.field.renderer, previous = r.getRenderTarget();
      try { this.query.submit(new Float32Array([p.x, p.z]), 1, this.tag, performance.now()); }
      finally { r.setRenderTarget(previous); }
    }
  }

  dispose() { this.tag++; this.query.dispose(); }
}

export class TileInteraction {
  constructor(field, scene, camera, controls) {
    this.field = field; this.camera = camera; this.controls = controls;
    this.canvas = field.renderer.domElement;
    this.picker = new TilePicker(field, scene);
    this.cursor = new SurfaceCursor(field, camera);
    this.state = 'idle'; this.selected = null; this.generation = 0;
    this.epoch = field.epoch; this.lastDrag = -Infinity; this.lastTap = null;
    this.samples = [];
    this.touches = new Set();
    this.highlight = new THREE.Group(); scene.add(this.highlight);
    this.outlines = this.picker.proxies.filter(p => p.tile).map(({ source: mesh, proxy: pick }) => {
      const proxy = pick.clone(false);
      if (pick.isInstancedMesh) { proxy.instanceMatrix = pick.instanceMatrix; proxy.instanceColor = pick.instanceColor; }
      proxy.material = new THREE.MeshBasicMaterial({ color: 0xffd37a, wireframe: true,
        transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
      patchTileMaterial(proxy.material, field.sim.uniforms, pick.userData.tileBase);
      proxy.matrixAutoUpdate = false; proxy.frustumCulled = false; proxy.renderOrder = 20;
      this.highlight.add(proxy);
      return { mesh, proxy, frameIndex: pick.userData.frameIndex };
    });
    this.abort = new AbortController();
    const listen = (target, name, fn, capture = false) => target.addEventListener(name, fn,
      { capture, signal: this.abort.signal });
    listen(this.canvas, 'pointerdown', e => this.down(e), true);
    listen(this.canvas, 'pointermove', e => this.move(e), true);
    listen(this.canvas, 'pointerup', e => this.up(e), true);
    listen(this.canvas, 'pointercancel', () => this.cancel(), true);
    listen(this.canvas, 'lostpointercapture', e => { if (this.gesture?.id === e.pointerId) this.cancel(); }, true);
    listen(this.canvas, 'pointerleave', () => { this.hoverPoint = null; this.generation++; if (!this.gesture) this.hovered = null; });
    listen(this.canvas, 'dblclick', e => {
      if (!this.canPromote()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    listen(window, 'blur', () => this.cancel());
    listen(this.canvas, 'webglcontextlost', () => this.cancel());
  }

  canPromote() { return !this.gesture && performance.now() - this.lastDrag > 600; }

  down(e) {
    if (this.replaying) return;
    if (e.pointerType === 'touch') this.touches.add(e.pointerId);
    if (e.pointerType === 'touch' && this.gesture && e.pointerId !== this.gesture.id) {
      const g = this.gesture;
      this.finish(true);
      this.replaying = true;
      try {
        this.canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: g.id,
          pointerType: 'touch', clientX: g.x, clientY: g.y, button: 0, buttons: 1, isPrimary: true }));
      } finally { this.replaying = false; }
      this.cameraTouch = true;
      return; // The real second pointer passes through to OrbitControls.
    }
    if (e.pointerType === 'touch' && this.touches.size > 1) { this.cameraTouch = true; return; }
    if (this.cameraTouch || e.button !== 0 || !this.field.sim) return;
    // The second press of a double click belongs to T5, without starting a drag.
    if (this.lastTap && performance.now() - this.lastTap.time < 500 &&
      Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 5) return;
    const hit = this.picker.pick(this.camera, e.clientX, e.clientY);
    this.samples.push(this.picker.lastMs); if (this.samples.length > 120) this.samples.shift();
    if (!hit) return;
    e.stopImmediatePropagation(); e.preventDefault(); this.generation++;
    if (this.settling) this.settling = null;
    this.selected = hit.frame;
    this.cursor.begin(hit);
    const p = this.cursor.point(e.clientX, e.clientY);
    if (!p) return;
    const f = hit.frame;
    this.gesture = { id: e.pointerId, type: e.pointerType, startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, frame: f, world: f.world.clone(), mode: f.mode, held: f.held,
      holdAge: f.holdAge, offset: p.clone().sub(f.world), target: f.world.clone(), dragged: false };
    this.state = 'selected'; this.controlsEnabled = this.controls.enabled; this.controls.enabled = false;
    // Drain OrbitControls' private damping accumulator without moving the view.
    const pos = this.camera.position.clone(), rotation = this.camera.quaternion.clone();
    const target = this.controls.target.clone(), damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update();
    this.camera.position.copy(pos); this.camera.quaternion.copy(rotation); this.controls.target.copy(target);
    this.camera.updateMatrixWorld(); this.controls.enableDamping = damping;
    this.canvas.setPointerCapture(e.pointerId);
  }

  move(e) {
    const g = this.gesture;
    if (!g) {
      if (e.pointerType !== 'touch' && !e.buttons) {
        this.hoverPoint = { x: e.clientX, y: e.clientY }; this.generation++;
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    e.stopImmediatePropagation();
    g.x = e.clientX; g.y = e.clientY;
    if (!g.dragged && Math.hypot(g.x - g.startX, g.y - g.startY) > (g.type === 'touch' ? 10 : 5)) {
      g.dragged = true;
      if (!g.frame.held) g.frame.holdAge = 0;
      g.frame.held = true;
      this.state = 'dragging'; this.field.syncFrames(true);
    }
    if (g.dragged) this.target(g);
  }

  target(g) {
    const p = this.cursor.point(g.x, g.y);
    this.limited = !p;
    this.canvas.style.cursor = p ? 'grabbing' : 'not-allowed';
    if (!p) return;
    const target = p.sub(g.offset).setY(0);
    // FD2 bounds are a conservative frame footprint; exact occupied terrain
    // contact validation belongs to FD4.
    const margin = this.field.radius;
    if (Math.abs(target.x) + margin > ISLAND_SIZE / 2 || Math.abs(target.z) + margin > ISLAND_SIZE / 2) {
      this.limited = true; this.canvas.style.cursor = 'not-allowed'; return;
    }
    g.target.copy(target);
    this.cursor.sample(this.cursor.point(g.x, g.y));
  }

  up(e) {
    this.touches.delete(e.pointerId);
    this.cameraTouch = this.touches.size > 0;
    if (!this.gesture || e.pointerId !== this.gesture.id) return;
    e.stopImmediatePropagation();
    this.finish(false);
  }

  finish(immediate) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.dragged) {
      this.lastDrag = performance.now(); this.lastTap = null;
      g.frame.mode = 'placed';
      if (!immediate) this.settling = { frame: g.frame, target: g.target.clone(), elapsed: 0 };
      this.field.syncFrames(true);
    } else this.lastTap = { x: g.x, y: g.y, time: performance.now() };
    this.controls.enabled = this.controlsEnabled;
    if (this.canvas.hasPointerCapture(g.id)) this.canvas.releasePointerCapture(g.id);
    this.state = this.settling ? 'settling' : 'selected';
    this.hoverPoint = g.type === 'touch' ? null : { x: g.x, y: g.y };
    this.canvas.style.cursor = '';
  }

  cancel() {
    const g = this.gesture;
    if (g) {
      this.gesture = null;
      g.frame.world.copy(g.world); g.frame.mode = g.mode; g.frame.held = g.held; g.frame.holdAge = g.holdAge;
      // For an inherited frame restore offset as well as world pose.
      g.frame.offset.copy(g.world).applyMatrix4(this.field.group.matrixWorld.clone().invert()).sub(g.frame.pivot).setY(0);
      this.field.syncFrames(true);
      this.controls.enabled = this.controlsEnabled;
      if (this.canvas.hasPointerCapture(g.id)) this.canvas.releasePointerCapture(g.id);
    }
    this.generation++; this.cursor.tag++; this.settling = null;
    this.hoverPoint = null; this.hovered = null; this.cameraTouch = false;
    this.touches.clear();
    this.state = this.selected ? 'selected' : 'idle'; this.canvas.style.cursor = '';
  }

  update(dt) {
    let fading = false;
    for (const frame of this.field.frameRegistry.entries) if (frame.held && frame.holdAge < 0.125) {
      frame.holdAge = Math.min(0.125, frame.holdAge + dt); fading = true;
    }
    if (fading) this.field.syncFrames(true);
    const g = this.gesture;
    if (g?.dragged) {
      this.target(g);
      const delta = g.target.clone().sub(g.frame.world).multiplyScalar(1 - Math.exp(-dt / 0.05));
      delta.clampLength(0, 500 * dt);
      const p = g.frame.world.clone().add(delta);
      this.field.moveFrame(g.frame.id, p.x, p.z);
    }
    if (this.settling) {
      const s = this.settling;
      s.elapsed += dt;
      const p = s.frame.world.clone().lerp(s.target, 1 - Math.exp(-dt / 0.035));
      if (s.elapsed >= 0.15) p.copy(s.target);
      this.field.moveFrame(s.frame.id, p.x, p.z);
      if (s.elapsed >= 0.15) { this.settling = null; this.state = 'selected'; }
    }
    if (!g && !this.hoverBusy && this.hoverPoint) {
      this.hoverBusy = true;
      const generation = this.generation, epoch = this.field.epoch;
      this.hoverGeneration = generation;
      this.picker.hover(this.camera, this.hoverPoint.x, this.hoverPoint.y).then(hit => {
        if (!this.disposed && epoch === this.field.epoch && generation === this.generation && !this.gesture) {
          this.hovered = hit?.frame ?? null;
          this.canvas.style.cursor = hit ? 'grab' : '';
        }
      }).catch(() => {}).finally(() => { this.hoverBusy = false; });
    }
    const frame = g?.frame ?? this.hovered ?? this.selected;
    for (const { mesh, proxy, frameIndex } of this.outlines) {
      proxy.visible = frame?.index === frameIndex;
      if (proxy.visible) { mesh.updateWorldMatrix(true, false); proxy.matrix.copy(mesh.matrixWorld); proxy.matrixWorldNeedsUpdate = true; }
    }
  }

  dispose() {
    this.cancel(); this.disposed = true; this.abort.abort(); this.cursor.dispose();
    const release = () => this.picker.dispose();
    // A PBO already submitted cannot be canceled in three; invalidate its epoch
    // and retire the target once that bounded read has completed.
    if (this.hoverBusy) this.retire = setInterval(() => {
      if (!this.hoverBusy) { clearInterval(this.retire); release(); }
    }, 10); else release();
    for (const { proxy } of this.outlines) { proxy.material.dispose(); proxy.dispose?.(); }
    this.highlight.removeFromParent();
  }
}
