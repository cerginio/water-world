// story-quest Q9 (STORY-QUEST-SPEC §4.2 v1.6, §4.2a; HANDOFF п.18): the board on the water and the
// hills, through the real frame loop on a phone viewport with the stick. 1) In the open sea at the
// surface «Onto the board»: the board sits in the water. 2) The stick ahead: sit → plane → rise →
// air, the plateau ~3 m holds while the stick does; vertical speed ≤ 2.5 m/s on the way up; the
// horizon level (the camera never rolls). 3) The stick let go: a glide down onto the water, planing,
// then sitting. 4) The stick flickers on and off for 40 s: lift-offs no closer than ~5 s. 5) Every
// visible command button carries its subject's icon (scene and product), a screenshot to look at.
// 6) prefers-reduced-motion: planing only, never off the water.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q9');
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
const PHONE = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true };

/**
 * Into the deep sea at the surface 1050 m out on the open sea's bearing, and round the island on a
 * circle: the yaw is kept tangent every frame, so a minute at 56 m/s never meets the 1500 m limit
 * (FLIGHT.limit: speed outwards stops there, and the board comes down).
 */
async function toSea(page) {
  await page.evaluate(async () => {
    await app.embed['swim.in']({ at: 'open-sea' });
    const s = app.walker.state, r = Math.hypot(s.x, s.z);
    app.walker.walker.swimAt(s.x / r * 1050, s.z / r * 1050, 0);
    s.pitch = 0;
    const circle = () => {
      const q = app.walker.state, l = Math.hypot(q.x, q.z);
      q.yaw = Math.atan2(-q.z / l, q.x / l);
      requestAnimationFrame(circle);
    };
    circle();
  });
  await page.waitForFunction(() => !!app.walker.state.swim && !app.walker.walker.under, {}, { timeout: 10000 });
}
/** A trace of the board every frame (rAF), the first row at once. */
const trace = (page) => page.evaluate(() => {
  window.__trace = [];
  const row = () => {
    const s = app.walker.state, c = app.camera, e = c.matrixWorld.elements;
    __trace.push({ t: performance.now() / 1000, phase: s.flight?.phase ?? null, y: s.y,
      speed: s.flight ? Math.hypot(s.flight.vx, s.flight.vz) : 0, x: s.x, z: s.z,
      roll: e[1] /* the camera's right axis, its world y: 0 = level horizon */ });
  };
  row();
  const tick = () => { if (window.__trace) { row(); requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
});
const stop = (page) => page.evaluate(() => { const t = window.__trace; window.__trace = null; return t; });
/**
 * The largest |vertical speed| over 0.2 s windows of rows that `keep` (frame to frame the wall
 * clock of rAF and the scene's own dt differ by ~6 %, Q9: 2.65 m/s read for a 2.5 m/s cap).
 */
function vspeed(rows, keep, sign = 1) {
  let best = 0;
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].t - rows[i].t <= 0.2) j++;
    if (j === i || rows[j].t - rows[i].t < 0.15 || !rows.slice(i, j + 1).every(keep)) continue;
    best = Math.max(best, sign * (rows[j].y - rows[i].y) / (rows[j].t - rows[i].t));
  }
  return best;
}
const starts = (rows, phase) => rows.filter((r, i) => r.phase === phase && i > 0 && rows[i - 1].phase !== phase);

