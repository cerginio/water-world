// story-quest QDb (STORY-QUEST-SPEC §4.4; docs/story-quest/quest-demo-qa.md; HANDOFF п.14): the QA
// stand of states and the product on the shared shell. On the stand, every card of states.json is
// clicked in the panel and must reach its expectation (state.read, read again here); a reload with
// &card= gives the same state; the Weather and Tech zones act on the scene. On a phone-sized touch
// page the panel opens on ☰ and gives way to the scene after a card. story-quest with ?story= raises
// the story (QA-Q1-2), without one offers the list (QA-Q1-3), a missing story says so.
// Run against npm run dev (http://localhost:5199/). CARDS=id,id runs only those.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mismatches } from '../products/quest-demo-qa/cards.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-states');
mkdirSync(out, { recursive: true });
const STORY = 'test-2025/my-day-3-moments';
const data = JSON.parse(readFileSync(new URL('../products/quest-demo-qa/states.json', import.meta.url), 'utf8'));
const only = process.env.CARDS?.split(',');
const cards = data.cards.filter((c) => !only || only.includes(c.id));
const report = { base, cards: {}, reload: {} };
const t0 = performance.now();
const errors = [];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const scene = (page) => page.frames().find((f) => f !== page.mainFrame());
/** the card's run in the panel: clicked, then done or failed */
const runCard = async (page, id, click = true) => {
  const t = performance.now();
  if (click) await page.click(`button.card-pick[data-card="${id}"]`);
  await page.waitForFunction((c) => document.body.dataset.card === c && ['done', 'failed'].includes(document.body.dataset.cardState),
    id, { timeout: 240000 });
  const r = await page.evaluate(async () => ({ state: document.body.dataset.cardState,
    steps: [...document.querySelectorAll('#cardSteps li')].map((li) => li.textContent),
    read: await window.questDemo.host.call('state.read') }));
  return { ...r, seconds: +((performance.now() - t) / 1000).toFixed(1) };
};

