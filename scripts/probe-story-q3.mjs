// story-quest Q3 (STORY-QUEST-SPEC §2 п.3–4, §4.1 «Мініатюра й гідратація»; HANDOFF Q3):
// miniatures on the island through the real frame loop and real keys. For each story of the
// test set: every frame is a miniature on dry land above the shallows, ≥ the layout's
// distance apart, lying on the drawn terrain, the field's frames hidden; a reload gives the
// same layout. On the first story: G takes a miniature into view, walking into the sea and G
// unfolds it to the frame's rest size on open water, where it floats as the fixture does
// (anchored, footprint steady); put on land it lies again; the touch button words it.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q3');
mkdirSync(out, { recursive: true });
const STORIES = (process.env.STORIES ?? 'test-2025/my-day-3-moments,public-test/frog-fairy-full,local/story-8-frames-hibrid').split(',');
const report = { base, stories: {} };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
};
const open = async (page, query) => {
  await page.goto(`${base}${query}`);
  await page.waitForFunction(() => window.app?.walker?.mode === 'eyes' && window.app?.minis?.active, {}, { timeout: 90000 });
  // after the flight over the island the first seconds hitch (HANDOFF «Персонаж», Q2b)
  await page.waitForTimeout(3000);
};
// the layout as the page has it, with the ground under every miniature
const layout = (page) => page.evaluate(() => app.minis.items.map((i) => {
  const p = i.root.position, g = app.ground(p.x, p.z);
  return { frameId: String(i.frameId), state: i.state, x: p.x, y: p.y, z: p.z, ground: g?.height ?? null,
    normalY: g?.normal?.y ?? null, gap: i.contactGap, radius: i.radius, visible: i.root.visible, meshes: i.body.children.length };
}));
const hiddenFrames = (page) => page.evaluate(() => app.tiles.boundsEntries.map((e) => ({
  id: String(app.tiles.frameRegistry.entries[e.frameIndex].id), visible: e.mesh.visible })));
