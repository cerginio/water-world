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
      return [t.rest.tiles.x[id] + h[i+2] + cz*x - sz*cx*y + sz*sx*z,
        t.rest.tiles.y0[id] + h[i] + sz*x + cz*cx*y - cz*sx*z,
        t.rest.tiles.z[id] + h[i+3] + sx*y + cx*z];
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
  await page.screenshot({ path: join(tmpdir(), 'tile-t2-field.png') });

  // WaterQuery is independent of TileSim's state/history implementation. Freeze
  // tile updates and compare the sampled centre at the actual displaced position.
  const yaw = page.getByLabel('fieldYaw', { exact: true });
  await yaw.fill('57'); await yaw.press('Enter'); await yaw.blur();
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Aerial' });
  await page.getByLabel('camera', { exact: true }).selectOption({ label: 'Tiles' });
  report.worldQuery = await page.evaluate(async () => {
    const { WaterQuery } = await import('/src/water/WaterQuery.js');
    const t = app.tiles, update = t.update;
    t.update = () => {};
    try {
      const ids = [0, 200, t.rest.tiles.count - 1];
      const read = (attachment) => {
        const a = new Float32Array(512 * t.sim.height * 4);
        app.renderer.readRenderTargetPixels(t.sim.target, 0, 0, 512, t.sim.height, a, 0, attachment);
        return a;
      };
      const before = read(0), matrix = t.group.matrixWorld.elements;
      const pts = new Float32Array(ids.length * 2);
      ids.forEach((id, k) => {
        const x = t.rest.tiles.x[id] + before[id*4+2], z = t.rest.tiles.z[id] + before[id*4+3];
        pts[k*2] = matrix[0]*x + matrix[8]*z + matrix[12];
        pts[k*2+1] = matrix[2]*x + matrix[10]*z + matrix[14];
      });
      update.call(t, 1/60);
      const state2 = read(2), state3 = read(3);
      const query = new WaterQuery(app.renderer, app.surface, ids.length);
      try {
        const target = app.renderer.getRenderTarget();
        query.submit(pts, ids.length, 0, 0);
        app.renderer.setRenderTarget(target);
        while (query.inFlight) await new Promise((r) => setTimeout(r, 10));
        return { samples: query.resultCount, maxError: Math.max(...ids.flatMap((id,k) => [
          Math.abs(state3[id*4] - query.result[k*4]),
          Math.abs(state2[id*4+2] - query.result[k*4+1]),
          Math.abs(state2[id*4+3] - query.result[k*4+2]),
        ])) };
      } finally { query.input.dispose(); query.target.dispose(); query.quad.material.dispose(); }
    } finally { t.update = update; }
  });
  assert.equal(report.worldQuery.samples, 3);
  assert.ok(report.worldQuery.maxError < 0.002);

  report.physics = await page.evaluate(async () => {
    const source = await (await fetch('/src/tiles/TileSim.js')).text();
    const THREE = await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const { TileSim } = await import('/src/tiles/TileSim.js');
    // A controlled flat surface uses the real waterAt and GPU integration, with
    // zero FFT displacement, no shore wave and no impacts. Analytic oracle:
    // centre height = h * (1/2 - density / (rhoWater * buoyancy)).
    const zero = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    zero.needsUpdate = true;
    const uniforms = { ...app.surface.uniforms };
    for (const name of ['uDisp0', 'uDisp1', 'uDisp2']) uniforms[name] = { value: zero };
    uniforms.uShoreWave = { value: new THREE.Vector4() };
    uniforms.uImpact = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0,0,1e9,0)) };
    const tiles = { count: 4, x: [0,1,2,3], z: [0,0,0,0], yaw: [0,0.4,1,2],
      radius: [0.4,0.1,0,0.01], y0: [0,0.08,-0.1,0], thickness: [0.3,0.1,0.01,0.002],
      runId: [-1,-1,-1,-1], flags: [0,0,0,0] };
    const sim = new TileSim(app.renderer, { uniforms }, tiles);
    const matrix = new THREE.Matrix4().makeTranslation(app.tiles.center.x, 0, app.tiles.center.z);
    const p = { ...app.tiles.params, orbit: 0 };
    const read = (attachment, target = sim.target) => {
      const a = new Float32Array(512*4);
      app.renderer.readRenderTargetPixels(target, 0, 0, 512, 1, a, 0, attachment);
      return Array.from(a.slice(0, tiles.count*4));
    };
    const settle = (density, dt) => {
      p.density = density; sim.reset();
      for (let i = 0; i < Math.ceil(48/Math.min(dt, 8/240)); i++) sim.update(matrix, dt, p);
      const state = read(0);
      return tiles.thickness.map((h,i) => ({ y: state[i*4] + tiles.y0[i],
        expected: h*(0.5-density/(1025*p.buoyancy)), vy: state[i*4+1] }));
    };
    try {
      const dense = settle(900, 1/60), light = settle(200, 1/60);
      const slowFrame = settle(500, 0.5);
      p.buoyancy = 1.5;
      const boosted = settle(500, 1/60);
      p.buoyancy = 1;
      // A displaced anchor must return, rather than merely clamp its position.
      sim.reset();
      const seedData = new Float32Array(512*4);
      for (let i = 0; i < tiles.count; i++) seedData.set([0,0,3,4], i*4);
      const seed = new THREE.DataTexture(seedData, 512, 1, THREE.RGBAFormat, THREE.FloatType);
      seed.needsUpdate = true;
      const springPeriods = [];
      for (const period of [0.5, 4, 20]) {
        sim.reset(); sim.uniforms.uState0.value = seed; p.anchorPeriod = period;
        for (let i = 0; i < Math.ceil(3*period*60); i++) sim.update(matrix, 1/60, p);
        const state = read(0);
        springPeriods.push({ period, remaining: Math.hypot(state[2],state[3]) });
      }
      seed.dispose(); p.anchorPeriod = 4;
      // Reset zeros all four attachments in BOTH targets, immediately.
      sim.reset();
      const resetMax = Math.max(...sim.targets.flatMap((t) => [0,1,2,3].flatMap((i) => read(i,t))).map(Math.abs));
      // A first sample with non-zero constant displacement has zero water velocity.
      zero.image.data.set([0, 2, 0, 0]); zero.needsUpdate = true;
      sim.update(matrix, 1/240, p);
      const first = read(0)[1];
      const expectedFirstVy = (1025/500-1)*9.81/240;
      // Poison one input attachment, recover to rest, then restart with fresh history.
      const poisonedData = new Float32Array(512*4).fill(NaN);
      poisonedData[0] = Infinity;
      const poison = new THREE.DataTexture(poisonedData, 512, 1, THREE.RGBAFormat, THREE.FloatType);
      poison.needsUpdate = true;
      sim.uniforms.uState1.value = poison;
      sim.update(matrix, 1/60, p);
      const recoveryMax = Math.max(...[0,1,2,3].flatMap((i) => read(i)).map(Math.abs));
      poison.dispose();
      sim.update(matrix, 1/60, p);
      const recoveredFinite = [0,1,2,3].flatMap((i) => read(i)).every(Number.isFinite);
      return { dense, light, slowFrame, boosted, springPeriods, resetMax, first, expectedFirstVy, recoveryMax, recoveredFinite };
    } finally { sim.dispose(); zero.dispose(); }
  });
  for (const result of [report.physics.dense, report.physics.light, report.physics.slowFrame, report.physics.boosted]) {
    for (const tile of result) {
      assert.ok(Math.abs(tile.y - tile.expected) < 0.003, JSON.stringify(tile));
      assert.ok(Math.abs(tile.vy) < 0.005, JSON.stringify(tile));
    }
  }
  assert.equal(report.physics.resetMax, 0);
  assert.equal(report.physics.recoveryMax, 0);
  assert.equal(report.physics.recoveredFinite, true);
  for (const spring of report.physics.springPeriods) assert.ok(spring.remaining < 0.001, JSON.stringify(spring));
  assert.ok(Math.abs(report.physics.first - report.physics.expectedFirstVy) < 1e-5);

  // Exercise the same visible controls as QA, in addition to the isolated fixture.
  await page.evaluate(() => {
    const t = app.tiles, reset = t.reset;
    window.tileResetChecks = [];
    t.reset = function () {
      reset.call(this);
      let max = 0;
      for (const target of this.sim.targets) for (let i = 0; i < 4; i++) {
        const data = new Float32Array(512*this.sim.height*4);
        app.renderer.readRenderTargetPixels(target,0,0,512,this.sim.height,data,0,i);
        for (const v of data) max = Math.max(max,Math.abs(v));
      }
      tileResetChecks.push(max);
    };
  });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'reset', exact: true }).click();
    await page.waitForTimeout(1500);
  }
  assert.deepEqual(await page.evaluate(() => tileResetChecks), [0,0,0]);
  const orbitControl = page.getByLabel('orbit', { exact: true });
  await orbitControl.fill('0'); await orbitControl.press('Enter'); await orbitControl.blur();
  await page.waitForTimeout(5000);
  report.orbitOff = await page.evaluate(() => {
    const t = app.tiles, data = new Float32Array(512*t.sim.height*4);
    app.renderer.readRenderTargetPixels(t.sim.target,0,0,512,t.sim.height,data);
    let max = 0;
    for (let i = 0; i < t.rest.tiles.count; i++) max = Math.max(max,Math.hypot(data[i*4+2],data[i*4+3]));
    return max;
  });
  assert.ok(report.orbitOff < 0.001);
  await orbitControl.fill('1'); await orbitControl.press('Enter'); await orbitControl.blur();

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
  await page.screenshot({ path: join(tmpdir(), 'tile-t2-rotated.png') });

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
