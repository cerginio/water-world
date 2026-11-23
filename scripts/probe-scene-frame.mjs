// SCENE-UI U2 (SCENE-UI-SPEC §4.3, §4.7 п.4–5): station «Мить». `→` walks all frames of
// the hybrid story in story order with the right N/M and wraps 8 → 1; the frame fills
// ~75 % of the screen; key 4 and a swipe across the node; a drifting frame stays on
// screen 30 s after arrival (the camera follows it ≤ 2 m/s) until the first touch; one
// frame — «Мить 1/1». Needs the stand on localhost:5199.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const START_TIMEOUT = 120000;
const DRIFT_S = Number(process.env.PROBE_DRIFT_S ?? 30);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
const t0 = performance.now();

async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.app?.stations && app.tiles.loaded && app.tiles.interaction, {}, { timeout: START_TIMEOUT });
  await page.waitForTimeout(1000);
  // NDC box of a frame's tiles as the GPU draws them (TileFrameQuery mode 0).
  await page.evaluate(async () => {
    const { TileFrameQuery } = await import('/src/tiles/TileFrameQuery.js');
    const ndcQuery = new TileFrameQuery(app.tiles, 0);
    window.__ndc = async (entry) => {
      const b = await ndcQuery.query(entry);
      return b && { minX: -b[0], minY: -b[1], maxX: b[2], maxY: b[3] };
    };
  });
  return page;
}

