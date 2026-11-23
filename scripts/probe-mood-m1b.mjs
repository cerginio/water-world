// MOOD-WEATHER M1b: the widget (spec §4.1, §4.2 without content, §4.5).
//   1. desktop — the round button right of the rail; the first open shows morning + A9 (§6 p.2),
//      half transparent while the world is the Controls' own; no digits and no range inputs in
//      the widget's DOM (§6 p.9); dragging the pebble moves the sea at once and the sky only on
//      release; a tap moves the pebble there; the sun drags along the arc and stops at its ends;
//      a Controls slider makes the state custom, the next touch hands it back.
//   2. phone — the bottom sheet stands above the rail, fits the screen, the window is square
//      and ≤ 320 px; a tap in the window sets the mood.
// Expected numbers come from the spec (window corners = corner anchors, §3.1; sun = §2.2), not
// from moodPad.js. Needs the stand on localhost:5199. Writes nothing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const sunAt = (t) => ({ elevation: -2 + 62 * Math.sin(Math.PI * t), azimuth: 205 - 180 * (1 - t) });   // spec §2.2
const PHONES = [
  { name: 'nord4', width: 412, height: 915 },
  { name: 'narrow', width: 360, height: 780 },
  { name: 'landscape', width: 915, height: 412 },
];

const t0 = performance.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = [], errors = [];
async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(new URL(query, BASE).href);
  await page.waitForFunction(() => window.app?.mood && document.getElementById('moodPad'), {}, { timeout: 120000 });
  await page.waitForTimeout(300);
  return page;
}
// the widget's geometry on screen: the window, the arc box, the pebble and sun centres
const geometry = (page) => page.evaluate(() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
  const root = document.getElementById('moodPad');
  const pad = rect(root.querySelector('.mood-window')), arc = rect(root.querySelector('.mood-arc'));
  return { pad, arc, button: rect(root.querySelector('.mood-button')), panel: rect(root.querySelector('.mood-panel')),
    rail: rect(document.getElementById('stationRail')),
    pebble: centre(rect(root.querySelector('.mood-pebble'))), sun: centre(rect(root.querySelector('.mood-sun'))),
    hidden: root.querySelector('.mood-panel').hidden, custom: root.querySelector('.mood-panel').classList.contains('custom'),
    opacity: Number(getComputedStyle(root.querySelector('.mood-pebble')).opacity), inner: [innerWidth, innerHeight] };
});
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const within = (r, [w, h]) => r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h;
const close = (a, b, what, eps) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
// the arc of the widget: an ellipse over the box's bottom; its ends and top in screen pixels
const arcAt = (g, t) => {
  const k = g.arc.width / 240, cx = 120, cy = 60, rx = 104, ry = 48, th = Math.PI * (1 - t);
  return { x: g.arc.left + (cx + rx * Math.cos(th)) * k, y: g.arc.top + (cy - ry * Math.sin(th)) * k };
};

