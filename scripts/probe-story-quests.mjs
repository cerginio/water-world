// story-quest Q6 (STORY-QUEST-SPEC §3; HANDOFF п.15): the quest layer of the product. The scene's
// contract events become facts in the Quests zone (found, in the water, at sea, a fate); a task is
// ticked by hand and the card offered for it is written; tasks are put aside, taken off and brought
// back; cards are written, bound (the deck under the feet by default), edited and deleted; the
// export gives a JSON and a Markdown file; a reload of the page brings the log back from IndexedDB;
// nothing goes to the network (every request of the page is recorded); the stand's Quests zone shows
// a card's facts; on a phone-sized touch page a hand tick and its card are made by taps alone.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-quests');
mkdirSync(out, { recursive: true });
const STORY = 'test-2025/my-day-3-moments';
const MARK = `Q6-mark-${Date.now().toString(36)}`;
const report = { base, facts: {}, cards: {}, network: {} };
const t0 = performance.now();
const errors = [];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const fact = (page, task) => page.$eval(`#questList li[data-task="${task}"], .quests li[data-task="${task}"]`,
  (li) => ({ fact: li.querySelector('.quest-fact')?.textContent ?? '', done: li.dataset.done === 'true',
    ticked: li.querySelector('input').checked, auto: li.querySelector('input').dataset.auto === 'true' }));
const waitFact = (page, task, text, timeout = 30000) => page.waitForFunction(([t, x]) =>
  document.querySelector(`.quests li[data-task="${t}"] .quest-fact`)?.textContent === x, [task, text], { timeout });
const call = async (page, cmd, args = {}) => {
  const r = await page.evaluate(([c, a]) => window.storyQuest.host.call(c, a), [cmd, args]);
  assert.ok(r.ok, `${cmd} ${JSON.stringify(args)}: ${r.reason} ${r.message}`);
  return r.value;
};
const ready = (page) => page.waitForFunction(() => !!window.storyQuest?.quests.log, {}, { timeout: 120000 });

