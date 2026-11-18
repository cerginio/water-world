import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { projectRoot, publishedAssetPath, resolveTilecraft, tilecraftAssets } from '../build/tilecraft-config.js';
import { tilecraftPlugin } from '../build/tilecraft-plugin.js';
import { verifyDist } from './verify-dist.mjs';
import { serveDist } from './static-server.mjs';

const root = resolveTilecraft();
const originalEnv = process.env.TILECRAFT_ROOT;
try {
  process.env.TILECRAFT_ROOT = '';
  assert.throws(() => resolveTilecraft(), /Set TILECRAFT_ROOT/);
  process.env.TILECRAFT_ROOT = resolve(projectRoot, '.build-qa/missing-checkout');
  assert.throws(() => resolveTilecraft(), /Tilecraft file missing/);
  process.env.TILECRAFT_ROOT = root;
  assert.equal(resolveTilecraft(), root);
} finally {
  if (originalEnv === undefined) delete process.env.TILECRAFT_ROOT;
  else process.env.TILECRAFT_ROOT = originalEnv;
}
const plugin = tilecraftPlugin(root);
assert.throws(() => plugin.configResolved({ base: './' }), /pathname base/);
plugin.configResolved({ base: '/' });
const loaderId = `${root}/viewer/engines/three/core/model-loader.js`;
assert.throws(() => plugin.transform('changed upstream contract', loaderId), /contract changed/);
assert.throws(() => plugin.transform("const STAND_ROOT = new URL('../', import.meta.url);".repeat(2), loaderId), /contract changed/);

verifyDist();
mkdirSync(resolve(projectRoot, '.build-qa'), { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], report = [];
async function checkSite(directory, base, sources) {
  const server = await serveDist({ directory, base });
  try {
    for (const asset of tilecraftAssets) {
      const response = await fetch(`${server.url}${publishedAssetPath(asset)}`);
      assert.equal(response.status, 200, asset);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(resolve(root, asset)));
    }
    assert.equal((await fetch(`${server.url}tilecraft/not-published.json`)).status, 404);
    for (const source of sources) {
      console.log(`Browser QA: ${base}?tiles=${source}`);
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
      page.on('request', request => {
        if (!request.url().startsWith(server.url) || request.url().includes('/@fs/')) errors.push(`External request: ${request.url()}`);
      });
      try {
        await page.goto(`${server.url}?tiles=${source}&mobile`);
        await page.waitForFunction(() => window.app?.tiles.sim || window.app?.tiles.status.startsWith('error:'), {}, { timeout: 60000 });
        const state = await page.evaluate(() => {
          const t = app.tiles;
          return { status: t.status, loaded: !!t.sim, sameThree: t.compiled?.sameThree,
            polygon: t.rest?.polygon.length, polyline: t.rest?.polyline.length,
            frames: t.frames.length, sidecar: !!t.payload?.sidecar, world: !!t.payload?.world };
        });
        assert.equal(state.loaded, true, JSON.stringify(state));
        assert.equal(state.sameThree, true);
        if (source.startsWith('story-')) { assert.equal(state.sidecar, true); assert.equal(state.frames, 8); }
        if (source.endsWith('hibrid')) { assert.ok(state.polygon > 0); assert.ok(state.polyline > 0); }
        if (source === 'demo') assert.equal(state.world, true);
        if (source.endsWith('hibrid')) {
          await page.evaluate(async () => {
            const t = app.tiles;
            t.setMode('drift'); t.setMode('anchored');
            t.params.frame = t.frames[0]; await t.rebuild();
            if (new Set([...t.rest.polygon, ...t.rest.polyline].map(part => part.frameId)).size !== 1) throw new Error('Frame filter did not apply');
            t.params.frame = 'all'; await t.rebuild();
            const f = t.frameRegistry.entries[0];
            t.moveFrame(f.id, 0, 0); // land
            if (f.mode !== 'placed') throw new Error('Land placement failed');
            t.moveFrame(f.id, 450, 450); // water
            t.releaseFrame(f.id);
            if (f.mode !== 'inherited') throw new Error('Release failed');
          });
          await page.screenshot({ path: resolve(projectRoot, '.build-qa', base === '/' ? 'production.png' : 'production-subpath.png') });
          // The actual UI uses a detached file input opened by the source dropdown.
          const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('select').filter({ has: page.locator('option', { hasText: 'file…' }) }).selectOption({ label: 'file…' }, { force: true }),
          ]);
          await chooser.setFiles({ name: 'local-demo.json', mimeType: 'application/json',
            buffer: readFileSync(resolve(directory, 'tilecraft/viewer/engines/three/fixtures/world-demo.json')) });
          await page.waitForFunction(() => app.tiles.source === 'local-demo.json' && !!app.tiles.sim, {}, { timeout: 60000 });
          await page.evaluate(json => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([json], 'dropped-demo.json', { type: 'application/json' }));
            window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
          }, readFileSync(resolve(directory, 'tilecraft/viewer/engines/three/fixtures/world-demo.json'), 'utf8'));
          await page.waitForFunction(() => app.tiles.source === 'dropped-demo.json' && !!app.tiles.sim, {}, { timeout: 60000 });
        }
        await page.reload();
        await page.waitForFunction(() => !!window.app?.renderer, {}, { timeout: 60000 });
        report.push({ base, source, ...state });
        console.log(`Browser QA passed: ${source}`);
      } finally { await page.close(); }
    }
  } finally { await server.close(); }
}
try {
  await checkSite(resolve(projectRoot, 'dist'), '/', ['story-8-frames-hibrid', 'story-8-frames-polygon', 'story-8-frames-polyline', 'demo']);
  const subpathDist = resolve(projectRoot, '.build-qa/subpath-dist');
  await build({ configFile: resolve(projectRoot, 'vite.config.js'), base: '/water/', build: { outDir: subpathDist } });
  verifyDist(subpathDist);
  await checkSite(subpathDist, '/water/', ['story-8-frames-hibrid']);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, report }, null, 2));
} finally { await browser.close(); }
