// story-quest Q2a (STORY-QUEST-SPEC §2 п.2, §4.1 «Персонаж»; HANDOFF Q2a): the walker on
// the island through real keys and the real frame loop. Every rendered frame the feet are
// on the drawn terrain (TerrainContact) and the camera is the eyes; walking up a slope gains
// height; walking into the sea goes into the water past the wading line (Q8: it swims), a
// course along the shore slides along it on the feet; V
// toggles eyes / standing with the figure shown; the product walks too (in its iframe).
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q2a');
mkdirSync(out, { recursive: true });
const FEET = 1e-6, EYE = 1e-3, WADE = 0.5;
const report = { base };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};

// a per-frame recorder: after the app's own tick (its rAF was registered first), the walker,
// the ground under it and the camera
const record = (page) => page.evaluate(() => {
  const w = app.walker, rows = [];
  window.__trace = rows;
  const sample = () => {
    if (window.__trace !== rows) return;
    const s = w.state, g = app.ground(s.x, s.z), c = app.camera.position;
    rows.push({ x: s.x, y: s.y, z: s.z, ground: g?.height ?? null, cam: [c.x, c.y, c.z], mode: w.mode, swim: !!s.swim });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
const stop = (page) => page.evaluate(() => { const rows = window.__trace; window.__trace = null; return rows; });
const hold = async (page, keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  await page.waitForTimeout(100);
};
// every frame: feet on the drawn ground, camera = eyes (1.6 m over the feet)
const checkFrames = (rows, label) => {
  let feet = 0, eye = 0, minGround = Infinity;
  for (const r of rows) {
    assert.ok(r.ground !== null, `${label}: walker off the terrain`);
    feet = Math.max(feet, Math.abs(r.y - r.ground));
    if (r.mode === 'eyes') eye = Math.max(eye, Math.hypot(r.cam[0] - r.x, r.cam[1] - (r.y + 1.6), r.cam[2] - r.z));
    minGround = Math.min(minGround, r.ground);
  }
  assert.ok(feet <= FEET, `${label}: feet ${feet} m off the ground`);
  assert.ok(eye <= EYE, `${label}: camera ${eye} m off the eyes`);
  return { frames: rows.length, maxFeetError: feet, maxEyeError: eye, minGround: +minGround.toFixed(3) };
};
const place = (page, x, z, yaw) => page.evaluate((at) => app.walker.place(at.x, at.z, at.yaw), { x, z, yaw });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');
  await page.goto(`${base}?tiles=none&walk`);
  await page.waitForFunction(() => window.app?.walker?.mode === 'eyes', {}, { timeout: 60000 });
  // since Q2b ?walk arrives after a flight over the island: the first seconds after it hitch
  // (up to 0.85 s a frame, headless), then 16.7 ms steady — walk after that
  await page.waitForTimeout(5000);
  const pace = await page.evaluate(() => app.walker.walker.pace.walk);
  const start = await page.evaluate(() => {
    const w = app.walker, s = w.state;
    return { x: s.x, z: s.z, yaw: s.yaw, height: s.y, reasons: app.rig.reasons, controls: app.controls.enabled,
      figure: { inScene: w.avatar.group.parent === app.scene, isGroup: w.avatar.group.isGroup, visible: w.avatar.group.visible } };
  });
  assert.deepEqual(start.reasons, ['eyes']);
  assert.equal(start.controls, false);
  assert.ok(start.figure.inScene && start.figure.isGroup && !start.figure.visible, 'figure in the scene, hidden in eyes');
  assert.ok(start.height >= 1, `spawn ${start.height} m — not on the beach`);
  report.spawn = start;
  await page.screenshot({ path: join(out, 'eyes-beach.png') });

  // 1. a slope: the steepest land within 30..90 m of the summit's bearing, uphill
  const slope = await page.evaluate(() => {
    let best = null;
    for (let a = 0; a < 360; a += 5) for (let r = 60; r < 260; r += 4) {
      const x = Math.cos(a * Math.PI / 180) * r, z = Math.sin(a * Math.PI / 180) * r, g = app.ground(x, z);
      if (!g || g.height < 8 || g.height > 50) continue;
      // uphill for 6 m stays uphill and on land: a route, not a spike
      const ux = -g.normal.x, uz = -g.normal.z, l = Math.hypot(ux, uz), ahead = app.ground(x + ux / l * 6, z + uz / l * 6);
      if (!ahead || ahead.height < g.height + 1.5) continue;
      if (!best || g.normal.y < best.ny) best = { x, z, ny: g.normal.y, yaw: Math.atan2(ux, uz), height: g.height };
    }
    return best;
  });
  assert.ok(slope, 'no slope found');
  await place(page, slope.x, slope.z, slope.yaw);
  await record(page);
  await hold(page, ['KeyW'], 1000);
  const slopeRows = await stop(page);
  const climbed = slopeRows.at(-1).y - slopeRows[0].y;
  const walked = Math.hypot(slopeRows.at(-1).x - slopeRows[0].x, slopeRows.at(-1).z - slopeRows[0].z);
  report.slope = { at: slope, degrees: +(Math.acos(slope.ny) * 180 / Math.PI).toFixed(1), ...checkFrames(slopeRows, 'slope'),
    climbed: +climbed.toFixed(2), walked: +walked.toFixed(2) };
  assert.ok(climbed > 0.5, `slope: climbed ${climbed} m`);
  assert.ok(walked > 0.71 * pace && walked < 1.1 * pace, `slope: walked ${walked} m in 1 s at ${pace} m/s`);
  await page.screenshot({ path: join(out, 'eyes-slope.png') });

  // 2. into the sea from the spawn: on the feet to the wading line, then in the water (Q8)
  await place(page, start.x, start.z, start.yaw);
  await record(page);
  await hold(page, ['ShiftLeft', 'KeyW'], 5000);
  const seaRows = await stop(page);
  const dry = seaRows.slice(0, Math.max(1, seaRows.findIndex((r) => r.swim)));
  const wentIn = seaRows.find((r) => r.swim);
  report.sea = { ...checkFrames(dry, 'sea'), wentIn: wentIn ? { ground: wentIn.ground === null ? null : +wentIn.ground.toFixed(3),
    after: +(dry.length / 60).toFixed(2) } : null, swimming: !!seaRows.at(-1).swim };
  assert.ok(report.sea.minGround >= -WADE - 0.1, `sea: stood on ${report.sea.minGround} m before the water`);
  assert.ok(wentIn && report.sea.swimming, `sea: never went into the water (${JSON.stringify(report.sea)})`);
  assert.ok(wentIn.ground === null || wentIn.ground < -WADE, `sea: in the water over ${wentIn.ground} m`);
  await page.screenshot({ path: join(out, 'eyes-into-the-sea.png') });

  // 3. every course off the shore normal, on straight pieces of shore, from the edge (a body's
  // radius off the wading line). Along the shore (≥ 75° off seaward; 65° is the edge on a rough beach) the walker slides on the
  // feet — the cell grid of the first Q2a build stuck at 0–0.2 m in 1 s; into the sea (≤ 45°)
  // it goes into the water within a step (Q8). A straight piece: the wading line's normal
  // every metre to ±3 m along it within 5° of the middle one (the beach is rough: 10–70° is
  // usual). 1 s of walking per course, stepped in the page at 60 Hz.
  report.sweep = await page.evaluate(() => {
    const w = app.walker.walker, wet = (x, z) => !app.ground(x, z) || app.ground(x, z).height < -0.5;
    const radius = 0.15 * w.bodyScale;
    // the wading line from (x, z) along (dx, dz), to 1 mm, and the ground's downhill there
    const line = (x, z, dx, dz) => {
      let a = 0, b = 0;
      while (!wet(x + dx * b, z + dz * b) && b < 400) b += 0.5;
      if (!wet(x + dx * b, z + dz * b)) return null;
      for (let i = 0; i < 12; i++) { const t = (a + b) / 2; if (wet(x + dx * t, z + dz * t)) b = t; else a = t; }
      const px = x + dx * a, pz = z + dz * a, g = app.ground(px, pz), l = Math.hypot(g.normal.x, g.normal.z);
      return { x: px, z: pz, nx: g.normal.x / l, nz: g.normal.z / l };
    };
    const pieces = [];
    for (let bearing = 0; bearing < 360 && pieces.length < 3; bearing += 11) {
      const bx = Math.sin(bearing * Math.PI / 180), bz = Math.cos(bearing * Math.PI / 180);
      const mid = line(bx * 150, bz * 150, bx, bz);
      if (!mid) continue;
      const tx = -mid.nz, tz = mid.nx;
      const ends = [-3, -2, -1, 1, 2, 3].map((o) => line(mid.x + tx * o - mid.nx * 4, mid.z + tz * o - mid.nz * 4, mid.nx, mid.nz));
      if (ends.some((e) => !e || e.nx * mid.nx + e.nz * mid.nz < Math.cos(5 * Math.PI / 180))) continue;
      pieces.push(mid);
    }
    const swept = [];
    for (const mid of pieces) {
      const seaward = Math.atan2(mid.nx, mid.nz);
      for (const deg of [-80, -75, -45, -30, -15, 0, 15, 30, 45, 75, 80]) {
        const ex = mid.x - mid.nx * (radius + 0.03), ez = mid.z - mid.nz * (radius + 0.03);
        w.place(ex, ez, seaward + deg * Math.PI / 180);
        w.state.pitch = 0;
        let deepest = Infinity, swam = false;
        for (let i = 0; i < 60; i++) {
          w.step(1 / 60, { forward: 1 });
          if (w.state.swim) { swam = true; break; }
          deepest = Math.min(deepest, w.state.y);
        }
        swept.push({ at: [+mid.x.toFixed(1), +mid.z.toFixed(1)], deg, swam,
          along: +Math.hypot(w.state.x - ex, w.state.z - ez).toFixed(2), deepest: +deepest.toFixed(3) });
      }
    }
    w.place(pieces[0].x - pieces[0].nx * 3, pieces[0].z - pieces[0].nz * 3);
    return swept;
  });
  assert.ok(report.sweep.length >= 22, `sweep: ${report.sweep.length / 11} straight piece(s) of shore found`);
  for (const { at, deg, swam, along, deepest } of report.sweep) {
    if (Math.abs(deg) >= 75) {
      assert.ok(!swam, `sweep ${at} ${deg}°: along the shore, yet went into the water`);
      assert.ok(deepest >= -WADE - 1e-3, `sweep ${at} ${deg}°: stood on ${deepest} m`);
      assert.ok(along >= 0.85 * pace * Math.abs(Math.sin(deg * Math.PI / 180)), `sweep ${at} ${deg}°: ${along} m along the shore in 1 s`);
    } else assert.ok(swam, `sweep ${at} ${deg}°: into the sea, yet not in the water`);
  }
  await place(page, start.x, start.z, start.yaw);
  await page.waitForTimeout(300);   // a frame moves the eyes there

  // 4. V: standing (figure shown, controls back, camera stays), V again: eyes
  const before = await page.evaluate(() => app.camera.position.toArray());
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(300);
  const standing = await page.evaluate(() => ({ mode: app.walker.mode, visible: app.walker.avatar.group.visible,
    controls: app.controls.enabled, reasons: app.rig.reasons, camera: app.camera.position.toArray() }));
  assert.equal(standing.mode, 'standing');
  assert.ok(standing.visible && standing.controls && !standing.reasons.length, 'V: figure shown, controls free');
  assert.ok(Math.hypot(...standing.camera.map((v, i) => v - before[i])) < 0.01, 'V: the camera jumped');
  const s = await page.evaluate(() => app.walker.state);
  await page.evaluate(({ x, y, z, yaw }) => {
    const P = app.camera.position.constructor;
    app.rig.place(new P(x + Math.sin(yaw) * 4, y + 2.2, z + Math.cos(yaw) * 4), new P(x, y + 0.9, z));   // in front, facing it
  }, s);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'standing-figure.png') });
  const box = await page.evaluate(() => {
    const g = app.walker.avatar.group;
    g.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    g.traverse((n) => {
      if (!n.isMesh || !n.visible || !n.parent?.visible) return;
      n.geometry.computeBoundingBox();
      const bb = n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld);
      minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
    });
    return { feet: minY - app.walker.state.y, height: maxY - minY };
  });
  report.figure = { feetOverGround: +box.feet.toFixed(3), height: +box.height.toFixed(2) };
  // back in goes smoothly since Q2b: 'boarding', then 'eyes'
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => app.walker.mode === 'eyes', {}, { timeout: 8000 });

  // 5. a station flight ends the ride: standing, the rail's flight owns the camera
  await page.evaluate(() => app.stations.go('island'));
  await page.waitForTimeout(200);
  report.stationEndsRide = await page.evaluate(() => ({ mode: app.walker.mode, reasons: app.rig.reasons }));
  assert.equal(report.stationEndsRide.mode, 'standing');

  // 6. the product walks the same way: since QDb the scene is the product's iframe (BOUNDARY-5:
  // the product page has no window.app), since Q7 the walker is there with a story by default
  const shell = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  watch(shell, 'shell');
  await shell.goto(`${base}products/story-quest/?story=test-2025/my-day-3-moments`);
  await shell.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.app?.walker?.mode === 'eyes', {}, { timeout: 90000 });
  const scene = shell.frames().find((f) => f !== shell.mainFrame());
  await shell.waitForTimeout(5000);   // the frames settle after the flight over the island
  const z0 = await scene.evaluate(() => ({ ...app.walker.state }));
  await scene.evaluate(() => app.walker.setStick({ x: 0, y: 0.8 }));
  await shell.waitForTimeout(1000);
  await scene.evaluate(() => app.walker.setStick({ x: 0, y: 0 }));
  const z1 = await scene.evaluate(() => ({ ...app.walker.state }));
  report.shell = { walked: +Math.hypot(z1.x - z0.x, z1.z - z0.z).toFixed(2) };
  assert.ok(report.shell.walked > 0.8, `shell: walked ${report.shell.walked} m in 1 s`);
  await shell.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`PASS probe-story-q2a ${report.seconds} s → ${out}`);
} catch (e) {
  report.errors = errors;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
