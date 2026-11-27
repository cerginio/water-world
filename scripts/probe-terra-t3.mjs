// terra T3 (ISLAND-MAPS-SPEC §3, §4.4, §5 п.3, п.4): the bay's decorations in the running scene.
// 1. ?map=lagoon&mobile: what the decorations cost a frame — renderer.info summed over 30 frames
//    with the decorations shown minus the same with them hidden, from the overview and from the
//    eyes turned to the beach: ≤ 120 000 triangles and ≤ 8 draw calls (all passes, no shadow pass);
//    one InstancedMesh per palm silhouette.
// 2. For each story of the test set on 'lagoon': the miniatures in the scene lie outside the closed
//    zones, each reached from the start on a line clear of the trunks; on 'island' the layout is
//    the one before the phase (tests/terraDecor.test.js holds the same points) and no decorations.
// 3. Screenshots: the overview, the start from the eyes (the hut by the cape), along the beach
//    (palms behind it), the hut close (roof and piles).
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'terra-t3');
mkdirSync(out, { recursive: true });
const RUNS = [
  ['my-day', 'story=test-2025/my-day-3-moments', 3],
  ['frog-fairy', 'story=public-test/frog-fairy-full', 10],
  ['hibrid-8', 'tiles=story-8-frames-hibrid', 8],
];
const ISLAND_FIRST = {   // the first miniature of each story on 'island' before T3
  'my-day': [212.353, -149.715], 'frog-fairy': [160.304, -205.357], 'hibrid-8': [183.252, -219.217],
};
const report = { base, budget: {}, runs: {} };
const t0 = performance.now();
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });

async function open(name, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(`${base}?${query}&walk&minis&embed`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.minis?.active, {}, { timeout: 120000 });
  await page.waitForTimeout(2000);
  return page;
}

