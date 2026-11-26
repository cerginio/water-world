// story-quest Q10 (STORY-QUEST-SPEC §4.2a «Меню малюнку»; HANDOFF п.19): the picture's menu on a
// phone viewport with the stick, every step by a touch on the menu. 1) No fates column on screen:
// one «Малюнок» button; with two miniatures (hands + backpack) it opens three slots — two drawings
// of the frames (not empty pictures), one empty place. 2) A touch on the backpack slot swaps it into
// the hands. 3) In the open sea, swimming: «Покласти» unfolds the frame ahead, not over the walker,
// who still swims. 4) «Взяти в руки» next to it: the frame folds back into the hands, the deck is
// gone, the menu folds. 5) Put down again: from the water the fates are in the menu (the frame
// beside). 6) On a deck: the deck underfoot is never «Взяти в руки». 7) On the board: «Покласти»
// unfolds behind it, the board does not ride onto it. Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q10');
mkdirSync(out, { recursive: true });
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
const report = { base, story: STORY };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const PHONE = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true };

/** The menu as a person sees it: open, the slots, the deeds, the fates. */
const menu = (page) => page.evaluate(() => {
  const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const t = document.querySelector('.walker-menu-toggle'), p = document.querySelector('.walker-menu');
  return { button: shown(t) ? t.textContent : null, icon: !!t?.querySelector('.cmd-icon svg'), open: shown(p),
    slots: [...document.querySelectorAll('.walker-slots > *')].filter(shown).map((s) => (s.classList.contains('empty') ? 'empty'
      : `${s.dataset.frame}:${s.dataset.where}:${s.querySelector('img') ? 'img' : 'word'}`)),
    deeds: [...document.querySelectorAll('.walker-deeds .walker-fate')].filter(shown).map((b) => b.dataset.action),
    fates: [...document.querySelectorAll('.walker-fates .walker-fate')].filter(shown).map((b) => b.dataset.action),
    loose: [...document.querySelectorAll('#walkerControls .walker-fate')].filter((b) => shown(b) && !b.closest('.walker-menu')).length };
});
const openMenu = async (page) => {
  await page.waitForFunction(() => !document.querySelector('.walker-menu-toggle')?.hidden, {}, { timeout: 5000 });
  if (!(await menu(page)).open) await page.tap('.walker-menu-toggle');
  await page.waitForFunction(() => !document.querySelector('.walker-menu').hidden, {}, { timeout: 2000 });
};
/** The walker to the deck's rim (m; 0 on it), and the state of the frame. */
const gap = (page, id) => page.evaluate((id) => {
  const d = app.raft.decks().find((x) => String(x.id) === id), s = app.walker.state;
  if (!d) return null;
  const dx = s.x - d.x, dz = s.z - d.z, u = dx * d.ux + dz * d.uz, v = dx * d.vx + dz * d.vz;
  return Math.hypot(Math.max(0, Math.abs(u) - d.hu), Math.max(0, Math.abs(v) - d.hv));
}, id);
/** Share of the slot drawing's pixels that are not transparent: a frame, not an empty picture. */
const inked = (page, i) => page.evaluate(async (i) => {
  const img = document.querySelectorAll('.walker-slot img')[i];
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let k = 3; k < d.length; k += 4) if (d[k] > 10) n++;
  return { share: n / (c.width * c.height), size: [c.width, c.height] };
}, i);

