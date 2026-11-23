// SCENE-ENVIRONMENT E1: moving the sky into src/environment/ changes nothing on screen.
// Each case is a fresh page with ?still (the render loop never starts) and Math.random seeded at app.still(),
// so time starts at 0 and app.still() renders the same frames at a fixed dt in both builds.
// Per case it records:
//   - the sun: direction and colour (the objects the water and the terrain hold);
//   - the sky cube: six 1024² faces, every 8th texel (half floats);
//   - the final frame: RGBA bytes of the canvas after `FRAMES` frames of the shot.
//   PROBE_MODE=capture  writes the reference into PROBE_DIR (run on the code BEFORE the change)
//   PROBE_MODE=compare  (default) checks the current build against it: ≤ 1/255 per channel,
//                       cube and sun relative difference ≤ 1/255.
// PROBE_DIR defaults to <os tmp>/scene-env-identity — outside the repository on purpose.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const MODE = process.env.PROBE_MODE ?? 'compare';
const DIR = process.env.PROBE_DIR ?? join(tmpdir(), 'scene-env-identity');
const FRAMES = Number(process.env.PROBE_FRAMES ?? 45);
const CASES = [
  { shot: 'Golden hour', query: '?still&desktop' },
  { shot: 'Lagoon', query: '?still&desktop' },
  { shot: 'Aerial', query: '?still&desktop' },
  { shot: 'Underwater', query: '?still&desktop' },
  { shot: 'Tiles', query: '?still&desktop&tiles=story-8-frames-hibrid' },
];
const STRIDE = 8;
assert.ok(MODE === 'capture' || MODE === 'compare', `PROBE_MODE capture|compare, got ${MODE}`);
mkdirSync(DIR, { recursive: true });

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = [];
try {
  for (const c of CASES) {
    const tc = performance.now();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    // floaters spawn with a random yaw (Underwater, Flotsam): the same sequence in both builds.
    // Reseeded right before app.still(): three's generateUUID draws from Math.random too, so any
    // object added at load (E1's environment/fullscreen.js copy: one geometry, one camera) would
    // shift a sequence seeded only at page start.
    await page.addInitScript(() => {
      let s = 1;
      window.__seedRandom = (seed) => { s = seed; };
      Math.random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    });
    await page.goto(new URL(c.query, BASE).href);
    await page.waitForFunction(() => window.app?.still, {}, { timeout: 120000 });
    if (c.shot === 'Tiles') await page.waitForFunction(() => app.tiles.loaded, {}, { timeout: 120000 });
    // E2b: the clouds drift with time; the probe compares the code, so they stand still (a build
    // before E2b ignores the key, and set() re-bakes the same sky)
    await page.evaluate(() => app.env?.set({ cloudSpeed: 0 }));
    const frame = await page.evaluate(({ shot, frames }) => (window.__seedRandom(0x2545f491), app.still({ shot, frames })), { shot: c.shot, frames: FRAMES });
    // the sun and the cube, through whichever API the build has (before E1: app.sky; after: app.env)
    const env = await page.evaluate((stride) => {
      const e = app.env, s = app.sky;
      const dir = e ? e.sun.direction : s.sunDir, color = e ? e.sun.color : s.sunColor;
      const rt = e ? e.cubeTarget : s.cubeRT, n = rt.width, m = n / stride;
      const buf = new Uint16Array(n * n * 4), faces = [];
      for (let f = 0; f < 6; f++) {
        app.renderer.readRenderTargetPixels(rt, 0, 0, n, n, buf, f);
        const out = new Array(m * m * 4);
        for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) for (let k = 0; k < 4; k++)
          out[(y * m + x) * 4 + k] = buf[((y * stride) * n + x * stride) * 4 + k];
        faces.push(out);
      }
      return { sunDir: dir.toArray(), sunColor: color.toArray(), cubeSize: n, faces };
    }, STRIDE);
    assert.deepEqual(errors, [], `${c.shot}: no page errors`);
    assert.equal(frame.shot, c.shot, `${c.shot}: the shot applied`);
    const pixels = Buffer.from(frame.rgba, 'base64');
    const name = c.shot.replace(/\s+/g, '-').toLowerCase();
    if (MODE === 'capture') {
      writeFileSync(join(DIR, `${name}.rgba`), pixels);
      writeFileSync(join(DIR, `${name}.json`), JSON.stringify({ width: frame.width, height: frame.height, frames: FRAMES, ...env }));
      report.push(`${c.shot}: captured ${frame.width}×${frame.height}, cube ${env.cubeSize}² (${((performance.now() - tc) / 1000).toFixed(1)} s)`);
    } else {
      const ref = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
      const refPx = readFileSync(join(DIR, `${name}.rgba`));
      assert.equal(ref.frames, FRAMES, `${c.shot}: the reference was taken with PROBE_FRAMES=${ref.frames}`);
      assert.deepEqual([frame.width, frame.height], [ref.width, ref.height], `${c.shot}: frame size`);
      const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
      const sunD = Math.max(...env.sunDir.map((v, i) => Math.abs(v - ref.sunDir[i])));
      const sunC = Math.max(...env.sunColor.map((v, i) => rel(v, ref.sunColor[i])));
      let cubeD = 0;
      env.faces.forEach((face, f) => face.forEach((h, i) => { cubeD = Math.max(cubeD, rel(half(h), half(ref.faces[f][i]))); }));
      let maxD = 0, over = 0;
      for (let i = 0; i < pixels.length; i++) {
        if ((i & 3) === 3) continue;   // alpha
        const d = Math.abs(pixels[i] - refPx[i]);
        if (d > maxD) maxD = d;
        if (d > 1) over++;
      }
      report.push(`${c.shot}: frame max Δ ${maxD}/255, channels > 1/255: ${over}; cube max rel Δ ${cubeD.toExponential(2)}; `
        + `sunDir Δ ${sunD.toExponential(2)}, sunColor rel Δ ${sunC.toExponential(2)} (${((performance.now() - tc) / 1000).toFixed(1)} s)`);
      assert.ok(sunD <= 1 / 255 && sunC <= 1 / 255, `${c.shot}: sun ${sunD} / ${sunC}`);
      assert.ok(cubeD <= 1 / 255, `${c.shot}: cube relative difference ${cubeD}`);
      assert.equal(over, 0, `${c.shot}: ${over} channels differ by more than 1/255 (max ${maxD})`);
    }
    await page.close();
  }
  console.log(report.join('\n'));
  console.log(`probe-scene-env-identity ${MODE} PASS ${((performance.now() - t0) / 1000).toFixed(1)} s (${DIR})`);
} catch (e) {
  console.log(report.join('\n'));
  throw e;
} finally {
  await browser.close();
}