/** renderer.info over `n` frames, per frame, with the decorations shown and hidden. */
const cost = (page) => page.evaluate(async () => {
  const info = app.renderer.info, frames = (n) => new Promise((done) => {
    let k = 0;
    const tick = () => (++k >= n ? done(undefined) : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  const measure = async (visible) => {
    app.decor.group.visible = visible;
    await frames(3);
    info.autoReset = false;
    info.reset();
    await frames(30);
    const r = { calls: info.render.calls / 30, triangles: info.render.triangles / 30 };
    info.autoReset = true;
    return r;
  };
  const shown = await measure(true), hidden = await measure(false);
  app.decor.group.visible = true;
  return { calls: Math.round(shown.calls - hidden.calls), triangles: Math.round(shown.triangles - hidden.triangles) };
});

try {
  // 1. the budget on the phone profile
  {
    const page = await open('budget', 'story=public-test/frog-fairy-full&map=lagoon&mobile');
    const meshes = await page.evaluate(() => {
      const list = [];
      app.decor.group.traverse((o) => { if (o.isMesh) list.push({ name: o.name, instanced: !!o.isInstancedMesh, count: o.count ?? 1 }); });
      return { list, stats: app.decor.stats, shadow: app.renderer.shadowMap.autoUpdate };
    });
    assert.equal(meshes.list.filter((m) => m.instanced).length, 3, 'one InstancedMesh per palm silhouette');
    assert.equal(meshes.list.length, 4, 'three palm meshes and the hut');
    report.budget.meshes = meshes.list;
    report.budget.shadowAutoUpdate = meshes.shadow;
    report.budget.eyes = await cost(page);
    await page.evaluate(() => { app.walker.state.yaw += Math.PI; });
    await page.waitForTimeout(800);
    report.budget.beach = await cost(page);
    await page.evaluate(() => app.stations.go('island'));
    await page.waitForTimeout(4500);
    report.budget.overview = await cost(page);
    const worst = ['eyes', 'beach', 'overview'].map((k) => report.budget[k]);
    report.budget.max = { calls: Math.max(...worst.map((w) => w.calls)), triangles: Math.max(...worst.map((w) => w.triangles)) };
    assert.ok(report.budget.max.calls <= 8, `≤ 8 draw calls (${report.budget.max.calls})`);
    assert.ok(report.budget.max.triangles <= 120000, `≤ 120 000 triangles (${report.budget.max.triangles})`);
    await page.close();
  }

  // 2. the layouts on both maps
  for (const [name, query, count] of RUNS) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    const lag = await open(name, `${query}&map=lagoon`);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const r = await lag.evaluate(async () => {
      const { pickMap } = await import('/src/scene/maps.js');
      const map = pickMap('lagoon'), decor = map.decor(), s = app.walker.state;
      const seg = (p, a, b) => {
        const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      };
      const minis = app.minis.items.map((m) => ({ x: m.root.position.x, z: m.root.position.z }));
      return {
        map: app.map, start: app.ground(s.x, s.z)?.height ?? null, minis: minis.length,
        blocked: minis.filter((m) => map.blocked(m.x, m.z)).length,
        crossing: minis.filter((m) => decor.palms.some((p) => seg(p, s, m) < 0.26 * 1.35 * 1.4 * p.scale + 0.4)).length,
        dry: Math.min(...minis.map((m) => app.ground(m.x, m.z)?.height ?? -99)),
      };
    });
    assert.equal(r.map, 'lagoon');
    assert.ok(r.start >= 1, `${name}: the start on dry sand (${r.start})`);
    assert.equal(r.minis, count, `${name}: every frame a miniature`);
    assert.equal(r.blocked, 0, `${name}: none in a closed zone`);
    assert.equal(r.crossing, 0, `${name}: the way to each clear of the trunks`);
    assert.ok(r.dry >= 0.8, `${name}: every miniature on dry land (${r.dry})`);
    if (name === 'frog-fairy') {
      await lag.screenshot({ path: join(out, 'start-eyes.png') });
      await lag.evaluate(() => { app.walker.state.yaw += 2.2; });
      await lag.waitForTimeout(1500);
      await lag.screenshot({ path: join(out, 'along-beach.png') });
      // close to the hut: on the cape's sand by the boardwalk's end, facing the hut
      await lag.evaluate(async () => {
        const { pickMap } = await import('/src/scene/maps.js');
        const h = pickMap('lagoon').decor().hut, to = h.walk.to;
        const dx = to.x - h.x, dz = to.z - h.z, l = Math.hypot(dx, dz);
        app.walker.place(to.x + dx / l * 6 + dz / l * 8, to.z + dz / l * 6 - dx / l * 8, 0);
        const s = app.walker.state;
        s.yaw = Math.atan2(h.x - s.x, h.z - s.z);
      });
      await lag.waitForTimeout(2000);
      await lag.screenshot({ path: join(out, 'hut.png') });
      await lag.evaluate(() => app.stations.go('island'));
      await lag.waitForTimeout(4500);
      await lag.screenshot({ path: join(out, 'overview.png') });
    }
    await lag.close();

    // oxlint-disable-next-line eslint/no-await-in-loop
    const isl = await open(name, query);
    // oxlint-disable-next-line eslint/no-await-in-loop
    const i = await isl.evaluate(() => ({ map: app.map, meshes: app.decor.stats.meshes, count: app.minis.items.length,
      first: [app.minis.items[0].home.x, app.minis.items[0].home.z] }));
    assert.equal(i.map, 'island');
    assert.equal(i.meshes, 0, `${name}: no decorations on the island`);
    assert.equal(i.count, count);
    assert.ok(Math.hypot(i.first[0] - ISLAND_FIRST[name][0], i.first[1] - ISLAND_FIRST[name][1]) < 1e-3, `${name}: the island's layout as before (${i.first})`);
    await isl.close();
    report.runs[name] = { lagoon: r, island: { count: i.count, first: i.first.map((v) => +v.toFixed(3)) } };
  }
  assert.deepEqual(errors, [], 'no page errors');
  report.pass = true;
} catch (e) {
  report.pass = false;
  report.error = String(e.stack ?? e);
}
report.errors = errors;
report.seconds = Math.round((performance.now() - t0) / 100) / 10;
await browser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`${report.pass ? 'PASS' : 'FAIL'} probe-terra-t3 ${report.seconds} s → ${out}`);
process.exit(report.pass ? 0 : 1);
