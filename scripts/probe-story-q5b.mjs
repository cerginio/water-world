// story-quest Q5b (STORY-QUEST-SPEC §2 п.6 «Плавання й пірнання»; HANDOFF п.12): the walker in
// the water through the real frame loop, the GPU water and real keys. A frame of the story is a
// raft 1300 m out (no bed, spec §4.3); another frame beside it is sunk 40 m (Q5). From the board
// over deep water Space lets the kite go: the walker is in the water, the eyes at the surface
// (the camera over the water it reads at itself). Space dives; looking down and swimming takes
// the eyes 40 m down to the sunk frame — the camera is under the water and has it in view.
// Space again — up to the surface. Off the raft with the kite down Space jumps in; a stroke back
// boards it. Near the island a swim to the beach stands the walker up on the shallows: 'eyes',
// walking. On a phone the same button reads «У воду» / «Пірнути» / «Випливти».
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q5b');
mkdirSync(out, { recursive: true });
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
const RATE = 10;
const report = { base, story: STORY };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};
const key = async (page, code) => { await page.keyboard.press(code); await page.waitForTimeout(150); };
// the walker and the camera against the water read at the camera
const where = (page) => page.evaluate(() => {
  const s = app.walker.state, c = app.camera.position, w = app.camWater();
  return { mode: app.walker.mode, swim: s.swim && { depth: +s.swim.depth.toFixed(3), target: +s.swim.target.toFixed(3) },
    deck: s.deck ? String(s.deck.id) : null, flight: !!s.flight, kite: app.raft.kite.up, hint: app.flyHint(),
    x: +s.x.toFixed(2), z: +s.z.toFixed(2), camY: +c.y.toFixed(3), water: +w.toFixed(3), overWater: +(c.y - w).toFixed(3) };
});
const boardOn = (page, id) => page.evaluate((id) => {
  const d = app.raft.decks().find((d) => String(d.id) === id);
  app.walker.walker.board(d, 0, 0, Math.atan2(d.x, d.z));
}, id);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?story=${STORY}&walk`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length >= 3 && app.fates, {}, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const ids = await page.evaluate((rate) => {
    app.fates.rate = rate;
    window.__land = [];
    app.raft.addEventListener('land', (e) => __land.push(e.detail.on));
    return app.raft.decks().map((d) => String(d.id));
  }, RATE);
  const [A, B] = ids;
  // A: a raft 1300 m out; B beside it, 6 m rim to rim across A's u axis
  await page.evaluate(({ A, B }) => {
    const ds = app.raft.decks(), a = ds.find((d) => String(d.id) === A), b = ds.find((d) => String(d.id) === B);
    const l = Math.hypot(a.x, a.z);
    app.raft.moveTo(a.id, a.x / l * 1300, a.z / l * 1300);
    const a2 = app.raft.decks().find((d) => String(d.id) === A), off = a2.hu + b.hu + 6;
    app.raft.moveTo(b.id, a2.x + a2.ux * off, a2.z + a2.uz * off);
  }, { A, B });
  await page.waitForTimeout(3000);

  // 1. B sunk 40 m (Q5), the walker on A with the kite up, Space: in the air
  await page.evaluate((B) => app.fates.give(app.raft.decks().find((d) => String(d.id) === B).id, 'sink'), B);
  await boardOn(page, A);
  await page.waitForTimeout(800);
  await page.evaluate(() => app.raft.setKite(true));
  await key(page, 'Space');
  assert.ok((await where(page)).flight, 'Space on the raft with the kite up: in the air');
  // over deep water off the raft: the button reads «into the water»
  await page.evaluate(({ A, B }) => {
    const ds = app.raft.decks(), a = ds.find((d) => String(d.id) === A);
    const f = app.tiles.frameRegistry.entries.find((e) => String(e.id) === B);
    // half way to the sunk frame, over the water between them
    Object.assign(app.walker.state, { x: (a.x + f.world.x) / 2 + a.ux * 2, z: (a.z + f.world.z) / 2 + a.uz * 2 });
  }, { A, B });
  await page.waitForTimeout(300);
  const air = await where(page);
  assert.equal(air.hint, 'water', `over deep water in the air: «into the water» (${JSON.stringify(air)})`);

  // 2. Space: the kite let go, the walker in the water, the eyes at the surface
  await key(page, 'Space');
  await page.waitForTimeout(2500);
  const surface = await where(page);
  report.surface = surface;
  assert.ok(surface.swim && surface.swim.depth === 0, `in the water at the surface (${JSON.stringify(surface)})`);
  assert.equal(surface.kite, false, 'the kite is gone');
  assert.deepEqual(await page.evaluate(() => __land), ['water']);
  assert.ok(surface.overWater > 0 && surface.overWater < 0.8, `the eyes just over the water: ${surface.overWater} m`);
  assert.equal(surface.hint, 'dive');
  await page.screenshot({ path: join(out, 'surface.png') });
  // a stroke along the water: 3 m/s, no deeper
  const sx = surface.x, sz = surface.z;
  await page.evaluate(() => { app.walker.state.pitch = 0; });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const swum = await where(page);
  const dist = Math.hypot(swum.x - sx, swum.z - sz);
  assert.ok(dist > 3 && dist < 8, `two seconds of a stroke: ${dist.toFixed(2)} m`);
  assert.equal(swum.swim.depth, 0, 'looking ahead at the surface: no deeper');

  // 3. Space: 3 m down; the camera under the water
  await key(page, 'Space');
  await page.waitForTimeout(3000);
  const under = await where(page);
  report.dive = under;
  assert.ok(Math.abs(under.swim.depth - 3) < 0.01, `«dive»: 3 m down (${under.swim.depth})`);
  assert.ok(under.overWater < -2, `the camera under the water: ${under.overWater} m`);
  assert.equal(under.hint, 'rise');

  // 4. look down at the sunk frame and swim: the eyes go down to it, it is in view
  await page.waitForFunction((B) => app.fates.of(app.tiles.frameRegistry.entries.find((e) => String(e.id) === B).id).t >= 1, B, { timeout: 30000 });
  const sunk = await page.evaluate(async (B) => {
    const f = app.tiles.frameRegistry.entries.find((e) => String(e.id) === B);
    const { TileFrameQuery } = await import('/src/tiles/TileFrameQuery.js');
    const q = new TileFrameQuery(app.tiles, 3);
    let top = null;
    for (let i = 0; i < 20 && !top; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      top = await q.query(f, undefined, 0, { x: f.world.x, z: f.world.z, radius: 60 });
      // oxlint-disable-next-line eslint/no-await-in-loop
      if (!top) await new Promise((r) => setTimeout(r, 50));
    }
    return { x: f.world.x, z: f.world.z, top: top && top[1] > 0.5 ? top[0] : null };
  }, B);
  assert.ok(sunk.top < -35, `the frame lies 40 m down: top ${sunk.top}`);
  const t1 = performance.now();
  // a point 8 m short of the frame on the way to it and 4 m over its top: from there it is in
  // front of the eyes, not straight under them (the gaze stops at −1.3 rad)
  const from = await page.evaluate(() => ({ x: app.walker.state.x, z: app.walker.state.z }));
  const along = Math.hypot(sunk.x - from.x, sunk.z - from.z);
  const aim = { x: sunk.x - (sunk.x - from.x) / along * 8, z: sunk.z - (sunk.z - from.z) / along * 8, y: sunk.top + 4 };
  for (let i = 0; i < 60; i++) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const s = await page.evaluate(({ x, z, y }) => {
      const w = app.walker.state, e = app.walker.walker.eyes().position;
      const dx = x - e.x, dz = z - e.z, dy = y - e.y, h = Math.hypot(dx, dz);
      w.yaw = Math.atan2(dx, dz);
      w.pitch = Math.max(-1.3, Math.atan2(dy, h));
      return { h, dy };
    }, aim);
    if (Math.hypot(s.h, s.dy) < 1.5) break;
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.keyboard.down('ShiftLeft');
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.keyboard.down('KeyW');
    // oxlint-disable-next-line eslint/no-await-in-loop
    await page.waitForTimeout(Math.hypot(s.h, s.dy) < 6 ? 150 : 500);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  // look at it
  const seen = await page.evaluate(({ x, z, y }) => {
    const w = app.walker.state, e = app.walker.walker.eyes().position;
    w.yaw = Math.atan2(x - e.x, z - e.z);
    w.pitch = Math.max(-1.3, Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)));
    return null;
  }, { x: sunk.x, z: sunk.z, y: sunk.top });
  await page.waitForTimeout(800);
  const deep = await where(page);
  const view = await page.evaluate(({ x, z, y }) => {
    const v = app.camera.position.clone().set(x, y, z).project(app.camera);
    return { ndc: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)],
      distance: +app.camera.position.distanceTo(app.camera.position.clone().set(x, y, z)).toFixed(2) };
  }, { x: sunk.x, z: sunk.z, y: sunk.top });
  report.deep = { ...deep, view, seconds: +((performance.now() - t1) / 1000).toFixed(1), seen };
  await page.screenshot({ path: join(out, 'sunk-frame.png') });
  assert.ok(deep.swim.depth > 28, `down by the sunk frame: ${deep.swim.depth} m`);
  assert.ok(deep.overWater < -25, `the camera deep under the water: ${deep.overWater} m`);
  assert.ok(Math.abs(view.ndc[0]) < 0.5 && Math.abs(view.ndc[1]) < 0.5 && view.ndc[2] < 1 && view.distance < 15,
    `the sunk frame in the middle of the view (${JSON.stringify(view)})`);

  // 5. Space: back up to the surface
  await key(page, 'Space');
  await page.waitForFunction(() => app.walker.state.swim?.depth === 0, {}, { timeout: 40000 });
  await page.waitForTimeout(1500);
  const up = await where(page);
  report.rise = up;
  assert.ok(up.overWater > 0, `surfaced: the camera over the water (${up.overWater} m)`);
  assert.equal(up.hint, 'dive');

  // 6. off the raft with the kite down: Space jumps in; a stroke back boards it
  await boardOn(page, A);
  await page.waitForTimeout(800);
  assert.equal((await where(page)).hint, 'water', 'on the raft, the kite down: «into the water»');
  await key(page, 'Space');
  const jumped = await where(page);
  assert.ok(jumped.swim && jumped.deck === null, `off the rim into the water (${JSON.stringify(jumped)})`);
  await page.evaluate(() => { app.walker.state.yaw += Math.PI; app.walker.state.pitch = 0; });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => !!app.walker.state.deck, {}, { timeout: 5000 });
  await page.keyboard.up('KeyW');
  const back = await where(page);
  assert.ok(back.deck === A && !back.swim, `a stroke back boards the raft (${JSON.stringify(back)})`);
  report.jump = { jumped: jumped.swim, back: back.deck };

  // 7. near the island: swim to the beach, stand up on the shallows, walk
  const start = await page.evaluate(() => {
    let x = app.tiles.center.x, z = app.tiles.center.z;
    const len = Math.hypot(x, z), dx = -x / len, dz = -z / len;
    // from the field towards the island up onto dry land, then back out to 2 m deep: the
    // shelf off this beach lies ~1 m deep for tens of metres (HANDOFF «Пліт і кайт»)
    for (let i = 0; i < 4000 && (app.ground(x, z)?.height ?? -99) < 1; i++) { x += dx * 0.5; z += dz * 0.5; }
    for (let i = 0; i < 4000 && (app.ground(x, z)?.height ?? -99) > -2; i++) { x -= dx * 0.5; z -= dz * 0.5; }
    const w = app.walker.walker;
    w.place(x, z, Math.atan2(dx, dz));
    Object.assign(w.state, { swim: { depth: 0, target: 0 }, y: -1.25, deck: null });
    return { x, z, bed: app.ground(x, z)?.height };
  });
  report.ashore = { start };
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => !app.walker.state.swim, {}, { timeout: 30000 })
    .catch(async (e) => { report.ashore.stuck = await where(page); throw e; });
  const ashore = await where(page);
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const walked = await where(page);
  const g = await page.evaluate(() => app.ground(app.walker.state.x, app.walker.state.z)?.height);
  report.ashore = { start, ashore, walked: Math.hypot(walked.x - ashore.x, walked.z - ashore.z), ground: g };
  assert.equal(ashore.mode, 'eyes');
  assert.ok(g >= -0.5, `standing on wadeable ground (${g})`);
  assert.ok(report.ashore.walked > 2, `walking on: ${report.ashore.walked.toFixed(2)} m in 1 s`);

  // 8. the phone: the same button, uk words, by touch
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, locale: 'uk-UA' });
  watch(phone, 'phone');
  await phone.goto(`${base}?story=${STORY}&walk&stick`);
  await phone.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length > 0, {}, { timeout: 90000 });
  await phone.evaluate(() => {
    const d = app.raft.decks()[0], l = Math.hypot(d.x, d.z);
    app.raft.moveTo(d.id, d.x / l * 1100, d.z / l * 1100);
  });
  await phone.waitForTimeout(1500);
  await phone.evaluate(() => { const d = app.raft.decks()[0]; app.walker.walker.board(d, 0, 0, Math.atan2(d.x, d.z)); });
  const word = (p) => p.waitForFunction(() => { const b = document.querySelector('.walker-fly'); return b && !b.hidden && b.textContent; }, {}, { timeout: 5000 }).then((h) => h.jsonValue());
  const words = [await word(phone)];
  await phone.tap('.walker-fly');
  await phone.waitForFunction(() => !!app.walker.state.swim && document.querySelector('.walker-fly')?.textContent === 'Пірнути', {}, { timeout: 5000 });
  words.push(await word(phone));
  await phone.tap('.walker-fly');
  await phone.waitForFunction(() => document.querySelector('.walker-fly')?.textContent === 'Випливти', {}, { timeout: 5000 });
  words.push(await word(phone));
  await phone.waitForTimeout(3000);
  await phone.screenshot({ path: join(out, 'phone-under.png') });
  const phoneDepth = await phone.evaluate(() => app.walker.state.swim.depth);
  assert.deepEqual(words, ['У воду', 'Пірнути', 'Випливти']);
  assert.ok(phoneDepth > 2.9, `a tap dives 3 m (${phoneDepth})`);
  report.phone = { words, depth: +phoneDepth.toFixed(2) };
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q5b PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
