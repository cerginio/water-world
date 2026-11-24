// story-quest Q1 (STORY-QUEST-SPEC §4.1 «Каталог», §5; HANDOFF Q1): a story from the R2
// catalog by ?story=<folder>/<slug> gives the same field as the same model dropped as a
// file (the fixture path), lies on its field (content offset < 1 m — the frameless frog
// tiles are filtered), a dead network gives a clear message and the dev fallback list,
// and the product shell products/story-quest/ raises the scene in dev and in preview.
// Run against npm run dev (http://localhost:5199/). PREVIEW_URL=http://127.0.0.1:4173/
// adds the preview pass (npm run build && npm run preview first).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const preview = process.env.PREVIEW_URL ?? null;
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q1');
mkdirSync(out, { recursive: true });
const CDN = 'https://cdn.storytilecraft.cc/';
// the story-quest test set (owner, 2026-11-24): two catalog stories + the hybrid fixture
const FIXTURE = 'story-8-frames-hibrid';
const STORIES = [{ folder: 'test-2025', slug: 'my-day-3-moments', tiles: 13046 }, { folder: 'public-test', slug: 'frog-fairy-full', tiles: 39092 }];
for (const story of STORIES) {
  const index = await (await fetch(`${CDN}${story.folder}/index.json`)).json();
  story.frameCount = index.stories.find((s) => s.slug === story.slug)?.frameCount;
  assert.ok(story.frameCount, `${story.folder}/${story.slug} is not in its index.json`);
}
const report = { base, preview, stories: [], fixture: null, offline: null, shell: [] };
const t0 = performance.now();

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/\[catalog\]|Failed to load resource|CORS/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
};
// the field as the probes of Q0 measure it; contentOffset = drawn geometry centre vs tiles.center
const field = (page) => page.evaluate(() => {
  const t = app.tiles, r = t.rest;
  t.group.updateMatrixWorld(true);
  const Box3 = (t.group.children[0].geometry.computeBoundingBox(), t.group.children[0].geometry.boundingBox.constructor);
  const box = new Box3();
  for (const m of t.group.children) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
  const c = box.getCenter(new box.min.constructor());
  return { source: t.source, status: t.status, tiles: r.tiles.count, groups: r.groups, frames: t.frameRegistry.entries.length,
    extent: [+t.extent.x.toFixed(2), +t.extent.y.toFixed(2)], contentOffset: +Math.hypot(c.x - t.center.x, c.z - t.center.z).toFixed(2),
    catalog: { state: app.catalog.state, story: app.catalog.story?.id ?? null }, url: location.search };
});
const settled = (page) => page.waitForFunction(() => window.app && (app.tiles.loaded || app.tiles.status.startsWith('error')), {}, { timeout: 120000 });
const same = (a, b) => ['tiles', 'groups', 'frames'].every((k) => a[k] === b[k]) && a.extent.every((v, i) => Math.abs(v - b.extent[i]) < 0.01);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  watch(page, 'scene');

  // 1. each catalog story: ?story= against the same model dropped as a file
  for (const story of STORIES) {
    const id = `${story.folder}/${story.slug}`;
    await page.goto(`${base}?story=${id}`);
    await settled(page);
    const viaStory = await field(page);
    await page.evaluate(() => app.views.Tiles());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `${story.slug}.png`) });
    const text = await (await fetch(`${CDN}${id}.json`)).text();
    await page.goto(`${base}?tiles=none`);
    await page.waitForFunction(() => window.app?.tiles);
    await page.evaluate(({ name, text }) => {
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type: 'application/json' }));
      dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));
    }, { name: `${story.slug}.json`, text });
    await page.waitForFunction((name) => app.tiles.source === name && (app.tiles.loaded || app.tiles.status.startsWith('error')), `${story.slug}.json`, { timeout: 120000 });
    const viaFile = await field(page);
    report.stories.push({ id, catalogFrames: story.frameCount, viaStory, viaFile, same: same(viaStory, viaFile) });
  }

  // 2. the fixture: ?tiles= against the same story from the dev fallback catalog
  await page.goto(`${base}?tiles=${FIXTURE}`);
  await settled(page);
  const viaFixture = await field(page);
  await page.goto(`${base}?story=local/${FIXTURE}`);
  await settled(page);
  const viaLocal = await field(page);
  report.fixture = { viaFixture, viaLocal, same: same(viaFixture, viaLocal) };

  // 3. no network to R2: the scene keeps running, the status says why; the product shell
  //    words it and offers the local stories
  const offline = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  watch(offline, 'offline');
  await offline.route(/storytilecraft\.cc|r2\.dev/, (route) => route.abort('internetdisconnected'));
  await offline.goto(`${base}?story=public-test/frog-fairy-full`);
  await settled(offline);
  const sceneOffline = await offline.evaluate(() => ({ status: app.tiles.status, catalog: { state: app.catalog.state, error: app.catalog.error } }));
  await offline.goto(`${base}products/story-quest/?story=public-test/frog-fairy-full`);
  await offline.waitForFunction(() => document.querySelector('#storyStatus li'), {}, { timeout: 60000 });
  const shellOffline = await offline.evaluate(() => {
    const box = document.getElementById('storyStatus');
    return { hidden: box.hidden, state: box.dataset.state, text: box.innerText, links: [...box.querySelectorAll('a')].map((a) => new URL(a.href).searchParams.get('story')) };
  });
  await offline.screenshot({ path: join(out, 'shell-offline.png') });
  report.offline = { scene: sceneOffline, shell: shellOffline };
  await offline.close();

  // 4. the product shell raises the scene with ?story= — dev, and preview when given
  for (const [label, root] of [['dev', base], ...(preview ? [['preview', preview]] : [])]) {
    const shell = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    watch(shell, `shell ${label}`);
    await shell.goto(`${root}products/story-quest/?story=test-2025/my-day-3-moments`);
    await settled(shell);
    await shell.waitForTimeout(500);
    const f = await field(shell);
    const status = await shell.evaluate(() => ({ title: document.title, hidden: document.getElementById('storyStatus').hidden }));
    await shell.screenshot({ path: join(out, `shell-${label}.png`) });
    report.shell.push({ label, ...status, ...f });
    await shell.close();
  }
} finally {
  await browser.close();
}
report.errors = errors;
report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`screenshots + report: ${out}`);

