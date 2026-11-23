// SCENE-ENVIRONMENT E2: the sky moves smoothly (spec §4, §5.3; DECISIONS «Оточення: оновлення неба в часі»).
// One page with ?still&desktop (no render loop; app.still() renders frames at a fixed dt). The sky is put
// at A9 in the morning at once, then env.setState() sends it to A1 at noon with τ = TAU s. A recorder
// around env.update() logs every tick. Checked:
//   - update() returns { sunChanged, cubeChanged, moving, faces, pmrem, drift } (drift: E2b);
//   - every sky param moves monotonically toward its target, and the sun's angle to its final
//     direction never grows; 95 % of the elevation is done after 3τ;
//   - while moving no frame re-bakes more than one cube face; the IBL (PMREM of the small bake)
//     follows: one every sixth tick, never more than six ticks apart (E2 QA: an IBL kept still
//     while moving made the sand under shallow water jump at rest);
//   - after the move: the six faces once more, the last tick makes the IBL, then env.dirty is false;
//   - the shadow map is redrawn about every 0.5 s while moving, once more at rest;
//   - the end state equals an immediate set() of the same target (sun and cube, bit for bit);
//   - env.cube / env.envMap / env.sun.* keep their identity, scene.environment is env.envMap;
//   - a real context loss + restore re-bakes everything in one tick (faces 6, pmrem);
//   - on screen (QA-E2-1): shot Lagoon, sun 50° → 5° with τ 0.3 s — the near half of the frame
//     (shallow water over sand) changes by a mean ≤ JUMP/255 between the last two ticks; with the
//     IBL kept still while moving it jumped by 34.7.
// PROBE_BASE=<url> (default the local stand); PROBE_TAU seconds (default 1).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const TAU = Number(process.env.PROBE_TAU ?? 1);
const DT = 1 / 60;
const JUMP = 5;
const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const stage = (name) => { if (process.env.PROBE_VERBOSE) console.error(`${((performance.now() - t0) / 1000).toFixed(1)} s  ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL('?still&desktop', BASE).href);
  await page.waitForFunction(() => window.app?.still, {}, { timeout: 120000 });

  // A9 at t 0.1 and A1 at t 0.5 as sky params (the module's own data)
  const { from, to } = await page.evaluate(async () => {
    const m = await import('/src/environment/index.js');
    const sky = (v, a, t) => {
      const s = m.sampleMood(m.MOOD_MAP_V1, v, a).sky, sun = m.sunAt(m.SUN_PATH_V1, t);
      // cloudSpeed 0: the E2 contract is the move of the sky state; the drift of the clouds (E2b)
      // re-bakes the cube on its own and has its own probe (probe-scene-env-clouds)
      return { elevation: sun.elevation, azimuth: sun.azimuth, sunIntensity: s.sunIntensity, cloudCoverage: s.cloudCoverage, turbidity: s.turbidity, cloudSpeed: 0 };
    };
    return { from: sky(1, -1, 0.1), to: sky(-1, 1, 0.5) };
  });

  // the end state of an immediate set(): the reference for the smooth move's end
  const sample = () => page.evaluate(() => {
    const rt = app.env.cubeTarget, n = rt.width, buf = new Uint16Array(n * n * 4), out = [];
    for (let f = 0; f < 6; f++) {
      app.renderer.readRenderTargetPixels(rt, 0, 0, n, n, buf, f);
      for (let i = 0; i < buf.length; i += 4 * 61) out.push(buf[i], buf[i + 1], buf[i + 2]);
    }
    return { dir: app.env.sun.direction.toArray(), color: app.env.sun.color.toArray(), cube: out };
  });
  await page.evaluate((s) => app.env.set(s), to);
  await page.evaluate(() => app.still({ frames: 2 }));
  const reference = await sample();
  stage('reference');

  await page.evaluate((s) => app.env.set(s), from);
  await page.evaluate(() => app.still({ frames: 2 }));
  assert.equal(await page.evaluate(() => app.env.dirty), false, 'A9 is baked at once');

  // recorder: every tick, the sun, the params and the shadow requests
  await page.evaluate(() => {
    const env = app.env, update = env.update, log = [];
    window.__log = log;
    window.__refs = { cube: env.cube, envMap: env.envMap, dir: env.sun.direction, color: env.sun.color };
    let shadows = 0;
    const sm = app.renderer.shadowMap;
    let needs = sm.needsUpdate;
    Object.defineProperty(sm, 'needsUpdate', { configurable: true, get: () => needs, set: (v) => { if (v) shadows++; needs = v; } });
    env.update = (dt) => {
      const r = update(dt);
      log.push({ dt, ...r, keys: Object.keys(r).sort().join(','), dir: env.sun.direction.toArray(),
        p: { ...env.params }, shadows, dirty: env.dirty });
      return r;
    };
  });
  await page.evaluate(({ s, tau }) => app.env.setState(s, { tau }), { s: to, tau: TAU });
  const frames = Math.ceil((10 * TAU + 0.5) / DT);
  // app.still() takes ≤ 600 frames a call; the clock goes on between calls
  for (let left = frames; left > 0; left -= 300) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.evaluate(({ n, dt }) => app.still({ frames: n, dt }), { n: Math.min(300, left), dt: DT });
  }
  stage('move');
  const log = await page.evaluate(() => window.__log);
  const state = await page.evaluate(() => ({
    dirty: app.env.dirty, target: { ...app.env.target },
    identity: app.env.cube === window.__refs.cube && app.env.envMap === window.__refs.envMap
      && app.env.sun.direction === window.__refs.dir && app.env.sun.color === window.__refs.color,
    envMapping: app.env.envMap.mapping,
    sceneEnvironment: app.scene.environment === app.env.envMap,
  }));

  // the shape of update()
  assert.ok(log.length > 10, `ticks recorded: ${log.length}`);
  assert.equal(log[0].keys, 'cubeChanged,drift,faces,moving,pmrem,sunChanged', 'update() result keys');

  // monotonic params and sun
  const keys = Object.keys(to);
  const azd = (a, b) => (((b - a + 180) % 360) + 360) % 360 - 180;
  const dist = (k, v) => Math.abs(k === 'azimuth' ? azd(v, to[k]) : to[k] - v);
  const angle = (d) => Math.acos(Math.min(1, d.reduce((s, x, i) => s + x * reference.dir[i], 0)));
  for (let i = 1; i < log.length; i++) {
    for (const k of keys) assert.ok(dist(k, log[i].p[k]) <= dist(k, log[i - 1].p[k]) + 1e-9, `${k} monotonic at tick ${i}: ${log[i - 1].p[k]} → ${log[i].p[k]}`);
    assert.ok(angle(log[i].dir) <= angle(log[i - 1].dir) + 1e-7, `sun angle to its end never grows (tick ${i})`);
  }
  // 95 % after 3τ
  const at3 = log[Math.round(3 * TAU / DT) - 1];
  const done = 1 - dist('elevation', at3.p.elevation) / Math.abs(to.elevation - from.elevation);
  assert.ok(done >= 0.95 && done < 0.96, `elevation ${(done * 100).toFixed(1)} % after 3τ`);

  // no full re-bake while moving; the IBL every cycle of faces, and once more at rest
  const moving = log.filter((r) => r.moving);
  assert.ok(moving.length > 3 * TAU / DT, `moving ticks: ${moving.length}`);
  assert.ok(moving.every((r) => r.faces === 1 && r.sunChanged), 'while moving: one face per frame, the sun follows');
  const iblTicks = log.map((r, i) => (r.pmrem ? i : -1)).filter((i) => i >= 0);
  const iblGaps = iblTicks.slice(1).map((t, i) => t - iblTicks[i]);
  assert.ok(iblTicks[0] <= 5, `the first IBL within the first cycle: tick ${iblTicks[0]}`);
  assert.ok(iblGaps.every((g) => g >= 1 && g <= 6), `IBL never more than six ticks apart: gaps ${[...new Set(iblGaps)]}`);
  const iblMoving = moving.filter((r) => r.pmrem).length;
  assert.ok(Math.abs(iblMoving - moving.length / 6) <= 1, `IBL while moving: ${iblMoving} in ${moving.length} ticks`);
  const lastMove = log.findLastIndex((r) => r.sunChanged);
  const tail = log.slice(lastMove);
  assert.deepEqual(tail.map((r) => r.faces), [1, 1, 1, 1, 1, 1], `after the move: six faces (${tail.map((r) => r.faces)})`);
  assert.equal(tail.at(-1).pmrem, true, 'the IBL at rest, on the last tick');
  assert.equal(state.dirty, false, 'env.dirty false after the move');
  assert.equal(log.at(-1).dirty, false, 'the last tick leaves nothing to do');

  // shadow: every 0.5 s while moving, then at rest
  const moveSeconds = log.slice(0, lastMove + 1).reduce((s, r) => s + r.dt, 0);
  const shadowsMoving = log[lastMove - 1].shadows;
  const shadowsTotal = log.at(-1).shadows;
  assert.ok(Math.abs(shadowsMoving - moveSeconds / 0.5) <= 1.5, `shadow redraws while moving: ${shadowsMoving} in ${moveSeconds.toFixed(2)} s`);
  assert.equal(shadowsTotal - shadowsMoving, 1, 'one more shadow at rest');

  // the end equals set() of the same target
  const end = await sample();
  end.dir.forEach((v, i) => assert.equal(v, reference.dir[i], 'sunDir as after set()'));
  end.color.forEach((v, i) => assert.equal(v, reference.color[i], 'sunColor as after set()'));
  const cubeDiff = end.cube.filter((v, i) => v !== reference.cube[i]).length;
  assert.equal(cubeDiff, 0, `cube samples as after set(): ${cubeDiff} of ${end.cube.length} differ`);
  assert.ok(state.identity, 'env.cube, env.envMap, env.sun.* keep their identity');
  assert.equal(state.envMapping, 306, 'env.envMap is a PMREM (CubeUVReflectionMapping)');
  assert.ok(state.sceneEnvironment, 'scene.environment is env.envMap');

  stage('checked the move');
  // context loss + restore: one tick re-bakes everything
  await page.evaluate(async () => {
    const ext = app.renderer.getContext().getExtension('WEBGL_lose_context');
    const c = app.renderer.domElement;
    const lost = new Promise((r) => c.addEventListener('webglcontextlost', r, { once: true }));
    const back = new Promise((r) => c.addEventListener('webglcontextrestored', r, { once: true }));
    ext.loseContext();
    await lost;
    // outside the lost event's dispatch: a restoreContext() in its microtask is never answered
    await new Promise((r) => setTimeout(r, 100));
    ext.restoreContext();
    await back;
    window.__log.length = 0;
    await app.still({ frames: 2 });
  });
  const restored = await page.evaluate(() => window.__log);
  assert.ok(restored.length >= 1 && restored[0].faces === 6 && restored[0].pmrem, `after restore: ${JSON.stringify(restored.map((r) => [r.faces, r.pmrem]))}`);
  const afterRestore = await sample();
  afterRestore.dir.forEach((v, i) => assert.equal(v, reference.dir[i], 'sunDir after restore'));
  const restoreDiff = afterRestore.cube.filter((v, i) => v !== reference.cube[i]).length;
  assert.equal(restoreDiff, 0, `cube after restore: ${restoreDiff} samples differ`);

  stage('restore');
  // on screen: no jump of the sand under shallow water when the move ends
  const jump = await page.evaluate(async () => {
    await app.still({ shot: 'Lagoon', frames: 3 });
    app.env.setState({ elevation: 5 }, { tau: 0.3 });
    let prev = null, last = null, n = 0;
    // oxlint-disable-next-line eslint/no-await-in-loop
    while (app.env.dirty && n < 400) { prev = last; last = (await app.still({ frames: 1, dt: 1 / 60 })).rgba; n++; }
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const a = bytes(prev), c = bytes(last), W = 1280, H = 720;
    let sum = 0, count = 0;
    // readPixels rows go bottom-up: the first H/2 rows are the near half
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) {
      const i = (y * W + x) * 4 + k;
      sum += Math.abs(a[i] - c[i]); count++;
    }
    return { ticks: n, mean: sum / count };
  });
  assert.ok(jump.mean <= JUMP, `near water at rest: mean Δ ${jump.mean.toFixed(2)}/255 between the last two ticks (≤ ${JUMP})`);

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`A9 t0.1 → A1 t0.5, τ ${TAU} s, dt 1/60: ${log.length} ticks, ${moving.length} moving, IBL ${iblMoving}× while moving (gaps ≤ ${Math.max(...iblGaps)}); elevation ${(done * 100).toFixed(1)} % at 3τ; `
    + `shadow ${shadowsMoving} redraws in ${moveSeconds.toFixed(2)} s + 1 at rest; end = set() (sun, ${end.cube.length} cube samples); `
    + `scene.environment === envMap; restore: faces 6 + PMREM; Lagoon 50° → 5°: near water at rest Δ ${jump.mean.toFixed(2)}/255 (${jump.ticks} ticks)`);
  console.log(`PASS probe-scene-env-smooth ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
}
