// Five minutes of actual integrated time on the live polygon field.
// Run after the short probe, against the same dev server; no product dependencies.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('Multiple instances of Three.js')) errors.push(m.text()); });
  await page.goto(`${process.env.TILES_URL ?? 'http://localhost:5199/'}?tiles=story-8-frames-polygon`);
  await page.waitForFunction(() => window.app?.tiles.sim, {}, { timeout: 60000 });
  const density = page.getByLabel('density', { exact: true });
  await density.fill('900'); await density.press('Enter'); await density.blur();
  await page.waitForTimeout(12000);
  await page.screenshot({ path: join(tmpdir(), 'tile-t2-density-900.png') });
  await density.fill('200'); await density.press('Enter'); await density.blur();
  await page.evaluate(() => {
    const sim = app.tiles.sim, update = sim.update;
    window.tileSoak = { seconds: 0, frames: 0, maxOffset: 0, maxOrbit: 0, maxSpringError: 0,
      maxTilt: 0, maxVy: 0, nonfinite: 0, count: app.tiles.rest.tiles.count };
    sim.update = function (matrix, dt, params) {
      update.call(this, matrix, dt, params);
      tileSoak.seconds += Math.min(dt, 8/240);
      tileSoak.frames++;
    };
  });
  let result;
  do {
    await page.waitForTimeout(15000);
    result = await page.evaluate(() => {
      const t = app.tiles, s = t.sim, r = app.renderer, out = tileSoak;
      const a = Array.from({ length: 4 }, () => new Float32Array(512*s.height*4));
      a.forEach((v,i) => r.readRenderTargetPixels(s.target,0,0,512,s.height,v,0,i));
      for (let i = 0; i < t.rest.tiles.count; i++) {
        const k = i*4;
        for (const v of a) for (let j = 0; j < 4; j++) if (!Number.isFinite(v[k+j])) out.nonfinite++;
        const offset = Math.hypot(a[0][k+2], a[0][k+3]), orbit = Math.hypot(a[2][k+2], a[2][k+3]);
        out.maxOffset = Math.max(out.maxOffset, offset);
        out.maxOrbit = Math.max(out.maxOrbit, orbit);
        // Rotation preserves length. A rest-started critically damped anchor has
        // zero residual, so its total displacement is exactly its orbital term.
        out.maxSpringError = Math.max(out.maxSpringError, Math.abs(offset-orbit));
        out.maxTilt = Math.max(out.maxTilt, Math.hypot(a[1][k], a[1][k+1]));
        out.maxVy = Math.max(out.maxVy, Math.abs(a[0][k+1]));
      }
      return { ...out, gpuMs: app.timer.ms.tiles, cpuSubmitMs: t.cpuMs };
    });
    console.log(JSON.stringify(result));
    assert.equal(result.nonfinite, 0);
    assert.ok(result.maxSpringError < 0.0001);
    assert.ok(result.maxTilt <= Math.PI/3 + 1e-6);
    assert.ok(result.maxVy <= 10);
  } while (result.seconds < 300);
  await page.screenshot({ path: join(tmpdir(), 'tile-t2-anchored-5min.png') });
  assert.ok(result.maxOffset <= 2*result.maxOrbit);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, ...result, errors }, null, 2));
} finally { await browser.close(); }
