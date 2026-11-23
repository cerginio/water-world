// MOOD-WEATHER M2: smooth transitions (spec §4.4, §6 p.3).
//   1. weather A9 → A1 (app.mood.to, like the widget): every channel of the sea, the sky and the
//      grade moves monotonically, no frame jumps more than one step of its exponent (dt ≤ 0.1 s),
//      95 % by ~3τ (sky 6 s, sea 10 s); the spectrum is re-made every frame while the waves move;
//      the sky moves one cube face a frame, no full re-bake while moving.
//   2. the day 0.1 → 0.9 in A5: the sun walks the arc (azimuth monotonic, elevation on the
//      spec §2.2 curve of that azimuth), not the short way between two points.
//   3. a Controls slider during a move → custom: the world stops where it is.
// Expected numbers come from the spec (§3.2 anchors, §2.2 sun, §4.4 τ), not from main.js.
// Needs the stand on localhost:5199. Writes nothing. ~80 s.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const sunAt = (t) => ({ elevation: -2 + 62 * Math.sin(Math.PI * t), azimuth: 205 - 180 * (1 - t) });   // spec §2.2
// spec §3.2: A9 and A1
const A9 = { windSpeed: 1.5, waveScale: 0.04, swellScale: 0.3, choppiness: 0.4, cloudCoverage: 0.12, sunIntensity: 9, turbidity: 1.6, keyValue: 0.2, contrast: 1.08, saturation: 1.3 };
const A1 = { windSpeed: 22, waveScale: 0.45, swellScale: 1.2, choppiness: 1.5, cloudCoverage: 0.95, sunIntensity: 7, turbidity: 5, keyValue: 0.12, contrast: 1.2, saturation: 0.8 };
const TAU = { windSpeed: 10, waveScale: 10, swellScale: 10, choppiness: 10, cloudCoverage: 6, sunIntensity: 6, turbidity: 6, keyValue: 6, contrast: 6, saturation: 6 };

