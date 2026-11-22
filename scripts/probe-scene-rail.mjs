// SCENE-UI U1 (SCENE-UI-SPEC §4.7 п.1–3, 6, 7): the station rail and the camera flight.
// Every frame of every flight is sampled: never under the terrain floor, 1 m over the
// water mid-flight, no jumps, ≤ 5 s, sun / clouds / waves untouched. pointerdown in a
// flight hands the controls back at once (also when it grabs a frame), no tiles →
// story inactive, reduced motion → fade, no flight. Needs the stand on localhost:5199.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const START_TIMEOUT = 120000;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
const t0 = performance.now();

async function open(context, query, { tiles = false } = {}) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.app?.stations, {}, { timeout: START_TIMEOUT });
  if (tiles) await page.waitForFunction(() => app.tiles.loaded && app.tiles.interaction, {}, { timeout: START_TIMEOUT });
  await page.waitForTimeout(1000);
  return page;
}

// Samples the camera on every animation frame while a station flight runs.
async function fly(page, id, start) {
  return page.evaluate(async ({ id: station, start: shotName }) => {
    if (shotName) app.views[shotName]();
    await new Promise((r) => setTimeout(r, 300));
    const world = () => JSON.stringify({ sky: app.sky.params, ocean: app.ocean.params });
    const before = world(), samples = [];
    let on = true;
    const rec = () => {
      if (!on) return;
      const p = app.camera.position, t = app.controls.target;
      samples.push({ p: p.toArray(), t: t.toArray(), floor: app.rig.ground(p.x, p.z), water: app.camWater(),
        flying: app.rig.flying, u: app.rig.flight ? app.rig.flight.elapsed / app.rig.flight.duration : 1 });
      requestAnimationFrame(rec);
    };
    rec();
    const go = app.stations.go(station);
    const duration = app.rig.flight?.duration ?? null, ms0 = performance.now();
    const arrived = await go;
    const ms = performance.now() - ms0;
    await new Promise((r) => setTimeout(r, 100));
    on = false;
    return { arrived, duration, ms, samples, unchanged: world() === before, current: app.stations.current,
      enabled: app.controls.enabled, reasons: app.rig.reasons };
  }, { id, start });
}

function judge(name, r) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const s = r.samples;
  const steps = s.slice(1).map((x, i) => dist(x.p, s[i].p));
  const path = steps.reduce((a, b) => a + b, 0);
  const underFloor = s.filter((x) => x.p[1] < x.floor - 0.01).length;
  const mid = s.filter((x) => x.flying && x.u >= 0.25 && x.u <= 0.75);
  const underWater = mid.filter((x) => x.p[1] < x.water + 1 - 0.3).length;
  const out = { arrived: r.arrived, duration: r.duration, ms: Math.round(r.ms), frames: s.length, path: +path.toFixed(1),
    maxStepShare: +(Math.max(...steps) / path).toFixed(3), minClearance: +Math.min(...s.map((x) => x.p[1] - x.floor)).toFixed(2),
    underFloor, underWater, unchanged: r.unchanged, current: r.current, enabled: r.enabled };
  assert.equal(r.arrived, true, `${name}: arrived`);
  assert.ok(r.duration > 0 && r.duration <= 5, `${name}: duration ${r.duration}`);
  assert.equal(underFloor, 0, `${name}: frames under the terrain`);
  assert.equal(underWater, 0, `${name}: mid-flight frames under the water`);
  assert.ok(out.maxStepShare < 0.25, `${name}: a jump of ${out.maxStepShare} of the path`);
  assert.equal(r.unchanged, true, `${name}: sky or ocean params changed`);
  assert.equal(r.current, name.split('→')[1], `${name}: on station after arrival`);
  assert.equal(r.enabled, true, `${name}: controls back after arrival`);
  assert.deepEqual(r.reasons, []);
  return out;
}

const rail = (page) => page.evaluate(() => [...document.querySelectorAll('#stationRail .station')].map((b) => ({
  id: b.dataset.station, label: b.querySelector('.label').textContent, disabled: b.getAttribute('aria-disabled'),
  on: b.classList.contains('on'), last: b.classList.contains('last'), current: b.getAttribute('aria-current'),
  title: b.title, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })));

