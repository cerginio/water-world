// One tiny SwiftShader-only smoke. No main.js, ocean, FFT, fixture or benchmark.
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
    'const WATER_GLSL = `vec3 waterAt(vec2 q, vec3 lod) { return vec3(0.0); }`;').replaceAll("'three'", "'/node_modules/.vite/deps/three.js'") }));
  await page.route('**/__t5_smoke__', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}</style><title>T5 tiny smoke</title>' }));
  await page.goto('http://localhost:5199/__t5_smoke__');
  const result = await page.evaluate(async () => {
    globalThis.__TILECRAFT_ROOT__ = '';
    const T = await import('/node_modules/.vite/deps/three.js');
    const { TileField } = await import('/src/tiles/TileField.js');
    const { Floaters } = await import('/src/scene/floaters.js');
    const { FullscreenQuad, rawPass } = await import('/src/engine/fullscreen.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(32, 32); document.body.appendChild(renderer.domElement);
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (!gpu.includes('SwiftShader')) throw new Error('Software GPU required');
    const scene = new T.Scene();
    const floaters = new Floaters({ scene, heightAt: () => -10, patchMaterial() {} });
    const camera = new T.OrthographicCamera(-4, 4, 4, -4, 0.1, 20);
    camera.position.set(0, 8, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const field = new TileField({ scene, renderer, surface: { uniforms: {} }, heightAt: () => -10, patchMaterial() {}, floaters, camera });
    const road = new T.BoxGeometry(0.8, 0.4, 0.8);
    const rest = { tiles: { count: 2, x: [-1, 1], z: [0, 0], yaw: [0, 0], radius: [0.4, 0.4], y0: [0, 0], thickness: [0.4, 0.4], runId: [-1, 0], flags: [0, 1], g: [1, 2], f: [1, 1], surfaceOffset: [0.01, 0.02] },
      runs: [{ tiles: [1] }], bounds: new T.Box2(new T.Vector2(-2, -1), new T.Vector2(2, 1)),
      polygon: [{ geometry: new T.BoxGeometry(0.8, 0.4, 0.8), tile: [0], count: 1, matrices: new Float32Array(new T.Matrix4().makeTranslation(-1, 0, 0).elements) }],
      polyline: [{ geometry: road, aOffset: new Float32Array(road.attributes.position.array), aTile: new Float32Array(road.attributes.position.count).fill(1) }] };
    field.rest = rest; field.build(rest);
    field.group.rotation.y = 0.3; field.group.position.set(0.5, 0, -0.3); field.group.updateWorldMatrix(true, false);
    const seed = new FullscreenQuad(rawPass(`precision highp float;
      layout(location=0) out vec4 s0; layout(location=1) out vec4 s1;
      layout(location=2) out vec4 s2; layout(location=3) out vec4 s3;
      void main(){s0=vec4(0.3,0.0,1.0,0.0);s1=vec4(0.1,-0.2,0.0,0.0);s2=vec4(0.0);s3=vec4(0.0);}`, {}));
    seed.render(renderer, field.sim.target); renderer.setRenderTarget(null);
    const point = id => {
      const p = new T.Vector3(rest.tiles.x[id] + 1, 0.3, 0).applyMatrix4(field.group.matrixWorld).project(camera);
      return [(p.x + 1) * 16, (1 - p.y) * 16];
    };
    const before = [0, 1].map(id => field.promotion.pick(camera, ...point(id)));
    if (before.join() !== '0,1') throw new Error('GPU-position ID picking failed: ' + before);
    if (field.promotion.pick(camera, 1, 1) !== -1) throw new Error('Empty pick not empty');
    // Native dblclick handler, not just direct promote(): single click does nothing.
    renderer.domElement.dispatchEvent(new MouseEvent('click', { clientX: point(0)[0], clientY: point(0)[1] }));
    if (floaters.bodies.length) throw new Error('Single click promoted');
    renderer.domElement.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: point(0)[0], clientY: point(0)[1], cancelable: true }));
    if (floaters.bodies.length !== 1) throw new Error('Double click did not promote');
    const afterPolygon = [0, 1].map(id => field.promotion.pick(camera, ...point(id)));
    if (afterPolygon.join() !== '-1,1') throw new Error('Hidden polygon ID: ' + afterPolygon);
    const body = field.promotion.promote(1);
    if (!body || body.desc.samples.length < 4) throw new Error('Road promotion failed');
    const afterBoth = [0, 1].map(id => field.promotion.pick(camera, ...point(id)));
    if (afterBoth.join() !== '-1,-1') throw new Error('Hidden road ID: ' + afterBoth);
    floaters.clear();
    const returned = [0, 1].map(id => field.promotion.pick(camera, ...point(id)));
    if (returned.join() !== '0,1') throw new Error('GPU field return failed: ' + returned);
    // Simulation attachments survive promotion/removal untouched.
    const data = new Float32Array(512 * 4); renderer.readRenderTargetPixels(field.sim.target, 0, 0, 512, 1, data);
    if (Math.abs(data[0] - 0.3) > 1e-6 || data[2] !== 1) throw new Error('Simulation state changed');
    const glError = gl.getError();
    field.clear(); seed.material.dispose(); renderer.dispose();
    return { gpu, before, afterPolygon, afterBoth, returned, glError };
  });
  assert.deepEqual(errors, []); assert.equal(result.glError, 0);
  console.log('PASS T5 tiny software-GPU smoke\n' + JSON.stringify(result, null, 2));
} finally { await browser.close(); }
