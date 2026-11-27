// story-quest Q7 (STORY-QUEST-SPEC §2, §8 Q7; HANDOFF п.16): the product on a phone-sized touch page.
// The route of §2 — the choice of a story (title, author, frames) → the island in the eyes → two
// miniatures (the backpack: one in the hands, one packed, swapped by a tap in the Backpack zone) →
// the water → the raft in the open sea → a fate → a card — with «Затихнути» and «На берег» always in
// sight and working by a tap, the language switch reaching the scene's own buttons, and
// prefers-reduced-motion opening straight in the eyes (no overview flight). The route's middle is
// put by the contract (the cards' way, QDb); the product's own controls are tapped.
// The probe reads the iframe's window.app to check the scene (the product never does).
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-product');
mkdirSync(out, { recursive: true });
const STORY = 'test-2025/my-day-3-moments';
const report = { base };
const t0 = performance.now();
const errors = [];
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'uk-UA' };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const call = async (page, cmd, args = {}) => {
  const r = await page.evaluate(([c, a]) => window.storyQuest.host.call(c, a), [cmd, args]);
  assert.ok(r.ok, `${cmd} ${JSON.stringify(args)}: ${r.reason} ${r.message}`);
  return r.value;
};
const scene = (page) => page.frames().find((f) => f !== page.mainFrame());
const inScene = (page, fn, arg) => scene(page).evaluate(fn, arg);
/** ms from the scene's ready (the product's «ready») to the walker in the eyes */
const timeToEyes = async (page) => {
  await page.waitForFunction(() => document.body.dataset.storyState === 'ready', {}, { timeout: 120000 });
  const start = Date.now();
  await scene(page).waitForFunction(() => window.app.walker?.mode === 'eyes', {}, { timeout: 30000, polling: 50 });
  return Date.now() - start;
};