try {
  // 1. the product, a clean device: the tasks of §3.1, nothing done
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'uk-UA', acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${base}products/story-quest/?story=${STORY}&walk&minis`);
  await ready(page);
  report.key = await page.evaluate(() => window.storyQuest.quests.key);
  assert.match(report.key, new RegExp(`^${STORY}#fnv1a-[0-9a-f]{8}-[0-9a-z]+$`), 'the key: the story + the fingerprint');
  const tasks = await page.$$eval('#questList li', (l) => l.map((x) => x.dataset.task));
  assert.deepEqual(tasks, ['find', 'water', 'sea', 'fate', 'note']);
  assert.deepEqual(await fact(page, 'find'), { fact: 'Знайдено 0 з 3', done: false, ticked: false, auto: false });

  // from here on every request of the page and of the scene is recorded (spec §5 «Приватність»)
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), main: r.frame() === page.mainFrame(), body: r.postData() ?? '' }));

  // 2. a hand tick first (no order, §3.2): the card is offered, not demanded; written from the offer
  await page.check('#questList input[data-task="sea"]');
  await page.waitForSelector('#questList li[data-task="sea"] .quest-offer');
  report.facts.handTick = await fact(page, 'sea');
  assert.deepEqual(report.facts.handTick, { fact: '', done: true, ticked: true, auto: false });
  await page.click('#questList li[data-task="sea"] button[data-act="write"]');
  await page.waitForSelector('#cardEditor:not([hidden]) textarea');
  report.cards.offer = await page.evaluate(() => ({ prompt: document.getElementById('cardPrompt').selectedOptions[0].textContent,
    bind: document.getElementById('cardBind').selectedOptions[0].textContent, focus: document.activeElement?.id }));
  assert.deepEqual(report.cards.offer, { prompt: 'Як саме і чому?', bind: 'Задача: Вийти в море', focus: 'cardText' });
  await page.fill('#cardText', `Ще на березі. ${MARK}`);
  await page.click('#cardEditor button[data-act="save"]');
  await waitFact(page, 'note', '1 картка');

  // 3. put aside and taken off: other lists, no «skipped»; brought back
  await page.click('#questList li[data-task="water"] button[data-act="defer"]');
  await page.click('#questList li[data-task="fate"] button[data-act="remove"]');
  report.lists = await page.evaluate(() => ({ open: [...document.querySelectorAll('#questList li')].map((x) => x.dataset.task),
    deferred: [...document.querySelectorAll('.quests.deferred li')].map((x) => x.dataset.task),
    removedButton: document.querySelector('[data-act="show-removed"]')?.textContent,
    text: document.querySelector('details[data-zone="quests"]').textContent }));
  assert.deepEqual(report.lists.open, ['find', 'sea', 'note']);
  assert.deepEqual(report.lists.deferred, ['water']);
  assert.equal(report.lists.removedButton, 'Прибране (1)');
  assert.doesNotMatch(report.lists.text, /пропущ|не зроблено|skipp/i);
  await page.click('[data-act="show-removed"]');
  await page.click('.quests.removed li[data-task="fate"] button[data-act="back"]');
  await page.screenshot({ path: join(out, 'quests-lists.png') });

  // 4. the facts: by the contract's commands (the same functions as the keys), each one's event in the zone
  const timed = async (name, step, task, text) => {
    const t = performance.now();
    await step();
    await waitFact(page, task, text);
    report.facts[name] = { ms: Math.round(performance.now() - t), fact: text };
  };
  await timed('take', () => call(page, 'minis.take', { frame: 0 }), 'find', 'Знайдено 1 з 3');
  await timed('hydrate0', () => call(page, 'minis.hydrate', { frame: 0 }), 'water', '1 частина у воді');
  await timed('hydrate1', () => call(page, 'minis.hydrate', { frame: 1 }), 'water', '2 частини у воді');
  assert.equal((await fact(page, 'find')).fact, 'Знайдено 2 з 3');
  assert.ok((await fact(page, 'water')).auto, 'water: done by the fact while put aside');
  await call(page, 'raft.board', { frame: 1 });
  await call(page, 'kite.set', { up: true });
  await timed('sea', () => call(page, 'raft.moveTo', { frame: 1, at: 'open-sea' }), 'sea', 'У морі');
  report.facts.seaAfterHand = await fact(page, 'sea');
  assert.ok(report.facts.seaAfterHand.auto && report.facts.seaAfterHand.done, 'the hand tick and the fact: one done');
  await page.click('#questList input[data-task="sea"]');
  assert.ok((await fact(page, 'sea')).ticked, 'a tick of the fact does not come off by a click');

  // 5. a card on the raft: bound to the deck under the feet by default
  await page.click('details[data-zone="cards"] button[data-act="add"]');
  await page.waitForSelector('#cardEditor:not([hidden]) textarea');
  report.cards.raftBind = await page.$eval('#cardBind', (s) => s.selectedOptions[0].textContent);
  assert.equal(report.cards.raftBind, 'Кадр 2');
  await page.selectOption('#cardPrompt', 'part');
  await page.fill('#cardText', `Пливу. ${MARK}`);
  await page.click('#cardEditor button[data-act="save"]');
  await waitFact(page, 'note', '2 картки');

  await timed('fate', () => call(page, 'fate.give', { frame: 1, kind: 'sink' }), 'fate', 'Втоплено 1');

  // 6. edit the first card, write a third and delete it (two taps)
  await page.click('#cardList li:last-child button[data-act="edit"]');
  await page.waitForSelector('#cardEditor:not([hidden]) textarea');
  await page.fill('#cardText', `Ще на березі, змінено. ${MARK}`);
  await page.click('#cardEditor button[data-act="save"]');
  await page.click('details[data-zone="cards"] button[data-act="add"]');
  await page.waitForSelector('#cardEditor:not([hidden]) textarea');
  await page.fill('#cardText', 'на видалення');
  await page.click('#cardEditor button[data-act="save"]');
  await waitFact(page, 'note', '3 картки');
  await page.click('#cardList li:first-child button[data-act="delete"]');
  assert.equal(await page.$eval('#cardList li:first-child button[data-act="delete"]', (b) => b.textContent), 'Точно видалити?');
  await page.click('#cardList li:first-child button[data-act="delete"]');
  await waitFact(page, 'note', '2 картки');
  report.cards.list = await page.$$eval('#cardList li', (l) => l.map((x) => [x.querySelector('.note-head').textContent, x.querySelector('.zone-meta').textContent.split(' · ')[0], x.querySelector('.note-text').textContent]));
  assert.deepEqual(report.cards.list.map((c) => c.slice(0, 2)), [['Що ця частина для мене?', 'Кадр 2'], ['Як саме і чому?', 'Задача: Вийти в море']]);
  assert.match(report.cards.list[1][2], /змінено/);
  await page.screenshot({ path: join(out, 'quests-cards.png') });

  // 7. the export: two files made in the page
  const save = async (act) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`button[data-act="${act}"]`)]);
    const path = join(out, dl.suggestedFilename());
    await dl.saveAs(path);
    return { name: dl.suggestedFilename(), url: dl.url().slice(0, 5), text: readFileSync(path, 'utf8') };
  };
  const json = await save('export-json'), md = await save('export-md');
  const parsed = JSON.parse(json.text);
  report.export = { json: json.name, md: md.name, from: [json.url, md.url], cards: parsed.cards.length,
    facts: parsed.tasks.map((x) => `${x.id}:${x.done ? 'x' : ' '}:${x.fact}`) };
  assert.match(json.name, /^story-quest-test-2025-my-day-3-moments-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(report.export.from, ['blob:', 'blob:']);
  assert.equal(parsed.cards.length, 2);
  assert.equal(parsed.fingerprint, report.key.split('#')[1]);
  assert.ok(parsed.tasks.find((x) => x.id === 'fate').fact === 'Втоплено 1');
  assert.match(md.text, /- \[x\] Знайти частини — Знайдено 2 з 3/);
  assert.match(md.text, /### Що ця частина для мене\?/);

  // 8. nothing went to the network: no request of the page itself, none carrying a card's words
  report.network = { all: requests.length, page: requests.filter((r) => r.main && !/^(blob|data):/.test(r.url)).map((r) => r.url),
    notGet: requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`),
    marked: requests.filter((r) => r.url.includes(MARK) || r.body.includes(MARK)).length };
  assert.deepEqual(report.network.page, [], 'the product page asked the network');
  assert.deepEqual(report.network.notGet, []);
  assert.equal(report.network.marked, 0);

  // 9. a reload: the log comes back from IndexedDB — facts, the hand tick, the lists, the cards
  await page.reload();
  await ready(page);
  await page.waitForSelector('#cardList li');
  report.reload = { key: await page.evaluate(() => window.storyQuest.quests.key),
    tasks: await page.$$eval('.quests li', (l) => l.map((x) => `${x.dataset.task}:${x.dataset.done}:${x.querySelector('.quest-fact')?.textContent ?? ''}`)),
    deferred: await page.$$eval('.quests.deferred li', (l) => l.map((x) => x.dataset.task)),
    cards: await page.$$eval('#cardList li .note-text', (l) => l.map((x) => x.textContent)) };
  assert.equal(report.reload.key, report.key);
  assert.deepEqual(report.reload.tasks, ['find:true:Знайдено 2 з 3', 'sea:true:У морі', 'fate:true:Втоплено 1', 'note:true:2 картки', 'water:true:2 частини у воді']);
  assert.deepEqual(report.reload.deferred, ['water']);
  assert.equal(report.reload.cards.length, 2);
  await page.screenshot({ path: join(out, 'quests-reload.png') });
  await ctx.close();

  // 10. the stand: a card's facts in its Quests zone
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'uk-UA' });
  const stand = await sctx.newPage();
  watch(stand);
  await stand.goto(`${base}products/quest-demo-qa/?story=${STORY}`);
  await stand.click('button.card-pick[data-card="fate-sunk"]');
  await stand.waitForFunction(() => document.body.dataset.cardState === 'done', {}, { timeout: 240000 });
  await stand.click('details[data-zone="quests"] > summary');
  await waitFact(stand, 'fate', 'Втоплено 1');
  report.stand = await stand.$$eval('.quests li', (l) => l.map((x) => `${x.dataset.task}:${x.querySelector('.quest-fact')?.textContent ?? ''}`));
  assert.deepEqual(report.stand, ['find:Знайдено 1 з 3', 'water:1 частина у воді', 'sea:У морі', 'fate:Втоплено 1', 'note:']);
  await stand.screenshot({ path: join(out, 'stand-quests.png') });
  await sctx.close();

  // 11. a phone: ☰, a hand tick and its card by taps
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'uk-UA' });
  const phone = await pctx.newPage();
  watch(phone);
  await phone.goto(`${base}products/story-quest/?story=${STORY}&walk&minis`);
  await ready(phone);
  await phone.tap('.panel-open');
  await phone.waitForFunction(() => document.body.dataset.panelOpen === 'true');
  await phone.tap('#questList input[data-task="fate"]');
  await phone.tap('#questList li[data-task="fate"] button[data-act="write"]');
  await phone.waitForSelector('#cardEditor:not([hidden]) textarea');
  await phone.locator('#cardText').fill('з телефона');
  await phone.tap('#cardEditor button[data-act="save"]');
  await waitFact(phone, 'note', '1 картка');
  report.phone = { fate: await fact(phone, 'fate'), cards: await phone.$$eval('#cardList li', (l) => l.length) };
  assert.ok(report.phone.fate.ticked && !report.phone.fate.auto);
  await phone.screenshot({ path: join(out, 'phone-quests.png') });
  await pctx.close();

  const own = errors.filter((e) => !/favicon|404|Failed to load resource/.test(e));
  report.errors = own;
  assert.deepEqual(own, [], 'no page errors');
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS probe-story-quests ${report.seconds} s → ${out}`);
} catch (e) {
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