const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = [], errors = [];
async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(new URL(query, BASE).href);
  await page.waitForFunction(() => window.app?.mood && document.getElementById('moodPad'), {}, { timeout: 120000 });
  await page.waitForTimeout(300);
  return page;
}
// samples every rendered frame for `seconds` after `start` runs in the page (one per env.update
// / renderFrame): the channels, the sky update's faces, the spectrum calls
const record = (page, start, seconds) => page.evaluate(async ([code, secs]) => {
  const { env, ocean, post } = window.app;
  const frames = [];
  let spectrum = 0, upd = null, clock = 0;
  const update = env.update, spec = ocean.updateSpectrum, oceanUpdate = ocean.update;
  env.update = (dt) => (upd = update(dt));
  // the frame clock (sum of dt, capped at 0.1 s a frame), not the wall clock: headless is slow
  ocean.update = function (dt, ...rest) { clock += dt; return oceanUpdate.call(this, dt, ...rest); };
  ocean.updateSpectrum = function () { spectrum++; return spec.call(this); };
  // eslint-disable-next-line no-new-func
  new Function('app', code)(window.app);
  const begin = performance.now();
  clock = 0;
  await new Promise((done) => {
    const tick = () => {
      const p = env.params, o = ocean.params, g = post.params;
      frames.push({ t: clock,
        windSpeed: o.windSpeed, waveScale: o.waveScale, swellScale: o.swellScale, choppiness: o.choppiness,
        cloudCoverage: p.cloudCoverage, sunIntensity: p.sunIntensity, turbidity: p.turbidity,
        elevation: p.elevation, azimuth: p.azimuth,
        keyValue: g.keyValue, contrast: g.contrast, saturation: g.saturation,
        faces: upd?.faces ?? 0, moving: upd?.moving ?? false, spectrum });
      upd = null;
      if (clock < secs && performance.now() - begin < secs * 4000) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  env.update = update;
  ocean.updateSpectrum = spec;
  ocean.update = oceanUpdate;
  return { frames, state: window.app.mood.state() };
}, [start, seconds]);
const close = (a, b, what, eps) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await open(context, '?desktop&controls');

  // ── 1. A9 → A1 ──────────────────────────────────────────────────────────────────────
  {
    await page.evaluate(() => app.mood.set(1, -1, 0.5));
    await page.waitForFunction(() => !app.env.dirty);
    const s0 = await page.evaluate(() => app.mood.state());
    assert.equal(s0.moving, false, 'set() arrives at once');
    const { frames, state } = await record(page, 'app.mood.to(-1, 1)', 32);
    assert.equal(state.anchor, 'A1', 'the target is A1 at once');
    assert.equal(state.moving, true, 'still on its way after 32 s (the sea τ 10)');
    const n = frames.length, fps = n / frames[n - 1].t;
    assert.ok(frames[n - 1].t >= 31.9, `32 s on the frame clock, got ${frames[n - 1].t}`);
    let worst = '';
    for (const k of Object.keys(A1)) {
      const range = A1[k] - A9[k], dir = Math.sign(range);
      close(frames[0][k] - A9[k], 0, `${k} starts at A9`, Math.abs(range) * 0.05);
      let maxStep = 0;
      for (let i = 1; i < n; i++) {
        const step = (frames[i][k] - frames[i - 1][k]) * dir;
        assert.ok(step >= -1e-9 * Math.abs(range), `${k} monotonic at frame ${i}: ${frames[i - 1][k]} → ${frames[i][k]}`);
        // one frame (dt ≤ 0.1 s) moves at most 1 − e^(−0.1/τ) of the range; ×1.5 for a frame that waited
        maxStep = Math.max(maxStep, step / Math.abs(range));
      }
      assert.ok(maxStep <= 1.5 * (1 - Math.exp(-0.1 / TAU[k])), `${k}: a frame jumped ${maxStep.toFixed(4)} of the range`);
      // 95 % by 3τ (±0.5 s — the first frame lands after the call)
      const at = frames.find((f) => (f[k] - A9[k]) / range >= 0.95)?.t ?? Infinity;
      assert.ok(Math.abs(at - 3 * TAU[k]) <= 0.15 * 3 * TAU[k] + 0.5, `${k}: 95 % at ${at.toFixed(1)} s, 3τ = ${3 * TAU[k]} s`);
      worst += ` ${k} ${at.toFixed(1)}s/${(maxStep * 100).toFixed(2)}%`;
    }
    const moving = frames.filter((f) => f.moving);
    assert.ok(moving.length > 0.8 * n * (18 / 32), `the sky moved for ~18 s: ${moving.length}/${n} frames`);
    assert.ok(moving.every((f) => f.faces <= 1), `no full re-bake while moving: ${moving.filter((f) => f.faces > 1).length} frames`);
    // the waves move all 32 s: a spectrum every frame
    const spectra = frames[n - 1].spectrum;
    assert.ok(spectra >= 0.95 * n, `a spectrum every frame while the sea moves: ${spectra}/${n}`);
    report.push(`A9→A1: ${n} frames @ ${fps.toFixed(0)} fps, 95 % at / largest frame step:${worst}; `
      + `spectrum ${spectra}/${n}; sky moving ${moving.length} frames, ≤ 1 face each`);
  }

  // ── 2. the day 0.1 → 0.9 in A5 ──────────────────────────────────────────────────────
  {
    await page.evaluate(() => app.mood.set(0, 0, 0.1));
    await page.waitForFunction(() => !app.env.dirty);
    const { frames, state } = await record(page, 'app.mood.to(0, 0, 0.9)', 20);
    close(state.t, 0.9, 'the sun on the arc moves at once', 1e-9);
    const n = frames.length;
    let off = 0;
    for (let i = 1; i < n; i++) {
      const f = frames[i];
      assert.ok(f.azimuth >= frames[i - 1].azimuth - 1e-6, `azimuth monotonic at ${i}: ${frames[i - 1].azimuth} → ${f.azimuth}`);
      assert.ok(f.azimuth - frames[i - 1].azimuth <= 1.5 * 144 * (1 - Math.exp(-0.1 / 6)) + 0.5, `azimuth step at ${i}`);
      // the sky follows the walked day within ~0.1 s: elevation on the arc for its azimuth
      const t = 1 - (205 - f.azimuth) / 180;
      off = Math.max(off, Math.abs(f.elevation - sunAt(t).elevation));
    }
    assert.ok(off <= 1.5, `the sun stays on the arc: ${off.toFixed(2)}° off at most`);
    const mid = frames.find((f) => f.azimuth >= sunAt(0.5).azimuth);
    assert.ok(mid && mid.elevation > 55, `the sun passes noon high (${mid?.elevation.toFixed(1)}°), not along the horizon`);
    const at = frames.find((f) => (f.azimuth - sunAt(0.1).azimuth) / 144 >= 0.95)?.t;
    assert.ok(at > 15 && at < 20, `day 95 % at ${at?.toFixed(1)} s, 3τ = 18 s`);
    report.push(`day 0.1→0.9: ${n} frames, azimuth monotonic, ≤ ${off.toFixed(2)}° off the arc, noon at ${mid.elevation.toFixed(1)}°, 95 % at ${at.toFixed(1)} s`);
  }

  // ── 3. Controls during a move → custom, the world stops ─────────────────────────────
  {
    await page.evaluate(() => app.mood.set(1, -1, 0.5));
    await page.waitForFunction(() => !app.env.dirty);
    await page.evaluate(() => app.mood.to(-1, 1));
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lil-gui .lil-controller')].find((x) => x.querySelector('.lil-name')?.textContent === 'sunIntensity');
      const input = c.querySelector('input');
      input.value = '12';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const a = await page.evaluate(() => ({ s: app.mood.state(), wind: app.ocean.params.windSpeed, cc: app.env.params.cloudCoverage, si: app.env.params.sunIntensity }));
    await page.waitForTimeout(2000);
    const b = await page.evaluate(() => ({ s: app.mood.state(), wind: app.ocean.params.windSpeed, cc: app.env.params.cloudCoverage, si: app.env.params.sunIntensity }));
    assert.equal(a.s.custom, true, 'a Controls slider during a move → custom');
    assert.ok(a.wind > A9.windSpeed + 1 && a.wind < A1.windSpeed - 5, `stopped part way: wind ${a.wind}`);
    assert.equal(b.wind, a.wind, 'the sea stays where it stopped');
    assert.equal(b.cc, a.cc, 'the sky stays where it stopped');
    close(b.si, 12, 'the slider\'s value stays', 1e-9);
    assert.equal(b.s.moving, false, 'nothing moves');
    report.push(`custom: stopped at wind ${a.wind.toFixed(2)}, cloud ${a.cc.toFixed(3)}; 2 s later the same`);
  }
  await context.close();
  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
}
for (const line of report) console.log(line);
console.log(`probe-mood-m2 PASS (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
