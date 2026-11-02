// Software-GPU regression for polygons and strips: waves, tiny tiles and density changes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const waves = `const WATER_GLSL = \`uniform float uTestTime, uTestAmplitude;
    vec3 waterAt(vec2 q, vec3 unused) {
      return vec3(0.0, uTestAmplitude*(0.45*sin(0.9*q.x-1.5*uTestTime)
        + 0.15*sin(2.2*q.x+2.5*uTestTime)), 0.0);
    }\`;`;
  const source = await readFile(new URL('../src/tiles/TileSim.js', import.meta.url), 'utf8');
  const withWaves = s => s.replace(/import \{ WATER_GLSL \} from [^;]+;/, waves);
  await page.route('**/src/tiles/TileSim-strip-test.js', r => r.fulfill({
    contentType: 'application/javascript', body: withWaves(source)
      .replaceAll("'three'", "'/node_modules/.vite/deps/three.js'"),
  }));
  if (process.env.TILES_BASELINE) {
    const baseline = await readFile(process.env.TILES_BASELINE, 'utf8');
    await page.route('**/src/tiles/TileSim-strip-before.js', r => r.fulfill({
      contentType: 'application/javascript', body: withWaves(baseline)
        .replaceAll("'three'", "'/node_modules/.vite/deps/three.js'"),
    }));
  }
  await page.route('**/__strip_probe__', r => r.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Strip regression</title>',
  }));
  await page.goto('http://localhost:5199/__strip_probe__');
  const result = await page.evaluate(async compare => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { TileSim } = await import('/src/tiles/TileSim-strip-test.js');
    const Before = compare ? (await import('/src/tiles/TileSim-strip-before.js')).TileSim : null;
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(16, 16);
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (!gpu.includes('SwiftShader')) throw Error('Expected software GPU');
    const count = 48;
    const tiles = { count, x: [], z: [], yaw: [], radius: [], y0: [], thickness: [], runId: [], flags: [] };
    for (let i = 0; i < count; i++) {
      tiles.x.push(i * 0.2); tiles.z.push(0); tiles.yaw.push(0);
      tiles.radius.push(i < 32 ? (i % 8 ? 0.2 : 0) : [0.0001, 0.01, 0.2, 1][i % 4]);
      tiles.y0.push(i % 2 ? 0.5 : -0.5);
      tiles.thickness.push(0.32); tiles.runId.push(i < 32 ? 0 : -1); tiles.flags.push(i < 32 ? 1 : 0);
    }
    const surface = { uniforms: { uTestTime: { value: 0 }, uTestAmplitude: { value: 1 } } };
    const runs = [{ tiles: Array.from({ length: 32 }, (_, i) => i) }];
    const sims = [new TileSim(renderer, surface, tiles, runs)];
    if (Before) sims.push(new Before(renderer, surface, tiles, runs));
    const p = { density: 480, buoyancy: 1.9, drag: 0, angularDrag: 0.8,
      orbit: 1, anchorPeriod: 4, mode: 'drift', windage: 0.02, driftRadius: 400 };
    const buffers = sims.map(() => [new Float32Array(512 * 4), new Float32Array(512 * 4)]);
    const stats = sims.map(() => ({ neighborHeight: 0, tilt: 0, trackingError: 0, finite: true,
      polygonTilt: 0, polygonTrackingError: 0, polygonSpeed: 0 }));
    let horizontalDifference = 0;
    const dt = 1 / 30, matrix = new THREE.Matrix4();
    const settings = [[480,1.9,0], [100,1,1.6], [100,1,0], [750,1,1.6], [480,1.9,0], [1000,1,1.6]];
    for (let frame = 0; frame < 1080; frame++) {
      const t = (frame + 1) * dt;
      surface.uniforms.uTestTime.value = t;
      [p.density, p.buoyancy, p.drag] = settings[Math.floor(frame / 180)];
      for (let n = 0; n < sims.length; n++) {
        const sim = sims[n], [a, b] = buffers[n];
        sim.update(matrix, dt, p);
        // Read each tiny pass immediately: no benchmark-style command backlog.
        renderer.readRenderTargetPixels(sim.target, 0, 0, 512, 1, a, 0, 0);
        renderer.readRenderTargetPixels(sim.target, 0, 0, 512, 1, b, 0, 1);
        stats[n].finite &&= [...a, ...b].every(Number.isFinite);
        if (frame < 90) continue;
        for (let i = 0; i < count; i++) {
          const y = tiles.y0[i] + a[4 * i];
          const eta = 0.45 * Math.sin(0.9 * tiles.x[i] - 1.5 * t)
            + 0.15 * Math.sin(2.2 * tiles.x[i] + 2.5 * t);
          const draft = 0.32 * (0.5 - p.density / (1025 * p.buoyancy));
          if (i >= 32) {
            stats[n].polygonTrackingError = Math.max(stats[n].polygonTrackingError, Math.abs(y - eta - draft));
            stats[n].polygonTilt = Math.max(stats[n].polygonTilt, Math.hypot(b[4 * i], b[4 * i + 1]));
            stats[n].polygonSpeed = Math.max(stats[n].polygonSpeed, Math.abs(a[4 * i + 1]));
          } else {
            stats[n].trackingError = Math.max(stats[n].trackingError, Math.abs(y - eta - draft));
            stats[n].tilt = Math.max(stats[n].tilt, Math.hypot(b[4 * i], b[4 * i + 1]));
          }
          if (i && i < 32) stats[n].neighborHeight = Math.max(stats[n].neighborHeight,
            Math.abs(y - tiles.y0[i - 1] - a[4 * (i - 1)]));
        }
      }
      if (sims.length > 1) for (let i = 0; i < count; i++) {
        for (const channel of [2,3]) horizontalDifference = Math.max(horizontalDifference,
          Math.abs(buffers[0][0][4*i+channel] - buffers[1][0][4*i+channel]));
      }
    }
    // Flat-water draft oracle: low-density polygons settle instead of launching.
    surface.uniforms.uTestAmplitude.value = 0;
    p.density = 100; p.buoyancy = 1; p.drag = 1.6;
    for (let i = 0; i < 120; i++) sims[0].update(matrix, dt, p);
    renderer.readRenderTargetPixels(sims[0].target, 0, 0, 512, 1, buffers[0][0]);
    renderer.readRenderTargetPixels(sims[0].target, 0, 0, 512, 1, buffers[0][1], 0, 1);
    let flatDraftError = 0, flatTilt = 0;
    for (let i = 0; i < count; i++) {
      flatDraftError = Math.max(flatDraftError, Math.abs(tiles.y0[i] + buffers[0][0][4*i] - 0.32*(0.5-100/1025)));
      flatTilt = Math.max(flatTilt, Math.hypot(buffers[0][1][4*i],buffers[0][1][4*i+1]));
    }
    // Both types still sink with insufficient buoyancy (values inside GUI limits).
    p.density = 1000; p.buoyancy = 0.5; p.drag = 0;
    sims[0].reset();
    for (let i = 0; i < 90; i++) sims[0].update(matrix, dt, p);
    renderer.readRenderTargetPixels(sims[0].target, 0, 0, 512, 1, buffers[0][0]);
    const sunk = buffers[0][0][0];
    const polygonSunk = buffers[0][0][128];
    sims[0].reset();
    renderer.readRenderTargetPixels(sims[0].target, 0, 0, 512, 1, buffers[0][0]);
    const resetMax = Math.max(...buffers[0][0].map(Math.abs));
    const glError = gl.getError();
    sims.forEach(s => s.dispose()); renderer.dispose();
    return { gpu, stats, horizontalDifference, flatDraftError, flatTilt, sunk, polygonSunk, resetMax, glError };
  }, Boolean(process.env.TILES_BASELINE));
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  assert.ok(result.stats[0].finite);
  assert.ok(result.stats[0].neighborHeight < 0.2);
  // Includes the instant draft-target change when controls jump between extremes.
  assert.ok(result.stats[0].trackingError < 0.4);
  assert.ok(result.stats[0].tilt <= 20 * Math.PI / 180 + 1e-6);
  assert.ok(result.stats[0].polygonTrackingError < 0.4);
  assert.ok(result.stats[0].polygonTilt <= 20 * Math.PI / 180 + 1e-6);
  assert.ok(result.stats[0].polygonSpeed < 2);
  assert.equal(result.horizontalDifference, 0);
  assert.ok(result.flatDraftError < 1e-5);
  assert.ok(result.flatTilt < 1e-5);
  assert.ok(result.sunk < -2);
  assert.ok(result.polygonSunk < -2);
  assert.equal(result.resetMax, 0);
  assert.equal(result.glError, 0);
  // Real LCR topology: measure rendered triangle-edge extension, not just seams.
  const actual = await page.evaluate(async () => {
    await import('/@vite/env');
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { TileSim } = await import('/src/tiles/TileSim-strip-test.js');
    const { fetchTileSource, compileTileSource } = await import('/src/tiles/tilecraftLoader.js');
    const { collectTileRest } = await import('/src/tiles/tileRest.js');
    const compiled = await compileTileSource(await fetchTileSource('story-8-frames-hibrid'));
    const rest = collectTileRest(compiled);
    compiled.scope.dispose();
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(16, 16);
    const surface = { uniforms: { uTestTime: { value: 0 }, uTestAmplitude: { value: 1 } } };
    const sim = new TileSim(renderer, surface, rest.tiles, rest.runs);
    const p = { density: 480, buoyancy: 1.9, drag: 0, angularDrag: 0.8,
      orbit: 1, anchorPeriod: 4, mode: 'drift', windage: 0.02, driftRadius: 400 };
    const a = new Float32Array(512 * sim.height * 4), b = new Float32Array(a.length);
    for (let i = 0; i < 180; i++) {
      surface.uniforms.uTestTime.value = (i + 1) / 30;
      if (i === 90) p.density = 100;
      sim.update(new THREE.Matrix4(), 1 / 30, p);
      renderer.readRenderTargetPixels(sim.target, 0, 0, 512, sim.height, a, 0, 0);
    }
    renderer.readRenderTargetPixels(sim.target, 0, 0, 512, sim.height, b, 0, 1);
    let maxExtension = 0, maxSeam = 0, edges = 0, worstEdge;
    const objects = [];
    for (const road of rest.polyline) {
      const positions = road.geometry.getAttribute('position');
      const points = [], joints = new Map();
      for (let v = 0; v < road.aTile.length; v++) {
        const id = road.aTile[v], k = id * 4, t = rest.tiles;
        const offset = new THREE.Vector3().fromArray(road.aOffset, v * 3);
        offset.applyMatrix4(new THREE.Matrix4().makeRotationX(b[k]));
        offset.applyMatrix4(new THREE.Matrix4().makeRotationZ(b[k + 1]));
        const point = offset.add(new THREE.Vector3(t.x[id] + a[k + 2], t.y0[id] + a[k], t.z[id] + a[k + 3]));
        points.push(point);
        const key = `${t.runId[id]}:${positions.getX(v)},${positions.getY(v)},${positions.getZ(v)}`;
        if (joints.has(key)) maxSeam = Math.max(maxSeam, point.distanceTo(joints.get(key)));
        else joints.set(key, point);
      }
      const index = road.geometry.index;
      for (let j = 0; j < index.count; j += 3) for (let e = 0; e < 3; e++) {
        const u = index.getX(j + e), v = index.getX(j + (e + 1) % 3);
        const before = Math.hypot(positions.getX(u) - positions.getX(v),
          positions.getY(u) - positions.getY(v), positions.getZ(u) - positions.getZ(v));
        const extension = points[u].distanceTo(points[v]) - before;
        if (extension > maxExtension) {
          maxExtension = extension;
          worstEdge = { before, after: points[u].distanceTo(points[v]),
            owner: [road.aTile[u], road.aTile[v]],
            offset: [Array.from(road.aOffset.slice(u*3,u*3+3)),Array.from(road.aOffset.slice(v*3,v*3+3))] };
        }
        edges++;
      }
      const geometry = road.geometry.clone();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(v => v.toArray()), 3));
      geometry.computeVertexNormals();
      objects.push(new THREE.Mesh(geometry, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })));
    }
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x293847);
    objects.forEach(m => scene.add(m));
    const box = new THREE.Box3().setFromObject(scene), center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(45, 1000 / 650, 0.1, 3000);
    camera.position.copy(center).add(new THREE.Vector3(0, Math.max(size.x, size.z) * 0.8, Math.max(size.x, size.z) * 0.65));
    camera.lookAt(center);
    renderer.setSize(1000, 650); document.body.appendChild(renderer.domElement);
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL();
    objects.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    rest.polygon.forEach(r => r.geometry.dispose()); rest.polyline.forEach(r => r.geometry.dispose());
    const glError = renderer.getContext().getError(); sim.dispose(); renderer.dispose();
    return { count: rest.tiles.count, runs: rest.runs.length, edges, maxExtension, maxSeam, worstEdge, glError, image };
  });
  const { image: preview, ...actualStats } = actual;
  if (process.env.TILES_PREVIEW) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.TILES_PREVIEW, Buffer.from(preview.split(',')[1], 'base64'));
  }
  console.log(JSON.stringify({ actual: actualStats }, null, 2));
  assert.equal(actual.maxSeam, 0);
  assert.ok(actual.maxExtension < 0.5, 'LCR triangle-edge extension exceeded 0.5 m');
  assert.equal(actual.glError, 0);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
