import * as THREE from 'three';
import { patchTileMaterial } from './TileMaterial.js';

// One bounded read. The alpha channel carries the actual deformed hit height,
// so grabbing an elevated strip does not project its grab point onto y=0.
export class TilePicker {
  constructor(field, scene) {
    this.field = field;
    this.scene = new THREE.Scene();
    this.proxies = [];
    this.target = new THREE.WebGLRenderTarget(13, 13, {
      type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, samples: 0,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    const parts = [...field.rest.polygon, ...field.rest.polyline];
    this.bytes = 0; // geometry and instance attributes are shared with the visible field
    field.group.children.forEach((source, i) => {
      const part = parts[i], proxy = source.clone(false);
      if (source.isInstancedMesh) {
        proxy.instanceMatrix = source.instanceMatrix;
        proxy.instanceColor = source.instanceColor;
      }
      const material = new THREE.MeshBasicMaterial({ side: source.material.side,
        vertexColors: source.material.vertexColors, toneMapped: false, blending: THREE.NoBlending });
      patchTileMaterial(material, field.sim.uniforms, part.tile?.[0] ?? 0);
      const patch = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        patch(shader, renderer);
        shader.uniforms.uPickFrame = { value: part.frameIndex + 1 };
        shader.vertexShader = 'varying float vPickY;\n' + shader.vertexShader;
        const end = shader.vertexShader.lastIndexOf('}');
        shader.vertexShader = shader.vertexShader.slice(0, end) + `
          #ifdef USE_INSTANCING
            vPickY = (modelMatrix * tileMatrix * vec4(transformed, 1.0)).y;
          #else
            vPickY = (modelMatrix * vec4(transformed, 1.0)).y;
          #endif
        ` + shader.vertexShader.slice(end);
        shader.fragmentShader = `varying float vPickY;
          uniform float uPickFrame, opacity;
          #include <color_pars_fragment>
          void main() {
            float alpha = opacity;
            #ifdef USE_COLOR_ALPHA
              alpha *= vColor.a;
            #endif
            if (alpha < 0.1) discard;
            gl_FragColor = vec4(uPickFrame, 0.0, 0.0, vPickY);
          }`;
      };
      material.customProgramCacheKey = () => 'frame-pick-v3';
      proxy.material = material;
      proxy.userData.frameIndex = part.frameIndex;
      proxy.userData.tileBase = part.tile?.[0] ?? 0;
      this.add(source, proxy, true);
    });
    // Opaque terrain/props occlude IDs. Water, sky and effects are surfaces the
    // tiles float on, rather than opaque blockers. Share buffers, own materials.
    scene.traverseVisible(mesh => {
      if (!mesh.isMesh || field.group.children.includes(mesh)) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(m => m.transparent || m.isShaderMaterial)) return;
      const proxy = mesh.clone(false);
      proxy.material = materials.map(m => new THREE.MeshBasicMaterial({
        color: 0, side: m.side, alphaTest: m.alphaTest, map: m.map, alphaMap: m.alphaMap,
        toneMapped: false, blending: THREE.NoBlending,
      }));
      if (!Array.isArray(mesh.material)) proxy.material = proxy.material[0];
      this.add(mesh, proxy, false);
    });
  }

  add(source, proxy, tile) {
    proxy.matrixAutoUpdate = false;
    proxy.frustumCulled = !tile;
    proxy.layers.set(0);
    this.proxies.push({ source, proxy, tile });
    this.scene.add(proxy);
  }

  render(camera, x, y) {
    const f = this.field, r = f.renderer, rect = r.domElement.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const viewport = r.getViewport(new THREE.Vector4()).multiplyScalar(r.getPixelRatio());
    const px = (x - rect.left) / rect.width * size.x;
    const py = (y - rect.top) / rect.height * size.y;
    if (px < viewport.x || px >= viewport.x + viewport.z || size.y - py < viewport.y || size.y - py >= viewport.y + viewport.w) return null;
    camera.updateWorldMatrix(true, false);
    const view = camera.clone(), original = camera.view;
    const left = px - viewport.x - 6, top = py - (size.y - viewport.y - viewport.w) - 6;
    if (original?.enabled) {
      view.setViewOffset(original.fullWidth, original.fullHeight,
        original.offsetX + left / viewport.z * original.width,
        original.offsetY + top / viewport.w * original.height,
        13 / viewport.z * original.width, 13 / viewport.w * original.height);
    } else view.setViewOffset(viewport.z, viewport.w, left, top, 13, 13);
    f.group.updateWorldMatrix(true, true);
    for (const { source, proxy } of this.proxies) {
      source.updateWorldMatrix(true, false);
      proxy.matrix.copy(source.matrixWorld);
      proxy.matrixWorldNeedsUpdate = true;
      let visible = true;
      for (let p = source; p; p = p.parent) visible &&= p.visible;
      proxy.visible = visible;
      if (proxy.userData.frameIndex !== undefined) {
        proxy.material.opacity = source.material.opacity;
        proxy.renderOrder=source.renderOrder;
        proxy.material.polygonOffset=source.material.polygonOffset;
        proxy.material.polygonOffsetFactor=source.material.polygonOffsetFactor;
        proxy.material.polygonOffsetUnits=source.material.polygonOffsetUnits;
      }
    }
    const previous = r.getRenderTarget(), autoClear = r.autoClear;
    const scissor = r.getScissor(new THREE.Vector4()), scissorTest = r.getScissorTest();
    const color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    try {
      r.autoClear = true;
      r.setClearColor(0, 0);
      r.setRenderTarget(this.target);
      r.setScissor(0, 0, 13, 13); r.setScissorTest(true);
      r.clear(); r.render(this.scene, view);
    } finally {
      r.setRenderTarget(previous);
      r.setScissor(scissor); r.setScissorTest(scissorTest);
      r.setClearColor(color, alpha); r.autoClear = autoClear;
    }
    return { x, y, dpr: size.x / rect.width };
  }

  decode(buffer, request) {
    if (!request) return null;
    let best = null, distance = Infinity;
    for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
      const k = (y * 13 + x) * 4, index = Math.round(buffer[k]) - 1;
      const d = (x - 6) ** 2 + (y - 6) ** 2;
      if (index < 0 || index >= this.field.frameRegistry.entries.length || d >= distance) continue;
      distance = d;
      best = { frame: this.field.frameRegistry.entries[index], height: buffer[k + 3],
        x: request.x + (x - 6) / request.dpr, y: request.y - (y - 6) / request.dpr };
    }
    return best;
  }

  pick(camera, x, y) {
    if (this.disposed) return null;
    const start = performance.now(), request = this.render(camera, x, y);
    if (!request) return null;
    const buffer = new Float32Array(13 * 13 * 4);
    this.field.renderer.readRenderTargetPixels(this.target, 0, 0, 13, 13, buffer);
    this.lastMs = performance.now() - start;
    return this.decode(buffer, request);
  }

  async hover(camera, x, y) {
    if (this.disposed || this.pending) return null;
    const request = this.render(camera, x, y);
    if (!request) return null;
    const buffer = new Float32Array(13 * 13 * 4);
    this.pending = true;
    try {
      await this.field.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, 13, 13, buffer);
      return this.disposed ? null : this.decode(buffer, request);
    } finally {
      this.pending = false;
      if (this.disposed) this.release();
    }
  }

  dispose() {
    this.disposed = true;
    if (!this.pending) this.release();
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.target.dispose();
    for (const { proxy } of this.proxies) {
      for (const m of Array.isArray(proxy.material) ? proxy.material : [proxy.material]) m.dispose();
      proxy.dispose?.();
    }
    this.scene.clear();
  }
}
