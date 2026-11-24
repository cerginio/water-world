// story-quest Q0 (STORY-QUEST-SPEC §7 p.1, §5.1): do the R2 catalog stories, which come
// without a .frames.json sidecar, compile and lie on the water like the fixture; and does
// the bucket answer this page's origin with CORS. Run against npm run dev.
// Models are fetched by Node (no CORS there) and dropped into the page as a File — the
// same path as the owner dragging a .json onto the scene.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TILES_URL ?? 'http://localhost:5199/';
const out = process.env.PROBE_OUT ?? join(tmpdir(), 'story-q0');
mkdirSync(out, { recursive: true });
const CDN = 'https://cdn.storytilecraft.cc/';
const MIRROR = 'https://pub-17dfba1e4d9148e7bcd3547a717794f9.r2.dev/';
// the story-quest test set (owner, 2026-11-24): two catalog stories + the hybrid fixture
const FIXTURE = 'story-8-frames-hibrid';
const STORIES = [{ folder: 'test-2025', slug: 'my-day-3-moments' }, { folder: 'public-test', slug: 'frog-fairy-full' }];
for (const story of STORIES) {
  const index = await (await fetch(`${CDN}${story.folder}/index.json`)).json();
  story.frameCount = index.stories.find((s) => s.slug === story.slug)?.frameCount;
  assert.ok(story.frameCount, `${story.folder}/${story.slug} is not in its index.json`);
}
const report = { base, cors: {}, stories: [] };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CORS') && !m.text().includes('Failed to load resource')) errors.push(m.text()); });

  const field = () => page.evaluate(() => {
    const t = app.tiles, r = t.rest;
    t.group.children[0].geometry.computeBoundingBox();
    const THREE_Box3 = t.group.children[0].geometry.boundingBox.constructor;   // three is not on window
    t.group.updateMatrixWorld(true);
    const frames = t.frameRegistry.entries.map((e) => ({ id: String(e.id), x: +e.world.x.toFixed(1), z: +e.world.z.toFixed(1),
      w: +(e.bounds.max.x - e.bounds.min.x).toFixed(2), d: +(e.bounds.max.y - e.bounds.min.y).toFixed(2) }));
    // two frames overlap when their rest rectangles intersect: they would sit on top of each other
    let overlaps = 0;
    const b = t.frameRegistry.entries.map((e) => e.bounds);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i].intersectsBox(b[j])) overlaps++;
    // where the drawn geometry actually is, against the field centre the camera frames:
    // Tilecraft centres its space on ALL source points, our field assumes content around 0
    const box = new THREE_Box3();
    for (const m of t.group.children) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
    const c = box.getCenter(new box.min.constructor());
    const contentOffset = +Math.hypot(c.x - t.center.x, c.z - t.center.z).toFixed(1);
    return { status: t.status, tiles: r.tiles.count, contentOffset, groups: r.groups, modelFrames: t.frames.length, frames: frames.length,
      extent: [+t.extent.x.toFixed(1), +t.extent.y.toFixed(1)], center: [+t.center.x.toFixed(0), +t.center.z.toFixed(0)],
      compileMs: +t.compiled.compileMs.toFixed(0), restMs: +t.compiled.restMs.toFixed(0), overlaps, frameList: frames };
  });
  const shoot = async (name) => {
    await page.evaluate(() => app.views.Tiles());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `${name}.png`) });
  };

  // baseline: the fixture with its (empty) sidecar
  await page.goto(`${base}?tiles=${FIXTURE}`);
  await page.waitForFunction(() => window.app?.tiles.loaded, {}, { timeout: 90000 });
  report.fixture = { id: FIXTURE, sidecarFrames: await page.evaluate(() => Object.keys(app.tiles.payload.sidecar?.frames ?? {}).length), ...await field() };
  await shoot('fixture');

  // CORS from this page's origin, both hosts
  report.cors = await page.evaluate(async (urls) => {
    const result = {};
    for (const u of urls) {
      try { const r = await fetch(u, { cache: 'no-store' }); result[u] = `ok ${r.status}`; }
      catch (e) { result[u] = `blocked: ${e.message}`; }
    }
    return result;
  }, STORIES.flatMap(({ folder }) => [`${CDN}${folder}/index.json`, `${MIRROR}${folder}/index.json`]));
  report.cors.origin = await page.evaluate(() => location.origin);

  for (const story of STORIES) {
    const text = await (await fetch(`${CDN}${story.folder}/${story.slug}.json`)).text();
    await page.evaluate(async ({ name, text }) => {
      const file = new File([text], name, { type: 'application/json' });
      const data = new DataTransfer();
      data.items.add(file);
      dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));
    }, { name: story.slug + '.json', text });
    await page.waitForFunction((name) => app.tiles.source === name && (app.tiles.loaded || app.tiles.status.startsWith('error')),
      story.slug + '.json', { timeout: 90000 });
    const s = { slug: story.slug, catalogFrames: story.frameCount, sidecar: await page.evaluate(() => app.tiles.payload?.sidecar ?? null), ...await field() };
    report.stories.push(s);
    await shoot(story.slug);
  }
} finally {
  await browser.close();
}
report.errors = errors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, (k, v) => (k === 'frameList' ? undefined : v), 2));
console.log(`screenshots + report: ${out}`);
for (const s of report.stories) {
  assert.ok(!s.status.startsWith('error'), `${s.slug}: ${s.status}`);
  assert.equal(s.frames, s.catalogFrames, `${s.slug}: frames in the field = index frameCount`);
}
assert.deepEqual(errors, []);
