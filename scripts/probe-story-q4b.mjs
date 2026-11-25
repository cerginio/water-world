// story-quest Q4b (STORY-QUEST-SPEC §2 п.6 «Вихід з плоту», «Інший кадр»; §4.2 v1.5; HANDOFF
// п.9): the board under the kite through the real frame loop and real keys. A miniature
// unfolds by the beach and becomes the raft (as probe-story-q4); K, then Space: the walker
// takes off on the board, the kite stays up, the raft left behind coasts to the drift; the
// board flies 24 m/s at 2–4 m over the mean water, the camera in the eyes (CameraRig.ride);
// over deep water Space does not land; on a course to the island it lands by itself on the
// shallows, on the feet. A second miniature, carried onto the raft and put down, unfolds
// beside it, clear of it, and the walker jumps across; from there a flight back over the
// first frame and Space lands on it, and it is the raft under the kite. On a phone the flight
// button words «Take off» / «Land».
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q4b');
mkdirSync(out, { recursive: true });
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
const report = { base, story: STORY };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};
const key = async (page, code) => { await page.keyboard.press(code); await page.waitForTimeout(100); };
const state = (page) => page.evaluate(() => {
  const s = app.walker.state, r = app.raft, e = app.walker.walker.eyes().position, c = app.camera.position;
  return { x: s.x, y: s.y, z: s.z, deck: s.deck && String(s.deck.id), flying: !!s.flight,
    speed: s.flight ? Math.hypot(s.flight.vx, s.flight.vz) : 0, kite: r.kite.up, raft: r.deckId === null ? null : String(r.deckId),
    ground: app.ground(s.x, s.z)?.height ?? null, hint: app.flyHint(), mode: app.walker.mode,
    camToEyes: Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z), board: app.walker.board.visible };
});
const motionOf = (page, id) => page.evaluate((id) => {
  for (const [k, m] of app.raft.motion) if (String(k) === id) return { speed: Math.hypot(m.vx, m.vz), x: m.x, z: m.z };
  return null;
}, id);
// the walker faces world (x, z)
const face = (page, x, z) => page.evaluate(({ x, z }) => {
  const s = app.walker.state;
  s.yaw = Math.atan2(x - s.x, z - s.z);
}, { x, z });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?story=${STORY}&walk&minis`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.minis?.active && app?.raft, {}, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__events = [];
    for (const type of ['board', 'leave', 'kite', 'takeoff', 'land']) app.raft.addEventListener(type, (e) => __events.push({ type, ...e.detail }));
  });

  // 1. a miniature into the hands, to the sea, unfolded by the beach, and onto it (as probe-story-q4)
  await page.evaluate(() => {
    const m = app.minis.items[0].root.position;
    app.walker.place(m.x - 1.5, m.z, Math.PI / 2);
  });
  await key(page, 'KeyG');
  await page.evaluate(() => {
    let x = app.tiles.center.x, z = app.tiles.center.z;
    const len = Math.hypot(x, z), dx = -x / len, dz = -z / len;
    while ((app.ground(x, z)?.height ?? -99) < 1) { x += dx * 0.5; z += dz * 0.5; }
    app.walker.place(x, z, Math.atan2(-dx, -dz));
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (app.ground(app.walker.state.x, app.walker.state.z)?.height ?? 0) < -0.45, {}, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  await key(page, 'KeyG');
  await page.waitForFunction(() => app.minis.items[0].state === 'water', {}, { timeout: 5000 });
  const raftId = await page.evaluate(() => String(app.minis.items[0].frameId));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.walker.state.deck !== null, {}, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  assert.equal((await state(page)).hint, null, 'no kite up: no take-off');

  // 2. K, the raft out to deep water; Space: up on the board, the kite stays up
  await page.evaluate(() => {
    const c = app.raft.decks()[0], l = Math.hypot(c.x, c.z);
    app.walker.state.yaw = Math.atan2(c.x / l, c.z / l);
  });
  await key(page, 'KeyK');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyW');
  const onRaft = await state(page);
  assert.equal(onRaft.deck, raftId);
  assert.equal(onRaft.hint, 'fly', 'on the raft with the kite up: «Take off»');
  const raftBefore = await motionOf(page, raftId);
  await key(page, 'Space');
  const up = await state(page);
  assert.ok(up.flying && up.deck === null && up.kite, `in the air on the board, the kite up (${JSON.stringify(up)})`);

  // 3. out to sea: 24 m/s, 2–4 m over the mean water, the camera in the eyes; Space does not land
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  const band = [];
  for (let i = 0; i < 20; i++) { band.push(await state(page)); await page.waitForTimeout(150); }
  const ys = band.map((s) => s.y), speeds = band.map((s) => s.speed);
  assert.ok(Math.min(...ys) >= 2 && Math.max(...ys) <= 4, `board 2–4 m over the mean water (${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)})`);
  assert.ok(Math.min(...speeds.slice(-10)) > 0.9 * 24, `board speed (${speeds.slice(-5).map((v) => v.toFixed(1))} m/s)`);
  assert.ok(band.every((s) => s.camToEyes < 0.05), `camera in the eyes (${Math.max(...band.map((s) => s.camToEyes)).toFixed(3)} m)`);
  assert.ok(band.every((s) => s.board && s.mode === 'eyes'));
  await page.evaluate(() => { app.walker.state.pitch = -0.7; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'flight-eyes.png') });
  await page.evaluate(() => { app.walker.state.pitch = 0; });
  await page.keyboard.up('KeyW');
  const deep = await state(page);
  assert.ok(deep.ground === null || deep.ground < -0.5);
  assert.equal(deep.hint, null, 'over deep water: no «Land»');
  await key(page, 'Space');
  await key(page, 'KeyK');
  assert.ok((await state(page)).flying, 'over deep water neither Space nor K lands');
  // the raft left behind: no kite on it, it coasts down
  const raftAfter = await motionOf(page, raftId);
  assert.ok(raftAfter.speed < raftBefore.speed - 1, `the raft left behind slows (${raftBefore.speed.toFixed(2)} → ${raftAfter.speed.toFixed(2)} m/s)`);
  await key(page, 'KeyV');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'flight-out-of-body.png') });
  await key(page, 'KeyV');
  await page.waitForFunction(() => app.walker.mode === 'eyes', {}, { timeout: 10000 });
  report.flight = { y: [Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(2)), speed: +speeds.at(-1).toFixed(2),
    camToEyes: +Math.max(...band.map((s) => s.camToEyes)).toFixed(4), raftLeft: [raftBefore.speed, raftAfter.speed].map((v) => +v.toFixed(2)) };

  // 4. a course to the island: it lands by itself on the shallows, on the feet, the kite gone
  const t1 = performance.now();
  await face(page, 0, 0);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => !app.walker.state.flight, {}, { timeout: 90000 });
  await page.keyboard.up('KeyW');
  const kiteShown = await page.evaluate(() => app.raft.kiteGroup.visible);
  await page.waitForTimeout(200);   // the raft lets the kite go on its next update
  const ashore = await state(page);
  assert.equal(ashore.mode, 'eyes');
  assert.ok(ashore.ground >= -0.5 && Math.abs(ashore.y - ashore.ground) < 1e-6, `on the feet on the shallows (${ashore.y} on ${ashore.ground})`);
  assert.equal(ashore.kite, false, 'landed on the ground: the kite is gone');
  assert.equal(kiteShown, false, 'the kite is not drawn the frame it lands');
  assert.equal(ashore.board, false);
  const land = await page.evaluate(() => __events.filter((e) => e.type === 'land').at(-1));
  assert.equal(land?.on, 'ground');
  const walked = await page.evaluate(() => app.walker.state.walked);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  assert.ok((await page.evaluate(() => app.walker.state.walked)) - walked > 2, 'walks on');
  await page.screenshot({ path: join(out, 'landed-ashore.png') });
  report.ashore = { ground: +ashore.ground.toFixed(3), seconds: +((performance.now() - t1) / 1000).toFixed(1) };

  // 5. another frame: a second miniature carried onto the raft and put down unfolds beside it
  await page.evaluate(() => {
    const m = app.minis.items[1].root.position;
    app.walker.place(m.x - 1.5, m.z, Math.PI / 2);
  });
  await key(page, 'KeyG');
  assert.ok(await page.evaluate(() => app.minis.items[1].state === 'carried'));
  const otherId = await page.evaluate(() => String(app.minis.items[1].frameId));
  await page.evaluate((id) => {
    const d = app.raft.decks().find((d) => String(d.id) === id);
    app.walker.walker.board(d, 0, 0, Math.atan2(d.x, d.z));   // facing out to sea
  }, raftId);
  await page.waitForTimeout(300);
  await key(page, 'KeyG');
  await page.waitForFunction(() => app.minis.items[1].state === 'water', {}, { timeout: 5000 });
  await page.waitForTimeout(300);
  const pair = await page.evaluate(({ raftId, otherId }) => {
    const ds = app.raft.decks(), a = ds.find((d) => String(d.id) === raftId), b = ds.find((d) => String(d.id) === otherId);
    // the gap between the two rectangles along the line of centres (both share the field's axes)
    const dx = b.x - a.x, dz = b.z - a.z, du = Math.abs(dx * a.ux + dz * a.uz), dv = Math.abs(dx * a.vx + dz * a.vz);
    const gap = Math.max(du - a.hu - b.hu, dv - a.hv - b.hv);
    return { b: { x: b.x, z: b.z }, gap };
  }, { raftId, otherId });
  assert.ok(pair.gap > 0, `unfolded clear of the raft (gap ${pair.gap.toFixed(2)} m)`);
  assert.ok(pair.gap < 4, `within a jump of it (gap ${pair.gap.toFixed(2)} m, DECK_JUMP 4)`);
  await face(page, pair.b.x, pair.b.z);
  await page.keyboard.down('KeyW');
  report.other = { frame: otherId, gap: +pair.gap.toFixed(2) };
  await page.waitForFunction((id) => String(app.walker.state.deck?.id) === id, otherId, { timeout: 15000 }).catch(async (e) => {
    report.otherDebug = await page.evaluate(() => ({ s: { ...app.walker.state, flight: null }, decks: app.raft.decks(), kite: app.raft.kite.up }));
    throw e;
  });
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, 'other-frame.png') });
  report.other = { frame: otherId, gap: +pair.gap.toFixed(2) };

  // 6. from the other frame: up, away, back over the first frame — Space lands on it, the raft
  await key(page, 'KeyK');
  await key(page, 'Space');
  assert.ok((await state(page)).flying);
  const target = await page.evaluate((id) => { const d = app.raft.decks().find((d) => String(d.id) === id); return { x: d.x, z: d.z }; }, raftId);
  await page.evaluate((t) => { const s = app.walker.state; app.walker.state.yaw = Math.atan2(s.x - t.x, s.z - t.z); }, target);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await face(page, target.x, target.z);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((id) => {
    const d = app.raft.decks().find((d) => String(d.id) === id), s = app.walker.state;
    return Math.abs((s.x - d.x) * d.ux + (s.z - d.z) * d.uz) < d.hu * 0.6 && Math.abs((s.x - d.x) * d.vx + (s.z - d.z) * d.vz) < d.hv * 0.6;
  }, raftId, { timeout: 30000, polling: 'raf' });
  await page.keyboard.up('KeyW');
  assert.equal((await state(page)).hint, 'land', 'over a frame: «Land»');
  await key(page, 'Space');
  const back = await state(page);
  assert.equal(back.deck, raftId, 'landed on the first frame');
  assert.ok(!back.flying && back.kite, 'the kite still up');
  await page.waitForTimeout(500);
  assert.equal((await state(page)).raft, raftId, 'it is the raft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const pulled = await motionOf(page, raftId);
  assert.ok(pulled.speed > 0.5 * 8, `the kite pulls it (${pulled.speed.toFixed(2)} m/s)`);
  const landed = await page.evaluate(() => __events.filter((e) => e.type === 'land').map((e) => e.on));
  assert.deepEqual(landed, ['ground', 'deck']);
  report.deckLanding = { raft: raftId, pull: +pulled.speed.toFixed(2), events: await page.evaluate(() => __events.map((e) => e.type)) };

  // 7. the touch buttons: «Take off», then «Land» over the deck it rose from
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  watch(phone, 'phone');
  await phone.goto(`${base}?story=${STORY}&walk&stick`);
  await phone.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length > 0, {}, { timeout: 90000 });
  await phone.evaluate(() => app.walker.walker.board(app.raft.decks()[0]));
  await phone.waitForFunction(() => document.querySelector('.walker-action')?.dataset.action === 'kite', {}, { timeout: 5000 });
  await phone.tap('.walker-action');
  await phone.waitForFunction(() => document.querySelector('.walker-fly')?.dataset.action === 'fly', {}, { timeout: 3000 });
  const flyWord = await phone.evaluate(() => document.querySelector('.walker-fly').textContent);
  await phone.tap('.walker-fly');
  await phone.waitForFunction(() => !!app.walker.state.flight && document.querySelector('.walker-fly').dataset.action === 'land', {}, { timeout: 3000 });
  const landWord = await phone.evaluate(() => document.querySelector('.walker-fly').textContent);
  await phone.screenshot({ path: join(out, 'phone-flight.png') });
  await phone.tap('.walker-fly');
  await phone.waitForFunction(() => !app.walker.state.flight && app.walker.state.deck !== null, {}, { timeout: 3000 });
  report.phone = { fly: flyWord, land: landWord };
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q4b PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
