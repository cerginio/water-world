// SCENE-ENVIRONMENT E3: the LDR output on env-demo.html (spec §5.4, §7 п.5–6). The page is set up like
// three's viewer (sRGB canvas, NoToneMapping, HemisphereLight + DirectionalLight); window.envDemo
// samples single pixels of the page texture (white paper / #141414 print) on three sheets: the
// "frame" on MeshBasicMaterial (as three draws frames), the same page on MeshStandardMaterial
// standing toward the camera and lying flat. Checked:
//   - §7 п.6: renderer.toneMapping is NoToneMapping before and after createEnvironment and stays so;
//   - §7 п.5: under all nine anchors at t 0.05, 0.5, 0.95 (MOOD-WEATHER §6 п.5 points) the frame's
//     white ≥ 0.55 and black ≤ 0.25 sRGB (luminance of the canvas bytes) — and the lit sheets too,
//     with env.ldrLights() (the hemisphere; the IBL variant is reported, not checked);
//   - §7 п.5: at the clear noon (A6, t 0.5) the frame matches three's current page (ref=three) with
//     ΔE76 ≤ 2; the standing sheet too (the same hemisphere); the lying one is reported (its sun
//     comes from the environment's noon direction, not three's (-10, 20, -8)).
// PROBE_BASE=<url> (default the local stand).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const WHITE = 0.55, BLACK = 0.25, DE = 2;
const DAY = [0.05, 0.5, 0.95];
const ANCHORS = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((v) => [v, a]));
const SHEETS = ['frame', 'standing', 'lying'];

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
/** sRGB of the pixel's luminance */
const luma = ([r, g, b]) => srgb(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
function lab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(new URL('env-demo.html', BASE).href, { timeout: 60_000 });
  await page.waitForFunction(() => window.envDemo?.ready, null, { timeout: 60_000 });

  // §7 п.6
  const tm = await page.evaluate(() => ({ ...envDemo.toneMapping, now: envDemo.toneMapping.now(), output: envDemo.env.output }));
  assert.equal(tm.output, 'ldr');
  assert.equal(tm.before, 0, 'NoToneMapping set by the page');
  assert.equal(tm.after, tm.before, 'createEnvironment leaves renderer.toneMapping');

  const run = (withIbl) => page.evaluate(async ({ anchors, day, ibl }) => {
    envDemo.setRef(false); envDemo.setIbl(ibl);
    const rows = [];
    for (const [v, a] of anchors) for (const t of day) {
      envDemo.set(v, a, t);
      rows.push({ v, a, t, s: envDemo.sample() });
    }
    return rows;
  }, { anchors: ANCHORS, day: DAY, ibl: withIbl });

  /** @param {Awaited<ReturnType<typeof run>>} rows */
  const extremes = (rows) => Object.fromEntries(SHEETS.map((k) => {
    const w = rows.map((r) => ({ x: luma(r.s[`${k}White`]), at: `${r.v},${r.a} t${r.t}` }));
    const b = rows.map((r) => ({ x: luma(r.s[`${k}Black`]), at: `${r.v},${r.a} t${r.t}` }));
    const minW = w.reduce((m, e) => (e.x < m.x ? e : m)), maxB = b.reduce((m, e) => (e.x > m.x ? e : m));
    return [k, { minW, maxB }];
  }));
  const fmt = (e) => Object.entries(e).map(([k, { minW, maxB }]) =>
    `${k} white ≥ ${minW.x.toFixed(3)} (${minW.at}), black ≤ ${maxB.x.toFixed(3)} (${maxB.at})`).join('; ');

  const hemi = extremes(await run(false));
  console.log(`hemisphere, 9 anchors × t ${DAY.join('/')}: ${fmt(hemi)}`);
  for (const k of SHEETS) {
    assert.ok(hemi[k].minW.x >= WHITE, `${k}: white ${hemi[k].minW.x.toFixed(3)} < ${WHITE} at ${hemi[k].minW.at}`);
    assert.ok(hemi[k].maxB.x <= BLACK, `${k}: black ${hemi[k].maxB.x.toFixed(3)} > ${BLACK} at ${hemi[k].maxB.at}`);
  }
  const ibl = extremes(await run(true));
  console.log(`IBL (reported): ${fmt(ibl)}`);

  // ΔE at the clear noon against three today
  const noon = async (asThree) => page.evaluate((r) => { envDemo.setIbl(false); envDemo.setRef(r); envDemo.set(1, 0, 0.5); return envDemo.sample(); }, asThree);
  const ours = await noon(false), three = await noon(true);
  const de = Object.fromEntries(Object.keys(ours).map((k) => [k, dE(ours[k], three[k])]));
  console.log(`clear noon ΔE76 vs three: ${Object.entries(de).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
  for (const k of ['frameWhite', 'frameBlack', 'standingWhite', 'standingBlack']) assert.ok(de[k] <= DE, `${k}: ΔE ${de[k].toFixed(2)} > ${DE}`);

  assert.equal(await page.evaluate(() => envDemo.toneMapping.now()), 0, 'toneMapping still NoToneMapping');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`PASS probe-scene-env-ldr ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
}
