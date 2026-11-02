// Tiny software-GPU T4 smoke; never loads main.js, FFT, Tilecraft fixtures or benchmarks.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const source = await readFile(new URL('../src/tiles/TileSim.js', import.meta.url), 'utf8');
  await page.route('**/src/tiles/TileSim.js*', r => r.fulfill({ contentType: 'application/javascript', body: source.replace(/import \{ WATER_GLSL \} from [^;]+;/,
    'const WATER_GLSL = `vec3 waterAt(vec2 q, vec3 lod) { return vec3(0.0, 0.1*q.x, 0.0); }`;').replaceAll("'three'", "'/node_modules/.vite/deps/three.js'") }));
  await page.route('**/__t4_smoke__', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>T4 tiny smoke</title>' }));
  await page.goto('http://localhost:5199/__t4_smoke__');
  const result = await page.evaluate(async () => {
    globalThis.__TILECRAFT_ROOT__ = ''; // synthetic page bypasses Vite's HTML define injection
    const T = await import('/node_modules/.vite/deps/three.js');
    const { TileField } = await import('/src/tiles/TileField.js');
    const { FullscreenQuad, rawPass } = await import('/src/engine/fullscreen.js');
    const { PlanarReflection } = await import('/src/engine/PlanarReflection.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(32, 32); renderer.autoClear = false;
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (!gpu.includes('SwiftShader')) throw new Error('Software GPU required');
    const results = [];
    for (const mobile of [false, true]) {
      const scene = new T.Scene(); scene.add(new T.AmbientLight(0xffffff, 2));
      const field = new TileField({ scene, renderer, surface: { uniforms: {} }, heightAt: () => -10, patchMaterial() {}, mobile });
      const road = new T.BoxGeometry(0.6, 0.4, 0.6), aOffset = new Float32Array(road.attributes.position.array);
      const rest = { tiles: { count: 2, x: [-1, 1], z: [0, 0], yaw: [0, 0], radius: [0.3, 0.3], y0: [0, 0], thickness: [0.4, 0.4], runId: [-1, 0], flags: [0, 1], surfaceOffset: [0.01, 0.02] },
        runs: [{ tiles: [1] }], bounds: new T.Box2(new T.Vector2(-2, -1), new T.Vector2(2, 1)),
        polygon: [{ geometry: new T.BoxGeometry(0.6, 0.4, 0.6), transparent: false, tile: [0], count: 1, matrices: new Float32Array(new T.Matrix4().makeTranslation(-1, 0, 0).elements) }],
        polyline: [{ geometry: road, transparent: false, aOffset, aTile: new Float32Array(aOffset.length / 3).fill(1) }] };
      field.rest = rest; field.build(rest);
      for (let i = 0; i < 3; i++) field.update(1 / 60);
      const data = new Float32Array(512 * 4); renderer.readRenderTargetPixels(field.sim.target, 0, 0, 512, 1, data);
      if (![...data].every(Number.isFinite)) throw new Error('nonfinite sim');
      if (!(data[0] < 0 && data[4] > 0)) throw new Error('Analytic water slope not sampled at tile centers');
      const state = new Float32Array(512 * 4);
      const stateTexture = new T.DataTexture(state, 512, 1, T.RGBAFormat, T.FloatType);
      stateTexture.needsUpdate = true; field.sim.uniforms.uState0.value = stateTexture;
      const cam = new T.OrthographicCamera(-4, 4, 4, -4, 0.1, 20); cam.position.set(0, 8, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      const target = new T.WebGLRenderTarget(32, 32, { depthTexture: new T.DepthTexture(32, 32) });
      const view = new T.WebGLRenderTarget(32, 32);
      const readDepth = new FullscreenQuad(rawPass('precision highp float; uniform sampler2D uDepth; in vec2 vUv; out vec4 outColor; void main(){ float d=texture(uDepth,vUv).r; outColor=vec4(vec3(d<0.999 ? 1.0 : 0.0),1.0); }', { uDepth: { value: target.depthTexture } }));
      const centroid = root => {
        renderer.setRenderTarget(target); renderer.setClearColor(0, 1); renderer.clear(true, true, false); renderer.render(root, cam);
        readDepth.render(renderer, view);
        const pixels = new Uint8Array(32*32*4); renderer.readRenderTargetPixels(view, 0, 0, 32, 32, pixels);
        let n = 0, x = 0;
        for (let i = 0; i < 1024; i++) if (pixels[i*4] > 128) { n++; x += i % 32; }
        if (!n) throw new Error('Empty depth image'); return { n, x: x/n };
      };
      field.syncShadow();
      const before = centroid(mobile ? scene : field.shadowScene);
      state[2] = state[6] = 1; stateTexture.needsUpdate = true;
      const after = centroid(mobile ? scene : field.shadowScene);
      if (after.x - before.x < 3) throw new Error('GPU-state depth did not move');
      const opaque = centroid(scene);
      if (Math.abs(opaque.x - after.x) > 0.01 || opaque.n !== after.n) throw new Error('Depth/main deformation mismatch');
      const refl = new PlanarReflection(); refl.setSize(32, 32);
      const camera = new T.PerspectiveCamera(50, 1, 0.1, 100); camera.position.set(0, 4, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      state[0] = state[4] = 1; stateTexture.needsUpdate = true;
      refl.render(renderer, scene, camera);

      const stage = new FullscreenQuad(rawPass('precision highp float; uniform sampler2D uTex; in vec2 vUv; out vec4 outColor; void main(){outColor=texture(uTex,vUv);}', { uTex: { value: refl.target.texture } }));
      stage.render(renderer, view);
      const reflected = new Uint8Array(32*32*4); renderer.readRenderTargetPixels(view, 0, 0, 32, 32, reflected);
      const visible = reflected.filter((v, i) => i % 4 === 3 && v > 0).length;
      if (!visible) throw new Error('No field in planar reflection');
      results.push({ profile: field.profile, stateDy: [data[0], data[4]], depthBefore: before, depthAfter: after, reflectedPixels: visible, glError: gl.getError() });
      stage.material.dispose(); refl.target.dispose(); stateTexture.dispose(); readDepth.material.dispose(); target.dispose(); view.dispose(); field.clear();
    }
    renderer.dispose(); return { gpu, results };
  });
  assert.deepEqual(errors, []);
  assert(result.results.every(r => r.glError === 0));
  console.log('PASS T4 tiny software-GPU smoke\n' + JSON.stringify(result, null, 2));
} finally { await browser.close(); }