try {
  // --- no tiles: island and shore work, story / frame inactive (п.1, 2, 6) --------------
  const desktop = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'uk-UA' });
  const page = await open(desktop, '');
  report.railNoTiles = await rail(page);
  assert.deepEqual(report.railNoTiles.map((n) => n.label), ['Острів', 'Берег', 'Історія', 'Мить']);
  assert.deepEqual(report.railNoTiles.map((n) => n.disabled), ['false', 'false', 'true', 'true']);
  assert.equal(report.railNoTiles[2].title, 'Історію не завантажено');
  assert.ok(report.railNoTiles.every((n) => n.w >= 44 && n.h >= 44), 'nodes ≥ 44×44');
  report.storyWithoutTiles = await page.evaluate(() => app.stations.go('story'));
  assert.equal(report.storyWithoutTiles, false);

  report.flights = {};
  for (const [start, id] of [['Lagoon', 'shore'], [null, 'island'], ['Underwater', 'shore'], ['Aerial', 'shore'], [null, 'island']]) {
    const from = start ?? (await page.evaluate(() => app.stations.current));
    const name = `${from}→${id}`;
    report.flights[name] = judge(name, await fly(page, id, start));
  }
  // The underwater start rose through the surface.
  assert.ok(report.flights['Underwater→shore'].frames > 10);

  // Filled on the station, ring once the camera is moved away.
  report.railOnIsland = (await rail(page)).filter((n) => n.on || n.last || n.current);
  assert.deepEqual(report.railOnIsland.map((n) => [n.id, n.on, n.current]), [['island', true, 'location']]);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(820, 520, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  report.railAfterOrbit = (await rail(page)).filter((n) => n.on || n.last);
  assert.deepEqual(report.railAfterOrbit.map((n) => [n.id, n.on, n.last]), [['island', false, true]]);

  // Keys 1–3 (3 inactive without tiles).
  await page.keyboard.press('2');
  await page.waitForFunction(() => app.stations.current === 'shore', {}, { timeout: 10000 });
  await page.keyboard.press('3');
  await page.waitForTimeout(300);
  report.keys = await page.evaluate(() => ({ current: app.stations.current, flying: app.rig.flying }));
  assert.deepEqual(report.keys, { current: 'shore', flying: false });

  // п.3: pointerdown on the canvas mid-flight stops the camera, OrbitControls work at once.
  await page.evaluate(() => { app.stations.go('island'); });
  await page.waitForFunction(() => app.rig.flight && app.rig.flight.elapsed / app.rig.flight.duration > 0.4);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  const atDown = await page.evaluate(() => ({ flying: app.rig.flying, enabled: app.controls.enabled, reasons: app.rig.reasons,
    p: app.camera.position.toArray() }));
  await page.mouse.move(520, 320, { steps: 8 });
  const orbit = await page.evaluate((p) => Math.hypot(...app.camera.position.toArray().map((v, i) => v - p[i])), atDown.p);
  await page.mouse.up();
  report.interrupt = { ...atDown, orbitMoved: +orbit.toFixed(2) };
  assert.deepEqual([atDown.flying, atDown.enabled, atDown.reasons], [false, true, []]);
  assert.ok(orbit > 0.5, 'orbit works right after the interrupt');
  // A new press during a flight rebuilds from the current pose (no jump).
  const rebuilt = await page.evaluate(async () => {
    app.stations.go('island');
    await new Promise((r) => setTimeout(r, 700));
    const p = app.camera.position.clone();
    const go = app.stations.go('shore');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const step = app.camera.position.distanceTo(p);
    return { arrived: await go, firstStep: step };
  });
  report.rebuild = rebuilt;
  assert.equal(rebuilt.arrived, true);
  assert.ok(rebuilt.firstStep < 5, `rebuilt flight jumped ${rebuilt.firstStep} m`);
  await page.close();

  // --- tiles: story and a frame grabbed mid-flight (п.1, 2, 3) ---------------------------
  const tpage = await open(desktop, '?tiles=story-8-frames-hibrid', { tiles: true });
  report.railTiles = (await rail(tpage)).map((n) => [n.id, n.disabled]);
  assert.deepEqual(report.railTiles, [['island', 'false'], ['shore', 'false'], ['story', 'false'], ['frame', 'true']]);
  for (const [start, id] of [[null, 'island'], [null, 'story'], [null, 'shore'], [null, 'story']]) {
    const from = (await tpage.evaluate(() => app.stations.current)) ?? 'Tiles';
    const name = `${from}→${id}`;
    report.flights[name] = judge(name, await fly(tpage, id, start));
  }
  // Island → story, grab the nearest frame at 80 % of the flight, drag it.
  await tpage.evaluate(() => app.stations.go('island'));
  await tpage.waitForFunction(() => app.stations.current === 'island');
  await tpage.evaluate(() => { app.stations.go('story'); });
  await tpage.waitForFunction(() => app.rig.flight && app.rig.flight.elapsed / app.rig.flight.duration > 0.8);
  const spot = await tpage.evaluate(() => {
    const f = app.tiles.frameRegistry.entries[0], s = f.world.clone().project(app.camera);
    return { x: (s.x + 1) * innerWidth / 2, y: (1 - s.y) * innerHeight / 2, world: f.world.toArray(), id: f.id };
  });
  await tpage.mouse.move(spot.x, spot.y);
  await tpage.mouse.down();
  const grab = await tpage.evaluate(() => ({ flying: app.rig.flying, reasons: app.rig.reasons, enabled: app.controls.enabled,
    state: app.tiles.interaction.state }));
  await tpage.mouse.move(spot.x + 80, spot.y + 30, { steps: 10 });
  await tpage.waitForTimeout(400);
  await tpage.mouse.up();
  await tpage.waitForTimeout(500);
  const after = await tpage.evaluate((id) => {
    const f = app.tiles.frameRegistry.entries.find((e) => e.id === id);
    return { world: f.world.toArray(), reasons: app.rig.reasons, enabled: app.controls.enabled, state: app.tiles.interaction.state,
      p: app.camera.position.toArray() };
  }, spot.id);
  await tpage.mouse.move(150, 150);
  await tpage.mouse.down();
  await tpage.mouse.move(260, 180, { steps: 8 });
  await tpage.mouse.up();
  const orbitAfterDrag = await tpage.evaluate((p) => Math.hypot(...app.camera.position.toArray().map((v, i) => v - p[i])), after.p);
  report.grabInFlight = { grab, moved: +Math.hypot(...after.world.map((v, i) => v - spot.world[i])).toFixed(2),
    after: { reasons: after.reasons, enabled: after.enabled, state: after.state }, orbitAfterDrag: +orbitAfterDrag.toFixed(2) };
  assert.equal(grab.flying, false, 'the press stopped the flight');
  assert.deepEqual(grab.reasons, ['frame-drag'], 'the frame drag holds the only lock');
  assert.ok(report.grabInFlight.moved > 1, 'the frame moved');
  assert.deepEqual([after.reasons, after.enabled], [[], true], 'controls back after the drag');
  assert.ok(orbitAfterDrag > 0.5, 'orbit works after the drag');
  await tpage.close();
  await desktop.close();

  // --- п.7: reduced motion — fade out, place, fade in -----------------------------------
  const calm = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  const cpage = await open(calm, '');
  report.reducedMotion = await cpage.evaluate(async () => {
    const samples = [], fade = document.getElementById('stationFade');
    let on = true;
    const rec = () => {
      if (!on) return;
      samples.push({ p: app.camera.position.toArray(), opacity: +getComputedStyle(fade).opacity, flying: app.rig.flying });
      requestAnimationFrame(rec);
    };
    rec();
    const t = performance.now(), arrived = await app.stations.go('island'), ms = performance.now() - t;
    on = false;
    const moves = [];
    for (let i = 1; i < samples.length; i++) {
      const d = Math.hypot(...samples[i].p.map((v, k) => v - samples[i - 1].p[k]));
      if (d > 1e-3) moves.push({ i, d: +d.toFixed(1), opacity: samples[i].opacity });
    }
    return { arrived, ms: Math.round(ms), frames: samples.length, moves, everFlying: samples.some((s) => s.flying),
      maxOpacity: Math.max(...samples.map((s) => s.opacity)), endOpacity: samples.at(-1).opacity,
      current: app.stations.current, enabled: app.controls.enabled };
  });
  const rm = report.reducedMotion;
  assert.equal(rm.arrived, true);
  assert.equal(rm.everFlying, false, 'no flight with reduced motion');
  assert.equal(rm.moves.length, 1, 'the camera is placed once');
  assert.ok(rm.moves[0].opacity > 0.99, 'placed while the screen is dark');
  assert.ok(rm.ms >= 450 && rm.ms < 1500, `fade took ${rm.ms} ms`);
  assert.deepEqual([rm.current, rm.enabled], ['island', true]);
  await cpage.close();
  await calm.close();

  // --- phone: the F2/F3 strip and a bottom #perf stand above the rail -------------------
  const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const ppage = await open(phone, '?fps');
  await ppage.evaluate(() => app.techPanels.toggle('strip'));
  report.phone = await ppage.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const r = box('stationRail'), s = box('techStrip'), p = box('perf');
    return { labels: [...document.querySelectorAll('#stationRail .label')].map((l) => l.textContent),
      railInView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      railStrip: overlap(r, s), railPerf: overlap(r, p), stripPerf: overlap(s, p) };
  });
  assert.deepEqual(report.phone.labels, ['Island', 'Shore', 'Story', 'Moment']);
  assert.deepEqual([report.phone.railInView, report.phone.railStrip, report.phone.railPerf, report.phone.stripPerf], [true, 0, 0, 0]);
  await ppage.close();
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(report, null, 1));
  console.log('PASS probe-scene-rail');
} catch (error) {
  console.log(JSON.stringify({ report, errors }, null, 1));
  console.error('FAIL probe-scene-rail:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
