// Real WebGL probe; run against npm run dev. PLAYWRIGHT_MODULE can point at an
// existing Playwright installation, so it need not be a product dependency.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const errors = [];
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('Multiple instances of Three.js')) errors.push(m.text()); });
  await page.goto(`${base}?tiles=story-8-frames-hibrid`);
  await page.waitForFunction(() => window.app?.tiles.sim, {}, { timeout: 60000 });
  await page.locator('button.lil-title').filter({ hasText: /^Waves$/ }).click();
  const wind = page.getByLabel('windSpeed', { exact: true });
  await wind.fill('25'); await wind.press('Enter'); await wind.blur();
  await page.waitForTimeout(1500);
  // Read actual MRT attachments. Capture buffer versions to detect CPU rewrites.
  report.state = await page.evaluate(() => {
    const t = app.tiles, s = t.sim, r = app.renderer;
    const h = new Float32Array(512 * s.height * 4), a = new Float32Array(h.length);
    r.readRenderTargetPixels(s.target, 0, 0, 512, s.height, h, 0, 0);
    r.readRenderTargetPixels(s.target, 0, 0, 512, s.height, a, 0, 1);
    window.tileProbeInitial = { h, versions: t.group.children.map((m) => [m.instanceMatrix?.version, m.geometry.attributes.normal.version]) };
    const out = { count: t.rest.tiles.count, polygon: 0, polyline: 0, min: Infinity, max: -Infinity, tilt: 0, nonfinite: 0, joints: 0, maxSeam: 0 };
    for (let i = 0; i < t.rest.tiles.count; i++) {
      out[t.rest.tiles.flags[i] ? 'polyline' : 'polygon']++;
      out.min = Math.min(out.min, h[i * 4]); out.max = Math.max(out.max, h[i * 4]);
      out.tilt = Math.max(out.tilt, Math.hypot(a[i * 4], a[i * 4 + 1]));
      if (!Number.isFinite(h[i * 4] + a[i * 4] + a[i * 4 + 1])) out.nonfinite++;
    }
    const deform = (part, v) => {
      const id = part.aTile[v], i = id * 4, o = part.aOffset;
      const x = o[v * 3], y = o[v * 3 + 1], z = o[v * 3 + 2];
      const cx = Math.cos(a[i]), sx = Math.sin(a[i]), cz = Math.cos(a[i + 1]), sz = Math.sin(a[i + 1]);
      return [t.rest.tiles.x[id] + cz*x - sz*cx*y + sz*sx*z,
        t.rest.tiles.y0[id] + h[i] + sz*x + cz*cx*y - cz*sx*z,
        t.rest.tiles.z[id] + sx*y + cx*z];
    };
    for (const part of t.rest.polyline) {
      const p = part.geometry.attributes.position, joints = new Map();
      for (let v = 0; v < p.count; v++) {
        const id = part.aTile[v], key = [t.rest.tiles.runId[id], p.getX(v), p.getY(v), p.getZ(v)].join(',');
        const first = joints.get(key);
        if (first === undefined) joints.set(key, v);
        else {
          out.joints++;
          const q = deform(part, v), f = deform(part, first);
          out.maxSeam = Math.max(out.maxSeam, Math.hypot(...q.map((x, k) => x - f[k])));
        }
      }
    }
    return out;
  });
  assert.equal(report.state.count, 46861);
  assert.equal(report.state.nonfinite, 0);
  assert.ok(report.state.polygon > 0 && report.state.polyline > 0);
  assert.ok(report.state.max - report.state.min > 0.1 && report.state.tilt > 0.01);
  assert.ok(report.state.joints > 0 && report.state.maxSeam < 1e-5);
  await page.waitForTimeout(800);
  report.motion = await page.evaluate(() => {
    const t = app.tiles, s = t.sim, a = new Float32Array(512 * s.height * 4);
    app.renderer.readRenderTargetPixels(s.target, 0, 0, 512, s.height, a);
    const changed = { polygon: 0, polyline: 0 };
    for (let i = 0; i < t.rest.tiles.count; i++) {
      if (Math.abs(a[i * 4] - tileProbeInitial.h[i * 4]) > 0.001) changed[t.rest.tiles.flags[i] ? 'polyline' : 'polygon']++;
    }
    return { changed, versions: t.group.children.map((m) => [m.instanceMatrix?.version, m.geometry.attributes.normal.version]),
      before: tileProbeInitial.versions, cpuSubmitMs: t.cpuMs, gpuMs: app.timer.ms.tiles };
  });
  assert.ok(report.motion.changed.polygon > 0 && report.motion.changed.polyline > 0);
  assert.deepEqual(report.motion.versions, report.motion.before);
  delete report.motion.versions; delete report.motion.before;
  await page.screenshot({ path: join(tmpdir(), 'tile-t1-field.png') });

  // A rotated field must query WORLD coordinates, with normals in field axes.
  const yaw = page.getByLabel('fieldYaw', { exact: true });
  await yaw.fill('57'); await yaw.press('Enter'); await yaw.blur();
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Aerial' });
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Tiles' });
  report.worldQuery = await page.evaluate(async () => {
    const { WaterQuery } = await import('/src/water/WaterQuery.js');
    const t = app.tiles;
    app.controls.update();
    t.update();
    const ids = [0, 200, t.rest.tiles.count - 1], pts = new Float32Array(ids.length * 10);
    const matrix = t.group.matrixWorld.elements;
    ids.forEach((id, k) => {
      const x = t.rest.tiles.x[id], z = t.rest.tiles.z[id];
      const e = Math.max(0.7 * t.rest.tiles.radius[id], 0.1);
      const offsets = [[0,0], [e,0], [-e,0], [0,e], [0,-e]];
      offsets.forEach(([dx,dz], j) => {
        pts[k*10+j*2] = matrix[0]*(x+dx) + matrix[8]*(z+dz) + matrix[12];
        pts[k*10+j*2+1] = matrix[2]*(x+dx) + matrix[10]*(z+dz) + matrix[14];
      });
    });
    const state = new Float32Array(512 * t.sim.height * 4);
    app.renderer.readRenderTargetPixels(t.sim.target, 0, 0, 512, t.sim.height, state);
    const angles = new Float32Array(state.length);
    app.renderer.readRenderTargetPixels(t.sim.target, 0, 0, 512, t.sim.height, angles, 0, 1);
    const query = new WaterQuery(app.renderer, app.surface, ids.length * 5);
    const target = app.renderer.getRenderTarget();
    query.submit(pts, ids.length * 5, 0, 0);
    app.renderer.setRenderTarget(target);
    const deadline = performance.now() + 10000;
    while (query.inFlight && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const maxError = Math.max(...ids.map((id, k) => Math.abs(state[id * 4] - query.result[k * 20])));
    const maxNormalError = Math.max(...ids.map((id, k) => {
      const q = query.result, e = Math.max(0.7 * t.rest.tiles.radius[id], 0.1), i = k * 20;
      const sx = (q[i+4] - q[i+8]) / (2*e), sz = (q[i+12] - q[i+16]) / (2*e);
      const normal = [-sx, 1, -sz], length = Math.hypot(...normal);
      const tx = angles[id*4], tz = angles[id*4+1];
      const actual = [-Math.sin(tz)*Math.cos(tx), Math.cos(tz)*Math.cos(tx), Math.sin(tx)];
      return Math.hypot(...actual.map((v,j) => v - normal[j]/length));
    }));
    query.input.dispose(); query.target.dispose(); query.quad.material.dispose();
    return { samples: query.resultCount, maxError, maxNormalError };
  });
  assert.equal(report.worldQuery.samples, 15);
  assert.ok(report.worldQuery.maxError < 0.002);
  assert.ok(report.worldQuery.maxNormalError < 0.005);

  // Frame filtering goes through the same visible control as manual QA.
  const frame = page.getByLabel('frame', { exact: true });
  await frame.selectOption({ label: '2' });
  await page.waitForFunction(() => app.tiles.sim && app.tiles.rest.tiles.count === 3978);
  report.frame = await page.evaluate(() => ({ count: app.tiles.rest.tiles.count, size: [app.tiles.sim.target.width, app.tiles.sim.target.height] }));
  assert.deepEqual(report.frame.size, [512, 8]);
  await frame.selectOption({ label: 'all' });
  await page.waitForFunction(() => app.tiles.sim && app.tiles.rest.tiles.count === 46861);
  const scale = page.getByLabel('metersPerSourceUnit', { exact: true });
  await scale.fill('0.1'); await scale.press('Enter'); await scale.blur();
  await page.waitForFunction(() => app.tiles.sim && app.tiles.compiled.space.unit === 0.1);
  report.scale = await page.evaluate(() => ({ count: app.tiles.rest.tiles.count, width: app.tiles.extent.x }));
  assert.equal(report.scale.count, 46861);
  assert.ok(report.scale.width > 160);
  await scale.fill('0.05'); await scale.press('Enter'); await scale.blur();
  await page.waitForFunction(() => app.tiles.sim && app.tiles.compiled.space.unit === 0.05);
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Aerial' });
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Tiles' });
  await page.screenshot({ path: join(tmpdir(), 'tile-t1-rotated.png') });

  // Compare render submission on the same scene against the T0 static material
  // path, interleaving rounds. GPU fence wait is outside these CPU measurements.
  report.cpu = await page.evaluate(async () => {
    const t = app.tiles, dynamic = t.group.children.map((m) => m.material);
    const fixed = dynamic.map((m) => { const c = m.clone(); app.terrain.patchProp(c); return c; });
    const update = t.update;
    const setMode = (moving) => {
      t.update = moving ? update : () => {};
      t.group.children.forEach((m, i) => {
        m.material = (moving ? dynamic : fixed)[i];
        if (!m.isInstancedMesh) m.position.y = moving ? 0 : t.rest.polyline[i - t.rest.polygon.length].baseY;
      });
    };
    const measure = () => new Promise((resolve) => {
      const begin = app.timer.beginFrame, end = app.timer.endFrame, samples = [];
      let start, count = 0;
      app.timer.beginFrame = function () { start = performance.now(); return begin.call(this); };
      app.timer.endFrame = function () {
        end.call(this); if (++count > 30) samples.push(performance.now() - start);
        if (samples.length === 90) {
          this.beginFrame = begin; this.endFrame = end;
          samples.sort((a,b) => a-b);
          resolve(samples.slice(9,81).reduce((a,b) => a+b,0)/72);
        }
      };
    });
    const moving = [], staticMs = [];
    for (let i = 0; i < 4; i++) { setMode(i % 2 === 0); (i % 2 === 0 ? moving : staticMs).push(await measure()); }
    setMode(true); fixed.forEach((m) => m.dispose());
    const mean = (a) => a.reduce((x,y) => x+y,0)/a.length;
    return { moving, staticMs, delta: mean(moving) - mean(staticMs) };
  });
  // Timing is reported separately: a noisy host should not hide correctness results.
  report.cpu.withinBudget = report.cpu.delta <= 0.5;
  const noneRequests = [];
  page.on('request', (req) => { if (req.url().includes('/@fs/') && req.url().includes('/tilecraft/')) noneRequests.push(req.url()); });
  await page.goto(`${base}?tiles=none`);
  await page.waitForFunction(() => window.app?.tiles && app.ocean.time > 0);
  report.none = await page.evaluate(() => ({ loaded: app.tiles.loaded, sim: !!app.tiles.sim, children: app.tiles.group.children.length }));
  assert.deepEqual(report.none, { loaded: false, sim: false, children: 0 });
  assert.deepEqual(noneRequests, []);
  report.errors = errors;
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
