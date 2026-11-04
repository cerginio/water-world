// FD2: actual DOM gestures, deformed WebGL picking, held GPU states and lifecycle.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:5199/?tiles=story-8-frames-hibrid&tilesMode=drift');
  await page.waitForFunction(() => window.app?.tiles.interaction, {}, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/tiles/TileSim.js')).text();
    const THREE = await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const t = app.tiles;
    const update = t.update;
    window.driftSeconds = 0;
    t.update = function(dt, timer) { driftSeconds += Math.min(dt, this.sim?.profile.maxSteps / 240 || 0); return update.call(this, dt, timer); };
    window.fd2 = { THREE, read: (target, attachment = 0) => {
      const data = new Float32Array(target.width * target.height * 4);
      app.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data, 0, attachment);
      return data;
    }, find: () => {
      const data = fd2.read(t.sim.target);
      for (let id = 0; id < t.rest.tiles.count; id += 7) {
        const k = id * 4, f = t.frameRegistry.entries[t.rest.tiles.frameIndex[id]];
        const p = new THREE.Vector3(t.rest.tiles.x[id] + data[k + 2] + f.offset.x,
          t.rest.tiles.y0[id] + data[k] + t.rest.tiles.surfaceOffset[id],
          t.rest.tiles.z[id] + data[k + 3] + f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
        const x = (p.x + 1) * 700, y = (1 - p.y) * 500;
        if (x < 100 || x > 1000 || y < 200 || y > 850) continue;
        const hit = t.interaction.picker.pick(app.camera, x, y);
        if (hit && hit.frame.index === f.index) return { x, y, id, index: hit.frame.index, height: hit.height };
      }
      throw new Error('No visible tile hit');
    } };
    fd2.cpu = [];
    const interactionUpdate = t.interaction.update;
    t.interaction.update = function(dt) {
      const active = !!this.gesture?.dragged || !!this.settling, start = performance.now();
      const result = interactionUpdate.call(this, dt);
      if (active) fd2.cpu.push(performance.now() - start);
      return result;
    };
  });
  // Let the actual animation run: picking must follow geometry after drift has
  // separated it, rather than just working on the compact source layout.
  if (!process.env.FD2_SKIP_SOAK) await page.waitForFunction(() => driftSeconds >= 60, {}, { timeout: 240000 });
  report.driftSeconds = await page.evaluate(() => driftSeconds);
  console.log(JSON.stringify({ driftSeconds: report.driftSeconds }));
  report.pipelinePicking = await page.evaluate(() => {
    const t = app.tiles, data = fd2.read(t.sim.target), result = {};
    for (const kind of ['polygon', 'polyline']) {
      const hitFrames = new Set();
      for (const part of t.rest[kind]) {
        if (hitFrames.has(part.frameIndex)) continue;
        const ids = part.tile ?? part.aTile;
        for (let j = 0; j < Math.min(ids.length, 5); j++) {
          const id = ids[j], k = id * 4, f = t.frameRegistry.entries[part.frameIndex];
          const p = new fd2.THREE.Vector3(t.rest.tiles.x[id] + data[k + 2] + f.offset.x,
            t.rest.tiles.y0[id] + data[k] + t.rest.tiles.surfaceOffset[id],
            t.rest.tiles.z[id] + data[k + 3] + f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
          if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) continue;
          const hit = t.interaction.picker.pick(app.camera, (p.x + 1) * 700, (1 - p.y) * 500);
          if (hit?.frame.index === f.index) { hitFrames.add(f.index); break; }
        }
      }
      result[kind] = [...hitFrames];
    }
    return result;
  });
  assert.equal(report.pipelinePicking.polygon.length, 8);
  assert.equal(report.pipelinePicking.polyline.length, 8);
  const point = await page.evaluate(() => fd2.find());
  report.firstHit = point;
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  report.down = await page.evaluate(() => ({ state: app.tiles.interaction.state,
    cameraEnabled: app.controls.enabled, selected: app.tiles.interaction.selected.index }));
  assert.equal(report.down.state, 'selected'); assert.equal(report.down.cameraEnabled, false);
  await page.mouse.move(point.x + 12, point.y + 4);
  await page.waitForTimeout(200); // orbital fade completes in 125 ms
  await page.evaluate(() => {
    fd2.before = fd2.read(app.tiles.sim.target);
    fd2.runBefore = fd2.read(app.tiles.sim.runTarget);
    fd2.camera = app.camera.position.toArray();
    fd2.world = app.tiles.interaction.selected.world.toArray();
  });
  await page.mouse.move(point.x + 140, point.y + 50, { steps: 15 });
  await page.waitForTimeout(500);
  report.grabBeforeUp = await page.evaluate(({id,x,y})=>{
    const t=app.tiles,data=fd2.read(t.sim.target),k=id*4;
    const f=t.frameRegistry.entries[t.rest.tiles.frameIndex[id]];
    const p=new fd2.THREE.Vector3(t.rest.tiles.x[id]+data[k+2]+f.offset.x,
      t.rest.tiles.y0[id]+data[k]+t.rest.tiles.surfaceOffset[id],
      t.rest.tiles.z[id]+data[k+3]+f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
    return {error:Math.hypot((p.x+1)*700-(x+140),(1-p.y)*500-(y+50)),
      pending:t.interaction.placementQuery.pending,occupancy:!!t.interaction.gesture.occupancy,
      target:t.interaction.gesture.target.toArray(),world:f.world.toArray()};
  },point);
  await page.mouse.up(); await page.waitForTimeout(300);
  report.hold = await page.evaluate(() => {
    const t = app.tiles, f = t.interaction.selected, after = fd2.read(t.sim.target), run = fd2.read(t.sim.runTarget);
    let xz = 0, runError = 0;
    for (let i = 0; i < t.rest.tiles.count; i++) if (t.rest.tiles.frameIndex[i] === f.index) {
      for (const j of [2, 3]) xz = Math.max(xz, Math.abs(after[i * 4 + j] - fd2.before[i * 4 + j]));
    }
    for (let i = 0; i < t.sim.runCount; i++) if (t.sim.runRest.image.data[i * 4 + 2] === f.index)
      for (let j = 0; j < 4; j++) runError = Math.max(runError, Math.abs(run[i * 4 + j] - fd2.runBefore[i * 4 + j]));
    return { xz, runError, mode: f.mode, held: f.held, cameraDelta: Math.hypot(...app.camera.position.toArray().map((v, i) => v - fd2.camera[i])),
      movement: Math.hypot(f.world.x - fd2.world[0], f.world.z - fd2.world[2]), state: t.interaction.state,
      controls: app.controls.enabled, activePromotions: t.promotion.active.size };
  });
  assert.equal(report.hold.xz, 0); assert.equal(report.hold.runError, 0);
  assert.equal(report.hold.mode, 'placed'); assert.equal(report.hold.held, true);
  assert.ok(report.hold.cameraDelta < 1e-6); assert.ok(report.hold.movement > 1, JSON.stringify(report.hold));
  assert.equal(report.hold.controls, true); assert.equal(report.hold.activePromotions, 0);
  report.grabErrorPx = await page.evaluate(({ id, x, y }) => {
    const t = app.tiles, data = fd2.read(t.sim.target), k = id * 4;
    const f = t.frameRegistry.entries[t.rest.tiles.frameIndex[id]];
    const p = new fd2.THREE.Vector3(t.rest.tiles.x[id] + data[k + 2] + f.offset.x,
      t.rest.tiles.y0[id] + data[k] + t.rest.tiles.surfaceOffset[id],
      t.rest.tiles.z[id] + data[k + 3] + f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
    return Math.hypot((p.x + 1) * 700 - (x + 140), (1 - p.y) * 500 - (y + 50));
  }, point);
  assert.ok(report.grabErrorPx <= 5, `grab error ${report.grabErrorPx}; before up ${JSON.stringify(report.grabBeforeUp)}`);
  await page.screenshot({ path: join(tmpdir(), 'water-fd2-drag.png') });
  await page.waitForTimeout(600);
  const again = await page.evaluate(() => fd2.find());
  await page.mouse.move(again.x, again.y); await page.mouse.down();
  await page.evaluate(() => { fd2.cancelWorld = app.tiles.interaction.selected.world.toArray(); });
  await page.mouse.move(again.x + 70, again.y + 20, { steps: 5 });
  await page.waitForTimeout(100);
  report.cancel = await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    const t = app.tiles, f = t.interaction.selected;
    return { error: Math.hypot(...f.world.toArray().map((v, i) => v - fd2.cancelWorld[i])), controls: app.controls.enabled,
      gesture: !!t.interaction.gesture };
  });
  await page.mouse.up();
  assert.equal(report.cancel.error, 0); assert.equal(report.cancel.controls, true); assert.equal(report.cancel.gesture, false);
  report.pick = await page.evaluate(() => {
    const t = app.tiles, p = fd2.find(), samples = [];
    for (let i = 0; i < 25; i++) { t.interaction.picker.pick(app.camera, p.x, p.y); samples.push(t.interaction.picker.lastMs); }
    samples.sort((a, b) => a - b);
    return { p50: samples[12], p95: samples[23], bytes: t.interaction.picker.bytes,
      frameDraws: t.interaction.picker.proxies.filter(p => p.tile).length,
      originalParts: t.group.children.length };
  });
  report.interactionCpu = await page.evaluate(() => {
    const a = fd2.cpu.sort((x, y) => x - y);
    return { samples: a.length, p50: a[Math.floor(a.length * 0.5)], p95: a[Math.floor(a.length * 0.95)] };
  });
  report.releaseJump = await page.evaluate(() => {
    const t = app.tiles, f = t.interaction.selected, before = fd2.read(t.sim.target);
    t.interaction.cancel(); t.releaseFrame(f.id);
    t.sim.update(t.group.matrixWorld, 1e-7, t.params);
    const after = fd2.read(t.sim.target);
    let jump = 0;
    for (let i = 0; i < t.rest.tiles.count; i++) if (t.rest.tiles.frameIndex[i] === f.index)
      jump = Math.max(jump, Math.hypot(after[i * 4 + 2] - before[i * 4 + 2], after[i * 4 + 3] - before[i * 4 + 3]));
    return jump;
  });
  assert.ok(report.releaseJump < 0.02);
  await page.getByRole('button', { name: 'Відпустити у дрейф', exact: true }).click();
  assert.equal(await page.evaluate(() => app.tiles.interaction.selected.held), false);
  await page.getByRole('button', { name: 'reset', exact: true }).click();
  report.reset = await page.evaluate(() => app.tiles.frameRegistry.entries.every(f => !f.held && f.mode === 'inherited'));
  assert.equal(report.reset, true);
  // Right mouse over a tile is still OrbitControls pan.
  const right = await page.evaluate(() => fd2.find());
  const cameraBefore = await page.evaluate(() => app.camera.position.toArray());
  await page.mouse.move(right.x, right.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(right.x + 35, right.y + 15, { steps: 5 }); await page.mouse.up({ button: 'right' });
  report.rightPan = await page.evaluate(before => Math.hypot(...app.camera.position.toArray().map((v, i) => v - before[i])), cameraBefore);
  assert.ok(report.rightPan > 0.1);
  await page.mouse.move(700, 930);
  const emptyBefore = await page.evaluate(() => app.camera.position.toArray());
  await page.mouse.down(); await page.mouse.move(740, 930, { steps: 5 }); await page.mouse.up();
  report.emptyOrbit = await page.evaluate(before => Math.hypot(...app.camera.position.toArray().map((v, i) => v - before[i])), emptyBefore);
  assert.ok(report.emptyOrbit > 0.1);
  await page.evaluate(() => { app.views.Tiles(); app.controls.update(); });
  await page.waitForTimeout(500);
  const touch = await page.evaluate(() => fd2.find());
  const cdp = await page.context().newCDPSession(page);
  const first = { x: touch.x, y: touch.y, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  first.x += 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first] });
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, { x: first.x + 120, y: first.y, id: 2 }] });
  report.secondTouch = await page.evaluate(() => ({ gesture: !!app.tiles.interaction.gesture,
    controls: app.controls.enabled, mode: app.tiles.interaction.selected?.mode,
    position: app.camera.position.toArray() }));
  assert.equal(report.secondTouch.gesture, false); assert.equal(report.secondTouch.controls, true);
  assert.equal(report.secondTouch.mode, 'placed');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { ...first, x: first.x - 20 }, { x: first.x + 145, y: first.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  report.pinchMovement = await page.evaluate(before => Math.hypot(...app.camera.position.toArray().map((v, i) => v - before[i])), report.secondTouch.position);
  assert.ok(report.pinchMovement > 0.1);
  await page.evaluate(() => { app.tiles.reset(); app.views.Tiles(); app.controls.update(); });
  await page.waitForTimeout(700);
  // T5 receives a real double click; its second press does not start FD2 drag.
  const double = await page.evaluate(() => fd2.find());
  await page.mouse.dblclick(double.x, double.y);
  report.doubleClick = await page.evaluate(() => ({ promotions: app.tiles.promotion.active.size, gesture: !!app.tiles.interaction.gesture }));
  assert.equal(report.doubleClick.promotions, 1); assert.equal(report.doubleClick.gesture, false);
  await page.waitForTimeout(700);
  const unload = await page.evaluate(() => fd2.find());
  await page.mouse.move(unload.x, unload.y); await page.mouse.down();
  await page.mouse.move(unload.x + 30, unload.y + 10, { steps: 3 });
  assert.equal(await page.evaluate(() => !!app.tiles.interaction.gesture), true);
  await page.evaluate(() => app.tiles.load('none'));
  await page.mouse.up();
  report.none = await page.evaluate(() => ({ interaction: !!app.tiles.interaction, sim: !!app.tiles.sim, enabled: app.controls.enabled }));
  assert.deepEqual(report.none, { interaction: false, sim: false, enabled: true });
  await page.close(); // Mobile measurements get the GPU without a second scene.
  // DPR/CSS conversion and the mobile shader profile on the same desktop GPU.
  const mobile = await browser.newPage({ viewport: { width: 480, height: 850 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true });
  mobile.on('pageerror', e => errors.push(e.message));
  mobile.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await mobile.goto('http://localhost:5199/?tiles=story-8-frames-hibrid&mobile');
  await mobile.waitForFunction(() => window.app?.tiles.interaction, {}, { timeout: 60000 });
  await mobile.waitForTimeout(1500);
  report.mobileProfile = await mobile.evaluate(() => {
    const t = app.tiles, rect = app.renderer.domElement.getBoundingClientRect();
    let hit = null, point;
    for (let y = rect.height * 0.35; !hit && y < rect.height * 0.75; y += 18)
      for (let x = 30; !hit && x < rect.width - 30; x += 18) {
        hit = t.interaction.picker.pick(app.camera, x, y); point = { x, y };
      }
    if (!hit) throw new Error('No mobile profile hit');
    const samples = [];
    for (let i = 0; i < 25; i++) {
      t.interaction.picker.pick(app.camera, point.x, point.y); samples.push(t.interaction.picker.lastMs);
    }
    samples.sort((a, b) => a - b);
    return { point, profile: t.profile, p50: samples[12], p95: samples[23], dpr: devicePixelRatio,
      drawingWidth: app.renderer.domElement.width, cssWidth: rect.width };
  });
  assert.equal(report.mobileProfile.profile, 'mobile');
  report.errors = errors; assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, ...report }, null, 2));
} finally { await browser.close(); }
