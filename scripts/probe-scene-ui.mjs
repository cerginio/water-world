// SCENE-UI U0 (SCENE-UI-SPEC §3.3): hidden technical UI, F2/F3, URL parameters,
// no HUD DOM writes while hidden, benchmark and autoResolution unchanged, and the
// three-finger strip on a touch profile. Needs the stand on localhost:5199.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const START_TIMEOUT = 120000;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
const t0 = performance.now();

const panels = (page) => page.evaluate(() => ({
  controls: getComputedStyle(document.querySelector('.lil-gui.lil-root')).display !== 'none',
  fps: getComputedStyle(document.getElementById('perf')).display !== 'none',
  strip: getComputedStyle(document.getElementById('techStrip')).display !== 'none',
}));

async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.app?.techPanels, {}, { timeout: START_TIMEOUT });
  await page.waitForTimeout(500);
  return page;
}

const cameraPose = (page) => page.evaluate(() => [...app.camera.position.toArray(), ...app.controls.target.toArray()]);
const maxDelta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

try {
  const desktop = await browser.newContext({ viewport: { width: 1400, height: 1000 } });

  // 1. No parameters: neither panel.
  const page = await open(desktop, '');
  report.clean = await panels(page);
  assert.deepEqual(report.clean, { controls: false, fps: false, strip: false });

  // 2. F2 / F3 toggle independently; F3's default (find next) is prevented.
  await page.evaluate(() => {
    window.u0Keys = [];
    window.addEventListener('keydown', (e) => u0Keys.push([e.code, e.defaultPrevented]));
  });
  const steps = [];
  for (const key of ['F3', 'F2', 'F3', 'F2']) {
    await page.keyboard.press(key);
    steps.push({ key, ...(await panels(page)) });
  }
  report.keys = steps;
  assert.deepEqual(steps.map(({ controls, fps }) => [controls, fps]),
    [[false, true], [true, true], [true, false], [false, false]]);
  report.defaultPrevented = await page.evaluate(() => u0Keys);
  assert.ok(report.defaultPrevented.every(([, prevented]) => prevented), 'F2/F3 default must be prevented');
  // Modifiers leave the browser's own shortcuts alone.
  await page.keyboard.press('Shift+F3');
  assert.equal((await panels(page)).fps, false, 'Shift+F3 must not toggle');

  // 3. Focus in a lil-gui field: F2/F3 do nothing.
  await page.keyboard.press('F2');
  const input = page.locator('.lil-gui input[type="text"], .lil-gui input:not([type])').first();
  await page.evaluate(() => { const gui = document.querySelector('.lil-gui.lil-root'); if (gui.classList.contains('lil-closed')) gui.querySelector('.lil-title').click(); });
  await input.focus();
  const beforeEditing = await panels(page);
  await page.keyboard.press('F3');
  await page.keyboard.press('F2');
  report.editing = { before: beforeEditing, after: await panels(page) };
  assert.deepEqual(report.editing.after, beforeEditing, 'F2/F3 must not fire while editing');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('F2');

  // 5a. Hidden #perf gets no DOM writes, the benchmark returns the same object either way.
  const mutations = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const observer = new MutationObserver((list) => { n += list.length; });
    observer.observe(document.getElementById('perf'), { subtree: true, childList: true, characterData: true, attributes: true });
    setTimeout(() => { observer.disconnect(); resolve(n); }, 2000);
  }));
  report.hiddenPerfMutations = mutations;
  assert.equal(mutations, 0, 'hidden #perf must not be written');
  const shape = (r) => Object.keys(r).sort().join(',');
  const benchHidden = await page.evaluate(() => runBenchmark(10, { warmup: 2 }));
  await page.keyboard.press('F3');
  const benchShown = await page.evaluate(() => runBenchmark(10, { warmup: 2 }));
  report.benchmark = { hiddenMs: benchHidden.ms, shownMs: benchShown.ms, keys: shape(benchHidden) };
  assert.equal(shape(benchHidden), shape(benchShown));
  assert.ok(Number.isFinite(benchHidden.ms) && benchHidden.frames === 10);
  // Shown again, the panel updates.
  await page.waitForTimeout(800);
  report.shownFps = await page.evaluate(() => document.getElementById('pFps').textContent);
  assert.match(report.shownFps, /^\d+$/);
  await page.close();

  // 4. URL parameters.
  report.url = {};
  for (const [query, expected] of [
    ['?debug', { controls: true, fps: true, strip: false }],
    ['?fps', { controls: false, fps: true, strip: false }],
    ['?controls', { controls: true, fps: false, strip: false }],
  ]) {
    const p = await open(desktop, query);
    report.url[query] = await panels(p);
    assert.deepEqual(report.url[query], expected, query);
    await p.close();
  }
  await desktop.close();

  // 6. Touch profile: three fingers show the strip, the camera stays, buttons = keys.
  const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  for (const query of ['', '?tiles=story-8-frames-hibrid']) {
    const p = await open(phone, query);
    if (query) {
      await p.waitForFunction(() => app.tiles.loaded && app.tiles.interaction, {}, { timeout: START_TIMEOUT });
      await p.waitForTimeout(1500);
    }
    const cdp = await phone.newCDPSession(p);
    const points = [[150, 450], [206, 470], [262, 450]].map(([x, y], id) => ({ x, y, id }));
    const tap = async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
      await p.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(700);
    };
    const r = {};
    await p.waitForTimeout(500);
    const pose0 = await cameraPose(p);
    const framePoses = () => p.evaluate(() => (app.tiles.frameRegistry?.entries ?? []).flatMap((f) => f.world.toArray()));
    const poses0 = await framePoses();
    await tap();
    r.afterTap = await panels(p);
    r.cameraDelta = maxDelta(pose0, await cameraPose(p));
    // FD2 selects a frame under the first finger and keeps it once a second finger
    // arrives (as for a pinch); the tap must not start a drag or move a frame.
    r.interaction = await p.evaluate(() => app.tiles.interaction?.state ?? null);
    r.frameDelta = poses0.length ? maxDelta(poses0, await framePoses()) : 0;
    assert.deepEqual(r.afterTap, { controls: false, fps: false, strip: true }, `${query}: strip after tap`);
    assert.ok(r.cameraDelta < 1e-3, `${query}: camera moved by ${r.cameraDelta}`);
    assert.notEqual(r.interaction, 'dragging', `${query}: tap started a drag`);
    assert.ok(r.frameDelta < 1e-3, `${query}: a frame moved by ${r.frameDelta}`);
    // Buttons: 44×44 at least, and they toggle the same panels as the keys.
    r.buttons = await p.evaluate(() => [...document.querySelectorAll('#techStrip button')].map((b) => {
      const box = b.getBoundingClientRect();
      return { text: b.textContent, w: box.width, h: box.height, bottom: innerHeight - box.bottom };
    }));
    assert.ok(r.buttons.every((b) => b.w >= 44 && b.h >= 44), 'strip buttons ≥ 44×44');
    await p.locator('#techStrip button[data-panel="fps"]').tap();
    await p.locator('#techStrip button[data-panel="controls"]').tap();
    r.afterButtons = await panels(p);
    assert.deepEqual(r.afterButtons, { controls: true, fps: true, strip: true });
    r.perfAboveStrip = await p.evaluate(() => document.getElementById('perf').getBoundingClientRect().bottom
      <= document.getElementById('techStrip').getBoundingClientRect().top);
    assert.ok(r.perfAboveStrip, '#perf must sit above the strip');
    // A second tap hides the strip; panels stay.
    await tap();
    r.afterSecondTap = await panels(p);
    assert.deepEqual(r.afterSecondTap, { controls: true, fps: true, strip: false });
    report[`touch${query || '(none)'}`] = r;
    await p.close();
  }

  // 5b. autoResolution still steps down with the FPS panel hidden (mobile profile, throttled CPU).
  const p = await open(phone, '');
  const cdp = await phone.newCDPSession(p);
  const res0 = await p.evaluate(() => app.quality.resolution);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await p.waitForFunction((r) => app.quality.resolution < r, res0, { timeout: 60000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  report.autoResolution = { from: res0, to: await p.evaluate(() => app.quality.resolution), fpsShown: (await panels(p)).fps };
  assert.equal(report.autoResolution.fpsShown, false);
  await p.close();
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(report, null, 1));
  console.log('PASS probe-scene-ui');
} catch (error) {
  console.log(JSON.stringify({ report, errors }, null, 1));
  console.error('FAIL probe-scene-ui:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