const node = (page) => page.evaluate(() => {
  const b = document.querySelector('#stationRail [data-station="frame"]'), r = b.getBoundingClientRect();
  return { label: b.querySelector('.label').textContent, aria: b.getAttribute('aria-label'), disabled: b.getAttribute('aria-disabled'),
    on: b.classList.contains('on'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

// After a frame arrival: which frame, the label, how much of the screen it fills.
const settle = (page) => page.evaluate(async () => {
  while (app.rig.flying || app.stations.current !== 'frame') await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 150));
  const i = app.stations.focus, entry = app.tiles.frameRegistry.byId.get(app.tiles.frames[i]) ?? app.tiles.frameRegistry.entries[i];
  const b = await __ndc(entry);
  return { focus: i, id: entry.id, label: document.querySelector('#stationRail [data-station="frame"] .label').textContent,
    fill: +Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2).toFixed(3),
    inside: b.minX >= -1 && b.maxX <= 1 && b.minY >= -1 && b.maxY <= 1,
    box: [b.minX, b.minY, b.maxX, b.maxY].map((x) => +x.toFixed(2)),
    camera: app.camera.position.toArray().map((x) => +x.toFixed(1)), target: app.controls.target.toArray().map((x) => +x.toFixed(1)) };
});

try {
  const desktop = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'uk-UA' });

  // --- п.4: → walks the story order, N/M right, 8 → 1 -----------------------------------
  const page = await open(desktop, '?tiles=story-8-frames-hibrid');
  report.before = await node(page);
  const count = await page.evaluate(() => app.tiles.frames.length);
  assert.equal(count, 8, 'hybrid story has 8 frames');
  assert.deepEqual([report.before.label, report.before.disabled], ['Мить 1/8', 'false']);
  await page.evaluate(() => app.stations.go('island'));
  await page.waitForFunction(() => app.stations.current === 'island');
  await page.keyboard.press('4');
  report.walk = [await settle(page)];
  for (let k = 0; k < count; k++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => app.rig.flying);
    report.walk.push(await settle(page));
  }
  const ids = await page.evaluate(() => app.tiles.frames);
  report.walk.forEach((w, k) => {
    const n = k % count;
    assert.equal(w.focus, n, `step ${k}: focus`);
    assert.equal(w.id, ids[n], `step ${k}: story order`);
    assert.equal(w.label, `Мить ${n + 1}/${count}`, `step ${k}: label`);
    assert.ok(w.inside, `step ${k}: frame inside the screen ${JSON.stringify(w)}`);
    assert.ok(w.fill > 0.65 && w.fill < 0.9, `step ${k}: fills ${w.fill} of the screen`);
  });
  report.walk = report.walk.map((w) => `${w.label} fill ${w.fill}`);

  // ← back, the node again → next, from another station → the frame in focus.
  await page.keyboard.press('ArrowLeft');
  report.back = (await settle(page)).label;
  assert.equal(report.back, 'Мить 8/8');
  await page.click('#stationRail [data-station="frame"]');
  report.again = (await settle(page)).label;
  assert.equal(report.again, 'Мить 1/8');
  await page.keyboard.press('1');
  await page.waitForFunction(() => app.stations.current === 'island');
  // ← → elsewhere do nothing.
  await page.keyboard.press('ArrowRight');
  report.arrowOffFrame = await page.evaluate(() => ({ flying: app.rig.flying, focus: app.stations.focus }));
  assert.deepEqual(report.arrowOffFrame, { flying: false, focus: 0 });
  await page.keyboard.press('4');
  report.returnTo = (await settle(page)).label;
  assert.equal(report.returnTo, 'Мить 1/8');

  // Swipe across the node: right — next, left — previous; no extra click step.
  const n = await node(page);
  await page.mouse.move(n.x - 30, n.y);
  await page.mouse.down();
  await page.mouse.move(n.x + 30, n.y, { steps: 6 });
  await page.mouse.up();
  report.swipeRight = (await settle(page)).label;
  await page.mouse.move(n.x + 30, n.y);
  await page.mouse.down();
  await page.mouse.move(n.x - 30, n.y, { steps: 6 });
  await page.mouse.up();
  report.swipeLeft = (await settle(page)).label;
  assert.deepEqual([report.swipeRight, report.swipeLeft], ['Мить 2/8', 'Мить 1/8']);
  // TileInteraction is not touched: nothing selected, no drag.
  report.interaction = await page.evaluate(() => ({ selected: app.tiles.interaction.selected?.id ?? null, state: app.tiles.interaction.state }));
  assert.deepEqual(report.interaction, { selected: null, state: 'idle' });
  await page.close();

  // --- п.5: drift — the frame stays on screen 30 s, the camera follows it ---------------
  const dpage = await open(desktop, '?tiles=story-8-frames-hibrid&tilesMode=drift');
  await dpage.evaluate(() => app.stations.go('frame'));
  const arrival = await settle(dpage);
  report.drift = await dpage.evaluate(async (seconds) => {
    const entry = app.tiles.frameRegistry.byId.get(app.tiles.frames[0]);
    const center = async () => { const b = await app.tiles.frameFootprint(entry); return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]; };
    const c0 = await center(), target0 = app.controls.target.clone(), samples = [];
    let speed = 0, last = app.controls.target.clone(), lastT = performance.now();
    const rec = () => {
      const now = performance.now(), dt = (now - lastT) / 1000;
      if (dt > 0.2) { speed = Math.max(speed, app.controls.target.distanceTo(last) / dt); last.copy(app.controls.target); lastT = now; }
      if (on) requestAnimationFrame(rec);
    };
    let on = true;
    rec();
    for (let s = 0; s < seconds; s += 5) {
      await new Promise((r) => setTimeout(r, 5000));
      const b = await __ndc(entry);
      samples.push({ s: s + 5, inside: b.minX >= -1 && b.maxX <= 1 && b.minY >= -1 && b.maxY <= 1,
        box: [b.minX, b.minY, b.maxX, b.maxY].map((x) => +x.toFixed(2)) });
    }
    on = false;
    const c1 = await center();
    return { frameMoved: +Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(2), cameraMoved: +app.controls.target.distanceTo(target0).toFixed(2),
      maxSpeed: +speed.toFixed(2), following: !!app.rig.following, current: app.stations.current, samples };
  }, DRIFT_S);
  report.drift.arrivalFill = arrival.fill;
  assert.ok(report.drift.samples.every((x) => x.inside), 'drifting frame left the screen');
  assert.ok(report.drift.maxSpeed <= 2.2, `followed at ${report.drift.maxSpeed} m/s`);
  assert.equal(report.drift.following, true);
  assert.equal(report.drift.current, 'frame', 'still on station while following');
  // The first touch ends the follow.
  await dpage.mouse.move(300, 300);
  await dpage.mouse.down();
  await dpage.mouse.up();
  report.drift.afterTouch = await dpage.evaluate(() => !!app.rig.following);
  assert.equal(report.drift.afterTouch, false);
  await dpage.close();

  // --- one frame: «Мить 1/1», → stays on it ---------------------------------------------
  const single = await open(desktop, '?tiles=story-8-frames-hibrid&tilesFrame=' + encodeURIComponent(ids[3]));
  report.single = [(await node(single)).label];
  await single.keyboard.press('4');
  report.single.push((await settle(single)).label);
  await single.keyboard.press('ArrowRight');
  report.single.push((await settle(single)).label);
  assert.deepEqual(report.single, ['Мить 1/1', 'Мить 1/1', 'Мить 1/1']);
  await single.close();

  // --- no tiles: «Мить» inactive ---------------------------------------------------------
  const empty = await desktop.newPage();
  await empty.goto(BASE);
  await empty.waitForFunction(() => window.app?.stations, {}, { timeout: START_TIMEOUT });
  report.noTiles = { ...(await node(empty)), go: await empty.evaluate(() => app.stations.go('frame')),
    next: await empty.evaluate(() => app.stations.nextFrame()) };
  assert.deepEqual([report.noTiles.label, report.noTiles.disabled, report.noTiles.go, report.noTiles.next], ['Мить', 'true', false, false]);
  await empty.close();
  await desktop.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(report, null, 1));
  console.log('PASS probe-scene-frame');
} catch (error) {
  console.log(JSON.stringify({ report, errors }, null, 1));
  console.error('FAIL probe-scene-frame:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