try {
  // ── 1. desktop ──────────────────────────────────────────────────────────────────────
  {
    const ts = performance.now();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await open(context, '?desktop&controls');
    let g = await geometry(page);
    assert.ok(g.hidden, 'collapsed at start');
    close(g.button.width, 56, 'button size', 0.5);
    assert.ok(g.button.left >= g.rail.right && overlap(g.button, g.rail) === 0, `button right of the rail: ${JSON.stringify([g.button, g.rail])}`);
    const before = await page.evaluate(() => ({ s: app.mood.state(), cc: app.env.params.cloudCoverage }));
    assert.equal(before.s.custom, true, 'the world starts as the Controls\' own');

    // first open: morning and A9, half transparent (custom), the world untouched
    await page.click('#moodPad .mood-button');
    g = await geometry(page);
    assert.ok(!g.hidden, 'open after a click');
    assert.ok(g.custom && Math.abs(g.opacity - 0.45) < 0.01, `custom → half transparent: ${g.custom} ${g.opacity}`);
    close(g.pad.width, 240, 'window 240 px', 0.5); close(g.pad.height, 240, 'window square', 0.5);
    close(g.pebble.x, g.pad.right, 'A9 pebble x (clear)', 1); close(g.pebble.y, g.pad.bottom, 'A9 pebble y (quiet)', 1);
    const sun01 = arcAt(g, 0.1);
    close(g.sun.x, sun01.x, 'sun at t 0.1, x', 1); close(g.sun.y, sun01.y, 'sun at t 0.1, y', 1);
    assert.ok(overlap(g.panel, g.rail) === 0 && within(g.panel, g.inner), 'panel above the rail, on screen');
    const dom = await page.evaluate(() => {
      const root = document.getElementById('moodPad');
      return { text: root.textContent, inputs: root.querySelectorAll('input').length,
        attrs: [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ') };
    });
    assert.ok(!/\d/.test(dom.text + dom.attrs), `no digits in the widget: «${dom.text}» / «${dom.attrs}»`);
    assert.equal(dom.inputs, 0, 'no inputs (no sliders) in the widget');
    assert.equal((await page.evaluate(() => app.env.params.cloudCoverage)), before.cc, 'opening does not touch the world');

    // drag the pebble A9 → A1: the sea follows the finger, the sky waits for the release
    await page.mouse.move(g.pebble.x, g.pebble.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(g.pebble.x - (i / 8) * 260, g.pebble.y - (i / 8) * 260);
    const mid = await page.evaluate(() => ({ s: app.mood.state(), cc: app.env.params.cloudCoverage, wind: app.ocean.params.windSpeed }));
    assert.equal(mid.cc, before.cc, 'sky not re-baked while the finger is down');
    close(mid.wind, 22, 'sea follows the finger (A1 wind)', 1e-6);
    assert.equal(mid.s.custom, false, 'a touch hands the world to the widget');
    await page.mouse.up();
    const a1 = await page.evaluate(() => ({ s: app.mood.state(), cc: app.env.params.cloudCoverage, dirty: app.env.dirty }));
    assert.deepEqual([a1.s.v, a1.s.a, a1.s.anchor], [-1, 1, 'A1'], 'released past the top-left corner → A1');
    close(a1.cc, 0.95, 'sky baked on release (A1 cloud)', 1e-6);
    g = await geometry(page);
    assert.ok(!g.custom && g.opacity === 1, 'opaque once the widget owns the world');
    close(g.pebble.x, g.pad.left, 'A1 pebble x', 1); close(g.pebble.y, g.pad.top, 'A1 pebble y', 1);

    // a tap moves the pebble there: the centre is A5
    await page.mouse.click((g.pad.left + g.pad.right) / 2, (g.pad.top + g.pad.bottom) / 2);
    const a5 = await page.evaluate(() => app.mood.state());
    assert.equal(a5.anchor, 'A5', 'tap in the centre → A5');
    assert.ok(Math.abs(a5.v) < 0.01 && Math.abs(a5.a) < 0.01, `centre → (0, 0): ${a5.v}, ${a5.a}`);

    // the sun: from t 0.1 to the top of the arc → noon; past the right end → sunset, no further
    g = await geometry(page);
    const top = arcAt(g, 0.5);
    await page.mouse.move(g.sun.x, g.sun.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(g.sun.x + (i / 6) * (top.x - g.sun.x), g.sun.y + (i / 6) * (top.y - g.sun.y));
    await page.mouse.up();
    const noon = await page.evaluate(() => ({ s: app.mood.state(), e: { ...app.env.params } }));
    close(noon.s.t, 0.5, 'sun dragged to the top → noon', 0.01);
    close(noon.e.elevation, sunAt(noon.s.t).elevation, 'noon elevation', 1e-6);
    assert.equal(noon.s.anchor, 'A5', 'the day leaves the weather alone');
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(g.arc.right + 80, g.arc.bottom + 60, { steps: 6 });
    await page.mouse.up();
    const dusk = await page.evaluate(() => ({ s: app.mood.state(), e: { ...app.env.params } }));
    assert.equal(dusk.s.t, 1, 'past the right end the sun stops at sunset');
    close(dusk.e.elevation, -2, 'sunset elevation', 1e-6); close(dusk.e.azimuth, 205, 'sunset azimuth', 1e-6);

    // a Controls slider → custom; the next touch hands the world back
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lil-gui .lil-controller')].find((x) => x.querySelector('.lil-name')?.textContent === 'cloudCoverage');
      const input = c.querySelector('input');
      input.value = '0.7';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const hand = await page.evaluate(() => ({ s: app.mood.state(), cc: app.env.params.cloudCoverage }));
    close(hand.cc, 0.7, 'the slider wrote the sky', 1e-6);
    assert.equal(hand.s.custom, true, 'a Controls change → custom');
    g = await geometry(page);
    assert.ok(g.custom && Math.abs(g.opacity - 0.45) < 0.01, 'custom → half transparent again');
    await page.mouse.click(g.pad.right - 2, g.pad.bottom - 2);
    const back = await page.evaluate(() => ({ s: app.mood.state(), cc: app.env.params.cloudCoverage }));
    assert.equal(back.s.custom, false, 'the next touch → not custom');
    assert.equal(back.s.anchor, 'A9', 'bottom-right → A9');
    close(back.cc, 0.12, 'A9 sky after the touch (2 px from the corner)', 0.02);

    // a Tiles change is not the mood's business
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.lil-gui .lil-controller')].find((x) => x.querySelector('.lil-name')?.textContent === 'fieldYaw');
      const input = c.querySelector('input');
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal((await page.evaluate(() => app.mood.state().custom)), false, 'a Tiles slider leaves the mood alone');

    await page.click('#moodPad .mood-button');
    assert.ok((await geometry(page)).hidden, 'a second click collapses');
    await context.close();
    report.push(`desktop: button ${g.button.width}px right of the rail; first open t 0.1 + A9, custom ½; drag A9→A1 `
      + `(sea live, sky on release); tap → A5; sun → noon → stops at sunset; Controls → custom → touch → A9 `
      + `(${((performance.now() - ts) / 1000).toFixed(1)} s)`);
  }

  // ── 2. phones ───────────────────────────────────────────────────────────────────────
  for (const vp of PHONES) {
    const ts = performance.now();
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2,
      hasTouch: true, isMobile: true, locale: 'uk-UA' });
    const page = await open(context, '?mobile');
    let g = await geometry(page);
    await page.tap('#moodPad .mood-button');
    g = await geometry(page);
    assert.ok(!g.hidden, `${vp.name}: open after a tap`);
    assert.equal(overlap(g.panel, g.rail), 0, `${vp.name}: the sheet does not cover the rail ${JSON.stringify([g.panel, g.rail])}`);
    assert.ok(g.panel.bottom <= g.rail.top, `${vp.name}: the sheet stands above the rail`);
    assert.ok(within(g.panel, g.inner), `${vp.name}: the sheet fits the screen ${JSON.stringify(g.panel)}`);
    close(g.pad.width, g.pad.height, `${vp.name}: window square`, 0.5);
    assert.ok(g.pad.width <= 320.5, `${vp.name}: window ≤ 320 px (${g.pad.width})`);
    close(g.panel.left, 8, `${vp.name}: sheet spans the width (left)`, 0.5);
    close(g.panel.right, vp.width - 8, `${vp.name}: sheet spans the width (right)`, 0.5);
    await page.touchscreen.tap(g.pad.left + 2, g.pad.top + 2);
    const s = await page.evaluate(() => app.mood.state());
    assert.equal(s.anchor, 'A1', `${vp.name}: a tap top-left → A1`);
    assert.equal(s.custom, false, `${vp.name}: the tap hands the world to the widget`);
    const lang = await page.evaluate(() => document.getElementById('moodPad').lang);
    assert.equal(lang, 'uk', `${vp.name}: the widget's language follows the browser`);
    report.push(`${vp.name} ${vp.width}×${vp.height}: sheet ${Math.round(g.panel.width)}×${Math.round(g.panel.height)} above the rail, `
      + `window ${Math.round(g.pad.width)} px, tap → A1 (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
    await context.close();
  }

  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
}
for (const line of report) console.log(line);
console.log(`probe-mood-m1b PASS (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
