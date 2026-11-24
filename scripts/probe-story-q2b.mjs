// story-quest Q2b (STORY-QUEST-SPEC §2 п.2; HANDOFF Q2b): cameras and the phone, through
// the real frame loop. 1) ?walk: a flight up to the island overview, a hold, then the
// camera goes down into the eyes without a jump; 2) out of the body (V) the camera is free
// — keys and the stick move it, the figure stands — and V back lands in the same eyes;
// 3) on a phone-sized touch page the stick walks the walker and the button leaves the
// body; 4) ?story=…&walk opens on the overview once the field is loaded and ends in the
// eyes (loading no longer throws the camera out of them).
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q2b');
const STORY = process.env.STORY ?? 'test-2025/my-day-3-moments';
mkdirSync(out, { recursive: true });
const report = { base };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};
// every frame after the app's tick: camera, orientation, the walker's mode, the rig's locks
const record = (page) => page.evaluate(() => {
  const rows = [];
  window.__trace = rows;
  const sample = (now) => {
    if (window.__trace !== rows) return;
    const c = app.camera, w = app.walker;
    rows.push({ now, p: c.position.toArray(), q: c.quaternion.toArray(), mode: w?.mode ?? 'none',
      reasons: app.rig.reasons.join(','), boarding: app.rig.boarding });
    requestAnimationFrame(sample);
  };
  sample(performance.now());   // the pose before whatever the probe does next
});
const stop = (page) => page.evaluate(() => { const rows = window.__trace; window.__trace = null; return rows; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const eyeError = (page) => page.evaluate(() => {
  const e = app.walker.walker.eyes().position, c = app.camera.position;
  return Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
});

/**
 * The descent: frames in 'boarding'. A jump is a frame that moves more than the curve can
 * in its (clamped) dt: smootherstep peaks at 1.875 × the mean speed, the rig clamps dt to 0.1 s.
 */
function checkDescent(rows, label) {
  const i0 = rows.findIndex((r) => r.mode === 'boarding');
  const i1 = rows.findIndex((r, i) => i > i0 && r.mode === 'eyes');
  assert.ok(i0 > 0 && i1 > i0, `${label}: no boarding → eyes in the trace`);
  const from = rows[i0 - 1], to = rows[i1];
  const total = dist(rows[i0].p, to.p), seconds = (to.now - rows[i0].now) / 1000;
  const peak = 1.875 * total / seconds;
  let worst = 0, turn = 0, maxStep = 0;
  for (let i = i0; i <= i1 + 2 && i < rows.length; i++) {
    const dt = Math.min(0.1, (rows[i].now - rows[i - 1].now) / 1000);
    const step = dist(rows[i].p, rows[i - 1].p);
    maxStep = Math.max(maxStep, step);
    worst = Math.max(worst, step / (peak * dt + 0.02));
    turn = Math.max(turn, angle(rows[i].q, rows[i - 1].q) / Math.max(dt, 1 / 60));
  }
  // the turn rate: a slerp over the whole descent, ≤ 1.875 × the mean rate, with margin
  const whole = angle(rows[i0].q, to.q);
  assert.ok(worst <= 1.05, `${label}: a frame moved ${worst.toFixed(2)} × what the curve allows`);
  assert.ok(turn <= 1.875 * whole / seconds * 1.3 + 0.05, `${label}: turned ${turn.toFixed(2)} rad/s`);
  return { frames: i1 - i0, seconds: +seconds.toFixed(2), distance: +total.toFixed(1), meanSpeed: +(total / seconds).toFixed(1),
    maxStep: +maxStep.toFixed(2), worstStepShare: +worst.toFixed(2), turn: +whole.toFixed(2),
    entryStep: +dist(from.p, rows[i0].p).toFixed(4) };
}

try {
  // 1. ?walk: overview → hold → descent → eyes
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?tiles=none&walk`);
  await page.waitForFunction(() => window.app?.rig, {}, { timeout: 60000 });
  await record(page);
  await page.waitForFunction(() => app.walker?.mode === 'eyes', {}, { timeout: 60000 });
  await page.waitForTimeout(300);
  const startRows = await stop(page);
  const flight = startRows.filter((r) => r.reasons === 'flight');
  assert.ok(flight.length > 10, 'start: no flight to the overview');
  // the hold: the frames between the flight's end and the descent, the camera still there
  const overview = flight.at(-1).p;
  const atOverview = startRows.filter((r) => r.now > flight.at(-1).now && r.mode === 'standing' && !r.reasons && dist(r.p, overview) < 0.01);
  assert.ok(atOverview.length > 5, 'start: no hold on the overview');
  report.start = { overviewHeight: +overview[1].toFixed(0) };
  Object.assign(report.start, {
    flightFrames: flight.length,
    holdSeconds: +((atOverview.at(-1).now - atOverview[0].now) / 1000).toFixed(2),
    descent: checkDescent(startRows, 'start'),
    eyeError: await eyeError(page),
    figureHiddenInEyes: !(await page.evaluate(() => app.walker.avatar.group.visible)),
  });
  assert.ok(report.start.holdSeconds >= 1, `start: overview held ${report.start.holdSeconds} s`);
  assert.ok(report.start.descent.entryStep < 0.5, `start: the descent began ${report.start.descent.entryStep} m off the overview`);
  assert.ok(report.start.eyeError < 1e-3, `start: camera ${report.start.eyeError} m off the eyes`);
  assert.ok(report.start.figureHiddenInEyes);
  await page.waitForTimeout(4000);   // the hitch after the flight over the island (Q2a probe, HANDOFF)

  // 2. out of the body and back into the same eyes
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => ({ state: { ...app.walker.state }, cam: app.camera.position.toArray(),
    target: app.controls.target.toArray(), q: app.camera.quaternion.toArray() }));
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(300);
  const out1 = await page.evaluate(() => ({ mode: app.walker.mode, visible: app.walker.avatar.group.visible,
    controls: app.controls.enabled, cam: app.camera.position.toArray() }));
  assert.deepEqual([out1.mode, out1.visible, out1.controls], ['standing', true, true]);
  assert.ok(dist(out1.cam, before.cam) < 0.01, 'V out: the camera jumped');
  // keys: the rig's WASD; the stick: rig.steer through the host
  await page.keyboard.down('KeyS'); await page.waitForTimeout(400); await page.keyboard.up('KeyS');
  const afterKeys = await page.evaluate(() => app.camera.position.toArray());
  await page.evaluate(() => app.walker.setStick({ x: 0, y: -0.5 }));
  await page.waitForTimeout(500);
  await page.evaluate(() => app.walker.setStick({ x: 0, y: 0 }));
  const afterStick = await page.evaluate(() => ({ cam: app.camera.position.toArray(), state: { ...app.walker.state } }));
  report.outOfBody = { keysMoved: +dist(afterKeys, out1.cam).toFixed(1), stickMoved: +dist(afterStick.cam, afterKeys).toFixed(1),
    walkerMoved: +Math.hypot(afterStick.state.x - before.state.x, afterStick.state.z - before.state.z).toFixed(6) };
  assert.ok(report.outOfBody.keysMoved > 10, `out: keys moved the camera ${report.outOfBody.keysMoved} m`);
  assert.ok(report.outOfBody.stickMoved > 3, `out: the stick moved the camera ${report.outOfBody.stickMoved} m`);
  assert.equal(report.outOfBody.walkerMoved, 0, 'out: the walker moved');
  await page.screenshot({ path: join(out, 'out-of-body.png') });
  await record(page);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => app.walker.mode === 'eyes', {}, { timeout: 10000 });
  await page.waitForTimeout(200);
  const backRows = await stop(page);
  const back = await page.evaluate(() => ({ cam: app.camera.position.toArray(), target: app.controls.target.toArray(),
    q: app.camera.quaternion.toArray() }));
  report.back = { descent: checkDescent(backRows, 'back'), camError: +dist(back.cam, before.cam).toExponential(2),
    targetError: +dist(back.target, before.target).toExponential(2), turnError: +angle(back.q, before.q).toExponential(2) };
  assert.ok(dist(back.cam, before.cam) < 1e-3 && dist(back.target, before.target) < 1e-3, 'back: not the same eyes');
  assert.ok(angle(back.q, before.q) < 1e-3, 'back: not the same view');
  await page.close();

  // 3. a phone-sized touch page: the stick walks, the button leaves the body
  const phone = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mp = await phone.newPage();
  watch(mp, 'phone');
  await mp.goto(`${base}?tiles=none&walk&mobile`);
  await mp.waitForFunction(() => app.walker?.mode === 'eyes', {}, { timeout: 60000 });
  await mp.waitForTimeout(4000);
  const ui = await mp.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return { hidden: document.getElementById('walkerControls').hidden, stick: box('.walker-stick'), toggle: box('.walker-toggle'),
      rail: box('#stationRail'), text: document.querySelector('.walker-toggle').textContent };
  });
  assert.equal(ui.hidden, false, 'phone: controls hidden');
  assert.ok(ui.stick.y + ui.stick.h <= ui.rail.y, 'phone: the stick overlaps the rail');
  assert.ok(ui.toggle.y + ui.toggle.h <= ui.rail.y + ui.rail.h && ui.toggle.x > ui.stick.x + ui.stick.w, 'phone: the button overlaps the stick');
  const cx = ui.stick.x + ui.stick.w / 2, cy = ui.stick.y + ui.stick.h / 2;
  const s0 = await mp.evaluate(() => ({ ...app.walker.state }));
  // 70 % of the radius up: (0.7 − 0.12) / 0.88 = 0.66 of the walking pace, forward
  await mp.mouse.move(cx, cy);
  await mp.mouse.down();
  await mp.mouse.move(cx, cy - 0.7 * 56, { steps: 4 });
  const held = await mp.evaluate(() => { const z = document.querySelector('.walker-stick').dataset; return { x: +z.x, y: +z.y }; });
  const h0 = performance.now();
  await mp.waitForTimeout(1500);
  await mp.mouse.up();
  const heldSeconds = (performance.now() - h0) / 1000;
  const s1 = await mp.evaluate(() => ({ ...app.walker.state, pace: app.walker.walker.pace.walk }));
  const dx = s1.x - s0.x, dz = s1.z - s0.z;
  const along = dx * Math.sin(s0.yaw) + dz * Math.cos(s0.yaw);
  report.phone = { ui, stick: held, walked: +Math.hypot(dx, dz).toFixed(2), along: +along.toFixed(2),
    expected: +(0.66 * s1.pace * heldSeconds).toFixed(2), afterRelease: await mp.evaluate(() => document.querySelector('.walker-stick').dataset.y) };
  assert.ok(Math.abs(held.y - 0.659) < 0.02 && Math.abs(held.x) < 0.02, `phone: stick read ${JSON.stringify(held)}`);
  assert.ok(along > 0.6 * report.phone.expected && along < 1.15 * report.phone.expected, `phone: walked ${along} m forward, expected ~${report.phone.expected}`);
  assert.equal(report.phone.afterRelease, '0.000', 'phone: the stick did not return');
  await mp.screenshot({ path: join(out, 'phone-eyes.png') });
  await mp.tap('.walker-toggle');
  await mp.waitForTimeout(300);
  report.phone.afterButton = await mp.evaluate(() => ({ mode: app.walker.mode, text: document.querySelector('.walker-toggle').textContent,
    visible: app.walker.avatar.group.visible }));
  assert.equal(report.phone.afterButton.mode, 'standing');
  assert.notEqual(report.phone.afterButton.text, ui.text, 'phone: the button kept its words');
  await mp.screenshot({ path: join(out, 'phone-out-of-body.png') });
  await phone.close();

  // 4. ?story=…&walk: field loaded, overview, eyes — not the field view
  const sp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(sp, 'story');
  await sp.goto(`${base}?story=${STORY}&walk`);
  await sp.waitForFunction(() => app.walker?.mode === 'eyes', {}, { timeout: 90000 });
  report.story = await sp.evaluate(() => ({ loaded: app.tiles.loaded, state: app.catalog.state, tiles: app.tiles.count ?? null,
    reasons: app.rig.reasons }));
  assert.ok(report.story.loaded, 'story: field not loaded before the eyes');
  assert.deepEqual(report.story.reasons, ['eyes']);
  await sp.waitForTimeout(1500);
  assert.equal(await sp.evaluate(() => app.walker.mode), 'eyes', 'story: thrown out of the eyes');
  await sp.screenshot({ path: join(out, 'story-eyes.png') });
  await sp.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS probe-story-q2b ${report.seconds} s → ${out}`);
} catch (e) {
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
