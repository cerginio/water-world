// SCENE-ENVIRONMENT E0: the cost of one sky change, step by step.
// - `?fps`: after a sun change the GPU timer has its own `sky` line (the HUD lists timer.ms);
// - app.measureEnvironment() returns six finite numbers (lut, cube, pmrem, pmrem256, spectrum > 0; shadow ≥ 0);
// - a second measurement sees the same PMREM cost (the shared PMREMGenerator is not disturbed);
// - after measuring, the sky is unchanged: sunDir and the HUD still work, no page errors.
// - the «Measure sky» button (#pSky, the phone path) prints the table into the HUD;
// - a double tap / double click on the panel copies its text to the clipboard.
// Prints the table for QA.md. PROBE_BASE=<deploy> measures a deploy; PROBE_REPEATS=N (1..60).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const REPEATS = Number(process.env.PROBE_REPEATS ?? 10);
const START_TIMEOUT = 120000;
const STEPS = ['lut', 'cube', 'pmrem', 'pmrem256', 'shadow', 'spectrum'];
const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL('?fps', BASE).href);
  await page.waitForFunction(() => window.app?.measureEnvironment, {}, { timeout: START_TIMEOUT });

  // a sun change -> the `sky` label (only where the timer extension exists)
  const timerAvailable = await page.evaluate(() => app.timer.available);
  const sunBefore = await page.evaluate(() => app.sky.sunDir.toArray());
  await page.evaluate(() => { app.sky.params.elevation += 0.5; app.markSun(); });
  if (timerAvailable) {
    await page.waitForFunction(() => 'sky' in app.timer.ms, {}, { timeout: 10000 });
    await page.waitForFunction(() => /\n\s+sky\s/.test(document.getElementById('hud').textContent), {}, { timeout: 10000 });
  }
  await page.evaluate(() => { app.sky.params.elevation -= 0.5; app.markSun(); });
  await page.waitForTimeout(300);
  const sunRestored = await page.evaluate(() => app.sky.sunDir.toArray());
  sunRestored.forEach((v, i) => assert.ok(Math.abs(v - sunBefore[i]) < 1e-6, `sunDir restored: ${sunRestored} vs ${sunBefore}`));

  const m = await page.evaluate((repeats) => app.measureEnvironment({ repeats }), REPEATS);
  // the shadow is below the timing noise on a desktop GPU (≤ 0.6 ms) — shadowCalls proves it re-renders
  for (const k of STEPS) assert.ok(Number.isFinite(m[k]) && (k === 'shadow' ? m[k] >= 0 : m[k] > 0), `${k} = ${m[k]} (raw ${JSON.stringify(m.raw)})`);
  const sunAfter = await page.evaluate(() => app.sky.sunDir.toArray());
  sunAfter.forEach((v, i) => assert.ok(Math.abs(v - sunBefore[i]) < 1e-6, 'measuring does not move the sun'));

  // a second run must see the same PMREM cost: three's shared PMREMGenerator, used for another
  // cube size in between, rebuilt the scene's 1024² PMREM with stale meshes in ~1 ms (and wrong)
  const again = await page.evaluate((repeats) => app.measureEnvironment({ repeats }), REPEATS);
  assert.ok(again.pmrem > 0.5 * m.pmrem, `repeatable PMREM: ${again.pmrem.toFixed(2)} after ${m.pmrem.toFixed(2)} ms`);
  assert.ok(m.raw.shadowCalls > 0, `the shadow pass re-renders casters: ${m.raw.shadowCalls} extra draw calls`);
  // the loop runs again after measuring (the GPU timer is no witness: headless ANGLE drops its queries)
  const o0 = await page.evaluate(() => app.ocean.time);
  await page.waitForTimeout(1000);
  const advance = await page.evaluate((o) => app.ocean.time - o, o0);
  assert.ok(advance > 0.2, `render loop resumed: ocean advanced ${advance} s in 1 s`);
  // the phone path: the «Measure sky» button in the FPS panel prints the table into the HUD
  await page.click('#pSky');
  await page.waitForFunction(() => /pmrem \d+\.\d\d/.test(document.getElementById('hud').textContent), {}, { timeout: 60000 });
  const hudLine = await page.evaluate(() => document.getElementById('hud').textContent.split('\n').filter((l) => /sky change|shadow .* spectrum/.test(l)).join(' | '));
  // double tap / double click on the panel copies its text, with the Measure sky lines
  await page.dblclick('#pGpu');
  await page.waitForFunction(() => document.getElementById('perf').dataset.copied, {}, { timeout: 5000 });
  const copied = await page.evaluate(async () => ({ flag: document.getElementById('perf').dataset.copied, text: await navigator.clipboard.readText() }));
  assert.equal(copied.flag, 'ok', 'panel copy reports success');
  assert.match(copied.text, /sky change \(ms, \d+×\): lut [\d.]+ +cube [\d.]+ +pmrem [\d.]+/, 'clipboard has the Measure sky line');
  assert.match(copied.text, /ANGLE|WebGL|Radeon|Mozilla/, 'clipboard has the GPU / browser line');
  const gpu = await page.evaluate(() => {
    const ext = app.renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    return ext ? app.renderer.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  assert.deepEqual(errors, [], 'no page errors');

  console.log(`GPU: ${gpu}; viewport ${m.viewport.width}x${m.viewport.height}; cube ${m.cubeSize}², shadow ${m.shadowSize}²; repeats ${m.repeats}; timer ext ${timerAvailable}`);
  console.log('| крок | мс |\n|---|---|');
  for (const k of STEPS) console.log(`| ${k} | ${m[k].toFixed(2)} |`);
  console.log(`| разом (зміна неба) | ${['lut', 'cube', 'pmrem', 'shadow'].reduce((a, k) => a + m[k], 0).toFixed(2)} |`);
  console.log(`raw ${JSON.stringify(Object.fromEntries(Object.entries(m.raw).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  console.log(`HUD: ${hudLine}`);
  console.log(`PASS probe-scene-env-measure ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
}
