// terra T1 (ISLAND-MAPS-SPEC §2, §4.3, §5 п.1 — the part about the scene and the URL): the map in
// the contract while only 'island' is built. A product link without map, with an unknown one, and
// a story picked over ?map=foo all open the island: scene.ready and state.read say map 'island',
// the walker starts on the same beach, the product's URL keeps the raw value, the iframe gets none.
// The probe reads the iframe's window.app to check the scene (the product never does).
// Run against npm run dev (http://localhost:5199/).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'terra-t1');
mkdirSync(out, { recursive: true });
const STORY = 'test-2025/my-day-3-moments';
const report = { base, runs: {} };
const t0 = performance.now();
const errors = [];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const scene = (page) => page.frames().find((f) => f !== page.mainFrame());

/** A product page whose scene got to the eyes: what the contract and the scene say about the map. */
async function product(name, query, { pick = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  // scene.ready as the product hears it: the hook is in before the product's first load
  await page.addInitScript(() => {
    window.__ready = [];
    addEventListener('message', (e) => {
      if (e.data?.type === 'event' && e.data.name === 'scene.ready') window.__ready.push(e.data.detail);
    });
  });
  await page.goto(`${base}products/story-quest/${query}`);
  if (pick) {
    await page.waitForSelector(`.story-choice-pick[data-story="${STORY}"]`, { timeout: 60000 });
    await page.click(`.story-choice-pick[data-story="${STORY}"]`);
  }
  await page.waitForFunction(() => document.body.dataset.storyState === 'ready', {}, { timeout: 120000 });
  await scene(page).waitForFunction(() => window.app.walker?.mode === 'eyes', {}, { timeout: 60000, polling: 100 });
  const state = await page.evaluate(() => window.storyQuest.host.call('state.read', {}));
  assert.ok(state.ok, `${name}: state.read ${state.reason}`);
  const spawn = await page.evaluate(() => window.storyQuest.host.call('walker.place', { at: 'beach' }));
  const r = {
    product: new URL(page.url()).search,
    iframe: await scene(page).evaluate(() => location.search),
    ready: await page.evaluate(() => window.__ready),
    map: state.value.map,
    sceneMap: await scene(page).evaluate(() => window.app.map),
    spawn: await scene(page).evaluate(() => {
      const s = window.app.walker.state;
      return [Math.round(s.x * 100) / 100, Math.round(s.z * 100) / 100];
    }),
    placed: spawn.ok,
  };
  await page.screenshot({ path: join(out, `${name}.png`) });
  await ctx.close();
  return r;
}

try {
  const plain = report.runs.plain = await product('plain', `?story=${STORY}`);
  const foo = report.runs.foo = await product('foo', `?story=${STORY}&map=foo`);
  const picked = report.runs.picked = await product('picked', '?map=foo', { pick: true });
  const island = report.runs.island = await product('island', `?story=${STORY}&map=island`);

  for (const [name, r] of Object.entries(report.runs)) {
    assert.equal(r.map, 'island', `${name}: state.read().map`);
    assert.equal(r.sceneMap, 'island', `${name}: the scene built the island`);
    assert.deepEqual(r.ready.map((d) => d.map), ['island'], `${name}: scene.ready says the island once`);
    assert.doesNotMatch(r.iframe, /map=/, `${name}: the default and unknown maps never reach the iframe`);
    assert.ok(r.placed, `${name}: walker.place beach`);
    // the beach anchor of probe-story-embed: (198.48, −207.3) on the island
    assert.deepEqual(r.spawn, [198.48, -207.3], `${name}: the walker starts on the island's story beach`);
  }
  assert.doesNotMatch(plain.product, /map=/, 'no map is added to a link without one');
  assert.match(foo.product, /[?&]map=foo(&|$)/, 'the unknown value stays in the product URL');
  assert.match(picked.product, /[?&]map=foo(&|$)/, 'picking a story keeps map in the product URL');
  assert.match(picked.product, /[?&]story=test-2025\/my-day-3-moments(&|$)/, 'and adds the story');
  assert.match(island.product, /[?&]map=island(&|$)/);

  // the scene page alone (GUI, no product): ?map=foo is the island too
  const page = await browser.newPage();
  await page.goto(`${base}?map=foo`);
  await page.waitForFunction(() => !!window.app?.terrain, {}, { timeout: 60000 });
  report.scenePage = await page.evaluate(() => window.app.map);
  assert.equal(report.scenePage, 'island');
  await page.close();

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
console.log(`${report.pass ? 'PASS' : 'FAIL'} probe-terra-t1 ${report.seconds} s → ${out}`);
process.exit(report.pass ? 0 : 1);