try {
  const page = await browser.newPage(PHONE);
  watch(page, 'scene');
  await page.goto(`${base}?story=${STORY}&walk&minis&stick&embed&lang=uk`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks && app.embed, {}, { timeout: 120000 });
  await page.waitForTimeout(4000);

  // 1. the open sea at the surface: «На дошку» — the board sits in the water, the kite up
  await toSea(page);
  await page.waitForFunction(() => document.querySelector('.walker-action')?.dataset.action === 'fly', {}, { timeout: 5000 });
  const onto = await page.evaluate(() => document.querySelector('.walker-action').textContent);
  assert.equal(onto, 'На дошку');
  await page.tap('.walker-action');
  await page.waitForTimeout(300);
  const sat = await page.evaluate(() => ({ phase: app.walker.state.flight?.phase, kite: app.raft.kite.up, y: app.walker.state.y }));
  report.onto = { word: onto, ...sat };
  assert.ok(sat.phase === 'sit' && sat.kite, `on the board, sitting in the water (${JSON.stringify(sat)})`);

  // 2. the stick ahead 16 s: sit → plane → rise → air; the plateau holds
  await trace(page);
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0.8 }));
  await page.waitForTimeout(16000);
  const up = await stop(page);
  const order = up.map((r) => r.phase).filter((p, i, a) => p !== a[i - 1]);
  const changes = (rows) => rows.filter((r, i) => i === 0 || r.phase !== rows[i - 1].phase)
    .map((r) => ({ phase: r.phase, t: +(r.t - rows[0].t).toFixed(2), speed: +r.speed.toFixed(1), r: Math.round(Math.hypot(r.x, r.z)) }));
  report.up = { order, seconds: +(up.at(-1).t - up[0].t).toFixed(1), changes: changes(up) };
  assert.deepEqual(order, ['sit', 'plane', 'rise', 'air'], `the phases in order (${order})`);
  const t = (phase) => up.find((r) => r.phase === phase).t - up[0].t;
  report.up.at = { plane: +t('plane').toFixed(2), rise: +t('rise').toFixed(2), air: +t('air').toFixed(2) };
  assert.ok(t('plane') > 1 && t('plane') < 2.2, `planing in ~1.5 s (${t('plane').toFixed(2)})`);
  const aloft = up.filter((r) => r.phase === 'air'), ys = aloft.map((r) => r.y);
  report.up.plateau = [Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(3));
  assert.ok(Math.min(...ys) >= 2.8 && Math.max(...ys) <= 3.2, `plateau ~3 m (${report.up.plateau})`);
  assert.ok(aloft.at(-1).speed > 0.95 * 56, `7× on the plateau (${aloft.at(-1).speed.toFixed(1)} m/s)`);
  const vmax = vspeed(up, (r) => r.phase === 'rise');
  report.up.vmax = +vmax.toFixed(2);
  assert.ok(vmax <= 2.55, `vertical speed on the way up ≤ 2.5 m/s (${vmax.toFixed(2)})`);
  const roll = Math.max(...up.map((r) => Math.abs(r.roll)));
  report.up.roll = +roll.toFixed(5);
  assert.ok(roll < 1e-3, `the horizon level: the camera does not roll (${roll})`);
  await page.screenshot({ path: join(out, '2-plateau.png') });

  // 3. let go: a glide down onto the water, planing, then sitting
  await trace(page);
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0 }));
  await page.waitForTimeout(14000);
  const down = await stop(page);
  const after = down.map((r) => r.phase).filter((p, i, a) => p !== a[i - 1]);
  report.down = { order: after };
  assert.deepEqual(after, ['air', 'fall', 'plane', 'sit'], `down in order (${after})`);
  const fall = down.find((r) => r.phase === 'fall'), touch = down.find((r) => r.t > fall.t && r.phase === 'plane');
  report.down.fallAfter = +(fall.t - down[0].t).toFixed(2);
  report.down.glide = +(touch.t - fall.t).toFixed(2);
  assert.ok(fall.t - down[0].t >= 3.5, `the air brakes slowly: down after ${report.down.fallAfter} s`);
  // the glide: ≥ 2.4 s over the 3 m onto calm water, longer onto a trough (≤ 2.2 m/s down, flight.js)
  const before = down[down.indexOf(fall) - 1], drop = before.y - touch.y;
  report.down.drop = +drop.toFixed(2);
  const vfall = vspeed(down, (r) => r.phase === 'fall', -1);
  report.down.vfall = +vfall.toFixed(2);
  assert.ok(touch.t - fall.t >= 2.3 && touch.t - fall.t <= Math.max(2.4, drop * 1.875 / 2.2) + 1,
    `a glide, not a drop: ${report.down.glide} s over ${report.down.drop} m`);
  // planing: the eyes ride the (smoothed) wave, no steps from the GPU read
  let vplane = 0, where = null;
  for (let i = 1; i < down.length; i++) {
    if (down[i].phase !== 'plane' || down[i - 1].phase !== 'plane' || down[i].t <= down[i - 1].t) continue;
    if (down[i].t - touch.t < 0.35) continue;   // the touch's own dip (0.15 m in 0.3 s, §4.2 v1.6)
    const v = Math.abs(down[i].y - down[i - 1].y) / (down[i].t - down[i - 1].t);
    if (v > vplane) { vplane = v; where = { afterTouch: +(down[i].t - touch.t).toFixed(2), speed: +down[i].speed.toFixed(1) }; }
  }
  report.down.vplaneAt = where;
  report.down.vplane = +vplane.toFixed(2);
  assert.ok(vfall <= 2.55, `down gently, ≤ 2.5 m/s whatever the wave: ${report.down.vfall} m/s`);
  assert.ok(vplane <= 2.5, `planing rides the wave smoothly: ${report.down.vplane} m/s`);

  // 4. the thumb flickers for 40 s: lift-offs at least ~5 s apart
  await trace(page);
  await page.evaluate(() => {
    let seed = 11, on = true;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const flip = () => { if (!window.__trace) return; on = rnd() < 0.7; app.walker.setStick({ x: 0, y: on ? 0.8 : 0 }); setTimeout(flip, 200 + rnd() * 1500); };
    flip();
  });
  await page.waitForTimeout(40000);
  const flicker = await stop(page);
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0 }));
  const rises = starts(flicker, 'rise').map((r) => r.t);
  report.flicker = { rises: rises.length, gaps: rises.slice(1).map((r, i) => +(r - rises[i]).toFixed(2)) };
  assert.ok(rises.length >= 1, 'the flickering thumb still gets the board up');
  assert.ok(report.flicker.gaps.every((g) => g > 5), `lift-offs ≥ 5 s apart (${report.flicker.gaps})`);

  // 5. icons: every visible command button of the scene carries its subject's
  await page.waitForTimeout(500);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('#walkerControls button')]
    .filter((b) => !b.hidden && b.getClientRects().length > 0)
    .map((b) => ({ text: b.textContent, icon: !!b.querySelector('.cmd-icon svg'), cls: b.className })));
  const knob = await page.evaluate(() => !!document.querySelector('.walker-knob .cmd-icon svg'));
  report.buttons = buttons;
  assert.ok(buttons.length >= 2 && buttons.every((b) => b.icon), `every button has its icon (${JSON.stringify(buttons)})`);
  assert.ok(knob, 'the stick knob carries the walker');
  await page.screenshot({ path: join(out, '5-buttons-on-the-board.png') });
  // the fates column too: on a raft (a frame unfolded), the fate buttons
  await page.evaluate(() => app.embed['minis.hydrate']({ frame: 0 }));
  await page.evaluate(() => app.embed['raft.board']({ frame: 0 }));
  // Q10: the fates are under the picture's menu
  await page.waitForFunction(() => !document.querySelector('.walker-menu-toggle')?.hidden, {}, { timeout: 15000 });
  await page.tap('.walker-menu-toggle');
  await page.waitForFunction(() => document.querySelectorAll('.walker-fates .walker-fate').length >= 3, {}, { timeout: 15000 });
  const fates = await page.evaluate(() => [...document.querySelectorAll('#walkerControls button:not(.walker-slot)')]
    .filter((b) => !b.hidden && b.getClientRects().length > 0).map((b) => ({ text: b.textContent, icon: !!b.querySelector('.cmd-icon svg') })));
  report.fateButtons = fates;
  assert.ok(fates.every((b) => b.icon), `fate buttons with icons (${JSON.stringify(fates)})`);
  await page.screenshot({ path: join(out, '5-buttons-on-the-raft.png') });
  await page.close();

  // the product's own buttons over the scene: «На берег» with the walker, «Затихнути» without
  const product = await browser.newPage(PHONE);
  watch(product, 'product');
  await product.goto(`${base}products/story-quest/?story=${STORY}&lang=uk`);
  await product.waitForFunction(() => !!document.querySelector('#toShore .cmd-icon svg'), {}, { timeout: 30000 });
  report.product = await product.evaluate(() => ({ shore: document.querySelector('#toShore').textContent,
    quiet: !!document.querySelector('#quietDown .cmd-icon') }));
  assert.equal(report.product.quiet, false, '«Затихнути» has no subject: no icon');
  await product.screenshot({ path: join(out, '5-product-buttons.png') });
  await product.close();

  // 6. prefers-reduced-motion: the stick ahead 12 s — planing only
  const calm = await browser.newPage({ ...PHONE, reducedMotion: 'reduce' });
  watch(calm, 'calm');
  await calm.goto(`${base}?story=${STORY}&walk&stick&embed`);
  await calm.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.raft?.decks && app.embed, {}, { timeout: 120000 });
  await toSea(calm);
  await calm.evaluate(() => app.embed['fly.takeOff']());
  await trace(calm);
  await calm.evaluate(() => app.walker.setStick({ x: 0, y: 0.8 }));
  await calm.waitForTimeout(12000);
  const still = await stop(calm);
  report.calm = { phases: [...new Set(still.map((r) => r.phase))], top: +Math.max(...still.map((r) => r.speed)).toFixed(1) };
  assert.deepEqual(report.calm.phases.filter((p) => p !== 'sit' && p !== 'plane'), [], `reduced motion: on the water only (${report.calm.phases})`);
  await calm.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q9 PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