try {
  // 1. no story: the choice over the island — title, author, frames; no walker yet; the calm bar
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}products/story-quest/`);
  await page.waitForSelector('.story-choice-pick', { timeout: 60000 });
  report.choice = await page.$$eval('.story-choice-pick', (bs) => bs.map((b) => ({ id: b.dataset.story,
    title: b.querySelector('.story-choice-title')?.textContent, meta: b.querySelector('.story-choice-meta')?.textContent ?? '' })));
  assert.ok(report.choice.length >= 3, 'the catalog is offered');
  assert.ok(report.choice.every((s) => s.title && /кадр/.test(s.meta)), 'every story says its frames');
  assert.ok(report.choice.some((s) => s.meta.startsWith('автор: ')), 'a story with a credit names its author');
  report.calm = await page.$$eval('#calmBar button', (bs) => bs.map((b) => b.textContent));
  assert.deepEqual(report.calm, ['На берег', 'Затихнути']);
  assert.equal(await inScene(page, () => !!document.querySelector('#walkerControls')), false, 'no walker without a story');
  await page.screenshot({ path: join(out, '1-choice.png') });

  // 2. a tap: the story loads in the product's route (walk + minis), the overview, then the eyes
  await page.tap(`.story-choice-pick[data-story="${STORY}"]`);
  report.url = new URL(page.url()).search;
  assert.equal(report.url, `?story=${STORY}`);
  report.eyesMs = await timeToEyes(page);
  const flags = await inScene(page, () => location.search);
  assert.match(flags, /walk/);
  assert.match(flags, /minis/);
  assert.match(flags, /lang=uk/);
  assert.ok(report.eyesMs > 1500, `the overview first (${report.eyesMs} ms)`);
  assert.equal(await inScene(page, () => document.querySelector('.walker-toggle')?.textContent), 'Вийти з тіла');

  // 3. two miniatures: the second take stows the first; a tap in the Backpack zone swaps them
  await call(page, 'minis.take', { frame: 0 });
  let s = await call(page, 'minis.take', { frame: 1 });
  assert.deepEqual([s.carried, s.pack], [1, [0]], 'one in the hands, one in the backpack');
  await page.tap('.panel-open');
  await page.waitForSelector('details[data-zone="pack"] li[data-frame="0"] button');
  await page.screenshot({ path: join(out, '2-backpack.png') });
  await page.tap('details[data-zone="pack"] li[data-frame="0"] button');
  await page.waitForFunction(() => document.querySelector('details[data-zone="pack"] .zone-body')?.dataset.hands === '0', {}, { timeout: 10000 });
  s = await call(page, 'state.read');
  assert.deepEqual([s.carried, s.pack], [0, [1]], 'swapped by a tap');
  report.backpack = { carried: s.carried, pack: s.pack };
  assert.equal(await page.$eval('#calmBar', (b) => getComputedStyle(b).bottom), '0px', 'the calm bar at the panel\'s foot');
  await page.tap('.panel-close');

  // 4. the water, the raft in the open sea, a fate (the facts reach the Quests zone)
  await call(page, 'minis.hydrate', { frame: 0 });
  await call(page, 'raft.board', { frame: 0 });
  await call(page, 'kite.set', { up: true });
  s = await call(page, 'raft.moveTo', { frame: 0, at: 'open-sea' });
  await page.waitForFunction(() => document.querySelector('.quests li[data-task="sea"] .quest-fact')?.textContent === 'У морі', {}, { timeout: 30000 });
  await call(page, 'fate.give', { frame: 0, kind: 'release' });
  s = await call(page, 'state.read');
  assert.equal(s.mode, 'eyes');
  assert.ok(s.walker.flight, 'the fate from the raft lifts the walker');

  // 5. «Затихнути» by a tap: the weather goes to the calm (A9), the Weather zone says so
  await page.tap('#quietDown');
  await scene(page).waitForFunction(() => { const m = window.app.mood.state(); return m.v === 1 && m.a === -1; }, {}, { timeout: 5000 });
  report.quiet = await inScene(page, () => { const m = window.app.mood.state(); return { v: m.v, a: m.a, anchor: m.anchor }; });

  // 6. «На берег» by a tap, from the air over the open sea: on the beach, in the eyes, the kite down;
  //    the fate stays, the backpack keeps what it holds
  await page.tap('#toShore');
  await scene(page).waitForFunction(() => { const w = window.app.walker.state; return !w.flight && !w.deck && !w.swim && Math.hypot(w.x, w.z) < 1000; }, {}, { timeout: 20000 });
  s = await call(page, 'state.read');
  const spawn = await inScene(page, () => { const w = window.app.walker.state; return { x: w.x, z: w.z, ground: window.app.ground(w.x, w.z).height }; });
  report.shore = { mode: s.mode, kite: s.kite, x: s.walker.x, z: s.walker.z, ground: Math.round(spawn.ground * 100) / 100,
    fate: s.frames[0].fate?.kind, pack: s.pack, carried: s.carried };
  assert.equal(s.mode, 'eyes');
  assert.equal(s.kite, false);
  assert.ok(spawn.ground >= -0.5, 'feet on wadeable ground');
  assert.equal(s.frames[0].fate?.kind, 'release', 'the fate is not undone by the shore');
  assert.deepEqual(s.pack, [1]);

  // 7. a card by taps, bound to the frame of the fate
  await page.tap('.panel-open');
  await page.tap('details[data-zone="cards"] button[data-act="add"]');
  await page.waitForSelector('#cardEditor:not([hidden]) textarea');
  await page.fill('#cardText', 'Q7: на березі після відпущеного кадру.');
  await page.tap('#cardEditor button[data-act="save"]');
  await page.waitForFunction(() => document.querySelectorAll('#cardList li').length >= 1, {}, { timeout: 5000 });

  // 8. English: the panel, the calm bar and the scene's own buttons
  await page.selectOption('#productLocale', 'en');
  await page.tap('.panel-close');
  await scene(page).waitForFunction(() => document.querySelector('.walker-toggle')?.textContent === 'Out of the body', {}, { timeout: 5000 });
  report.en = { calm: await page.$$eval('#calmBar button', (bs) => bs.map((b) => b.textContent)),
    toggle: await inScene(page, () => document.querySelector('.walker-toggle').textContent) };
  assert.deepEqual(report.en.calm, ['To the shore', 'Quiet down']);
  await page.screenshot({ path: join(out, '3-shore-en.png') });
  await ctx.close();

  // 9. prefers-reduced-motion: straight into the eyes, no overview flight
  const quiet = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
  const still = await quiet.newPage();
  watch(still);
  await still.goto(`${base}products/story-quest/?story=${STORY}`);
  report.reducedEyesMs = await timeToEyes(still);
  assert.ok(report.reducedEyesMs < 1000, `no overview flight with reduced motion (${report.reducedEyesMs} ms)`);
  await quiet.close();

  // 10. «Місце» by taps (ISLAND-MAPS-SPEC §2, §5 п.1, п.2; terra T4): island → lagoon → island;
  //     the product's URL, the iframe and state.read() say the map; a reload keeps the choice; a card
  //     saved on one map is on the other; the route starts over (the walker back at the start)
  const placeCtx = await browser.newContext(PHONE);
  const pg = await placeCtx.newPage();
  watch(pg);
  const picked = () => pg.$eval('.place-pick[aria-pressed="true"]', (b) => b.dataset.map);
  const onMap = async (id) => {
    await timeToEyes(pg);
    const st = await call(pg, 'state.read');
    const frame = await inScene(pg, () => new URLSearchParams(location.search).get('map'));
    const w = await inScene(pg, () => { const s = window.app.walker.state; return { x: s.x, z: s.z, ground: window.app.ground(s.x, s.z).height }; });
    return { map: st.map, product: new URL(pg.url()).searchParams.get('map'), frame, carried: st.carried, pack: st.pack,
      walker: { x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10, ground: Math.round(w.ground * 100) / 100 } };
  };
  const openStoryZone = async () => {
    if (await pg.$eval('body', (b) => b.dataset.panelOpen) !== 'true') await pg.tap('.panel-open');
    if (!await pg.$eval('details[data-zone="story"]', (d) => d.open)) await pg.tap('details[data-zone="story"] > summary');
    await pg.waitForSelector('.place-pick[data-map="lagoon"]');
  };
  const tapPlace = async (id) => {
    await openStoryZone();
    await pg.tap(`.place-pick[data-map="${id}"]`);
    await pg.waitForFunction((m) => new URL(location.href).searchParams.get('map') === m, id, { timeout: 5000 });
  };
  const cards = () => pg.$$eval('#cardList li .note-text', (ps) => ps.map((p) => p.textContent));
  await pg.goto(`${base}products/story-quest/?story=${STORY}`);
  const place = { island: await onMap('island') };
  assert.equal(place.island.map, 'island');
  assert.equal(place.island.frame, null, 'island: no map in the iframe');
  await openStoryZone();
  assert.equal(await picked(), 'island');
  place.note = await pg.$eval('.place-note', (p) => p.textContent);
  assert.match(place.note, /спочатку/);
  await call(pg, 'minis.take', { frame: 0 });
  await pg.tap('details[data-zone="cards"] button[data-act="add"]');
  await pg.waitForSelector('#cardEditor:not([hidden]) textarea');
  await pg.fill('#cardText', 'T4: картка з острова.');
  await pg.tap('#cardEditor button[data-act="save"]');
  await pg.waitForFunction(() => document.querySelectorAll('#cardList li').length === 1, {}, { timeout: 5000 });
  await pg.screenshot({ path: join(out, '4-place-island.png') });

  await tapPlace('lagoon');
  place.lagoon = await onMap('lagoon');
  assert.deepEqual([place.lagoon.map, place.lagoon.product, place.lagoon.frame], ['lagoon', 'lagoon', 'lagoon']);
  assert.deepEqual([place.lagoon.carried, place.lagoon.pack], [null, []], 'the route starts over: nothing in the hands or the backpack');
  assert.ok(place.lagoon.walker.ground >= 1, 'the start on dry sand of the bay');
  assert.ok(Math.hypot(place.lagoon.walker.x - place.island.walker.x, place.lagoon.walker.z - place.island.walker.z) > 5, 'another start');
  await openStoryZone();
  assert.equal(await picked(), 'lagoon');
  await pg.waitForFunction(() => document.querySelectorAll('#cardList li').length === 1, {}, { timeout: 15000 });
  assert.deepEqual(await cards(), ['T4: картка з острова.'], 'the card is the story\'s, not the map\'s');
  await pg.screenshot({ path: join(out, '5-place-lagoon.png') });

  await pg.reload();
  place.reload = await onMap('lagoon');
  assert.equal(place.reload.map, 'lagoon', 'a reload keeps the map');
  await openStoryZone();
  assert.equal(await picked(), 'lagoon');

  await tapPlace('island');
  place.back = await onMap('island');
  assert.deepEqual([place.back.map, place.back.product, place.back.frame], ['island', 'island', null], 'island: the product says map=island, the iframe leaves the default out');
  assert.deepEqual(place.back.walker, place.island.walker, 'the island\'s start again');
  await openStoryZone();
  await pg.waitForFunction(() => document.querySelectorAll('#cardList li').length === 1, {}, { timeout: 15000 });
  assert.deepEqual(await cards(), ['T4: картка з острова.']);
  report.place = place;
  await placeCtx.close();

  const bad = errors.filter((e) => !/favicon|404/.test(e));
  assert.deepEqual(bad, [], 'no page errors');
  report.seconds = Math.round((performance.now() - t0) / 100) / 10;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-product PASS ${report.seconds} s → ${out}`);
} catch (e) {
  report.error = String(e.stack ?? e);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.error(report.error, errors);
  console.log('probe-story-product FAIL');
  process.exitCode = 1;
} finally {
  await browser.close();
}
