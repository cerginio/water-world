// story-quest QDa (STORY-QUEST-SPEC §4.4; HANDOFF п.13): the scene's contract for products. A
// test host — a page of the same origin with the scene in an <iframe ?…&embed> — brings the
// scene by commands alone (postMessage, nothing else) to the deep states of the route: a raft
// under the kite in the open sea, the board over deep water, the walker under the water by a
// sunk frame. state.read confirms each, and the iframe's own app the GPU side of it (the
// camera under the water). Then the anchors resolve for every story of the test set.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-embed');
mkdirSync(out, { recursive: true });
const STORY = 'test-2025/my-day-3-moments';
const SET = ['test-2025/my-day-3-moments', 'public-test/frog-fairy-full', 'local/story-8-frames-hibrid'];
const report = { base, steps: [] };
const productMode = process.argv.includes('--product');
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL, args: ['--use-angle=d3d11'] });
const errors = [];

// the host: the protocol from the outside, as a product speaks it (no import of src/)
const HOST = `<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}</style>
<iframe id="scene"></iframe>
<script>
  const CHANNEL = 'ultra-water/scene', frame = document.getElementById('scene'), pending = new Map();
  let seq = 0;
  window.__ev = []; window.__ready = null;
  addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== frame.contentWindow || !m || m.channel !== CHANNEL) return;
    if (m.type === 'ready') window.__ready = m;
    else if (m.type === 'event') __ev.push(m);
    else if (m.type === 'result') { pending.get(m.id)?.(m); pending.delete(m.id); }
  });
  window.load = (url) => new Promise((resolve) => {
    window.__ready = null; __ev.length = 0;
    frame.src = url;
    const hello = setInterval(() => {
      if (window.__ready) { clearInterval(hello); resolve(window.__ready); return; }
      frame.contentWindow?.postMessage({ channel: CHANNEL, type: 'hello' }, location.origin);
    }, 150);
  });
  window.call = (cmd, args) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, reason: 'timeout', message: cmd }); }, 25000);
    frame.contentWindow.postMessage({ channel: CHANNEL, type: 'call', id, cmd, args }, location.origin);
  });
</script>`;

const step = async (page, cmd, args = {}) => {
  const t = performance.now();
  console.log(`embed: ${cmd}`);
  const r = await page.evaluate(([c, a]) => window.call(c, a), [cmd, args]);
  report.steps.push({ cmd, args, ok: r.ok, reason: r.reason, ms: Math.round(performance.now() - t) });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return r;
};
const must = async (page, cmd, args) => {
  const r = await step(page, cmd, args);
  assert.ok(r.ok, `${cmd} ${JSON.stringify(args ?? {})}: ${r.reason} — ${r.message}`);
  return r.value;
};
const events = (page) => page.evaluate(() => __ev.map((e) => e.name));
// the iframe's GPU side: the camera against the water there (the probe may look; a product may not)
const scene = (page) => productMode ? page.frames().find((f) => new URL(f.url()).pathname === '/' && f.parentFrame()?.parentFrame())
  : page.frame({ name: 'scene' }) ?? page.frames()[1];