try {
  const page = await browser.newPage(PHONE);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?story=${STORY}&walk&minis&stick&embed&lang=uk`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks && app.embed && app.minis?.active, {}, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // 1. no column on screen; two miniatures — the menu opens three slots with drawings
  report.empty = await menu(page);
  assert.equal(report.empty.button, null, 'nothing to do with a picture yet: no menu button');
  await page.evaluate(async () => { await app.embed['minis.take']({ frame: 0 }); await app.embed['minis.take']({ frame: 1 }); });
  await page.waitForTimeout(300);
  const closed = await menu(page);
  assert.ok(closed.button === 'Малюнок' && closed.icon && !closed.open && closed.loose === 0, `one closed menu button (${JSON.stringify(closed)})`);
  await page.tap('.walker-menu-toggle');
  await page.waitForTimeout(300);
  report.slots = await menu(page);
  assert.deepEqual(report.slots.slots, ['1:hands:img', '0:pack:img', 'empty'], 'hands, backpack, an empty place');
  report.ink = [await inked(page, 0), await inked(page, 1)];
  // my-day frame 2 is a few strokes (~3 % of the drawing), frame 1 a full picture (~20 %)
  for (const k of report.ink) assert.ok(k.share > 0.01, `a slot draws its frame (${JSON.stringify(k)})`);
  await page.screenshot({ path: join(out, '1-slots.png') });

  // 2. a touch on the backpack slot: frame 1 into the backpack, frame 0 into the hands
  await page.tap('.walker-slot[data-where="pack"]');
  await page.waitForTimeout(200);
  report.swap = await page.evaluate(async () => { const s = await app.embed['state.read'](); return { carried: s.carried, pack: s.pack }; });
  assert.deepEqual(report.swap, { carried: 0, pack: [1] });
  assert.deepEqual((await menu(page)).slots.slice(0, 2), ['0:hands:img', '1:pack:img']);

  // 3. swimming in the open sea: «Покласти» unfolds the frame ahead, not over the walker
  await page.evaluate(() => app.embed['swim.in']({ at: 'open-sea' }));
  await page.waitForFunction(() => !!app.walker.state.swim && !app.walker.walker.under, {}, { timeout: 10000 });
  await openMenu(page);
  const wet = await menu(page);
  assert.ok(wet.deeds.includes('put'), `«Покласти» in the water (${wet.deeds})`);
  const id0 = await page.evaluate(() => String(app.minis.carried.frameId));
  await page.tap('.walker-deeds .walker-fate[data-action="put"]');
  await page.waitForFunction((id) => app.minis.items.find((i) => String(i.frameId) === id)?.state === 'water' && app.raft.decks().some((d) => String(d.id) === id), id0, { timeout: 8000 });
  report.put = { gap: +(await gap(page, id0)).toFixed(2), swimming: await page.evaluate(() => !!app.walker.state.swim),
    folded: !(await menu(page)).open };
  assert.ok(report.put.gap > 0.2 && report.put.swimming, `ahead, not over the swimmer (${JSON.stringify(report.put)})`);
  await page.screenshot({ path: join(out, '3-put-from-the-water.png') });

  // 4. swim up to it: «Взяти в руки» folds it back into the hands
  await page.evaluate((id) => {
    const d = app.raft.decks().find((x) => String(x.id) === id), s = app.walker.state;
    const dx = s.x - d.x, dz = s.z - d.z, l = Math.hypot(dx, dz);
    const r = Math.hypot(d.hu, d.hv);
    app.walker.walker.swimAt(d.x + dx / l * (r + 1), d.z + dz / l * (r + 1), 0);   // at the surface
    s.yaw = Math.atan2(-dx, -dz);   // facing the frame
    s.pitch = -0.3;
  }, id0);
  await page.waitForTimeout(400);
  report.near = { gap: +(await gap(page, id0)).toFixed(2) };
  await openMenu(page);
  const by = await menu(page);
  assert.ok(by.deeds.includes('lift'), `«Взяти в руки» beside the frame (${JSON.stringify(by)}, gap ${report.near.gap})`);
  report.fromWater = by.fates;
  assert.deepEqual(by.fates.slice(0, 3), ['release', 'sink', 'break'], 'Q10: from the water the fates go to the frame beside');
  await page.tap('.walker-deeds .walker-fate[data-action="lift"]');
  await page.waitForTimeout(600);
  report.lift = await page.evaluate((id) => ({ state: app.minis.items.find((i) => String(i.frameId) === id).state, deck: app.raft.decks().some((d) => String(d.id) === id),
    swimming: !!app.walker.state.swim, under: app.walker.walker.under, scale: +app.minis.items.find((i) => String(i.frameId) === id).root.scale.x.toFixed(3) }), id0);
  report.lift.folded = !(await menu(page)).open;
  await page.screenshot({ path: join(out, '4-lifting.png') });
  await page.waitForTimeout(1200);
  report.lift.after = await page.evaluate((id) => +app.minis.items.find((i) => String(i.frameId) === id).root.scale.x.toFixed(3), id0);
  assert.ok(report.lift.state === 'carried' && !report.lift.deck && report.lift.swimming && report.lift.folded,
    `the frame back in the hands (${JSON.stringify(report.lift)})`);
  assert.ok(report.lift.after <= 0.13, `folded to the miniature's size (${report.lift.after})`);

  // 6. on a deck: the deck underfoot is never lifted
  await page.evaluate(() => app.embed['minis.put']({}));
  await page.evaluate(() => app.embed['raft.board']({ frame: 0 }));
  await page.waitForFunction(() => app.raft.boarded, {}, { timeout: 8000 });
  report.onDeck = await page.evaluate(() => ({ deck: String(app.raft.deckId), lift: app.liftTarget(), actions: app.menuActions() }));
  assert.ok(report.onDeck.lift === null || String(report.onDeck.lift) !== report.onDeck.deck, `not the deck underfoot (${JSON.stringify(report.onDeck)})`);
  const refused = await page.evaluate(async () => {
    try { await app.embed['minis.lift']({ frame: 0 }); return 'lifted'; } catch (e) { return e.reason; }
  });
  report.onDeck.refused = refused;
  assert.equal(refused, 'not-possible');

  // 7. on the board: «Покласти» unfolds ahead of it
  await page.evaluate(() => app.embed['minis.unpack']({ frame: 1 }));
  await page.evaluate(() => app.embed['fly.takeOff']());
  await page.waitForFunction(() => !!app.walker.state.flight, {}, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await openMenu(page);
  const id1 = await page.evaluate(() => String(app.minis.carried.frameId));
  await page.tap('.walker-deeds .walker-fate[data-action="put"]');
  await page.waitForFunction((id) => app.minis.items.find((i) => String(i.frameId) === id)?.state === 'water'
    && app.raft.decks().some((d) => String(d.id) === id), id1, { timeout: 8000 });
  report.board = { gap: +(await gap(page, id1) ?? -1).toFixed(2), flight: await page.evaluate(() => app.walker.state.flight?.phase ?? null) };
  assert.ok(report.board.gap > 0, `from the board, not under it (${JSON.stringify(report.board)})`);
  await page.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q10 PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
