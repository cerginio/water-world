import * as THREE from 'three';
import { TilePicker } from './TilePicker.js';
import { TileFrameQuery } from './TileFrameQuery.js';
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
      // Only terrain in front of the water point can win. Do not traverse
      // underwater cells behind it just to discard their intersection.
      const land = this.field.terrainContact.raycast(ray, this.groundOffset ?? 0.005, t);
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
    this.placementQuery = new TileFrameQuery(field, 1);
    this.occupancyQuery = new TileFrameQuery(field, 2);
    this.contactMargin=0;
    for(const footprint of field.rest.tiles.footprints)for(const p of footprint??[])this.contactMargin=Math.max(this.contactMargin,2*p.length());
    this.highlight = document.createElementNS('http://www.w3.org/2000/svg','svg');
    this.highlight.dataset.tileFrameSelection = '';
    this.highlight.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none';
    this.outline=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    this.outline.setAttribute('fill','none');this.outline.setAttribute('stroke','#ffd37a');this.outline.setAttribute('stroke-width','1.5');
    this.highlight.append(this.outline);
    document.body.append(this.highlight);
    this.marker = document.createElement('div');
    this.marker.textContent = '⊘';this.marker.setAttribute('aria-label','Розміщення заборонено');
    this.marker.style.cssText = 'position:fixed;pointer-events:none;color:#ff796a;font:28px sans-serif;z-index:6;display:none';
    document.body.append(this.marker);
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
    // A second press may become a drag. Decide whether it was a double click
    // only after pointerup; the dblclick listener still hands a true tap to T5.
    const hit = this.picker.pick(this.camera, e.clientX, e.clientY);
    this.samples.push(this.picker.lastMs); if (this.samples.length > 120) this.samples.shift();
    if (!hit) {
      this.clearSelection();
      this.emptyPress = { id:e.pointerId,x:e.clientX,y:e.clientY };
      this.lastTap = null;
      return;
    }
    this.emptyPress = null;
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
    if(!p){this.limited=true;this.canvas.style.cursor='not-allowed';return;}
    this.canvas.style.cursor=this.limited?'not-allowed':'grabbing';
    this.cursor.sample(p);
    const target = p.sub(g.offset).setY(0);
    // The ordinary island has no dry >55-degree faces. Do not delay a short
    // water drag behind a GPU read just to prove an empty steep-cell list.
    if(!this.field.terrainContact.steepBounds.length){
      const b=g.frame.bounds,margin=this.field.sim.uniforms.uTileMotionLimit.value+this.contactMargin;
      const inside=[[b.min.x,b.min.y],[b.max.x,b.min.y],[b.max.x,b.max.y],[b.min.x,b.max.y]].every(([x,z])=>{
        const p=new THREE.Vector3(x+g.frame.offset.x,0,z+g.frame.offset.z).applyMatrix4(this.field.group.matrixWorld).add(target.clone().sub(g.frame.world));
        return Math.max(Math.abs(p.x),Math.abs(p.z))+margin<=ISLAND_SIZE/2;
      });
      if(inside){g.validation=(g.validation??0)+1;g.target.copy(target);this.limited=false;return;}
    }
    if(!g.occupancy && g.frame.holdAge>=0.125 && !this.occupancyQuery.pending){
      const origin=g.frame.world.clone();
      this.occupancyQuery.query(g.frame).then(bounds=>{
        if(this.disposed||this.gesture!==g||!bounds||bounds[0]<-1e19)return;
        g.occupancy={minX:-bounds[0]-origin.x,maxX:bounds[2]-origin.x,
          minZ:-bounds[1]-origin.z,maxZ:bounds[3]-origin.z};
      }).catch(error=>{if(!this.disposed)console.error('[tile occupancy]',error);});
    }
    // A cached GPU bound of the held layout cheaply excludes all steep cells.
    // Only a possible overlap needs exact per-tile triangle clipping.
    if(g.occupancy){
      const b=g.occupancy;
      // Cover subsequent tilt changes of a held tile as it reaches the shore.
      const margin=this.contactMargin;
      const minX=b.minX+Math.min(g.frame.world.x,target.x)-margin,maxX=b.maxX+Math.max(g.frame.world.x,target.x)+margin;
      const minZ=b.minZ+Math.min(g.frame.world.z,target.z)-margin,maxZ=b.maxZ+Math.max(g.frame.world.z,target.z)+margin;
      if(Math.max(Math.abs(minX),Math.abs(maxX),Math.abs(minZ),Math.abs(maxZ))<=ISLAND_SIZE/2 &&
        !this.field.terrainContact.steepBounds.some(b=>b.maxX>=minX&&b.minX<=maxX&&b.maxZ>=minZ&&b.minZ<=maxZ)){
        g.validation=(g.validation??0)+1;g.target.copy(target);this.limited=false;return;
      }
    }
    if (this.placementQuery.pending) return;
    // The GPU clips terrain against the swept occupied footprint, including
    // the path between current pose and target, so large moves cannot tunnel.
    const delta=target.clone().sub(g.frame.world).setY(0);
    const candidate=g.frame.world.clone().add(delta);
    const validation=g.validation=(g.validation??0)+1;
    this.placementQuery.query(g.frame,new THREE.Vector2(delta.x,delta.z),
      this.cursor.height-(this.cursor.waterOffset??this.cursor.groundOffset??0)).then(result=>{
      if(this.disposed||this.gesture!==g||g.validation!==validation||!result)return;
      this.limited=result[0]>0.5;
      if(!this.limited) g.target.copy(candidate);
      this.canvas.style.cursor=this.limited?'not-allowed':'grabbing';
    }).catch(error=>{if(!this.disposed){console.error('[tile placement]',error);this.limited=true;}});
  }

  up(e) {
    this.touches.delete(e.pointerId);
    this.cameraTouch = this.touches.size > 0;
    if(this.emptyPress?.id===e.pointerId){
      if(Math.hypot(e.clientX-this.emptyPress.x,e.clientY-this.emptyPress.y)<(e.pointerType==='touch'?10:5)){
        this.clearSelection();
      }
      this.emptyPress=null;
    }
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
      this.field.placeFrameOnTop(g.frame);
      if (!immediate) this.settling = { frame: g.frame, target: g.target.clone(), elapsed: 0 };
      this.field.syncFrames(true);
    } else this.lastTap = { x: g.x, y: g.y, time: performance.now() };
    this.controls.enabled = this.controlsEnabled;
    if (this.canvas.hasPointerCapture(g.id)) this.canvas.releasePointerCapture(g.id);
    this.state = this.settling ? 'settling' : 'selected';
    this.hoverPoint = g.type === 'touch' ? null : { x: g.x, y: g.y };
    this.canvas.style.cursor = '';
    this.marker.style.display='none';this.limited=false;
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
    this.emptyPress=null;this.marker.style.display='none';this.limited=false;
    this.hoverPoint = null; this.hovered = null; this.cameraTouch = false;
    this.touches.clear();
    this.state = this.selected ? 'selected' : 'idle'; this.canvas.style.cursor = '';
  }

  clearSelection(){
    this.selected=null;this.hovered=null;this.hoverPoint=null;this.highlightFrame=null;
    this.generation++;this.state='idle';this.highlight.style.display='none';
  }

  updateHighlight(frame){
    this.highlightFrame=frame;
    if(!frame){this.highlight.style.display='none';return;}
    const {min,max}=frame.bounds,rect=this.canvas.getBoundingClientRect();
    const points=[[min.x,min.y],[max.x,min.y],[max.x,max.y],[min.x,max.y]].map(([x,z])=>{
      const p=new THREE.Vector3(x+frame.offset.x,0,z+frame.offset.z).applyMatrix4(this.field.group.matrixWorld);
      const land=this.field.terrainContact.at(p.x,p.z)?.height??-1e20;
      p.y=land>0?land+0.05:frame.selectionHeight+0.05;
      const screen=p.clone().project(this.camera);
      return `${rect.left+(screen.x+1)*rect.width/2},${rect.top+(1-screen.y)*rect.height/2}`;
    });
    this.outline.setAttribute('points',points.join(' '));
    this.highlight.style.display='block';
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
      this.marker.style.display=this.limited?'block':'none';
      this.marker.style.left=`${g.x+14}px`;this.marker.style.top=`${g.y+12}px`;
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
      if (s.elapsed >= 0.15) { this.settling = null; this.state = this.selected?'selected':'idle'; }
    }
    if (!g && !this.hoverBusy && this.hoverPoint &&
      (this.hoverGeneration !== this.generation || performance.now() - (this.hoverTime ?? 0) >= 100)) {
      this.hoverBusy = true;
      this.hoverTime = performance.now();
      const generation = this.generation, epoch = this.field.epoch;
      this.hoverGeneration = generation;
      this.picker.hover(this.camera, this.hoverPoint.x, this.hoverPoint.y).then(hit => {
        if (!this.disposed && epoch === this.field.epoch && generation === this.generation && !this.gesture) {
          this.hovered = hit?.frame ?? null;
          this.canvas.style.cursor = hit ? 'grab' : '';
        }
      }).catch(() => {}).finally(() => { this.hoverBusy = false; });
    }
    this.updateHighlight(g?.frame??this.selected);
  }

  dispose() {
    if (this.disposed) return;
    this.cancel(); this.disposed = true; this.abort.abort(); this.cursor.dispose();
    this.picker.dispose();
    this.placementQuery.dispose();this.occupancyQuery.dispose();
    this.highlight.remove();this.marker.remove();
  }
}
