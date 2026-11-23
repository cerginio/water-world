// MOOD-WEATHER M1a: the mood data reach the world through app.mood.set(v, a, t).
//   1. anchors  — the nine anchors of spec §3.2 land in env / ocean / spray / shore / fog / post
//                 (expected numbers typed from the spec table, not read from mood.js);
//   2. field    — the time of day before and after the tiles load does not move the story field
//                 (spec §6 p.10);
//   3. readable — Tiles shot under 9 anchors × t 0.05 / 0.5 / 0.95: the white parts of the tiles
//                 have median sRGB luma ≥ 0.55, the black ≤ 0.25 (spec §6 p.5).
// The story tiles are colour pictures; the floor is about the tiles whose albedo is exactly white
// (1,1,1) or black (0,0,0) — 916 and 5 962 of 23 678 in story-8-frames-hibrid. Masks per case, three
// renders at dt ≈ 0 with reflections off (auto exposure holds): A as is, C all tiles albedo 0,
// W all tiles albedo 1. White tile: A ≈ W; black: A ≈ C; both where W − C is large (a lit face).
// Tone mapping is not linear, so the test is "equal to", never a ratio; grain (1–3/255) and glints
// (up to 180/255 between two frames at dt ≈ 0) are why the tolerance and the 1 px erosion.
// The measured frame is the one before, with reflections, after SETTLE frames for auto exposure.
// PROBE_ONLY=anchors,field,readable runs a subset; PROBE_CASES=default,A9 limits the readable cases.
// Writes nothing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const ONLY = new Set((process.env.PROBE_ONLY ?? 'anchors,field,readable').split(','));
const TILES = '?still&desktop&tiles=story-8-frames-hibrid';
const SETTLE = Number(process.env.PROBE_SETTLE ?? 240);   // frames at 1/60 for auto exposure (adaptDown 1/s)

