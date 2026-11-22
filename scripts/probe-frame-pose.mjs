// Real WebGL and visible-control checks for FD1. Run against npm run dev.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [], report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${process.env.TILES_URL ?? 'http://localhost:5199/'}?tiles=story-8-frames-hibrid`);
  await page.waitForFunction(() => window.app?.tiles.sim, {}, { timeout: 60000 });
  await page.waitForTimeout(1500);
  report.move = await page.evaluate(() => {
    const t = app.tiles;
    const update = t.update;
    t.update = () => {}; // freeze time, not the coordinate transforms under test
    const read = () => t.sim.target.textures.map((_, i) => {
      const data = new Float32Array(512 * t.sim.height * 4);
      app.renderer.readRenderTargetPixels(t.sim.target, 0, 0, 512, t.sim.height, data, 0, i);
      return data;
    });
    const before = read(), versions = t.group.children.map(m => m.instanceMatrix?.version);
    const frame = t.frameRegistry.get(t.frames[2]), world = frame.world.clone();
    const positions = t.group.children.map(m => m.position.clone());
    t.moveFrame(frame.id, world.x + 20, world.z);
    const after = read();
    let stateChange = 0, otherMovement = 0, movedParts = 0;
    before.forEach((data, k) => data.forEach((v, i) => { stateChange = Math.max(stateChange, Math.abs(v - after[k][i])); }));
    t.boundsEntries.forEach((entry, i) => {
      const delta = entry.mesh.position.distanceTo(positions[i]);
      if (entry.frameIndex === frame.index) { if (Math.abs(delta - 20) < 1e-8) movedParts++; }
      else otherMovement = Math.max(otherMovement, delta);
    });
    window.fd1 = { id: frame.id, world: frame.world.toArray(), before, update };
    const bits = t.sim.rest1.image.data;
    const packed = Array.from({ length: t.rest.tiles.count }, (_, i) => (bits[i * 4 + 3] >> 2) === t.rest.tiles.frameIndex[i]).every(Boolean);
    return { id: frame.id, stateChange, otherMovement, movedParts,
      expectedParts: t.boundsEntries.filter(e => e.frameIndex === frame.index).length,
      packed, buffersUnchanged: versions.every((v, i) => v === t.group.children[i].instanceMatrix?.version),
      mode: frame.mode };
  });
  assert.equal(report.move.stateChange, 0); assert.equal(report.move.otherMovement, 0);
  assert.ok(report.move.movedParts > 1); assert.equal(report.move.movedParts, report.move.expectedParts);
  assert.equal(report.move.packed, true); assert.equal(report.move.buffersUnchanged, true);
  assert.equal(report.move.mode, 'placed');

  const yaw = page.getByLabel('fieldYaw', { exact: true });
  await yaw.fill('45'); await yaw.press('Enter'); await yaw.blur();
  report.yaw = await page.evaluate(() => {
    const t = app.tiles, f = t.frameRegistry.get(fd1.id);
    return { worldError: f.world.distanceTo({ x: fd1.world[0], y: 0, z: fd1.world[2] }),
      renderedPivot: f.pivot.clone().add(f.offset).applyMatrix4(t.group.matrixWorld).toArray(),
      world: f.world.toArray(), yaw: t.params.fieldYaw,
      shadows: t.boundsEntries.every(e => !e.proxy || e.mesh.position.equals(e.proxy.position)) };
  });
  assert.equal(report.yaw.yaw, 45); assert.ok(report.yaw.worldError < 1e-8);
  assert.ok(Math.hypot(...report.yaw.renderedPivot.map((v, i) => v - report.yaw.world[i])) < 1e-8);
  assert.equal(report.yaw.shadows, true);
  report.worldQuery = await page.evaluate(async () => {
    const { WaterQuery } = await import('/src/water/WaterQuery.js');
    const t = app.tiles, f = t.frameRegistry.get(fd1.id);
    const ids = [0, 1].map(flag => Array.from({ length: t.rest.tiles.count }, (_, i) => i)
      .find(i => t.rest.tiles.frameIndex[i] === f.index && t.rest.tiles.flags[i] === flag));
    const read = attachment => {
      const a = new Float32Array(512 * t.sim.height * 4);
      app.renderer.readRenderTargetPixels(t.sim.target, 0, 0, 512, t.sim.height, a, 0, attachment);
      return a;
    };
    const before = read(0), matrix = t.group.matrixWorld.elements;
    const runId = t.rest.tiles.runId[ids[1]], runKey = runId * 4;
    const run = new Float32Array(512 * t.sim.runHeight * 4), history = new Float32Array(run.length);
    app.renderer.readRenderTargetPixels(t.sim.runTarget, 0, 0, 512, t.sim.runHeight, run, 0, 0);
    app.renderer.readRenderTargetPixels(t.sim.runTarget, 0, 0, 512, t.sim.runHeight, history, 0, 1);
    const runRest = t.sim.runRest.image.data;
    const runX = runRest[runKey] + f.offset.x + run[runKey]
      + (matrix[0] * history[runKey] + matrix[2] * history[runKey + 1]) * history[runKey + 2];
    const runZ = runRest[runKey + 1] + f.offset.z + run[runKey + 1]
      + (matrix[8] * history[runKey] + matrix[10] * history[runKey + 1]) * history[runKey + 2];
    const points = new Float32Array((ids.length + 1) * 2);
    ids.forEach((id, k) => {
      const x = t.rest.tiles.x[id] + before[id * 4 + 2] + f.offset.x;
      const z = t.rest.tiles.z[id] + before[id * 4 + 3] + f.offset.z;
      points[k * 2] = matrix[0] * x + matrix[8] * z + matrix[12];
      points[k * 2 + 1] = matrix[2] * x + matrix[10] * z + matrix[14];
    });
    points[ids.length * 2] = matrix[0] * runX + matrix[8] * runZ + matrix[12];
    points[ids.length * 2 + 1] = matrix[2] * runX + matrix[10] * runZ + matrix[14];
    fd1.update.call(t, 1 / 60);
    const state2 = read(2), state3 = read(3);
    const runHistory = new Float32Array(history.length);
    app.renderer.readRenderTargetPixels(t.sim.runTarget, 0, 0, 512, t.sim.runHeight, runHistory, 0, 1);
    const query = new WaterQuery(app.renderer, app.surface, ids.length + 1);
    try {
      const previous = app.renderer.getRenderTarget();
      query.submit(points, ids.length + 1, 0, 0); app.renderer.setRenderTarget(previous);
      while (query.inFlight) await new Promise(resolve => setTimeout(resolve, 10));
      return { samples: query.resultCount, runError: Math.hypot(runHistory[runKey] - query.result[ids.length * 4 + 1],
        runHistory[runKey + 1] - query.result[ids.length * 4 + 2]), error: Math.max(...ids.flatMap((id, k) => [
        Math.abs(state3[id * 4] - query.result[k * 4]),
        Math.abs(state2[id * 4 + 2] - query.result[k * 4 + 1]),
        Math.abs(state2[id * 4 + 3] - query.result[k * 4 + 2]),
      ])) };
    } finally { query.input.dispose(); query.target.dispose(); query.quad.material.dispose(); }
  });
  assert.equal(report.worldQuery.samples, 3); assert.ok(report.worldQuery.error < 0.002); assert.ok(report.worldQuery.runError < 0.002);
  report.reposition = await page.evaluate(() => {
    const t = app.tiles, frame = t.frameRegistry.get(fd1.id), world = frame.world.clone();
    const other = t.frameRegistry.entries.find(f => f.id !== frame.id), otherWorld = other.world.clone();
    t.place({ x: t.center.x + 40, y: t.center.z }, { x: 1, y: 0 });
    return { placedError: frame.world.distanceTo(world), inheritedMovement: other.world.distanceTo(otherWorld) };
  });
  assert.ok(report.reposition.placedError < 1e-8); assert.ok(report.reposition.inheritedMovement > 1);
  // Filter hides the moved frame, then restores it through the actual GUI.
  const frame = page.getByLabel('frame', { exact: true });
  await frame.selectOption({ label: '2' });
  await page.waitForFunction(() => app.tiles.sim && app.tiles.params.frame === 2 && app.tiles.rest.tiles.count === 3978);
  await frame.selectOption({ label: 'all' });
  await page.waitForFunction(() => app.tiles.sim && app.tiles.rest.tiles.count === 46861);
  report.filter = await page.evaluate(() => {
    const f = app.tiles.frameRegistry.get(fd1.id);
    return { world: f.world.toArray(), mode: f.mode };
  });
  assert.deepEqual(report.filter.world, report.yaw.world); assert.equal(report.filter.mode, 'placed');
  const scale = page.getByLabel('metersPerSourceUnit', { exact: true });
  await scale.fill('0.06'); await scale.press('Enter'); await scale.blur();
  await page.waitForFunction(() => app.tiles.sim && app.tiles.compiled.space.unit === 0.06);
  report.scale = await page.evaluate(() => app.tiles.frameRegistry.get(fd1.id).world.toArray());
  assert.deepEqual(report.scale, report.yaw.world);
  await page.screenshot({ path: join(tmpdir(), 'water-fd1-placed.png') });

  // Actual linked programs + controlled flat-water oracles for both pose paths.
  report.physics = await page.evaluate(async () => {
    const source = await (await fetch('/src/tiles/TileSim.js')).text();
    const THREE = await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const { TileSim } = await import('/src/tiles/TileSim.js');
    const renderer = app.renderer, gl = renderer.getContext();
    const zero = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const deep = new THREE.DataTexture(new Float32Array([-60, 1e4, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    zero.needsUpdate = deep.needsUpdate = true;
    const uniforms = { ...app.surface.uniforms, uShore: { value: deep }, uShoreWave: { value: new THREE.Vector4() },
      uImpact: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1e9, 0)) } };
    for (const name of ['uDisp0', 'uDisp1', 'uDisp2']) uniforms[name] = { value: zero };
    const tileData = { count: 4, x: [500, 501, 502, 503], z: [0, 0, 0, 0], yaw: [0, 0, 0, 0],
      radius: [0.4, 0.4, 0.4, 0.4], y0: [0, 0, 0, 0], thickness: [0.3, 0.3, 0.3, 0.3],
      runId: [-1, 0, -1, 1], flags: [0, 1, 0, 1], frameIndex: [0, 0, 1, 1] };
    const results = [];
    for (const count of [2, app.tiles.sim.frameUniformLimit, app.tiles.sim.frameUniformLimit + 1]) {
      const frames = Array.from({ length: count }, (_, i) => ({ pose: new THREE.Vector4(0, 0, i === 0 ? 1 : 0, 0),
        pivot: new THREE.Vector3(i === 0 ? 500.5 : 502.5, 0, 0) }));
      // Put frame 1 on the LAST texture row: catch truncated uploads/indexing.
      const index = count - 1;
      const tiles = { ...tileData, frameIndex: [0, 0, index, index] };
      const sim = new TileSim(renderer, { uniforms, sim: { params: { windSpeed: 10, windDirection: 0 } } },
        tiles, [{ tiles: [1] }, { tiles: [3] }], 'desktop', frames);
      const params = { ...app.tiles.params, mode: 'drift', orbit: 0, windage: 0.05, driftRadius: 100 };
      const matrix = new THREE.Matrix4();
      const read = attachment => {
        const a = new Float32Array(512 * 4);
        renderer.readRenderTargetPixels(sim.target, 0, 0, 512, 1, a, 0, attachment);
        return a;
      };
      try {
        zero.image.data.fill(0); zero.needsUpdate = true;
        for (let i = 0; i < 600; i++) sim.update(matrix, 1 / 60, params);
        const a = read(0);
        const placed = Math.max(Math.abs(a[2]), Math.abs(a[6]));
        const inherited = Math.min(a[10], a[14]);
        zero.image.data.set([1.5, 0, -0.7, 0]); zero.needsUpdate = true;
        params.orbit = 0.8;
        sim.update(matrix, 1 / 60, params);
        // Mode changes use the existing velocity convention, without teleporting.
        const transitions = [];
        for (const poseZ of [1, 0, 1, 0]) {
          const before = read(0);
          const velocity = read(2);
          frames[index].pose.z = poseZ; sim.syncFrames();
          sim.update(matrix, 1e-8, params);
          const after = read(0);
          const afterVelocity = read(2);
          transitions.push({ position: Math.max(...[2, 3, 6, 7, 10, 11, 14, 15].map(i => Math.abs(before[i] - after[i]))),
            velocity: Math.max(...[8, 9, 12, 13].map(i => Math.abs(velocity[i] - afterVelocity[i]))) });
        }
        const linked = renderer.properties.get(sim.quad.material).currentProgram.program;
        const active = Array.from({ length: gl.getProgramParameter(linked, gl.ACTIVE_UNIFORMS) }, (_, i) => gl.getActiveUniform(linked, i));
        const samplers = active.filter(u => [gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW].includes(u.type)).reduce((n, u) => n + u.size, 0);
        const runProgram = renderer.properties.get(sim.runQuad.material).currentProgram.program;
        const runActive = Array.from({ length: gl.getProgramParameter(runProgram, gl.ACTIVE_UNIFORMS) }, (_, i) => gl.getActiveUniform(runProgram, i));
        const runSamplers = runActive.filter(u => [gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW].includes(u.type)).reduce((n, u) => n + u.size, 0);
        const vectors = active.reduce((n, u) => n + u.size * (u.type === gl.FLOAT_MAT4 ? 4 : u.type === gl.FLOAT_MAT3 ? 3 : 1), 0);
        results.push({ texture: !!sim.frameTexture, placed, inherited, transitions, samplers,
          runSamplers, conservativeUniformVectors: vectors,
          frameCount: count, linked: gl.getProgramParameter(linked, gl.LINK_STATUS),
          frameUniforms: active.filter(u => /Frame/.test(u.name)).map(u => ({ name: u.name, size: u.size })) });
      } finally { sim.dispose(); }
    }
    zero.dispose(); deep.dispose();
    return { maxFragmentVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      uniformFrameLimit: app.tiles.sim.frameUniformLimit, results };
  });
  for (const result of report.physics.results) {
    assert.equal(result.linked, true); assert.ok(result.placed < 1e-5);
    assert.ok(result.inherited > 4);
    for (const transition of result.transitions) { assert.ok(transition.position < 1e-5); assert.ok(transition.velocity < 1e-5); }
    assert.ok(result.samplers <= 16); assert.ok(result.runSamplers <= 16);
    assert.ok(result.conservativeUniformVectors <= report.physics.maxFragmentVectors);
  }
  assert.equal(report.physics.results[0].texture, false); assert.equal(report.physics.results[1].texture, false);
  assert.equal(report.physics.results[2].texture, true);

  report.release = await page.evaluate(() => {
    const t = app.tiles, entry = t.frameRegistry.get(fd1.id), world = entry.world.clone();
    const version = t.sim.target.texture.version;
    t.releaseFrame(entry.id);
    return { mode: entry.mode, worldError: entry.world.distanceTo(world), unchanged: version === t.sim.target.texture.version };
  });
  assert.equal(report.release.mode, 'inherited'); assert.ok(report.release.worldError < 1e-8); assert.equal(report.release.unchanged, true);

  await page.getByRole('button', { name: 'reset', exact: true }).click();
  report.reset = await page.evaluate(() => ({
    allInherited: app.tiles.frameRegistry.entries.every(f => f.mode === 'inherited' && f.offset.length() === 0),
    meshesAtRest: app.tiles.group.children.every(m => m.position.length() === 0),
  }));
  assert.equal(report.reset.allInherited, true); assert.equal(report.reset.meshesAtRest, true);
  await page.getByLabel('source', { exact: true }).selectOption({ label: 'none' });
  await page.waitForFunction(() => !app.tiles.loaded);
  report.none = await page.evaluate(() => ({ sim: !!app.tiles.sim, registry: app.tiles.frameRegistry.entries.length,
    meshes: app.tiles.group.children.length, listeners: !!app.tiles.unbindPromotion, picking: !!app.tiles.promotion.target }));
  assert.deepEqual(report.none, { sim: false, registry: 0, meshes: 0, listeners: false, picking: false });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, ...report, errors }, null, 2));
} finally { await browser.close(); }
