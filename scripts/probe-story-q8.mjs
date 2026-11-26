// story-quest Q8 (the owner's phone, 2026-11-26): through the real frame loop on a phone viewport
// with the stick. 1) From the beach the stick walks the walker straight into the sea: past the
// wading line it swims (before Q8 the line held it on the shore). 2) In the water at the surface
// the action button reads «Onto the board» (Q9; «Take off» before); a tap lifts the walker out of the sea onto the board with
// the kite up. 3) The board flies at seven times the raft (56 m/s). 4) The board is a twin-tip
// kiteboard (deck, pads, straps, handle, fins), seen looking down — a screenshot to look at.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q8');
mkdirSync(out, { recursive: true });
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
const report = { base, story: STORY };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const where = (page) => page.evaluate(() => {
  const s = app.walker.state;
  return { mode: app.walker.mode, swim: s.swim && { depth: +s.swim.depth.toFixed(3) }, flight: s.flight && {
    speed: +Math.hypot(s.flight.vx, s.flight.vz).toFixed(2), phase: s.flight.phase }, kite: app.raft.kite.up, kiteShown: app.raft.kiteGroup.visible,
    board: app.walker.board.visible, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2),
    ground: app.ground(s.x, s.z)?.height ?? null,
    button: (() => { const b = document.querySelector('.walker-action'); return b.hidden ? null : { text: b.textContent, action: b.dataset.action }; })() };
});

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?story=${STORY}&walk&minis&stick`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks && app.fates, {}, { timeout: 120000 });
  await page.waitForTimeout(5000);   // the frames settle after the flight over the island

  // 1. the beach, facing the deepest way down within 30 m; the stick ahead (no run)
  const start = await page.evaluate(() => {
    const s = app.walker.state;
    let best = null;
    for (let k = 0; k < 72; k++) {
      const a = k * Math.PI / 36, x = s.x + Math.sin(a) * 30, z = s.z + Math.cos(a) * 30;
      const h = app.ground(x, z)?.height ?? -100;
      if (!best || h < best.h) best = { a, h };
    }
    app.walker.place(s.x, s.z, best.a);
    app.walker.walker.state.pitch = 0;
    app.walker.setStick({ x: 0, y: 0.8 });
    return { x: s.x, z: s.z, yaw: best.a, ground: app.ground(s.x, s.z).height };
  });
  const tWalk = performance.now();
  await page.waitForFunction(() => !!app.walker.state.swim, {}, { timeout: 30000 })
    .catch(() => { throw new Error('the stick did not take the walker from the beach into the water in 30 s'); });
  const wentIn = await where(page);
  report.wentIn = { ...wentIn, seconds: +((performance.now() - tWalk) / 1000).toFixed(1), from: start };
  assert.ok(wentIn.ground === null || wentIn.ground < -0.5, `in the water past the wading line (${JSON.stringify(wentIn)})`);
  await page.waitForTimeout(2000);
  const swum = await where(page);
  const out1 = Math.hypot(swum.x - wentIn.x, swum.z - wentIn.z);
  assert.ok(swum.swim && out1 > 3, `swims on out: ${out1.toFixed(2)} m in 2 s (${JSON.stringify(swum)})`);
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0 }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, '1-in-the-water.png') });

  // 2. at the surface the action button: «Onto the board» (Q9); a tap — on the board sitting in the water, the kite up
  const surface = await where(page);
  report.surface = surface;
  assert.deepEqual(surface.button, { text: 'Onto the board', action: 'fly' }, `the action button in the water (${JSON.stringify(surface)})`);
  await page.tap('.walker-action');
  await page.waitForTimeout(1500);
  const air = await where(page);
  report.air = air;
  assert.ok(air.flight && !air.swim, `on the board off the water (${JSON.stringify(air)})`);
  assert.ok(air.kite && air.kiteShown && air.board, 'the kite up and shown, the board under the feet');
  assert.ok(air.flight.phase === 'sit' && air.y < 0.8, `out of the sea the board sits in the water (Q9): ${air.flight.phase}, ${air.y} m`);

  // 3. the stick: planing, then off the water onto the plateau at 56 m/s, seven times the raft
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0.8 }));
  await page.waitForFunction(() => app.walker.state.flight?.phase === 'air', {}, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const fast = await where(page);
  report.fast = fast;
  assert.ok(fast.flight && fast.flight.speed > 50 && fast.flight.speed <= 56.01, `flight speed ${fast.flight?.speed} m/s`);
  assert.ok(fast.y >= 2.8 && fast.y <= 3.2, `the board on the plateau ~3 m: ${fast.y}`);

  // 4. the board: a kiteboard; look down at it
  const board = await page.evaluate(() => {
    const b = app.walker.board, names = {};
    b.traverse((o) => { if (o !== b) names[o.name] = (names[o.name] ?? 0) + 1; });
    return names;
  });
  report.board = board;
  assert.deepEqual(board, { 'kiteboard-deck': 1, 'kiteboard-pad': 2, 'kiteboard-strap': 2, 'kiteboard-handle': 1, 'kiteboard-fin': 4 });
  await page.evaluate(() => { app.walker.setStick({ x: 0, y: 0 }); app.walker.walker.state.pitch = -1.3; });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(out, '4-board-looking-down.png') });

  assert.deepEqual(errors, [], 'page errors');
  report.ok = true;
} finally {
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`probe-story-q8: PASS ${report.seconds} s → ${out}`);
