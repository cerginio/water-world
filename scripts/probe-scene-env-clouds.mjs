// SCENE-ENVIRONMENT E2b: the clouds move (spec §3.3, §7 p.4). One page with ?still&desktop (no
// render loop; app.still() renders frames at a fixed dt), shot Golden hour (open sky over the sea).
// The sky zone = pixel rows whose view ray rises above SKY_Y at the left, centre and right edge.
// Checked:
//   - clouds on (the shot's cloudCoverage 0.38, cloudSpeed 1): two frames 1 s apart differ in the
//     sky zone — at least MIN_MOVED pixels by more than GRAIN/255 (post grain is 1–3/255);
//   - meanwhile env.dirty stays false (a drift is not a sky change: the mood stays at rest), no tick
//     bakes more than one cube face, the deck drifted CLOUD_WIND × 1 s, and the cube's offset trails
//     the live one by at most CLOUD_STEP + one run of faces (the reflection follows the sky);
//   - no clouds (cloudCoverage 0): the sky zone of two frames 1 s apart is the same (≤ GRAIN),
//     env.active is false and update() is not called;
//   - clouds that do not move (cloudSpeed 0): the same.
// PROBE_BASE=<url> (default the local stand).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const SHOT = 'Golden hour';
const SKY_Y = 0.03;
const GRAIN = 6;
const MIN_MOVED = 500;
const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL('?still&desktop', BASE).href);
  await page.waitForFunction(() => window.app?.still, {}, { timeout: 120000 });

  // recorder: every update() tick
  await page.evaluate(() => {
    const env = app.env, update = env.update;
    window.__ticks = [];
    env.update = (dt) => {
      const u = update(dt);
      window.__ticks.push({ faces: u.faces, pmrem: u.pmrem, drift: u.drift, dirty: env.dirty });
      return u;
    };
  });
  const frame = async (opts) => Buffer.from((await page.evaluate((o) => app.still(o), opts)).rgba, 'base64');
  await frame({ shot: SHOT, frames: 300 });   // the auto-exposure settles
  const first = await frame({ frames: 1 });

  // the sky rows (readPixels: row 0 at the bottom)
  const { width, height, rows } = await page.evaluate((skyY) => {
    const cam = app.camera;
    const canvas = app.renderer.domElement, w = canvas.width, h = canvas.height, out = [];
    const v = cam.position.clone();
    for (let r = 0; r < h; r++) {
      const ny = ((r + 0.5) / h) * 2 - 1;
      let lo = Infinity;
      for (const nx of [-1, 0, 1]) {
        v.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
        lo = Math.min(lo, v.y);
      }
      if (lo > skyY) out.push(r);
    }
    return { width: w, height: h, rows: out };
  }, SKY_Y);
  assert.ok(rows.length > height * 0.2, `the sky zone: ${rows.length} of ${height} rows`);
  const moved = (a, b) => {
    let n = 0, max = 0;
    for (const r of rows) for (let x = 0; x < width; x++) {
      const i = (r * width + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > GRAIN) n++;
      if (d > max) max = d;
    }
    return { n, max };
  };

  // clouds on, moving: 1 s later
  const before = await page.evaluate(() => ({ p: { ...app.env.params }, offset: app.env.clouds.offset.toArray() }));
  assert.ok(before.p.cloudCoverage > 0 && before.p.cloudSpeed > 0, `the shot has moving clouds: ${JSON.stringify(before.p)}`);
  await page.evaluate(() => { window.__ticks = []; });
  const later = await frame({ frames: 60 });
  const on = moved(first, later);
  const drift = await page.evaluate(() => ({
    ticks: window.__ticks, dirty: app.env.dirty,
    offset: app.env.clouds.offset.toArray(), cube: app.env.clouds.cube.toArray(),
    wind: 0.003,   // CLOUD_WIND (clouds.js)
  }));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const went = dist(drift.offset, before.offset);
  const lag = dist(drift.offset, drift.cube);
  const faces = drift.ticks.reduce((s, t) => s + t.faces, 0);
  const runs = drift.ticks.filter((t) => t.faces === 1 && t.drift).length / 6;
  report.push(`clouds 0.38 × 1: ${on.n} sky px moved > ${GRAIN}/255 (max ${on.max}) in 1 s; deck ${went.toFixed(5)}, cube lag ${lag.toFixed(5)}; `
    + `${drift.ticks.length} ticks, ${faces} faces (~${runs.toFixed(1)} runs), ${drift.ticks.filter((t) => t.pmrem).length} IBL`);
  assert.ok(on.n >= MIN_MOVED, `clouds move: ${on.n} sky pixels changed (need ≥ ${MIN_MOVED})`);
  assert.equal(drift.ticks.length, 60, 'update() ticks every frame while the clouds drift');
  assert.ok(drift.ticks.every((t) => !t.dirty) && !drift.dirty, 'a drift is not a sky change: env.dirty false');
  assert.ok(drift.ticks.every((t) => t.faces <= 1), 'at most one cube face a tick');
  assert.ok(Math.abs(went - drift.wind) < 1e-4, `the deck drifts CLOUD_WIND × 1 s: ${went}`);
  assert.ok(lag <= 0.001 + 7 * drift.wind / 60 + 1e-6, `the cube trails by ≤ CLOUD_STEP + a run: ${lag}`);

  // no clouds, then clouds that stand still
  for (const [label, set] of [['coverage 0', { cloudCoverage: 0 }], ['speed 0', { cloudCoverage: 0.38, cloudSpeed: 0 }]]) {
    await page.evaluate((s) => app.env.set(s), set);
    await frame({ frames: 300 });   // the auto-exposure settles on the new sky
    const a = await frame({ frames: 1 });
    await page.evaluate(() => { window.__ticks = []; });
    const b = await frame({ frames: 60 });
    const off = moved(a, b);
    const s = await page.evaluate(() => ({ ticks: window.__ticks.length, active: app.env.active }));
    report.push(`${label}: ${off.n} sky px > ${GRAIN}/255 (max ${off.max}) in 1 s; ${s.ticks} ticks, active ${s.active}`);
    assert.equal(off.n, 0, `${label}: the sky does not change`);
    assert.equal(s.ticks, 0, `${label}: update() is not called`);
    assert.equal(s.active, false, `${label}: env.active false`);
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log(report.join('\n'));
  console.log(`probe-scene-env-clouds PASS ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.log(report.join('\n'));
  if (errors.length) console.log('page errors:', errors.join('\n'));
  throw e;
} finally {
  await browser.close();
}
