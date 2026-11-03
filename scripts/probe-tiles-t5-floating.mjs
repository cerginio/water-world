// T5 floating regression (owner QA 2026-11-03: promoted groups capsized/launched).
// Real story-8-frames-hibrid groups -> makePromotionDescriptor -> Floaters.integrate on a
// synthetic 0.6 m / 25 m wave, water heights refreshed at 60 Hz and 3 frames late like WaterQuery.
// The page only hosts Tilecraft's loader: no WebGL renderer, ocean or GPU work.
// Needs the dev server on :5199 (TILECRAFT_ROOT reachable) and Playwright.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const density = +(process.env.TILES_DENSITY ?? 100);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  page.setDefaultTimeout(120000);
  await page.route('**/__t5_floating__', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>T5 floating</title>' }));
  await page.goto('http://localhost:5199/__t5_floating__');
  const rows = await page.evaluate(async (density) => {
    globalThis.__TILECRAFT_ROOT__ = 'D:/work/js-games/ua-dream/tilecraft';
    const T = await import('/node_modules/.vite/deps/three.js');
    const L = await import('/src/tiles/tilecraftLoader.js');
    const { collectTileRest } = await import('/src/tiles/tileRest.js');
    const G = await import('/src/tiles/tilePromotionGeometry.js');
    const { Floaters } = await import('/src/scene/floaters.js');
    const rest = collectTileRest(await L.compileTileSource(await L.fetchTileSource('story-8-frames-hibrid')));
    const t = rest.tiles;
    const field = { rest, params: { density }, group: new T.Group(), sim: { uniforms: { uTileMotionLimit: { value: 1e9 } } },
      material: () => new T.MeshBasicMaterial() };
    const A = 0.6, k = 2 * Math.PI / 25, w = Math.sqrt(9.81 * k);
    const wave = (x, time) => [A * Math.sin(k * x - w * time), A * w * Math.cos(k * x - w * time)];
    // GPU state at its hydrostatic target on the wave (TileSim), no tilt.
    const state0 = new Float32Array(t.count * 4), state1 = new Float32Array(t.count * 4);
    for (let i = 0; i < t.count; i++) state0[i * 4] = wave(t.x[i], 0)[0] + t.thickness[i] * (0.5 - density / 1025) - t.y0[i];
    const groups = [], seen = new Set();
    for (let i = 0; i < t.count; i++) {
      const line = t.flags[i] & 1;
      if (!line && t.g[i] < 0) continue;
      const key = line ? `r${t.runId[i]}` : `g${t.f[i]}:${t.g[i]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ id: i, kind: line ? 'run' : 'poly', n: G.promotionMembers(rest, i).length });
    }
    const picks = [];
    for (const kind of ['poly', 'run']) {
      const list = groups.filter(g => g.kind === kind).sort((a, b) => a.n - b.n);
      for (const q of [0.5, 0.75, 0.9, 0.97, 1]) picks.push(list[Math.min(list.length - 1, Math.floor(q * list.length))]);
    }
    const up = new T.Vector3();
    return picks.map(({ id, kind, n }) => {
      const desc = G.makePromotionDescriptor(field, G.promotionMembers(rest, id), state0, state1);
      const floaters = new Floaters({ scene: new T.Scene(), heightAt: () => -50, patchMaterial() {} });
      const b = floaters.addDescriptor(desc, desc.positionWorld.clone(), 0, () => {});
      const start = b.pos.clone();
      const pose = desc.cellHeight * (0.5 - density / 1025) - desc.samples.reduce((m, p) => m + p.y, 0) / desc.samples.length;
      let above = -Infinity, vy = 0, tilt = 0, drift = 0, spin = 0, time = 0;
      for (let s = 0; s < 240 * 20; s++) {
        time += 1 / 240;
        // WaterQuery-like: one result per 60 Hz frame, sampled 3 frames (50 ms) earlier.
        if (s >= 12 && s % 4 === 0) {
          b.updateWorld();
          b.world.forEach((p, i) => {
            const [h, v] = wave(p.x, time - 0.05);
            b.water.set([h, 0, Math.max(-0.8, Math.min(0.8, v)), 0], i * 4);
          });
          b.ready = true;
        }
        floaters.integrate(b, 1 / 240);
        // above its own flat-water pose (draft + decorative offset are not a leap)
        above = Math.max(above, b.pos.y - wave(b.pos.x, time)[0] - pose);
        vy = Math.max(vy, Math.abs(b.vel.y));
        // Tilt relative to the local water surface, not to vertical.
        const slope = Math.atan(A * k * Math.abs(Math.cos(k * b.pos.x - w * time)));
        const normal = new T.Vector3(-Math.sin(slope) * Math.sign(Math.cos(k * b.pos.x - w * time)), Math.cos(slope), 0);
        if (time > 1) {
          tilt = Math.max(tilt, Math.acos(Math.min(1, up.set(0, 1, 0).applyQuaternion(b.quat).dot(normal))) * 180 / Math.PI);
          spin = Math.max(spin, Math.hypot(b.angVel.x, b.angVel.z));
        }
        drift = Math.max(drift, Math.hypot(b.pos.x - start.x, b.pos.z - start.z));
      }
      const r = v => +v.toFixed(2);
      return { kind, n, size: Math.max(desc.size.x, desc.size.z), samples: desc.samples.length,
        above: r(above), vy: r(vy), tilt: +tilt.toFixed(1), spin: r(spin), drift: r(drift) };
    });
  }, density);
  console.table(rows);
  // The wave's own maxima: vertical speed A·ω = 0.94 m/s, slope rate A·k·ω = 0.24 rad/s.
  for (const row of rows) {
    const label = `${row.kind} n=${row.n}`;
    assert(row.vy <= 1.1, `${label} leaps: |vy| ${row.vy} m/s (water 0.94)`);
    assert(row.spin <= 0.4, `${label} flutters: ${row.spin} rad/s (surface 0.24)`);
    assert(row.tilt <= 10, `${label} off the surface by ${row.tilt}deg`);
    assert(row.drift <= 0.5, `${label} drifts ${row.drift} m on a standing wave`);
    // A plate wider than half a wavelength bridges crest and trough: its centre sits off the local surface.
    if (row.size < 6) assert(row.above <= 0.3, `${label} rides ${row.above} m above its pose`);
  }
  console.log(`PASS T5 floating: ${rows.length} fixture groups, density ${density}, |vy|<=1.1 m/s, spin<=0.4 rad/s, tilt to surface<=10deg, drift<=0.5 m`);
} finally { await browser.close(); }
