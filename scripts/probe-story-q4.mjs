// story-quest Q4 (STORY-QUEST-SPEC §2 п.5, §4.2, §4.3; HANDOFF Q4): the raft and the kite
// through the real frame loop and real keys. A miniature unfolds by the beach (as Q3); W
// walks onto the frame — the walker stands on it at the GPU's deck height and a drag on it
// turns the head, it does not drag the raft; K puts the kite up and W pulls the raft along
// the course, the tiles going with it; past the edge of the shore map (|x| or |z| > 900 m)
// the 'sea' event comes right at the edge; the raft casts no float shadow out there; K lets
// go and the raft slows to the drift; brought back to the beach it stops short of the
// shallows and the walker steps off onto the land. On a phone the button words the kite.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q4');
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
const hold = async (page, code, ms) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
// the raft frame's tiles over consecutive frames (GPU state): how often a tile's horizontal
// step turns back. A frame drawn in two places in turn (Q4 review, the surf) reverses on
// over half of all tile-frames; floating steady, on none.
const reversals = (page, frames = 30) => page.evaluate(async (frames) => {
  const f = app.tiles.frameRegistry.get(app.raft.deckId), sim = app.tiles.sim, r = app.renderer;
  const ids = [];
  for (let i = 0; i < app.tiles.rest.tiles.count; i++) if (app.tiles.rest.tiles.frameIndex[i] === f.index) ids.push(i);
  const buf = new Float32Array(512 * sim.height * 4), series = [];
  for (let k = 0; k < frames; k++) {
    await new Promise((res) => requestAnimationFrame(() => res()));
    r.readRenderTargetPixels(sim.target, 0, 0, 512, sim.height, buf, undefined, 0);
    series.push(ids.map((i) => [buf[i * 4 + 2], buf[i * 4 + 3]]));
  }
  let turns = 0, steps = 0;
  for (let t = 0; t < ids.length; t++) {
    for (let k = 2; k < frames; k++) {
      const a = series[k - 2][t], b = series[k - 1][t], c = series[k][t];
      const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
      steps++;
      if (d1[0] * d2[0] + d1[1] * d2[1] < 0 && Math.hypot(...d2) > 0.02) turns++;
    }
  }
  const deck = app.raft.decks().find((d) => d.id === app.raft.deckId);
  return { share: turns / steps, turns, steps, ground: app.ground(deck.x, deck.z)?.height ?? null };
}, frames);
// the kite's bar in camera space over consecutive frames: steady while the raft runs straight
const barJitter = (page, frames = 30) => page.evaluate(async (frames) => {
  const ps = [];
  for (let k = 0; k < frames; k++) {
    await new Promise((res) => requestAnimationFrame(() => res()));
    ps.push(app.raft.bar.clone().applyMatrix4(app.camera.matrixWorldInverse));
  }
  const m = ps.reduce((a, p) => a.add(p), ps[0].clone().multiplyScalar(0)).multiplyScalar(1 / ps.length);
  return Math.max(...ps.map((p) => p.distanceTo(m)));
}, frames);
const raftState = (page) => page.evaluate(() => {
  const r = app.raft, s = app.walker.state, id = r.deckId, m = id === null ? null : r.motion.get(id);
  const deck = r.decks().find((d) => d.id === id);
  return { deck: s.deck && String(s.deck.id), x: s.x, y: s.y, z: s.z, kite: r.kite.up, inSea: r.inSea,
    speed: m ? Math.hypot(m.vx, m.vz) : 0, blocked: m?.blocked ?? false, deckY: deck?.y ?? null,
    centre: deck ? [deck.x, deck.z] : null, hint: app.kiteHint() };
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?story=${STORY}&walk&minis`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.minis?.active && app?.raft, {}, { timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.__events = [];
    for (const type of ['board', 'leave', 'kite', 'sea']) app.raft.addEventListener(type, (e) => __events.push({ type, ...e.detail }));
  });
  assert.equal((await page.evaluate(() => app.raft.decks().length)), 0, 'miniatures on the land: no decks on the water');

  // 1. a miniature into the hands, to the sea, unfolded by the beach (as probe-story-q3)
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
  const frameId = await page.evaluate(() => String(app.minis.items[0].frameId));
  const decks = await page.evaluate(() => app.raft.decks().map((d) => ({ id: String(d.id), hu: d.hu, hv: d.hv, x: d.x, z: d.z })));
  assert.deepEqual(decks.map((d) => d.id), [frameId], 'the hydrated frame is the only deck');
  const shore = await page.evaluate(() => ({ x: app.walker.state.x, z: app.walker.state.z, yaw: app.walker.state.yaw }));

  // 2. W onto it: the walker stands on the deck at the GPU's height
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.walker.state.deck !== null, {}, { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1500);
  const heights = [];
  for (let i = 0; i < 15; i++) {
    heights.push(await raftState(page));
    await page.waitForTimeout(200);
  }
  const ys = heights.map((h) => h.y), deckYs = heights.map((h) => h.deckY);
  assert.ok(heights.every((h) => h.deck === frameId), 'stays on the deck');
  assert.ok(heights.every((h) => Math.abs(h.y - h.deckY) < 0.1), `feet on the deck (${ys.map((v) => v.toFixed(2))} vs ${deckYs.map((v) => v.toFixed(2))})`);
  assert.ok(Math.min(...deckYs) > -0.6 && Math.max(...deckYs) < 1.2, `deck height from the tiles (${Math.min(...deckYs)}..${Math.max(...deckYs)})`);
  assert.equal(heights[0].hint, 'kite');
  await page.screenshot({ path: join(out, 'on-deck.png') });
  report.deck = { frameId, half: [decks[0].hu, decks[0].hv].map((v) => +v.toFixed(2)),
    deckY: [Math.min(...deckYs), Math.max(...deckYs)].map((v) => +v.toFixed(3)), feetMinusDeck: +Math.max(...heights.map((h) => Math.abs(h.y - h.deckY))).toFixed(3) };

  // 3. a drag over the raft turns the head; the raft does not move
  const drag = await page.evaluate(() => { app.walker.state.pitch = -0.9; return { yaw: app.walker.state.yaw, world: app.tiles.frameRegistry.get(app.raft.deckId).world.toArray() }; });
  await page.waitForTimeout(300);
  await page.mouse.move(640, 500);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 15, 500);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await page.evaluate(() => ({ yaw: app.walker.state.yaw, world: app.tiles.frameRegistry.get(app.raft.deckId).world.toArray() }));
  assert.ok(Math.abs(dragged.yaw - drag.yaw) > 0.3, `the drag turned the head (${drag.yaw} → ${dragged.yaw})`);
  assert.ok(Math.hypot(dragged.world[0] - drag.world[0], dragged.world[2] - drag.world[2]) < 1e-6, 'the raft was not dragged');
  await page.evaluate(() => { app.walker.state.pitch = 0; });

  // 4. K: the kite up; W pulls the raft out along the course, the tiles with it
  const outward = await page.evaluate(() => {
    const c = app.raft.decks()[0], l = Math.hypot(c.x, c.z);
    app.walker.state.yaw = Math.atan2(c.x / l, c.z / l);
    return [c.x / l, c.z / l];
  });
  await key(page, 'KeyK');
  assert.equal((await raftState(page)).kite, true);
  const before = await page.evaluate(async () => {
    const f = app.tiles.frameRegistry.get(app.raft.deckId), b = await app.tiles.frameFootprint(f);
    return { centre: app.raft.decks()[0], box: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2] };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(7000);
  const bar = await barJitter(page);
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const pulled = await raftState(page);
  const after = await page.evaluate(async () => {
    const f = app.tiles.frameRegistry.get(app.raft.deckId), b = await app.tiles.frameFootprint(f);
    return { centre: app.raft.decks()[0], box: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2] };
  });
  const moved = [after.centre.x - before.centre.x, after.centre.z - before.centre.z];
  const tilesMoved = [after.box[0] - before.box[0], after.box[1] - before.box[1]];
  const along = (moved[0] * outward[0] + moved[1] * outward[1]) / Math.hypot(...moved);
  assert.equal(pulled.deck, frameId, 'still on the raft');
  assert.ok(pulled.speed > 0.8 * 8, `the kite's speed (${pulled.speed} m/s)`);
  assert.ok(along > 0.99, `along the course (cos ${along})`);
  assert.ok(bar < 0.02, `the kite's bar stays put in view while the raft runs (${bar.toFixed(4)} m)`);
  assert.ok(Math.hypot(tilesMoved[0] - moved[0], tilesMoved[1] - moved[1]) < 1.5,
    `the tiles went with the deck (${tilesMoved.map((v) => v.toFixed(1))} vs ${moved.map((v) => v.toFixed(1))})`);
  await page.screenshot({ path: join(out, 'kite.png') });
  report.kite = { speed: +pulled.speed.toFixed(2), moved8s: +Math.hypot(...moved).toFixed(1), cos: +along.toFixed(4),
    tilesVsDeck: +Math.hypot(tilesMoved[0] - moved[0], tilesMoved[1] - moved[1]).toFixed(2), barJitter: +bar.toFixed(4) };

  // 5. the edge of the shore map: the raft just inside it, W on across; 'sea' right at the edge
  const course = await page.evaluate(() => {
    const c = app.raft.decks()[0], ax = Math.abs(c.x) >= Math.abs(c.z);
    const dir = ax ? [Math.sign(c.x), 0] : [0, Math.sign(c.z)];
    const s = app.walker.state, dx = s.x - c.x, dz = s.z - c.z;
    // the walker 20 m inside the edge, on its course
    const wx = ax ? dir[0] * 880 : s.x, wz = ax ? s.z : dir[1] * 880;
    app.raft.moveTo(app.raft.deckId, wx - dx, wz - dz);
    app.walker.state.yaw = Math.atan2(dir[0], dir[1]);
    __events.length = 0;
    return dir;
  });
  await page.waitForTimeout(500);
  assert.equal((await raftState(page)).inSea, false);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.raft.inSea, {}, { timeout: 30000 });
  await page.keyboard.up('KeyW');
  const sea = await page.evaluate(() => __events.find((e) => e.type === 'sea'));
  const edge = Math.max(Math.abs(sea.x), Math.abs(sea.z)) - 900;
  assert.ok(sea.inSea && String(sea.frameId) === frameId);
  assert.ok(edge > 0 && edge < 0.5, `'sea' right at the edge (${edge.toFixed(3)} m past it)`);
  await page.waitForTimeout(3000);
  const atSea = await page.evaluate(() => ({ shadow: app.tiles.castsShadow ? app.tiles.syncShadow() : 'no float shadow',
    deck: app.walker.state.deck && String(app.walker.state.deck.id), x: app.walker.state.x, z: app.walker.state.z }));
  assert.equal(atSea.deck, frameId);
  assert.ok(atSea.shadow === null || atSea.shadow === 'no float shadow' || atSea.shadow.radius < 120,
    `the float shadow does not stretch out to the raft (${JSON.stringify(atSea.shadow)})`);
  await page.screenshot({ path: join(out, 'open-sea-eyes.png') });
  report.sea = { course, eventPastEdge: +edge.toFixed(3), at: [+sea.x.toFixed(2), +sea.z.toFixed(2)], shadow: atSea.shadow };

  // 6. K: let go — the raft slows to the drift
  await key(page, 'KeyK');
  assert.equal((await raftState(page)).kite, false);
  await page.waitForTimeout(12000);
  const drifting = await raftState(page);
  const drift = await page.evaluate(() => { const d = app.raft.drift(); return Math.hypot(d.x, d.z); });
  assert.ok(Math.abs(drifting.speed - drift) < 0.1, `slowed to the drift (${drifting.speed} vs ${drift} m/s)`);
  report.drift = { after12s: +drifting.speed.toFixed(3), drift: +drift.toFixed(3) };
  // out of the body: the raft and the figure from behind
  await key(page, 'KeyV');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'open-sea-out-of-body.png') });
  await key(page, 'KeyV');
  await page.waitForFunction(() => app.walker.mode === 'eyes', {}, { timeout: 10000 });

  // 7. back to the beach: the raft stops short of the shallows, the walker steps off
  await page.evaluate(({ shore, home }) => {
    // the deck centre back where the frame unfolded, the walker facing the beach
    app.raft.moveTo(app.raft.deckId, home[0], home[1]);
    app.walker.state.yaw = shore.yaw + Math.PI;
  }, { shore, home: [decks[0].x, decks[0].z] });
  await page.waitForTimeout(300);
  await key(page, 'KeyK');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.raft.motion.get(app.raft.deckId)?.blocked, {}, { timeout: 30000 });
  await page.keyboard.up('KeyW');
  const aground = await raftState(page);
  await key(page, 'KeyK');
  // in the surf the tiles float as on open water: no frame drawn in two places in turn
  await page.waitForTimeout(3000);
  const surf = await reversals(page);
  assert.ok(surf.share < 0.005, `tiles in the surf reverse on ${(surf.share * 100).toFixed(2)} % of steps (${surf.turns}/${surf.steps}, ground ${surf.ground})`);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.walker.state.deck === null, {}, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const ashore = await page.evaluate(() => {
    const s = app.walker.state, g = app.ground(s.x, s.z);
    return { y: s.y, ground: g?.height ?? null, events: __events.map((e) => e.type) };
  });
  assert.ok(Math.abs(ashore.y - ashore.ground) < 1e-6 && ashore.ground >= -0.5, `on the ground off the raft (${ashore.y} on ${ashore.ground})`);
  assert.ok(ashore.events.includes('leave'));
  await page.screenshot({ path: join(out, 'ashore.png') });
  report.shore = { aground: aground.blocked, groundOff: +ashore.ground.toFixed(3),
    surfReversals: surf.turns, surfSteps: surf.steps, surfGround: surf.ground && +surf.ground.toFixed(2) };

  // 8. the touch button words the kite (no miniatures: every frame on the water is a deck)
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  watch(phone, 'phone');
  await phone.goto(`${base}?story=${STORY}&walk&stick`);
  await phone.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks().length > 0, {}, { timeout: 90000 });
  await phone.evaluate(() => app.walker.walker.board(app.raft.decks()[0]));
  await phone.waitForFunction(() => document.querySelector('.walker-action')?.dataset.action === 'kite', {}, { timeout: 5000 });
  const kiteWord = await phone.evaluate(() => document.querySelector('.walker-action').textContent);
  await phone.tap('.walker-action');
  await phone.waitForFunction(() => app.raft.kite.up && document.querySelector('.walker-action').dataset.action === 'unkite', {}, { timeout: 3000 });
  const unkiteWord = await phone.evaluate(() => document.querySelector('.walker-action').textContent);
  await phone.screenshot({ path: join(out, 'phone-kite.png') });
  report.phone = { kite: kiteWord, unkite: unkiteWord };
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q4 PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