try {
  // 1. the stand: its zones, the catalog by folders with the local fixtures in dev
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page);
  await page.goto(`${base}products/quest-demo-qa/?story=${STORY}`);
  const zones = await page.$$eval('details.zone', (d) => d.map((x) => x.dataset.zone));
  assert.deepEqual(zones, ['story', 'states', 'weather', 'quests', 'cards', 'tech']);
  await page.click('details[data-zone="story"] > summary');
  await page.waitForSelector('.story-pick', { timeout: 90000 });
  const stories = await page.$$eval('.story-pick', (b) => b.map((x) => x.dataset.story));
  report.stories = stories.length;
  for (const folder of ['test-2025/', 'public-test/', 'local/']) assert.ok(stories.some((s) => s.startsWith(folder)), `folder ${folder} in ${stories}`);
  assert.ok(await page.$eval(`.story-pick[data-story="${STORY}"]`, (b) => b.getAttribute('aria-current') === 'true'), 'the current story marked');
  await page.click('details[data-zone="story"] > summary');
  const panels = await scene(page).evaluate(() => ({ gui: !!document.querySelector('.lil-gui.root')?.checkVisibility(),
    perf: !!document.getElementById('perf')?.checkVisibility(), mood: !!document.getElementById('moodPad')?.checkVisibility(),
    rail: !!document.getElementById('stationRail')?.checkVisibility() }));
  assert.deepEqual(panels, { gui: false, perf: false, mood: false, rail: false }, 'the scene in the stand: no panels of its own');

  // 2. every card reaches its expectation
  for (const card of cards) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await runCard(page, card.id);
    const miss = r.read.ok ? mismatches(r.read.value, card.expect) : [{ path: 'state.read', got: r.read.reason }];
    report.cards[card.id] = { state: r.state, seconds: r.seconds, miss, steps: r.state === 'done' ? r.steps.length : r.steps };
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.screenshot({ path: join(out, `card-${card.id}.png`) });
    assert.equal(r.state, 'done', `${card.id}: ${r.steps.join(' | ')}`);
    assert.deepEqual(miss, [], `${card.id}: state.read after the card`);
    assert.equal(new URL(page.url()).searchParams.get('card'), card.id, 'the address carries the card');
  }

  // 3. a reload with &card= — the same state
  for (const id of ['raft-kite-open-sea', 'water-under-sunk'].filter((c) => cards.some((x) => x.id === c))) {
    const card = data.cards.find((c) => c.id === id);
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.goto(`${base}products/quest-demo-qa/?story=${STORY}&card=${id}`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await runCard(page, id, false);
    const miss = mismatches(r.read.value, card.expect);
    report.reload[id] = { state: r.state, seconds: r.seconds, miss };
    assert.equal(r.state, 'done', `reload ${id}: ${r.steps.join(' | ')}`);
    assert.deepEqual(miss, [], `reload ${id}`);
  }

  // 3b. a story that is not there: the card stops at the load, the reason shown (QA-QDb-5)
  await page.goto(`${base}products/quest-demo-qa/?story=test-2025/no-such-story&card=island-eyes`);
  const bad = await runCard(page, 'island-eyes', false);
  report.refusal = { state: bad.state, steps: bad.steps };
  assert.equal(bad.state, 'failed');
  assert.match(bad.steps[0], /story-failed: not-found/);
  assert.ok(bad.steps.slice(1).every((s) => /wait|чекає/.test(s)), bad.steps.join(' | '));
  await page.goto(`${base}products/quest-demo-qa/?story=${STORY}`);

  // 4. Weather and Tech act on the same iframe
  await page.click('details[data-zone="weather"] > summary');
  await page.click('.weather-grid button[data-weather="storm"]');
  await page.waitForFunction(() => document.querySelector('[data-weather="storm"]').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(500);
  const mood = await scene(page).evaluate(() => { const s = app.mood.state(); return { v: s.v, a: s.a, anchor: s.anchor }; });
  report.weather = mood;
  assert.deepEqual([mood.v, mood.a], [-1, 1], `storm is (−1, 1): ${JSON.stringify(mood)}`);
  await page.click('details[data-zone="tech"] > summary');
  await page.check('input[data-tech="fps"]');
  await page.waitForFunction(() => /\d+ fps/.test(document.querySelector('.tech-rate')?.textContent ?? ''), {}, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('techState')?.textContent.includes('"mode"'), {}, { timeout: 10000 });
  report.tech = { rate: await page.$eval('.tech-rate', (e) => e.textContent),
    perf: await scene(page).evaluate(() => !!document.getElementById('perf')?.checkVisibility()) };
  assert.ok(report.tech.perf, 'the FPS panel shown in the scene');
  await page.screenshot({ path: join(out, 'stand-tech.png') });
  await page.close();

  // 5. a phone: the scene first, ☰ brings the panel, a card hands the screen back to the scene
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const phone = await ctx.newPage();
  watch(phone);
  await phone.goto(`${base}products/quest-demo-qa/?story=${STORY}`);
  assert.equal(await phone.evaluate(() => document.body.dataset.panelOpen), 'false', 'a phone opens on the scene');
  await phone.tap('.panel-open');
  await phone.waitForFunction(() => document.body.dataset.panelOpen === 'true');
  await phone.screenshot({ path: join(out, 'phone-panel.png') });
  await phone.tap('button.card-pick[data-card="raft-kite-shore"]');
  assert.equal(await phone.evaluate(() => document.body.dataset.panelOpen), 'false', 'the panel gives way after a card');
  const pr = await runCard(phone, 'raft-kite-shore', false);
  report.phone = { state: pr.state, seconds: pr.seconds,
    stick: await scene(phone).evaluate(() => !!document.getElementById('walkerControls')?.checkVisibility()) };
  assert.equal(pr.state, 'done', pr.steps.join(' | '));
  assert.ok(report.phone.stick, 'the walker\'s stick in the scene on a phone');
  await phone.waitForTimeout(1500);
  await phone.screenshot({ path: join(out, 'phone-card.png') });
  await ctx.close();

  // 6. story-quest on the shell: a story, no story, a missing story
  const sq = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(sq);
  await sq.goto(`${base}products/story-quest/?story=${STORY}`);
  await sq.waitForFunction(() => document.body.dataset.storyState === 'ready', {}, { timeout: 120000 });
  await sq.waitForFunction(() => document.getElementById('sceneStatus').hidden);
  const field = await scene(sq).evaluate(() => ({ loaded: app.tiles.loaded, frames: app.tiles.frames.length, story: app.catalog.story?.id }));
  report.storyQuest = { field, zones: await sq.$$eval('details.zone', (d) => d.map((x) => x.dataset.zone)) };
  assert.ok(field.loaded && field.story === STORY, JSON.stringify(field));
  assert.deepEqual(report.storyQuest.zones, ['story', 'quests', 'cards', 'weather']);
  await sq.screenshot({ path: join(out, 'story-quest.png') });
  await sq.goto(`${base}products/story-quest/`);
  await sq.waitForSelector('#sceneStatus button[data-story]', { timeout: 90000 });
  report.storyQuest.offered = await sq.$$eval('#sceneStatus button[data-story]', (b) => b.length);
  await sq.screenshot({ path: join(out, 'story-quest-none.png') });
  await sq.click('#sceneStatus button[data-story]');
  await sq.waitForFunction(() => document.body.dataset.storyState === 'ready', {}, { timeout: 120000 });
  assert.ok(new URL(sq.url()).searchParams.get('story'), 'a pick puts the story into the address');
  await sq.goto(`${base}products/story-quest/?story=test-2025/no-such-story`);
  await sq.waitForFunction(() => document.body.dataset.storyState === 'failed', {}, { timeout: 60000 });
  await sq.waitForSelector('#sceneStatus button[data-story]', { timeout: 60000 });
  report.storyQuest.missing = await sq.$eval('#sceneStatus', (e) => e.firstChild.textContent);
  await sq.screenshot({ path: join(out, 'story-quest-missing.png') });
  await sq.close();

  const own = errors.filter((e) => !/favicon|404|Failed to load resource/.test(e));
  report.errors = own;
  assert.deepEqual(own, [], 'no page errors');
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS probe-story-states ${report.seconds} s → ${out}`);
} catch (e) {
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