// spec §3.1 / §3.2 — (v, a), sunIntensity, cloudCoverage, turbidity, windSpeed, waveScale, swellScale,
// choppiness, shore ×, spray ×, clarity, fog ×, keyValue, contrast, saturation
const ANCHORS = {
  A1: [-1, 1, 7, 0.95, 5, 22, 0.45, 1.2, 1.5, 1.6, 2.5, 0.5, 6, 0.12, 1.2, 0.8],
  A2: [0, 1, 9, 0.45, 2, 15, 0.3, 0.9, 1.15, 1.3, 1.6, 1, 1.5, 0.18, 1.15, 1.25],
  A3: [1, 1, 10, 0.2, 1.5, 10, 0.18, 0.7, 0.9, 1.0, 1.0, 1.3, 0.8, 0.22, 1.12, 1.4],
  A4: [-1, 0, 8, 0.88, 4, 6, 0.1, 0.5, 0.7, 0.8, 0.6, 0.6, 3, 0.14, 1.0, 0.8],
  A5: [0, 0, 9, 0.38, 2, 7, 0.12, 0.6, 0.8, 0.9, 0.8, 1, 1, 0.18, 1.1, 1.25],
  A6: [1, 0, 9.5, 0.15, 1.8, 5, 0.1, 0.6, 0.7, 0.8, 0.6, 1.1, 0.9, 0.2, 1.12, 1.35],
  A7: [-1, -1, 8, 0.6, 8, 2, 0.05, 0.35, 0.5, 0.5, 0.3, 0.7, 8, 0.15, 0.92, 0.7],
  A8: [0, -1, 8.5, 0.55, 2.5, 2.5, 0.06, 0.4, 0.5, 0.5, 0.3, 0.9, 1.5, 0.16, 1.02, 1.0],
  A9: [1, -1, 9, 0.12, 1.6, 1.5, 0.04, 0.3, 0.4, 0.4, 0.2, 1.5, 0.8, 0.2, 1.08, 1.3],
};
const close = (a, b, what, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${what}: ${a} ≠ ${b}`);
const sunAt = (t) => ({ elevation: -2 + 62 * Math.sin(Math.PI * t), azimuth: 205 - 180 * (1 - t) });   // spec §2.2

const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = [];
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL(query, BASE).href);
  await page.waitForFunction(() => window.app?.mood, {}, { timeout: 120000 });
  return { page, errors };
}

try {
  if (ONLY.has('anchors')) {
    const ts = performance.now();
    const { page, errors } = await open('?still&desktop');
    const before = await page.evaluate(() => app.mood.state());
    assert.equal(before.custom, true, 'before the first set the world is the Controls\' own');
    assert.deepEqual([before.t, before.v, before.a, before.map], [0.1, 1, -1, 'mood@1'], 'default state: morning, A9');
    const base = await page.evaluate(() => ({
      shore: app.surface.uniforms.uShoreWave.value.x, spray: app.spray.params.amount,
      terrainFog: app.terrain.uniforms.uFogDensity.value, waterFog: app.surface.uniforms.uOptics.value.w,
    }));
    for (const [id, [v, a, si, cc, tb, ws, wv, sw, ch, sh, sp, cl, fog, kv, ct, sat]] of Object.entries(ANCHORS)) {
      const t = { A1: 0.05, A5: 0.5, A9: 0.1 }[id] ?? 0.95;
      const got = await page.evaluate(([mv, ma, mt]) => {
        const s = app.mood.set(mv, ma, mt), su = app.surface.uniforms, op = app.ocean.params, p = app.post.params, e = app.env.params;
        return { s, e: { ...e }, op: { windSpeed: op.windSpeed, waveScale: op.waveScale, swellScale: op.swellScale, choppiness: op.choppiness },
          dirty: app.env.dirty, shore: su.uShoreWave.value.x, spray: app.spray.params.amount,
          terrainFog: app.terrain.uniforms.uFogDensity.value, waterFog: su.uOptics.value.w, absorptionG: su.uAbsorption.value.y,
          grade: { keyValue: p.keyValue, contrast: p.contrast, saturation: p.saturation },
          sunY: app.env.sun.direction.y };
      }, [v, a, t]);
      assert.equal(got.s.anchor, id, `${id}: nearest anchor`);
      assert.equal(got.s.custom, false, `${id}: set hands the world to the mood`);
      assert.equal(got.dirty, false, `${id}: the sky is baked at once`);
      const sun = sunAt(t);
      close(got.e.elevation, sun.elevation, `${id} elevation`);
      close(got.e.azimuth, sun.azimuth, `${id} azimuth`);
      close(got.sunY, Math.sin(sun.elevation * Math.PI / 180), `${id} sun direction`, 1e-5);
      close(got.e.sunIntensity, si, `${id} sunIntensity`); close(got.e.cloudCoverage, cc, `${id} cloudCoverage`); close(got.e.turbidity, tb, `${id} turbidity`);
      close(got.op.windSpeed, ws, `${id} windSpeed`); close(got.op.waveScale, wv, `${id} waveScale`);
      close(got.op.swellScale, sw, `${id} swellScale`); close(got.op.choppiness, ch, `${id} choppiness`);
      close(got.shore, base.shore * sh, `${id} shore`); close(got.spray, base.spray * sp, `${id} spray`);
      close(got.terrainFog, base.terrainFog * fog, `${id} terrain fog`); close(got.waterFog, base.waterFog * fog, `${id} water fog`);
      close(got.grade.keyValue, kv, `${id} keyValue`); close(got.grade.contrast, ct, `${id} contrast`); close(got.grade.saturation, sat, `${id} saturation`);
      // absorption green / clarity: clear 0.062, tropical 0.045, murky ½ (0.062 + 0.62) / 2
      const g = { A1: (0.062 + 0.62) / 2, A3: 0.045, A9: 0.045 }[id] ?? 0.062;
      close(got.absorptionG, g / cl, `${id} absorption`, 1e-5);
    }
    assert.deepEqual(errors, [], 'anchors: no page errors');
    report.push(`anchors: 9/9 match spec §3.2 (sky, sea, fog, grade, sun from t) (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
    await page.close();
  }

  let readablePage = null;
  if (ONLY.has('field') || ONLY.has('readable')) {
    const ts = performance.now();
    // the day set before the tiles load
    const early = await open(TILES);
    const loadedAtSet = await early.page.evaluate(() => { const l = app.tiles.loaded; app.mood.set(1, -1, 0.05); return l; });
    await early.page.waitForFunction(() => app.tiles.loaded, {}, { timeout: 120000 });
    const cEarly = await early.page.evaluate(() => app.tiles.center.toArray());
    assert.deepEqual(early.errors, [], 'field (early): no page errors');
    await early.page.close();
    // the day set after
    const late = await open(TILES);
    await late.page.waitForFunction(() => app.tiles.loaded, {}, { timeout: 120000 });
    const cLate = await late.page.evaluate(() => app.tiles.center.toArray());
    const cAfter = await late.page.evaluate(() => (app.mood.set(-1, 1, 0.95), app.tiles.center.toArray()));
    const dEarly = Math.hypot(...cEarly.map((x, i) => x - cLate[i])), dAfter = Math.hypot(...cAfter.map((x, i) => x - cLate[i]));
    if (ONLY.has('field')) {
      assert.equal(loadedAtSet, false, 'field: the early set lands before the tiles have loaded');
      assert.ok(dEarly < 1e-6 && dAfter < 1e-6, `field moved: early Δ ${dEarly} m, after Δ ${dAfter} m`);
      report.push(`field: t 0.05 before load vs t 0.95 after — centre Δ ${dEarly.toExponential(1)} m / ${dAfter.toExponential(1)} m `
        + `at (${cLate.map((x) => x.toFixed(1)).join(', ')}) (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
    }
    readablePage = late;
  }

  if (ONLY.has('readable')) {
    const ts = performance.now();
    const { page, errors } = readablePage;
    await page.evaluate(() => app.still({ shot: 'Tiles', frames: 1 }));
    const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const rows = [], fails = [];
    // first the world as it opens today (the Tiles shot, the Controls' own sky): the floor's reference
    const cases = [{ id: 'default', v: null, a: null, t: null }];
    for (const [id, [v, a]] of Object.entries(ANCHORS)) for (const t of [0.05, 0.5, 0.95]) cases.push({ id, v, a, t });
    const pickCases = process.env.PROBE_CASES ? new Set(process.env.PROBE_CASES.split(',')) : null;
    for (const { id, v, a, t } of cases.filter((c) => !pickCases || pickCases.has(c.id))) {
        const shots = await page.evaluate(async ([mv, ma, mt, settle]) => {
          if (mv !== null) app.mood.set(mv, ma, mt);
          // the tile colours: instanceColor on the polygons, the vertex colours on the polylines
          const colours = [], mats = new Set();
          app.tiles.group.traverse((o) => {
            if (!o.isMesh) return;
            mats.add(o.material);
            const attr = o.instanceColor ?? o.geometry.getAttribute('color');
            if (attr) colours.push([attr, attr.array.slice()]);
          });
          const refl = app.quality.reflections;
          const grab = (frames, dt) => app.still({ frames, dt });
          const frame = await grab(settle, 1 / 60);
          app.quality.reflections = false;
          const A = await grab(1, 1e-6);
          mats.forEach((m) => m.color.setScalar(0));
          const C = await grab(1, 1e-6);
          mats.forEach((m) => m.color.setScalar(1));
          colours.forEach(([attr]) => { attr.array.fill(1); attr.needsUpdate = true; });
          const Wt = await grab(1, 1e-6);
          colours.forEach(([attr, orig]) => { attr.array.set(orig); attr.needsUpdate = true; });
          app.quality.reflections = refl;
          return { frame: frame.rgba, A: A.rgba, C: C.rgba, W: Wt.rgba, width: frame.width, height: frame.height };
        }, [v, a, t, SETTLE]);
        const [F, A, C, Wt] = [shots.frame, shots.A, shots.C, shots.W].map((s) => Buffer.from(s, 'base64'));
        const W = shots.width, H = shots.height, n = W * H;
        // per pixel: 1 white tile, 2 black tile, 0 neither (water, a colour, an edge)
        const cls = new Uint8Array(n);
        const sad = (X, Y, i) => Math.abs(X[i] - Y[i]) + Math.abs(X[i + 1] - Y[i + 1]) + Math.abs(X[i + 2] - Y[i + 2]);
        for (let p = 0; p < n; p++) {
          const i = p * 4, span = sad(Wt, C, i);
          if (span < 45) continue;                       // the albedo barely shows here: not a lit tile face
          const tol = Math.max(9, 0.15 * span);          // post grain is 1–3/255 per channel
          cls[p] = sad(A, Wt, i) <= tol ? 1 : sad(A, C, i) <= tol ? 2 : 0;
        }
        const white = [], black = [];
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const p = y * W + x, c = cls[p];
          if (!c || cls[p - 1] !== c || cls[p + 1] !== c || cls[p - W] !== c || cls[p + W] !== c) continue;   // interior only
          const i = p * 4;
          (c === 1 ? white : black).push(luma(F[i], F[i + 1], F[i + 2]));
        }
        white.sort((x, y) => x - y); black.sort((x, y) => x - y);
        const q = (s, f) => s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN;
        const r = { id, t: t ?? NaN, white: q(white, 0.5), black: q(black, 0.5), wP10: q(white, 0.1), bP90: q(black, 0.9), nw: white.length, nb: black.length };
        const small = Math.min(r.nw, r.nb) < 300;
        rows.push(r);
        if (id === 'default') continue;
        if (small) fails.push(`${id} t ${t}: too few tile pixels (white ${r.nw}, black ${r.nb})`);
        else if (!(r.white >= 0.55 && r.black <= 0.25)) fails.push(`${id} t ${t}: white ${r.white.toFixed(3)}, black ${r.black.toFixed(3)}`);
    }
    assert.deepEqual(errors, [], 'readable: no page errors');
    report.push('readable (median sRGB luma; P10 white / P90 black; mask px):');
    for (const r of rows) {
      report.push(`  ${r.id}${Number.isNaN(r.t) ? ' (Tiles shot, no mood)' : ` t ${r.t.toFixed(2)}`}: white ${r.white.toFixed(3)} (P10 ${r.wP10.toFixed(3)}), black ${r.black.toFixed(3)} `
        + `(P90 ${r.bP90.toFixed(3)}); ${r.nw}/${r.nb} px${Math.min(r.nw, r.nb) < 300 ? '  ← FAIL (too few px)' : r.white >= 0.55 && r.black <= 0.25 ? '' : '  ← FAIL'}`);
    }
    const graded = rows.filter((r) => r.id !== 'default');
    const minW = Math.min(...graded.map((r) => r.white)), maxB = Math.max(...graded.map((r) => r.black));
    report.push(`readable: ${graded.length - fails.length}/${graded.length} pass; min white ${minW.toFixed(3)}, max black ${maxB.toFixed(3)} `
      + `(${((performance.now() - ts) / 1000).toFixed(1)} s)`);
    await page.close();
    assert.deepEqual(fails, [], 'readability floor (spec §6 p.5)');
  } else await readablePage?.page.close();

  console.log(report.join('\n'));
  console.log(`probe-mood-m1a PASS ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.log(report.join('\n'));
  throw e;
} finally {
  await browser.close();
}