for (const s of report.stories) {
  assert.ok(!s.viaStory.status.startsWith('error'), `${s.id}: ${s.viaStory.status}`);
  assert.equal(s.viaStory.catalog.state, 'ready', `${s.id}: catalog state`);
  assert.ok(s.same, `${s.id}: ?story= and the dropped file give different fields`);
  assert.equal(s.viaStory.frames, s.catalogFrames, `${s.id}: frames = index frameCount`);
  assert.ok(s.viaStory.contentOffset < 1, `${s.id}: content ${s.viaStory.contentOffset} m off the field centre`);
  assert.match(s.viaStory.url, new RegExp(`story=${s.id.replace('/', '%2F')}`), `${s.id}: the link keeps ?story=`);
}
const expectTiles = Object.fromEntries(STORIES.map((s) => [`${s.folder}/${s.slug}`, s.tiles]));
for (const s of report.stories) assert.equal(s.viaStory.tiles, expectTiles[s.id], `${s.id}: tile count`);
assert.ok(report.fixture.same, 'local catalog fixture ≠ ?tiles= fixture');
assert.ok(report.fixture.viaFixture.contentOffset < 1, 'fixture content off centre');
assert.match(report.offline.scene.status, /^error: Network error/);
assert.equal(report.offline.scene.catalog.error.code, 'network');
assert.equal(report.offline.shell.state, 'failed');
assert.ok(report.offline.shell.links.length >= 3 && report.offline.shell.links.every((id) => id.startsWith('local/')), 'offline: the local stories are offered');
for (const s of report.shell) {
  assert.equal(s.title, 'Story Quest');
  assert.equal(s.hidden, true, `${s.label}: the status line is hidden once the story is ready`);
  assert.equal(s.tiles, 13046, `${s.label}: shell field`);
}
assert.deepEqual(errors, []);
console.log(`PASS ${report.seconds} s`);
