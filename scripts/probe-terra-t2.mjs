// terra T2 (ISLAND-MAPS-SPEC §3, §4.1, §4.2, §5 п.3): the bay's relief through the real frame loop.
// For each story of the test set on ?map=lagoon: the walker starts on dry sand (h ≥ 1 m), every
// miniature lies on land, one is hydrated by the beach, the walker boards it and the kite pulls
// the raft (stepRaft with openWater — never raft.moveTo) out of the bay until the 'sea' event
// (|x| or |z| > 900 m) without stopping in the shallows; «На берег» (walker.shore) puts the walker
// back on dry sand. Screenshots: the start from the eyes, the bay from the sea, the overview.
// The scene page with &embed: app.embed is the contract's commands, the keys drive the walker.
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'terra-t2');
mkdirSync(out, { recursive: true });
const RUNS = [
  ['my-day', 'story=test-2025/my-day-3-moments'],
  ['frog-fairy', 'story=public-test/frog-fairy-full'],
  ['hibrid-8', 'tiles=story-8-frames-hibrid'],
];
const only = process.env.RUN;
const report = { base, runs: {} };
const t0 = performance.now();
const errors = [];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const key = async (page, code) => { await page.keyboard.press(code); await page.waitForTimeout(100); };

async function run(name, query, { overview = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(`${base}?${query}&map=lagoon&walk&minis&embed`);
  await page.waitForFunction(() => app?.walker?.mode === 'eyes' && app?.minis?.active && app?.raft && app?.embed, {}, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const r = {};

  // 1. the start: dry sand; every miniature on land
  const start = await page.evaluate(() => {
    const s = app.walker.state;
    return { map: app.map, x: s.x, z: s.z, ground: app.ground(s.x, s.z)?.height ?? null,
      minis: app.minis.items.map((m) => app.ground(m.root.position.x, m.root.position.z)?.height ?? null),
      field: [app.tiles.center.x, app.tiles.center.z] };
  });
  assert.equal(start.map, 'lagoon', `${name}: the scene built the bay`);
  assert.ok(start.ground >= 1, `${name}: the start on dry sand (${start.ground})`);
  assert.ok(start.minis.length > 0 && start.minis.every((h) => h > 0), `${name}: every miniature on land (${start.minis.map((h) => h?.toFixed(2))})`);
  r.start = { at: [start.x, start.z].map((v) => +v.toFixed(2)), ground: +start.ground.toFixed(2),
    minis: start.minis.length, minMiniGround: +Math.min(...start.minis).toFixed(2), field: start.field.map((v) => +v.toFixed(1)) };
  await page.screenshot({ path: join(out, `${name}-start.png`) });

  // 2. a miniature into the hands, walked into the wading line facing the field, unfolded there
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
  await page.waitForFunction(() => app.minis.items[0].state === 'water', {}, { timeout: 10000 });
  const frameId = await page.evaluate(() => String(app.minis.items[0].frameId));
  await page.waitForFunction((id) => app.raft.decks().some((d) => String(d.id) === id), frameId, { timeout: 10000 });

  // 3. onto the deck, the kite up, W: the course toward the open-sea anchor (the field's ray, 1300 m)
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => app.walker.state.deck !== null, {}, { timeout: 15000 });
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(800);
  const deck = await page.evaluate(() => { const d = app.raft.decks().find((x) => x.id === app.raft.deckId); return { hu: d.hu, hv: d.hv, x: d.x, z: d.z }; });
  const aim = () => page.evaluate(() => {
    const c = app.tiles.center, l = Math.hypot(c.x, c.z), s = app.walker.state;
    const tx = c.x / l * 1300 - s.x, tz = c.z / l * 1300 - s.z;
    s.yaw = Math.atan2(tx, tz);
  });
  await aim();
  await key(page, 'KeyK');
  assert.equal(await page.evaluate(() => app.raft.kite.up), true, `${name}: the kite up`);
  const t = performance.now(), track = [];
  await page.keyboard.down('KeyW');
  let inSea = false;
  while (!inSea && performance.now() - t < 300000) {
    await page.waitForTimeout(1000);
    await aim();
    const s = await page.evaluate(() => {
      const m = app.raft.motion.get(app.raft.deckId), w = app.walker.state;
      return { x: w.x, z: w.z, deck: w.deck && String(w.deck.id), blocked: m?.blocked ?? null,
        speed: m ? Math.hypot(m.vx, m.vz) : 0, inSea: app.raft.inSea, kite: app.raft.kite.up };
    });
    track.push(s);
    inSea = s.inSea;
  }
  await page.keyboard.up('KeyW');
  const cruising = track.slice(3);
  assert.ok(inSea, `${name}: the raft reached open sea (last ${JSON.stringify(track.at(-1))})`);
  assert.ok(track.every((s) => s.deck === frameId && s.kite), `${name}: on the raft under the kite all the way`);
  assert.ok(track.every((s) => s.blocked === false), `${name}: never stopped in the shallows (${track.filter((s) => s.blocked).length} blocked samples)`);
  assert.ok(cruising.every((s) => s.speed > 6), `${name}: the kite's speed held (min ${Math.min(...cruising.map((s) => s.speed)).toFixed(2)} m/s)`);
  const last = track.at(-1);
  r.raft = { frameId, half: [deck.hu, deck.hv].map((v) => +v.toFixed(2)), from: [deck.x, deck.z].map((v) => +v.toFixed(1)),
    seconds: +((performance.now() - t) / 1000).toFixed(1), samples: track.length, blocked: 0,
    minSpeed: +Math.min(...cruising.map((s) => s.speed)).toFixed(2), at: [last.x, last.z].map((v) => +v.toFixed(1)) };
  // looking back at the bay from the sea: the capes and the mouth
  await page.evaluate(() => { const s = app.walker.state; s.yaw = Math.atan2(-s.x, -s.z); s.pitch = 0.05; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}-from-sea.png`) });

  // 4. «На берег»: the kite let go, the walker on dry sand
  const shore = await page.evaluate(async () => {
    await app.embed['walker.shore']({});
    const s = app.walker.state;
    return { deck: s.deck, kite: app.raft.kite.up, ground: app.ground(s.x, s.z)?.height ?? null, mode: app.walker.mode };
  });
  assert.equal(shore.deck, null, `${name}: off the raft`);
  assert.equal(shore.kite, false, `${name}: the kite let go`);
  assert.ok(shore.ground >= 1, `${name}: back on dry sand (${shore.ground})`);
  r.shore = { ground: +shore.ground.toFixed(2), mode: shore.mode };

  if (overview) {
    await page.evaluate(() => app.stations.go('island'));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(out, `${name}-overview.png`) });
  }
  await page.close();
  return r;
}

try {
  for (const [name, query] of RUNS) {
    if (only && only !== name) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop
    report.runs[name] = await run(name, query, { overview: name === 'my-day' });
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
console.log(`${report.pass ? 'PASS' : 'FAIL'} probe-terra-t2 ${report.seconds} s → ${out}`);
process.exit(report.pass ? 0 : 1);
