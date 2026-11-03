import * as THREE from 'three';
import { patchTileMaterial } from './TileMaterial.js';
import { promotionMembers, makePromotionDescriptor, disposePromotion } from './tilePromotionGeometry.js';

// Lazy, gesture-only 1px ID pass. No pick work or CPU tile loop during animation.
export class TilePromotion {
  constructor(field, floaters) {
    this.field = field;
    this.floaters = floaters;
    this.active = new Map();
    this.pickScene = new THREE.Scene();
    this.pickGroup = new THREE.Group();
    this.pickScene.add(this.pickGroup);
  }

  buildPicker() {
    if (this.target) return;
    const field = this.field;
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, depthBuffer: true });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    field.group.children.forEach((mesh, i) => {
      const part = [...field.rest.polygon, ...field.rest.polyline][i];
      const proxy = mesh.clone();
      const material = new THREE.MeshBasicMaterial({ side: mesh.material.side, toneMapped: false });
      patchTileMaterial(material, field.sim.uniforms, part.tile?.[0] ?? 0);
      const patch = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        patch(shader, renderer);
        shader.vertexShader = 'flat varying float vTilePick;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('ivec2 tileUV', 'vTilePick = float(tileId + 1);\n  ivec2 tileUV');
        shader.fragmentShader = `precision highp float;
          flat varying float vTilePick;
          void main() {
            float id = floor(vTilePick + 0.5);
            gl_FragColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0),
              floor(id / 65536.0), 255.0) / 255.0;
          }`;
      };
      material.customProgramCacheKey = () => 'tile-pick-v1';
      proxy.material = material;
      proxy.frustumCulled = false;
      this.pickGroup.add(proxy);
    });
  }

  pick(camera, clientX, clientY) {
    const f = this.field, r = f.renderer;
    if (!f.sim || r.getContext().isContextLost()) return -1;
    const rect = r.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientY < rect.top || clientX >= rect.right || clientY >= rect.bottom) return -1;
    this.buildPicker();
    f.group.updateWorldMatrix(true, false);
    this.pickGroup.matrixAutoUpdate = false;
    this.pickGroup.matrix.copy(f.group.matrixWorld);
    this.pickGroup.matrixWorldNeedsUpdate = true;
    this.pickGroup.children.forEach((proxy, i) => proxy.position.copy(f.group.children[i].position));
    // Clone: never mutate the real camera's view/projection, including on failure.
    camera.updateWorldMatrix(true, false);
    const view = camera.clone();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    view.setViewOffset(size.x, size.y,
      Math.floor((clientX - rect.left) / rect.width * size.x),
      Math.floor((clientY - rect.top) / rect.height * size.y), 1, 1);
    const previous = r.getRenderTarget(), autoClear = r.autoClear;
    const color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    const pixel = new Uint8Array(4);
    try {
      r.autoClear = true;
      r.setClearColor(0, 0);
      r.setRenderTarget(this.target);
      r.clear();
      r.render(this.pickScene, view);
      r.readRenderTargetPixels(this.target, 0, 0, 1, 1, pixel);
    } finally {
      r.setRenderTarget(previous);
      r.setClearColor(color, alpha);
      r.autoClear = autoClear;
    }
    const id = pixel[0] + pixel[1] * 256 + pixel[2] * 65536 - 1;
    return id >= 0 && id < f.rest.tiles.count ? id : -1;
  }

  hidden(ids, hidden) {
    const texture = this.field.sim.rest1;
    for (const id of ids) {
      const k = id * 4 + 3;
      texture.image.data[k] = hidden ? texture.image.data[k] | 2 : texture.image.data[k] & ~2;
    }
    texture.needsUpdate = true;
  }

  promote(id) {
    const f = this.field;
    if (!f.sim) return null;
    const ids = promotionMembers(f.rest, id);
    if (!ids.length || ids.some(id => (f.sim.rest1.image.data[id * 4 + 3] & 2) !== 0)) return null;
    // Synchronous snapshot is confined to the gesture. Read only occupied rows;
    // the two attachments come from the exact target used by the ID pass.
    const firstRow = Math.floor(Math.min(...ids) / 512);
    const endRow = Math.floor(Math.max(...ids) / 512) + 1;
    const state0 = new Float32Array(endRow * 512 * 4), state1 = new Float32Array(state0.length);
    f.renderer.readRenderTargetPixels(f.sim.target, 0, firstRow, 512, endRow - firstRow,
      state0.subarray(firstRow * 512 * 4), undefined, 0);
    f.renderer.readRenderTargetPixels(f.sim.target, 0, firstRow, 512, endRow - firstRow,
      state1.subarray(firstRow * 512 * 4), undefined, 1);
    if (ids.some(id => ![...state0.subarray(id * 4, id * 4 + 4),
      ...state1.subarray(id * 4, id * 4 + 4)].every(Number.isFinite))) throw new Error('Invalid GPU tile snapshot');
    const desc = makePromotionDescriptor(f, ids, state0, state1);
    let body;
    try {
      body = this.floaters.addDescriptor(desc, desc.positionWorld, desc.yaw, () => {
        this.hidden(ids, false);
        this.active.delete(body);
        disposePromotion(desc);
      });
    } catch (error) { disposePromotion(desc); throw error; }
    this.active.set(body, ids);
    this.hidden(ids, true);
    body.object.position.copy(body.pos);
    body.object.quaternion.copy(body.quat);
    return body;
  }

  clear() {
    // Before TileField releases the rest textures: removal callbacks unhide them.
    for (const body of [...this.active.keys()]) this.floaters.remove(body);
    for (const proxy of this.pickGroup.children) { proxy.material.dispose(); proxy.dispose?.(); }
    this.pickGroup.clear();
    this.target?.dispose();
    this.target = null;
  }
}

// Only dblclick is claimed. No click/pointerdown interception: FD2 owns those.
// A future drag arbiter can preventDefault() dblclick or suppress via canPromote.
export function bindTilePromotion(canvas, field, camera, canPromote = () => true) {
  let lastDrag = -Infinity, origin = null;
  const down = e => { if (e.button === 0) origin = [e.clientX, e.clientY]; };
  const move = e => {
    if (origin && Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) > 5) lastDrag = e.timeStamp;
  };
  const up = () => { origin = null; };
  const doubleClick = e => {
    const blocked = e.timeStamp - lastDrag < 600;
    if (blocked || e.defaultPrevented || e.button !== 0 || !field.loaded || !canPromote()) return;
    try {
      const id = field.promotion.pick(camera, e.clientX, e.clientY);
      if (id >= 0 && field.promotion.promote(id)) e.preventDefault();
    } catch (error) { console.error('[tiles promotion]', error); }
  };
  const cancel = () => { origin = null; lastDrag = -Infinity; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('dblclick', doubleClick);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('dblclick', doubleClick);
  };
}