const camera = (page) => scene(page).evaluate(() => ({ y: app.camera.position.y, water: app.camWater() }));

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (productMode) {
    await page.context().grantPermissions(['local-network-access']);
    const hostOrigin = process.env.EMBED_HOST_ORIGIN ?? 'http://127.0.0.1:8184';
    const productUrl = new URL('products/story-quest/', base);
    productUrl.search = `?story=${STORY}&embed&embed-origin=${encodeURIComponent(hostOrigin)}`;
    const html = HOST.replaceAll('location.origin);', `${JSON.stringify(new URL(base).origin)});`);
    await page.route(`${hostOrigin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(hostOrigin);
    await page.evaluate((url) => Promise.race([window.load(url), new Promise((_, reject) => setTimeout(() => reject(new Error('product hello timeout')), 12000))]), productUrl.href);
    assert.ok(await page.evaluate(() => __ready.commands.includes('quest.start')));
    await page.waitForFunction(() => __ev.some((e) => e.name === 'scene.ready'), {}, { timeout: 30000 });
    const product = page.frames().find((f) => f.url().includes('/products/story-quest/'));
    await product.waitForFunction(() => !!window.storyQuest?.quests.log, {}, { timeout: 10000 });
    assert.equal((await step(page, 'quest.start', { id: 'unknown' })).reason, 'unknown-quest');
    for (const id of ['find', 'note']) {
      const result = await must(page, 'quest.start', { id });
      assert.deepEqual(result, { id, status: 'started' });
    }
    assert.equal(await product.getByTestId('quest-note-text').isVisible(), true);
    await page.screenshot({ path: join(out, 'product-quests.png') });
    const paused = await must(page, 'deactivate');
    await page.waitForTimeout(400);
    assert.deepEqual(await scene(page).evaluate(() => app.lifecycle.read()), paused, 'RAF really stopped');
    const before = await scene(page).evaluate(() => app.walker.state.x);
    const activated = await must(page, 'activate');
    assert.ok(activated.active && activated.frames > paused.frames, `activation ack ${JSON.stringify(activated)}`);
    await scene(page).waitForFunction((frames) => app.lifecycle.read().frames > frames, activated.frames, { timeout: 3000 });
    const resumed = await scene(page).evaluate(() => app.lifecycle.read());
    report.lifecycle = { paused, activated, resumed };
    assert.ok(resumed.active && resumed.frames > paused.frames, `resumed ${JSON.stringify(resumed)}`);
    assert.ok(Math.abs(await scene(page).evaluate(() => app.walker.state.x) - before) < 0.1, 'no time jump');

    // Headless Chrome не приховує вкладку при bringToFront: перевірка DOM visibility handler.
    await scene(page).evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = await scene(page).evaluate(() => app.lifecycle.read());
    await page.waitForTimeout(200);
    assert.deepEqual(await scene(page).evaluate(() => app.lifecycle.read()), hidden);
    assert.equal(hidden.active, false);
    await scene(page).evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await scene(page).waitForFunction((frames) => app.lifecycle.read().frames > frames, hidden.frames, { timeout: 3000 });
    report.visibilityHandler = 'PASS (simulated document.hidden, not physical tab switching)';
    const disposed = await must(page, 'dispose');
    assert.equal(disposed.disposed, true);
    assert.equal(await product.getByTestId('product-scene').count(), 0);
    // Той самий дозволений origin у URL не дозволяє чужому parent викликати API.
    const evil = 'http://127.0.0.1:8185';
    await page.route(`${evil}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(evil);
    await page.evaluate((url) => {
      document.getElementById('scene').src = url;
      window._hello = setInterval(() => document.getElementById('scene').contentWindow.postMessage({ channel: 'ultra-water/scene', type: 'hello' }, new URL(url).origin), 100);
    }, productUrl.href);
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => __ready), null, 'foreign parent receives no ready');
    await page.evaluate(() => clearInterval(window._hello));
    report.foreignOriginRejected = true;
    assert.deepEqual(errors.filter((e) => !/favicon|404/.test(e)), []);
    report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`PASS probe-story-embed --product ${report.seconds} s → ${out}`);
  } else {
  await page.goto(`${base}src/embed/protocol.js`);   // any document of the origin, replaced by the host
  await page.setContent(HOST);
  await page.evaluate(() => { document.getElementById('scene').name = 'scene'; });

  // 0. hello → ready with the closed list; the scene comes up
  const ready = await page.evaluate((url) => window.load(url), `/?story=${STORY}&walk&minis&embed`);
  assert.equal(ready.version, 1);
  assert.ok(ready.commands.includes('swim.dive') && ready.commands.includes('state.read'), `commands: ${ready.commands}`);
  report.commands = ready.commands.length;
  await page.waitForFunction(() => __ev.some((e) => e.name === 'scene.ready'), {}, { timeout: 90000 });
  const panels = await scene(page).evaluate(() => ({ gui: !!document.querySelector('.lil-gui.root')?.checkVisibility(),
    perf: !!document.getElementById('perf')?.checkVisibility() }));
  report.panels = panels;
  assert.deepEqual(panels, { gui: false, perf: false }, 'no technical panels in the iframe');

  // refusals are reasons, not exceptions
  assert.equal((await step(page, 'walker.fly')).reason, 'unknown-command');
  assert.equal((await step(page, 'walker.place', { at: 'moon' })).reason, 'unknown-anchor');
  assert.equal((await step(page, 'raft.board', { frame: 0 })).reason, 'not-on-water', 'a miniature is not a deck');

  // 1. a raft under the kite in the open sea
  const t1 = performance.now();
  await must(page, 'minis.hydrate', { frame: 0 });
  await must(page, 'raft.board', { frame: 0 });
  await must(page, 'kite.set', { up: true });
  let s = await must(page, 'raft.moveTo', { frame: 0, at: 'open-sea' });
  await page.waitForFunction(() => __ev.some((e) => e.name === 'raft.sea'), {}, { timeout: 15000 });
  s = await must(page, 'state.read');
  report.raft = { seconds: +((performance.now() - t1) / 1000).toFixed(1), walker: s.walker, kite: s.kite, openSea: s.openSea };
  assert.equal(s.mode, 'eyes');
  assert.equal(s.walker.deck, 0, 'on frame 0\'s deck');
  assert.ok(s.kite && s.openSea, `kite up in the open sea (${JSON.stringify(s)})`);
  assert.ok(Math.max(Math.abs(s.walker.x), Math.abs(s.walker.z)) > 900, 'past the shore map\'s edge');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, 'raft-open-sea.png') });

  // 2. the board over deep water
  await must(page, 'fly.takeOff');
  s = await must(page, 'fly.to', { at: 'beside:0' });
  await page.waitForTimeout(1500);
  s = await must(page, 'state.read');
  report.flight = { walker: s.walker, kite: s.kite };
  assert.ok(s.walker.flight && s.kite, 'in the air with the kite');
  assert.equal(s.walker.landing, 'water', 'over deep water');
  assert.equal(s.hints.fly, 'water', 'the button reads «into the water»');
  await page.screenshot({ path: join(out, 'flight-deep.png') });

  // 3. under the water by a sunk frame: another frame beside the raft, sunk; the walker 30 m down over it
  const t3 = performance.now();
  await must(page, 'minis.hydrate', { frame: 1 });
  await must(page, 'raft.moveTo', { frame: 1, at: 'beside:0' });
  s = await must(page, 'fate.give', { frame: 1, kind: 'sink' });
  assert.equal(s.frames[1].fate.kind, 'sink');
  assert.ok(s.frames[1].fate.t >= 1, `sunk (${JSON.stringify(s.frames[1])})`);
  await must(page, 'swim.in', { at: 'over:1', depth: 30 });
  s = await must(page, 'walker.look', { pitch: -1.2 });
  await page.waitForTimeout(2000);
  s = await must(page, 'state.read');
  const cam = await camera(page);
  report.under = { seconds: +((performance.now() - t3) / 1000).toFixed(1), swim: s.walker.swim, camera: cam };
  assert.ok(s.walker.swim && s.walker.swim.depth > 25, `30 m down (${JSON.stringify(s.walker.swim)})`);
  assert.ok(cam.y - cam.water < -20, `the camera deep under the water: ${(cam.y - cam.water).toFixed(1)} m`);
  assert.equal(s.hints.fly, 'rise');
  await page.screenshot({ path: join(out, 'under-sunk.png') });
  s = await must(page, 'swim.rise');
  assert.equal(s.walker.swim.depth, 0);

  // the route's facts came as events
  const names = await events(page);
  report.events = [...new Set(names)];
  for (const n of ['scene.ready', 'minis.take', 'minis.hydrate', 'raft.board', 'raft.kite', 'raft.sea', 'raft.takeoff', 'fate.change']) {
    assert.ok(names.includes(n), `event ${n} (${report.events})`);
  }

  // 4. the anchors for every story of the test set (no &minis: every frame is a deck)
  report.stories = {};
  for (const story of SET) {
    const t = performance.now();
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.evaluate((url) => window.load(url), `/?story=${story}&walk&embed`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.waitForFunction(() => __ev.some((e) => e.name === 'scene.ready' || e.name === 'scene.failed'), {}, { timeout: 120000 });
    // oxlint-disable-next-line eslint/no-await-in-loop
    const beach = await must(page, 'walker.place', { at: 'beach' });
    // oxlint-disable-next-line eslint/no-await-in-loop
    const shallow = await must(page, 'walker.place', { at: 'shallow' });
    // oxlint-disable-next-line eslint/no-await-in-loop
    const sea = await must(page, 'raft.moveTo', { frame: 0, at: 'open-sea' });
    report.stories[story] = { seconds: +((performance.now() - t) / 1000).toFixed(1), frames: sea.frames.length,
      beach: [beach.walker.x, beach.walker.z], shallow: [shallow.walker.x, shallow.walker.z, shallow.walker.y],
      sea: [sea.frames[0].x, sea.frames[0].z] };
    assert.ok(beach.walker.y > 0.5, `${story}: the beach is land (${beach.walker.y})`);
    assert.ok(shallow.walker.y < 0.2 && shallow.walker.y > -0.5, `${story}: the shallow is at the wading line (${shallow.walker.y})`);
    assert.ok(Math.hypot(sea.frames[0].x, sea.frames[0].z) > 1250, `${story}: frame 0 in the open sea`);
  }

  const own = errors.filter((e) => !/favicon|404/.test(e));
  assert.deepEqual(own, [], 'no page errors');
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS probe-story-embed ${report.seconds} s → ${out}`);
  }
} catch (e) {
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
