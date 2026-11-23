// SCENE-UI U4: the shore map on a GPU without OES_texture_float_linear. On the owner's
// phone (Chrome Android) a 32-bit float colour texture with a linear filter is incomplete
// and samples as 0: the shore map read depth 0 over its whole 1800 m square. Desktop GPUs
// have the extension, so the square itself cannot be reproduced here. What can:
// - a WebGL tracker lists every R/RG/RGB/RGBA32F texture whose min or mag filter is
//   linear at the moment it is sampled by a draw — the textures a phone would read as 0.
//   Depth textures (the floater shadow, compare mode) are not colour formats and are
//   complete in core WebGL2. After U4 the list is empty; before it — shore, travel, surf.
// - with the extension hidden from three, the station still renders without errors.
// Works on the dev stand and on a deploy (PROBE_BASE); names are not needed.
// PROBE_SHOTS=<dir> also saves the «Island» station with and without the extension.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const SHOTS = process.env.PROBE_SHOTS;
const START_TIMEOUT = 120000;
const EXT = 'OES_texture_float_linear';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
const t0 = performance.now();

// Runs in the page before any script. hide: the phone's WebGL, everything but the
// extension. The tracker keeps (internal format, filters, compare mode) per texture and,
// on every draw, records float32 colour textures bound with a linear filter.
function trackFloatLinear({ ext, hide }) {
  const C = WebGL2RenderingContext.prototype;
  if (hide) {
    const get = C.getExtension, list = C.getSupportedExtensions;
    C.getExtension = function (name) { return name === ext ? null : get.call(this, name); };
    C.getSupportedExtensions = function () { return (list.call(this) ?? []).filter((n) => n !== ext); };
  }
  const F32 = { 0x822e: 'R32F', 0x8230: 'RG32F', 0x8815: 'RGB32F', 0x8814: 'RGBA32F' };
  const LINEAR = new Set([0x2601, 0x2701, 0x2702, 0x2703]); // LINEAR, *_MIPMAP_* except NEAREST_MIPMAP_NEAREST
  const info = new Map(), bound = new Map();   // texture → state; unit → TEXTURE_2D texture
  const bad = new Map();                        // texture → 'RGBA32F 512x512'
  let unit = 0;
  const of = (gl) => bound.get(unit);
  const wrap = (name, fn) => { const orig = C[name]; C[name] = function (...a) { fn.call(this, a); return orig.apply(this, a); }; };
  wrap('activeTexture', ([u]) => { unit = u; });
  wrap('bindTexture', ([target, tex]) => {
    if (target !== 0x0de1) return;
    bound.set(unit, tex);
    if (tex && !info.has(tex)) info.set(tex, { fmt: 0, min: 0x2702, mag: 0x2601, compare: 0, size: '' });
  });
  wrap('texStorage2D', ([target, , fmt, w, h]) => { const t = info.get(of()); if (target === 0x0de1 && t) Object.assign(t, { fmt, size: `${w}x${h}` }); });
  wrap('texImage2D', ([target, level, fmt, w, h]) => {
    const t = info.get(of());
    if (target === 0x0de1 && t && level === 0 && typeof w === 'number') Object.assign(t, { fmt, size: `${w}x${h}` });
  });
  wrap('texParameteri', ([target, pname, v]) => {
    const t = info.get(of());
    if (target !== 0x0de1 || !t) return;
    if (pname === 0x2801) t.min = v; else if (pname === 0x2800) t.mag = v; else if (pname === 0x884c) t.compare = v;
  });
  const check = () => {
    for (const tex of bound.values()) {
      const t = tex && info.get(tex);
      if (t && F32[t.fmt] && !t.compare && (LINEAR.has(t.min) || t.mag === 0x2601)) bad.set(tex, `${F32[t.fmt]} ${t.size}`);
    }
  };
  for (const d of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) wrap(d, check);
  window.__floatLinear = () => [...bad.values()];
}

async function run(name, hide) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(trackFloatLinear, { ext: EXT, hide });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForFunction(() => window.app?.stations, {}, { timeout: START_TIMEOUT });
  const arrived = await page.evaluate(() => app.stations.go('island'));
  await page.waitForTimeout(1500);
  const r = await page.evaluate((ext) => {
    const u = app.surface.uniforms;
    const shape = (t) => ({ type: t.type, min: t.minFilter, mag: t.magFilter, data: t.image.data.constructor.name });
    return { ext: app.renderer.extensions.has(ext), station: app.stations.current, floatLinear: window.__floatLinear(),
      shore: shape(u.uShore.value), travel: shape(u.uTravel.value), surf: shape(u.uSurf.value) };
  }, EXT);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `island-${name}.png`) });
  await context.close();
  report[name] = { ext: r.ext, arrived, station: r.station, floatLinear: r.floatLinear,
    textures: [r.shore, r.travel, r.surf].map((t) => `${t.type}/${t.min}/${t.mag}/${t.data}`) };
  return { ...r, arrived };
}

try {
  const desktop = await run('desktop', false);
  const phone = await run('no-float-linear', true);
  assert.equal(desktop.ext, true, 'desktop GPU has OES_texture_float_linear (else the probe compares nothing)');
  assert.equal(phone.ext, false, 'the extension is hidden from three');
  for (const r of [desktop, phone]) {
    assert.equal(r.arrived, true, 'arrived at «Island»');
    for (const t of [r.shore, r.travel, r.surf]) {
      assert.deepEqual([t.type, t.min, t.mag, t.data], [1016, 1006, 1006, 'Uint16Array'], 'HalfFloatType + LinearFilter, half data');
    }
  }
  for (const r of [desktop, phone]) assert.deepEqual(r.floatLinear, [], 'no float32 colour texture is sampled with a linear filter');
  assert.deepEqual(errors, [], 'page errors');
  report.verdict = 'PASS';
} catch (e) {
  report.verdict = 'FAIL';
  report.error = e.message;
  process.exitCode = 1;
} finally {
  report.errors = errors;
  report.seconds = Math.round((performance.now() - t0) / 1000);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