const key = async (page, code) => { await page.keyboard.press(code); await page.waitForTimeout(100); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, 'scene');

  // 1. the layout of every story of the test set; a reload gives the same one
  for (const id of STORIES) {
    const t = performance.now();
    await open(page, `?story=${id}&walk&minis`);
    const first = await layout(page);
    const frames = await page.evaluate(() => app.tiles.frameRegistry.entries.length);
    assert.equal(first.length, frames, `${id}: a miniature per frame`);
    let minDistance = Infinity, maxGap = 0, minGap = Infinity;
    for (const [i, m] of first.entries()) {
      assert.equal(m.state, 'ground');
      assert.ok(m.visible && m.meshes > 0, `${id} ${m.frameId}: drawn`);
      assert.ok(m.ground >= 0.8, `${id} ${m.frameId}: on dry land above the shallows (${m.ground})`);
      assert.ok(m.normalY >= 0.85, `${id} ${m.frameId}: not on a cliff`);
      const centre = m.y - m.ground;   // the base over the ground under the centre: lifted over the corners
      assert.ok(m.gap >= -1e-6 && centre >= -1e-6 && centre < 0.25, `${id} ${m.frameId}: lies on the ground (corner ${m.gap}, centre ${centre})`);
      maxGap = Math.max(maxGap, centre); minGap = Math.min(minGap, centre);
      for (const q of first.slice(i + 1)) minDistance = Math.min(minDistance, Math.hypot(m.x - q.x, m.z - q.z));
    }
    assert.ok(minDistance >= 12 * 0.8 ** 2, `${id}: miniatures ${minDistance} m apart`);
    const hidden = await hiddenFrames(page);
    assert.ok(hidden.every((h) => !h.visible), `${id}: the field's frames are hidden`);
    await page.screenshot({ path: join(out, `${id.replace('/', '_')}-eyes.png`) });
    await open(page, `?story=${id}&walk&minis`);
    const again = await layout(page);
    const moved = Math.max(...again.map((m, i) => Math.hypot(m.x - first[i].x, m.y - first[i].y, m.z - first[i].z)));
    assert.ok(moved < 1e-6, `${id}: the reload moved a miniature by ${moved} m`);
    report.stories[id] = { frames, minDistance: +minDistance.toFixed(2), gap: [+minGap.toFixed(4), +maxGap.toFixed(4)],
      radius: +first[0].radius.toFixed(3), reloadMoved: moved, seconds: +((performance.now() - t) / 1000).toFixed(1) };
  }

  // 2. take, carry, unfold on the water (the first story)
  const id = STORIES[0];
  await open(page, `?story=${id}&walk&minis`);
  const target = (await layout(page))[0];
  // next to the miniature, facing it
  await page.evaluate((m) => {
    const yaw = Math.atan2(m.x - (m.x - 1.5), 0);
    app.walker.place(m.x - 1.5, m.z, yaw);
  }, target);
  assert.equal(await page.evaluate(() => app.miniHint()), 'take');
  await key(page, 'KeyG');
  const carried = await page.evaluate(() => {
    const c = app.minis.carried, p = c.root.position.clone().project(app.camera);
    return { frameId: String(c.frameId), ndc: [p.x, p.y, p.z], found: app.minis.counts().found, hint: app.miniHint() };
  });
  assert.equal(carried.frameId, target.frameId);
  assert.ok(Math.abs(carried.ndc[0]) < 0.5 && carried.ndc[1] < 0 && carried.ndc[1] > -1 && carried.ndc[2] < 1,
    `carried in view, below the centre (${carried.ndc.map((v) => v.toFixed(2))})`);
  assert.equal(carried.found, 1);
  assert.equal(carried.hint, 'put');
  await page.screenshot({ path: join(out, 'carried.png') });

  // put down on the land: lies again where it was put
  await key(page, 'KeyG');
  const laid = await page.evaluate(() => {
    const i = app.minis.items[0], p = i.root.position, g = app.ground(p.x, p.z);
    return { state: i.state, gap: i.contactGap, ground: g.height };
  });
  assert.equal(laid.state, 'ground');
  assert.ok(laid.gap >= -1e-6 && laid.gap < 0.25, `put on the land lies (gap ${laid.gap})`);
  await key(page, 'KeyG');

  // to the sea with it in hand: on the coast facing the field, then W until the wading line
  const spawn = await page.evaluate(() => ({ field: [app.tiles.center.x, app.tiles.center.z] }));
  await page.evaluate(({ field }) => {
    // the coast towards the field: from the field centre back to the island until dry land
    let x = field[0], z = field[1];
    const len = Math.hypot(x, z), dx = -x / len, dz = -z / len;
    while ((app.ground(x, z)?.height ?? -99) < 1) { x += dx * 0.5; z += dz * 0.5; }
    app.walker.place(x, z, Math.atan2(-dx, -dz));
  }, spawn);
  const before = await page.evaluate(() => app.walker.state.y);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (app.ground(app.walker.state.x, app.walker.state.z)?.height ?? 0) < -0.45, {}, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const wade = await page.evaluate(() => app.ground(app.walker.state.x, app.walker.state.z).height);
  // the reference: the same frame, hidden, floating at its rest pose in the field — the GPU footprint
  const restFootprint = await page.evaluate(async () => {
    const b = await app.tiles.frameFootprint(app.tiles.frameRegistry.get(app.minis.items[0].frameId));
    return [b.maxX - b.minX, b.maxZ - b.minZ];
  });
  await key(page, 'KeyG');
  const unfolding = await page.evaluate(() => {
    const i = app.minis.items[0], f = app.tiles.frameRegistry.get(i.frameId);
    return { state: i.state, mode: f.mode, world: [f.world.x, f.world.z], open: i.unfold?.open,
      ground: app.ground(f.world.x, f.world.z)?.height ?? null, fullRadius: i.fullRadius };
  });
  assert.equal(unfolding.state, 'unfolding');
  assert.equal(unfolding.mode, 'placed');
  assert.equal(unfolding.open, true, 'found open water for the frame');
  assert.ok(unfolding.ground === null || unfolding.ground < -1, `deep water under the frame (${unfolding.ground})`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'unfolding.png') });
  await page.waitForFunction(() => app.minis.items[0].state === 'water', {}, { timeout: 5000 });
  const hydrated = await page.evaluate(async () => {
    const i = app.minis.items[0], f = app.tiles.frameRegistry.get(i.frameId);
    const shown = app.tiles.boundsEntries.filter((e) => e.frameIndex === f.index).every((e) => e.mesh.visible);
    const b = await app.tiles.frameFootprint(f);
    return { shown, mini: i.root.visible, counts: app.minis.counts(), bounds: [f.bounds.max.x - f.bounds.min.x, f.bounds.max.y - f.bounds.min.y],
      footprint: b && [b.maxX - b.minX, b.maxZ - b.minZ, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2], world: [f.world.x, f.world.z] };
  });
  assert.ok(hydrated.shown && !hydrated.mini, 'the frame shows, the miniature is gone');
  assert.deepEqual(hydrated.counts, { total: hydrated.counts.total, found: 1, water: 1 });
  // rest size: the GPU footprint of the frame's tiles as it was, hidden, in the field. The tiles
  // ride the waves' orbits, larger on open water than by the field: 15 %, not centimetres
  // (a miniature would be 1/8 of it)
  const size = Math.max(Math.abs(hydrated.footprint[0] / restFootprint[0] - 1), Math.abs(hydrated.footprint[1] / restFootprint[1] - 1));
  assert.ok(size < 0.15, `rest size on the water: footprint ${hydrated.footprint.slice(0, 2).map((v) => v.toFixed(2))} vs ${restFootprint.map((v) => v.toFixed(2))}`);
  // it floats where it unfolded, as the fixture does (anchored): 8 s later the footprint stays
  await page.waitForTimeout(8000);
  const later = await page.evaluate(async () => {
    const f = app.tiles.frameRegistry.get(app.minis.items[0].frameId), b = await app.tiles.frameFootprint(f);
    return b && [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ];
  });
  const drift = Math.hypot(later[0] - hydrated.footprint[2], later[1] - hydrated.footprint[3]);
  assert.ok(drift < 1.5, `floats anchored: centre moved ${drift} m in 8 s`);
  await page.screenshot({ path: join(out, 'hydrated.png') });
  // the walker's own eye view of it: out of the body, the camera stays at the eyes
  report.unfold = { wadeGround: +wade.toFixed(3), walkerStartY: +before.toFixed(2), frameGround: unfolding.ground && +unfolding.ground.toFixed(2),
    restBox: hydrated.bounds.map((v) => +v.toFixed(2)), restFootprint: restFootprint.map((v) => +v.toFixed(2)), footprint: hydrated.footprint.slice(0, 2).map((v) => +v.toFixed(2)),
    sizeError: +size.toFixed(3), drift8s: +drift.toFixed(3) };

  // 3. the touch button words what G would do
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  watch(phone, 'phone');
  await open(phone, `?story=${id}&walk&minis&stick`);
  const m = (await layout(phone))[1];
  await phone.evaluate((p) => app.walker.place(p.x - 1.5, p.z, Math.PI / 2), m);
  await phone.waitForFunction(() => !document.querySelector('.walker-action').hidden, {}, { timeout: 3000 });
  const take = await phone.evaluate(() => document.querySelector('.walker-action').textContent);
  await phone.tap('.walker-action');
  await phone.waitForFunction(() => document.querySelector('.walker-action').dataset.action === 'put', {}, { timeout: 3000 });
  const put = await phone.evaluate(() => ({ text: document.querySelector('.walker-action').textContent, carried: String(app.minis.carried?.frameId) }));
  assert.equal(put.carried, m.frameId);
  await phone.screenshot({ path: join(out, 'phone-carried.png') });
  await phone.evaluate(() => app.walker.place(app.walker.state.x - 20, app.walker.state.z, Math.PI / 2));
  await phone.tap('.walker-action');
  await phone.waitForFunction(() => app.minis.carried === null, {}, { timeout: 3000 });
  await phone.evaluate(() => app.walker.place(app.walker.state.x - 30, app.walker.state.z, 0));
  await phone.waitForFunction(() => document.querySelector('.walker-action').hidden, {}, { timeout: 3000 });
  report.phone = { take, put: put.text };
  await phone.close();

  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`probe-story-q3 PASS ${report.seconds} s → ${out}`);
} catch (e) {
  console.error(JSON.stringify(report, null, 2));
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
