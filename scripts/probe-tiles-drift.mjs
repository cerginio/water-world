// T3: independent flat-water oracles plus two minutes on the real hybrid field.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const errors = [], report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?tiles=story-8-frames-hibrid&tilesMode=drift&tilesFieldYaw=57`);
  await page.waitForFunction(() => window.app?.tiles.sim, {}, { timeout: 60000 });
  report.physics = await page.evaluate(async () => {
    const source = await (await fetch('/src/tiles/TileSim.js')).text();
    const THREE = await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const { TileSim } = await import('/src/tiles/TileSim.js');
    const zero = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    zero.needsUpdate = true;
    const uniforms = { ...app.surface.uniforms };
    for (const name of ['uDisp0', 'uDisp1', 'uDisp2']) uniforms[name] = { value: zero };
    uniforms.uShoreWave = { value: new THREE.Vector4() };
    const deep = new THREE.DataTexture(new Float32Array([-60,1e4,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);
    deep.needsUpdate = true;
    uniforms.uShore = { value: deep };
    uniforms.uImpact = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0,0,1e9,0)) };
    const tiles = { count: 4, x: [0,-1,1,0], z: [0,0,0,1], yaw: [0,0,0,0],
      radius: [0.4,0.4,0.4,0.4], y0: [0,0,0,0], thickness: [0.3,0.3,0.3,0.3],
      runId: [-1,0,0,-1], flags: [0,1,1,0] };
    const wind = { windDirection: 90, windSpeed: 10 };
    const sim = new TileSim(app.renderer, { uniforms, sim: { params: wind } }, tiles, [{ tiles: [1,2] }]);
    const matrix = new THREE.Matrix4().makeRotationY(57*Math.PI/180);
    matrix.setPosition(app.tiles.center);
    const p = { ...app.tiles.params, mode: 'drift', orbit: 0, windage: 0.05, driftRadius: 400 };
    const read = (target, attachment = 0) => {
      const a = new Float32Array(512*4);
      app.renderer.readRenderTargetPixels(target,0,0,512,1,a,0,attachment);
      return a;
    };
    const step = (seconds) => { for (let i = 0; i < Math.round(seconds*60); i++) sim.update(matrix,1/60,p); };
    try {
      step(10);
      const a = read(sim.target), run = read(sim.runTarget);
      const world = new THREE.Vector3(a[2],0,a[3]).applyMatrix4(new THREE.Matrix4().extractRotation(matrix));
      // dv/dt = drag*(0.5-v), exact continuous displacement after 10 seconds.
      const expected = 0.5*(10-(1-Math.exp(-p.drag*10))/p.drag);
      const windError = Math.hypot(world.x,world.z-expected);
      const runError = Math.hypot(a[6]-run[0],a[7]-run[1],a[10]-run[0],a[11]-run[1]);
      // At zero dt, setMode changes no textures. At tiny dt neither position nor
      // physical velocity may teleport in either direction, even with an orbit.
      zero.image.data.set([1.5,0,-0.7,0]); zero.needsUpdate = true;
      p.orbit = 0.8;
      sim.update(matrix,1/60,p); // warm the constant-water history before switching
      const transitions = [];
      for (const mode of ['anchored','drift','anchored','drift']) {
        const before = read(sim.target), vel = read(sim.target,2), previous = p.mode;
        p.mode = mode; sim.update(matrix,1e-7,p);
        const after = read(sim.target), v = read(sim.target,2);
        // Constant displacement has zero water velocity once history is warm.
        transitions.push({ from: previous, to: mode, position: Math.hypot(after[2]-before[2],after[3]-before[3]),
          velocity: Math.hypot(v[0]-vel[0],v[1]-vel[1]) });
        sim.update(matrix,1/60,p);
      }
      // A changing orbit has nonzero physical velocity. Compare total velocities,
      // since anchored stores the residual and drift stores the total velocity.
      const movingTransitions = [];
      for (const mode of ['anchored','drift']) {
        const before = read(sim.target,2), from = p.mode;
        zero.image.data[0] += 1/1024; zero.needsUpdate = true;
        p.mode = mode; sim.update(matrix,0.001,p);
        const after = read(sim.target,2);
        const worldVelocity = new THREE.Vector3(
          Math.max(-3,Math.min(3,(after[2]-before[2])/0.001)),0,
          Math.max(-3,Math.min(3,(after[3]-before[3])/0.001)));
        const orbital = worldVelocity.applyMatrix4(new THREE.Matrix4().extractRotation(matrix).invert()).multiplyScalar(p.orbit);
        const vx0 = before[0]+(from === 'anchored' ? orbital.x : 0);
        const vz0 = before[1]+(from === 'anchored' ? orbital.z : 0);
        const vx1 = after[0]+(mode === 'anchored' ? orbital.x : 0);
        const vz1 = after[1]+(mode === 'anchored' ? orbital.z : 0);
        movingTransitions.push({ from, to: mode, velocityError: Math.hypot(vx1-vx0,vz1-vz0), orbitalSpeed: orbital.length() });
      }
      p.mode = 'anchored'; step(12);
      // WATER_GLSL displacement is zero here only after clearing the constant FFT.
      zero.image.data.fill(0); zero.needsUpdate = true;
      p.orbit = 0; step(12);
      const flatReturned = read(sim.target);
      const returnError = Math.max(...[0,1,2,3].map((id) => Math.hypot(flatReturned[id*4+2],flatReturned[id*4+3])));
      // Windage=0 on flat water must produce no horizontal motion.
      sim.reset(); p.mode = 'drift'; p.windage = 0; step(5);
      const calm = read(sim.target), calmMax = Math.max(...Array.from(calm.slice(0,16)).filter((_,i) => i%4>=2).map(Math.abs));
      // Reach the wall with maximum wind, then verify a steady bounded state.
      sim.reset(); p.windage = 0.1; p.driftRadius = 3; wind.windSpeed = 25; wind.windDirection = 0;
      step(25); const wallA = read(sim.target); step(10); const wallB = read(sim.target);
      const wallRun = read(sim.runTarget);
      const wallMax = Math.max(Math.hypot(wallRun[0],wallRun[1]),
        ...[0,3].map((id) => Math.hypot(tiles.x[id]+wallB[id*4+2],tiles.z[id]+wallB[id*4+3])));
      const wallChange = Math.hypot(wallA[2]-wallB[2],wallA[3]-wallB[3]);
      // Reset both tile and run ping-pong targets, including their histories.
      sim.reset();
      const resetMax = Math.max(...[...sim.targets.flatMap((t) => [0,1,2,3].flatMap((i) => Array.from(read(t,i)))),
        ...sim.runTargets.flatMap((t) => [0,1].flatMap((i) => Array.from(read(t,i))))].map(Math.abs));
      return { windError, world: [world.x,world.z], expected, runError, transitions, movingTransitions, returnError, calmMax, wallMax, wallChange, resetMax };
    } finally { sim.dispose(); zero.dispose(); deep.dispose(); }
  });
  console.log(JSON.stringify({ physics: report.physics }));
  assert.ok(report.physics.windError < 0.005);
  assert.equal(report.physics.runError, 0);
  for (const t of report.physics.transitions) assert.ok(t.position < 0.00001, JSON.stringify(t));
  // The first transition changes FFT displacement deliberately; subsequent
  // constant-water transitions must preserve velocity as well.
  for (const t of report.physics.transitions.slice(1)) assert.ok(t.velocity < 0.0001, JSON.stringify(t));
  for (const t of report.physics.movingTransitions) assert.ok(t.orbitalSpeed > 1 && t.velocityError < 0.08,JSON.stringify(t));
  assert.ok(report.physics.returnError < 0.001);
  assert.equal(report.physics.calmMax, 0);
  assert.ok(report.physics.wallMax < 4.1 && report.physics.wallChange < 0.001);
  assert.equal(report.physics.resetMax, 0);
  if (process.env.TILES_PHYSICS_ONLY) {
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ pass: true, physics: report.physics, errors },null,2));
    await browser.close();
    process.exit(0);
  }

  // Instrument actual live updates; count integrated time, not wall-clock time.
  await page.evaluate(() => {
    const t = app.tiles, update = t.update;
    t.reset();
    window.driftSoak = { seconds: 0, frames: 0 };
    t.update = function (dt) {
      update.call(this,dt); driftSoak.seconds += Math.min(dt,8/240); driftSoak.frames++;
    };
    window.readDrift = () => {
      const s = t.sim, r = app.renderer, n = t.rest.tiles.count;
      const a = Array.from({ length: 4 }, () => new Float32Array(512*s.height*4));
      a.forEach((v,i) => r.readRenderTargetPixels(s.target,0,0,512,s.height,v,0,i));
      const runs = new Float32Array(512*s.runHeight*4);
      r.readRenderTargetPixels(s.runTarget,0,0,512,s.runHeight,runs);
      let nonfinite = 0, polygonMax = 0, runMax = 0, runMismatch = 0, anchorError = 0;
      const yaw = t.params.fieldYaw*Math.PI/180, c = Math.cos(yaw), sn = Math.sin(yaw);
      for (let id = 0; id < n; id++) {
        const k = id*4;
        for (const v of a) for (let j = 0; j < 4; j++) if (!Number.isFinite(v[k+j])) nonfinite++;
        const ox = (c*a[2][k+2]-sn*a[2][k+3])*t.params.orbit;
        const oz = (sn*a[2][k+2]+c*a[2][k+3])*t.params.orbit;
        if (t.rest.tiles.flags[id]) {
          const ri = t.rest.tiles.runId[id]*4;
          runMismatch = Math.max(runMismatch,Math.hypot(a[0][k+2]-ox-runs[ri],a[0][k+3]-oz-runs[ri+1]));
        } else polygonMax = Math.max(polygonMax,Math.hypot(a[0][k+2],a[0][k+3]));
        anchorError = Math.max(anchorError,Math.hypot(a[0][k+2]-ox,a[0][k+3]-oz));
      }
      for (let i = 0; i < s.runCount; i++) {
        runMax = Math.max(runMax,Math.hypot(runs[i*4],runs[i*4+1]));
        for (let j = 0; j < 4; j++) if (!Number.isFinite(runs[i*4+j])) nonfinite++;
      }
      return { ...driftSoak, nonfinite, polygonMax, runMax, runMismatch, anchorError, gpuMs: app.timer.ms.tiles, cpuMs: t.cpuMs };
    };
  });
  do {
    await page.waitForTimeout(15000);
    report.drift = await page.evaluate(() => readDrift());
    console.log(JSON.stringify({ drift: report.drift }));
    assert.equal(report.drift.nonfinite,0);
    assert.ok(report.drift.runMismatch < 0.0001);
  } while (report.drift.seconds < 120);
  assert.ok(report.drift.polygonMax > 5 && report.drift.runMax > 5);
  report.seams = await page.evaluate(() => {
    const t = app.tiles, s = t.sim;
    const h = new Float32Array(512*s.height*4), a = new Float32Array(h.length);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,h,0,0);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,a,0,1);
    const deform = (part,v) => {
      const id = part.aTile[v], i = id*4, o = part.aOffset;
      const x = o[v*3], y = o[v*3+1], z = o[v*3+2];
      const cx = Math.cos(a[i]), sx = Math.sin(a[i]), cz = Math.cos(a[i+1]), sz = Math.sin(a[i+1]);
      return [t.rest.tiles.x[id]+h[i+2]+cz*x-sz*cx*y+sz*sx*z,
        t.rest.tiles.y0[id]+h[i]+sz*x+cz*cx*y-cz*sx*z,
        t.rest.tiles.z[id]+h[i+3]+sx*y+cx*z];
    };
    let pairs = 0, maxSeam = 0;
    for (const part of t.rest.polyline) {
      const pos = part.geometry.attributes.position, joints = new Map();
      for (let v = 0; v < pos.count; v++) {
        const key = [t.rest.tiles.runId[part.aTile[v]],pos.getX(v),pos.getY(v),pos.getZ(v)].join(',');
        const first = joints.get(key);
        if (first === undefined) joints.set(key,v);
        else {
          pairs++;
          const p = deform(part,v), q = deform(part,first);
          maxSeam = Math.max(maxSeam,Math.hypot(...p.map((n,i) => n-q[i])));
        }
      }
    }
    return { pairs, maxSeam };
  });
  assert.ok(report.seams.pairs > 0 && report.seams.maxSeam < 0.00001);
  await page.screenshot({ path: join(tmpdir(),'tile-t3-drift-2min.png') });
  // No texture write on the GUI mode change, before the next simulation step.
  report.switch = await page.evaluate(() => {
    const t = app.tiles, before = readDrift();
    t.setMode('anchored'); driftSoak.seconds = 0;
    const after = readDrift();
    return { same: before.polygonMax === after.polygonMax && before.runMax === after.runMax };
  });
  assert.ok(report.switch.same);
  await page.getByLabel('mode', { exact: true }).selectOption({ label: 'anchored' });
  await page.waitForFunction(() => driftSoak.seconds >= 12, {}, { timeout: 60000 });
  report.returned = await page.evaluate(() => readDrift());
  assert.ok(report.returned.anchorError < 0.001,JSON.stringify(report.returned));
  await page.screenshot({ path: join(tmpdir(),'tile-t3-returned.png') });

  // Visible controls write a reproducible URL and reload restores numeric frame ids.
  const fill = async (name,value) => {
    const el = page.getByLabel(name,{ exact: true });
    await el.fill(String(value)); await el.press('Enter'); await el.blur();
  };
  await fill('windage',0.073); await fill('driftRadius',120); await fill('density',730);
  await page.getByLabel('frame',{ exact: true }).selectOption({ label: '2' });
  await page.waitForFunction(() => app.tiles.sim && app.tiles.rest.tiles.count === 3978);
  report.url = await page.evaluate(() => ({ url: location.href, params: { ...app.tiles.params } }));
  await page.reload();
  await page.waitForFunction(() => app?.tiles.sim && app.tiles.rest.tiles.count === 3978, {}, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(() => ({ ...app.tiles.params })),report.url.params);
  // Repeated mode changes through the visible control and reset must stay finite.
  for (let i = 0; i < 6; i++) await page.getByLabel('mode',{ exact: true }).selectOption({ label: i%2 ? 'anchored' : 'drift' });
  await page.getByRole('button',{ name: 'reset',exact: true }).click();
  // Malformed links must not feed NaN into shaders or break frame filtering.
  await page.goto(`${base}?tiles=story-8-frames-hibrid&tilesFrame=missing&tilesMode=unknown&tilesDensity=NaN&tilesWindage=Infinity&tilesDrag=-5&tilesOrbit=99&keep=ok#tile-qa`);
  await page.waitForFunction(() => window.app?.tiles.sim, {}, { timeout: 60000 });
  report.invalidUrl = await page.evaluate(() => ({ params: { ...app.tiles.params }, keep: new URL(location.href).searchParams.get('keep'), hash: location.hash }));
  assert.equal(report.invalidUrl.params.frame,'all');
  assert.equal(report.invalidUrl.params.mode,'anchored');
  assert.equal(report.invalidUrl.params.density,500);
  assert.equal(report.invalidUrl.params.windage,0.02);
  assert.equal(report.invalidUrl.params.drag,0);
  assert.equal(report.invalidUrl.params.orbit,1);
  assert.equal(report.invalidUrl.keep,'ok');
  assert.equal(report.invalidUrl.hash,'#tile-qa');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ pass: true, ...report, errors },null,2));
} finally { await browser.close(); }
