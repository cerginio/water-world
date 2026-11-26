// story-quest Q5 (STORY-QUEST-SPEC §2 п.6, §4.1 «Долі кадру»; Edge §4.4; HANDOFF п.10): the
// frame's fates through the real frame loop, the GPU sim and real keys. A frame of the story
// becomes a raft past the end of the bed (1300 m out, no bed: spec §4.3). On it X sinks it —
// and the kite lifts the walker on the board first (Q4b); the frame goes down 40 m, the field
// stays whole; H raises it, and it is back: the same place, the same footprint, the same deck
// height. The same for Z (released: out 600 m and gone; called back home) and C (comes apart,
// the tiles drift and sink; gathered). L («Leave it so») fixes a fate: no way back. From a deck
// next to another frame the fate is that frame's and the walker stays; from the air it is the
// frame below; the way back also from the shore. On a phone the buttons are a column of touches.
// The fates' clocks run ×10 here (app.fates.rate); the way back is ×2 of that already.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q5');
mkdirSync(out, { recursive: true });
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
const RATE = 10;
const report = { base, story: STORY, rate: RATE };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};
const key = async (page, code) => { await page.keyboard.press(code); await page.waitForTimeout(120); };

// the frame as the GPU has it: world pivot, footprint box (null when gone), the highest tile
// top within 60 m of its centre, its fate; one read at a time
const look = (page, id) => page.evaluate(async (id) => {
  const f = app.tiles.frameRegistry.entries.find((e) => String(e.id) === id);
  const { TileFrameQuery } = await import('/src/tiles/TileFrameQuery.js');
  window.__top ??= new TileFrameQuery(app.tiles, 3);
  const fp = await app.tiles.frameFootprint(f);
  const c = fp ? { x: (fp.minX + fp.maxX) / 2, z: (fp.minZ + fp.maxZ) / 2 } : { x: f.world.x, z: f.world.z };
  let top = null;
  for (let i = 0; i < 20 && !top; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    top = await __top.query(f, undefined, 0, { x: c.x, z: c.z, radius: 60 });
    // oxlint-disable-next-line eslint/no-await-in-loop
    if (!top) await new Promise((r) => setTimeout(r, 50));
  }
  const fate = app.fates.of(f.id);
  return { world: { x: f.world.x, z: f.world.z }, fp, top: top && top[1] > 0.5 ? top[0] : null,
    fate: { kind: fate.kind, t: fate.t, dir: fate.dir, kept: fate.kept, origin: fate.origin } };
}, id);
const size = (fp) => ({ w: fp.maxX - fp.minX, d: fp.maxZ - fp.minZ, x: (fp.minX + fp.maxX) / 2, z: (fp.minZ + fp.maxZ) / 2 });
const waitFate = (page, id, test, timeout = 30000) => page.waitForFunction(({ id, test }) => {
  const f = app.tiles.frameRegistry.entries.find((e) => String(e.id) === id), s = app.fates.of(f.id);
  return new Function('s', `return ${test}`)(s);
}, { id, test }, { timeout });
const boardOn = (page, id) => page.evaluate((id) => {
  const d = app.raft.decks().find((d) => String(d.id) === id);
  app.walker.walker.board(d, 0, 0, Math.atan2(d.x, d.z));
}, id);
// the pair «fate → way back» puts the frame back: to where the fate began (a raft coasts with the
// wind until then), the footprint (±15 %, tiles on waves — Q3), at the surface
function same(before, after, label, origin) {
  const off = Math.hypot(after.world.x - origin.x, after.world.z - origin.z);
  assert.ok(off < 1e-3, `${label}: back where the fate began (${off.toFixed(4)} m off)`);
  const a = size(before.fp), b = size(after.fp);
  // the footprint's centre against the frame's pivot: the tiles are back in the picture
  const shift = Math.hypot((b.x - after.world.x) - (a.x - before.world.x), (b.z - after.world.z) - (a.z - before.world.z));
  assert.ok(shift < 2, `${label}: footprint centre within 2 m of where it was on the frame (${shift.toFixed(2)})`);
  assert.ok(Math.abs(b.w / a.w - 1) < 0.15 && Math.abs(b.d / a.d - 1) < 0.15, `${label}: footprint ${a.w.toFixed(1)}×${a.d.toFixed(1)} → ${b.w.toFixed(1)}×${b.d.toFixed(1)}`);
  // 1300 m out the highest tile top rides −1.1…+2.6 m on the open-sea swell (two runs): «at the
  // surface» against −40 m sunk, not to the cm
  assert.ok(after.top > -3, `${label}: afloat again (top ${before.top.toFixed(2)} → ${after.top.toFixed(2)} m)`);
  assert.equal(after.fate.kind, null);
  return { place: 0, footprint: [+b.w.toFixed(1), +b.d.toFixed(1)], top: +after.top.toFixed(2) };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?story=${STORY}&walk`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length >= 3 && app.fates, {}, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const ids = await page.evaluate((rate) => {
    app.fates.rate = rate;
    window.__fates = [];
    app.fates.addEventListener('change', (e) => __fates.push(`${String(e.detail.frameId)}:${e.detail.kind}:${e.detail.phase}`));
    return app.raft.decks().map((d) => String(d.id));
  }, RATE);
  const [A, B, C] = ids;
  // A: a raft 1300 m out, past the end of the bed (ISLAND_SIZE / 2 = 1200 m)
  await page.evaluate((id) => {
    const d = app.raft.decks().find((d) => String(d.id) === id), l = Math.hypot(d.x, d.z);
    app.raft.moveTo(d.id, d.x / l * 1300, d.z / l * 1300);
  }, A);
  await page.waitForTimeout(3000);
  await boardOn(page, A);
  await page.waitForTimeout(800);
  const home = await look(page, A);
  assert.ok(home.fp && Number.isFinite(home.top), `frame ${A} read on the water (${JSON.stringify(home)})`);
  report.home = { world: home.world, footprint: [size(home.fp).w, size(home.fp).d].map((v) => +v.toFixed(1)), top: +home.top.toFixed(2) };
  assert.deepEqual(await page.evaluate(() => app.fateHints()), ['release', 'sink', 'break'], 'on the raft: the three fates, the lighter first');

  // 1. X on the raft: the walker up on the board under the kite, the frame sinks 40 m, no bed
  await key(page, 'KeyX');
  const origin106 = await page.evaluate((id) => app.fates.of(app.tiles.frameRegistry.entries.find((e) => String(e.id) === id).id).origin, A);
  const up = await page.evaluate(() => ({ flying: !!app.walker.state.flight, kite: app.raft.kite.up, decks: app.raft.decks().map((d) => String(d.id)) }));
  assert.ok(up.flying && up.kite, `sink from the raft: the walker in the air under the kite (${JSON.stringify(up)})`);
  assert.ok(!up.decks.includes(A), 'a frame under a fate is no deck');
  assert.deepEqual(await page.evaluate(() => app.fateHints().slice(-2)), ['raise', 'keep']);
  await waitFate(page, A, 's.t >= 1');
  await page.waitForTimeout(1500);
  const sunk = await look(page, A);
  assert.ok(sunk.top < -35, `sunk 40 m with no bed under it: top ${sunk.top?.toFixed(2)} m`);
  const others = await Promise.all([look(page, B)]);
  assert.ok(others.every((o) => o.fp && Number.isFinite(o.top) && Math.abs(o.top) < 1.5), `the rest of the field afloat (${others.map((o) => o.top?.toFixed(2))})`);
  await page.screenshot({ path: join(out, 'sunk.png') });
  await key(page, 'KeyH');
  await waitFate(page, A, 's.kind === null');
  await page.waitForTimeout(2500);
  report.sink = { top: +sunk.top.toFixed(2), back: same(home, await look(page, A), 'sink → raise', origin106) };

  // 2. Z: released — out 600 m, gone; H calls it home
  await boardOn(page, A);
  await page.waitForTimeout(500);
  await key(page, 'KeyZ');
  const origin126 = await page.evaluate((id) => app.fates.of(app.tiles.frameRegistry.entries.find((e) => String(e.id) === id).id).origin, A);
  assert.ok(await page.evaluate(() => !!app.walker.state.flight));
  await page.waitForTimeout(3000);
  const going = await look(page, A);
  assert.ok(going.fp && going.fate.kind === 'release', 'on its way, still drawn');
  await waitFate(page, A, 's.t >= 1');
  await page.waitForTimeout(500);
  const gone = await look(page, A);
  const away = Math.hypot(gone.world.x - origin126.x, gone.world.z - origin126.z);
  assert.ok(Math.abs(away - 600) < 1, `released: ${away.toFixed(1)} m out`);
  assert.ok(Math.hypot(gone.world.x, gone.world.z) > Math.hypot(origin126.x, origin126.z) + 599, 'away from the island');
  assert.equal(gone.fp, null, 'gone over the horizon: no tile drawn');
  assert.deepEqual(await page.evaluate(() => app.fateHints().slice(-2)), ['call', 'keep']);
  await key(page, 'KeyH');
  await waitFate(page, A, 's.kind === null');
  await page.waitForTimeout(2500);
  report.release = { away: +away.toFixed(1), back: same(home, await look(page, A), 'release → call', origin126) };

  // 3. C: comes apart — tiles drift and sink one by one; H gathers them
  await boardOn(page, A);
  await page.waitForTimeout(500);
  await key(page, 'KeyC');
  const origin147 = await page.evaluate((id) => app.fates.of(app.tiles.frameRegistry.entries.find((e) => String(e.id) === id).id).origin, A);
  await waitFate(page, A, 's.t >= 0.5');
  const half = await look(page, A);
  const grow = size(half.fp).w / size(home.fp).w;
  assert.ok(grow > 1.02, `coming apart: the tiles drift out (${grow.toFixed(3)} × the width)`);
  await page.screenshot({ path: join(out, 'break-half.png') });
  await waitFate(page, A, 's.t >= 1');
  await page.waitForTimeout(1500);
  const broken = await look(page, A);
  assert.ok(broken.top < -20, `all sunk: top ${broken.top?.toFixed(2)} m`);
  await key(page, 'KeyH');
  await waitFate(page, A, 's.kind === null');
  await page.waitForTimeout(3000);
  report.break = { grow: +grow.toFixed(3), top: +broken.top.toFixed(2), back: same(home, await look(page, A), 'break → gather', origin147) };

  // 4. another frame: on B with C beside it, X sinks C, the walker stays on B
  await page.evaluate(({ B, C }) => {
    const ds = app.raft.decks(), b = ds.find((d) => String(d.id) === B), c = ds.find((d) => String(d.id) === C);
    const l = Math.hypot(b.x, b.z);
    app.raft.moveTo(b.id, b.x / l * 1000, b.z / l * 1000);
    const b2 = app.raft.decks().find((d) => String(d.id) === B);
    // C beside B across its u axis, 3 m rim to rim
    const off = b2.hu + c.hu + 3;
    app.raft.moveTo(c.id, b2.x + b2.ux * off, b2.z + b2.uz * off);
  }, { B, C });
  await page.waitForTimeout(3000);
  await boardOn(page, B);
  await page.waitForTimeout(800);
  const target = await page.evaluate(() => { const t = app.fateTarget(); return t && { id: String(t.id), own: t.own }; });
  assert.deepEqual(target, { id: C, own: false }, 'on a deck next to another frame: the fate is that one\'s');
  await key(page, 'KeyX');
  const stay = await page.evaluate(() => ({ deck: String(app.walker.state.deck?.id), flying: !!app.walker.state.flight }));
  assert.deepEqual(stay, { deck: B, flying: false }, 'the walker stays on its frame');
  await waitFate(page, C, 's.t >= 0.3');
  await key(page, 'KeyH');
  await waitFate(page, C, 's.kind === null');
  report.other = { from: B, to: C };

  // 5. from the air: over C, Z releases C; then ashore, H calls it back
  // (boarded by board(), the kite of the last flight is still up: K would let it go)
  await page.evaluate(() => app.raft.setKite(true));
  await key(page, 'Space');
  assert.ok(await page.evaluate(() => !!app.walker.state.flight));
  await page.evaluate((C) => {
    const c = app.raft.decks().find((d) => String(d.id) === C);
    Object.assign(app.walker.state, { x: c.x, z: c.z });
  }, C);
  await page.waitForTimeout(200);
  const below = await page.evaluate(() => { const t = app.fateTarget(); return t && { id: String(t.id), own: t.own }; });
  assert.deepEqual(below, { id: C, own: false }, 'in the air: the frame below');
  await key(page, 'KeyZ');
  await waitFate(page, C, 's.t >= 0.2');
  await page.evaluate(() => {
    let x = app.tiles.center.x, z = app.tiles.center.z;
    const len = Math.hypot(x, z), dx = -x / len, dz = -z / len;
    while ((app.ground(x, z)?.height ?? -99) < 1) { x += dx * 0.5; z += dz * 0.5; }
    app.walker.place(x, z, Math.atan2(-dx, -dz));
  });
  await page.waitForTimeout(300);
  const ashore = await page.evaluate(() => app.fateHints());
  assert.deepEqual(ashore, ['call', 'keep'], 'on the shore: the way back and «Leave it so», no new fate');
  await key(page, 'KeyH');
  await waitFate(page, C, 's.kind === null');
  report.air = { below: C, ashore };

  // 6. L: «Leave it so» — B sunk and kept; H does nothing, the fate runs to its end and stays
  await page.evaluate(() => { app.raft.setKite(false); });
  await boardOn(page, B);
  await page.waitForTimeout(800);
  await page.evaluate(() => app.fates.give(app.raft.deckId, 'sink'));
  await page.waitForTimeout(300);
  await key(page, 'KeyL');
  assert.equal(await page.evaluate(() => app.undoFate()), null, 'kept: no way back');
  await waitFate(page, B, 's.t >= 1 && s.kept');
  assert.deepEqual(await page.evaluate(() => app.fateHints().filter((n) => ['raise', 'keep', 'call', 'gather'].includes(n))), []);
  report.keep = { frame: B, facts: await page.evaluate(() => app.fates.facts()) };
  report.events = await page.evaluate(() => __fates);

  // 7. the touch buttons: a column, uk words, «Sink it» lifts the walker, «Raise it» and the quiet note
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, locale: 'uk-UA' });
  watch(phone, 'phone');
  await phone.goto(`${base}?story=${STORY}&walk&stick`);
  await phone.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length > 0 && app.fates, {}, { timeout: 90000 });
  await phone.evaluate((rate) => {
    app.fates.rate = rate;
    const d = app.raft.decks()[0], l = Math.hypot(d.x, d.z);
    app.raft.moveTo(d.id, d.x / l * 1100, d.z / l * 1100);
  }, RATE);
  await phone.waitForTimeout(1500);
  await phone.evaluate(() => app.walker.walker.board(app.raft.decks()[0]));
  // Q10: the fates are under the picture's menu; a fate done folds it
  const openMenu = async () => {
    await phone.waitForFunction(() => !document.querySelector('.walker-menu-toggle')?.hidden, {}, { timeout: 5000 });
    if (await phone.evaluate(() => document.querySelector('.walker-menu-toggle').dataset.open !== 'true')) await phone.tap('.walker-menu-toggle');
  };
  await openMenu();
  await phone.waitForFunction(() => document.querySelectorAll('.walker-fates .walker-fate').length === 3, {}, { timeout: 5000 });
  const words = await phone.evaluate(() => [...document.querySelectorAll('.walker-fates .walker-fate')].map((b) => b.textContent));
  assert.deepEqual(words, ['Відпустити', 'Втопити', 'Дати розпастися']);
  await phone.tap('.walker-fate[data-action="sink"]');
  await phone.waitForFunction(() => !!app.walker.state.flight && document.querySelector('.walker-menu').hidden, {}, { timeout: 3000 });
  await openMenu();
  await phone.waitForFunction(() => !!document.querySelector('.walker-fate[data-action="raise"]')?.checkVisibility(), {}, { timeout: 3000 });
  const back = await phone.evaluate(() => ({ words: [...document.querySelectorAll('.walker-fates .walker-fate')].map((b) => b.textContent),
    note: document.querySelector('.walker-note')?.hidden === false ? document.querySelector('.walker-note').textContent : null }));
  await phone.screenshot({ path: join(out, 'phone-fates.png') });
  assert.deepEqual(back.words.slice(-2), ['Підняти', 'Залишити так']);
  assert.equal(back.note, 'Світ запам’ятає це.');
  await phone.tap('.walker-fate[data-action="raise"]');
  await phone.waitForFunction(() => app.fates.open() === null, {}, { timeout: 10000 });
  report.phone = { fates: words, back };
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q5 PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
