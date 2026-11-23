// SCENE-UI U3 (SCENE-UI-SPEC §4.6): the station rail on a phone. Per viewport: the rail
// spans the width with 16 px margins and stands 16 px over the bottom, a free slot for
// the round weather button (56 px) on its right, every touch target ≥ 44×44 px, the rail,
// the F2/F3 strip and a bottom #perf do not overlap. Then: aria (nav label, buttons,
// aria-current on the station only), a keyboard Tab shows a visible focus ring and Enter
// flies, a tap flies, the labels and `lang` follow the browser's language (uk / en).
// Needs the stand on localhost:5199. safe-area-inset-* cannot be emulated in Chromium:
// it is 0 here, a notched phone is the owner's eyes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
const START_TIMEOUT = 120000;
const MARGIN = 16, WEATHER = 56, GAP = 8, TOUCH = 44;
const VIEWPORTS = [
  { name: 'nord4', width: 412, height: 915, locale: 'uk-UA' },
  { name: 'narrow', width: 360, height: 780, locale: 'en-US' },
  { name: 'landscape', width: 915, height: 412, locale: 'en-US' },
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const report = {}, errors = [];
const t0 = performance.now();

async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.app?.stations, {}, { timeout: START_TIMEOUT });
  await page.waitForTimeout(500);
  return page;
}

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2,
      hasTouch: true, isMobile: true, locale: vp.locale });
    const page = await open(context, '?fps');
    await page.evaluate(() => app.techPanels.toggle('strip'));
    const r = await page.evaluate(({ WEATHER: weather, GAP: gap }) => {
      const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const railEl = document.getElementById('stationRail');
      const rail = rect(railEl), strip = rect(document.getElementById('techStrip')), perf = rect(document.getElementById('perf'));
      // the weather slot: right of the rail, at its height
      const slot = { left: rail.right + gap, right: rail.right + gap + weather, top: rail.bottom - weather, bottom: rail.bottom };
      const slotHit = document.elementFromPoint((slot.left + slot.right) / 2, (slot.top + slot.bottom) / 2);
      const targets = [...document.querySelectorAll('#stationRail .station, #techStrip button')].map((b) => {
        const x = rect(b);
        return { name: b.dataset.station ?? b.textContent, width: Math.round(x.width), height: Math.round(x.height) };
      });
      return { strip, perf, mobile: document.body.classList.contains('mobile'), inner: [innerWidth, innerHeight], rail, slot,
        slotFree: slotHit?.tagName === 'CANVAS', slotInView: slot.right <= innerWidth,
        targets, overlaps: [overlap(rail, strip), overlap(rail, perf), overlap(strip, perf)],
        stripInView: strip.top >= 0 && perf.top >= 0,
        lang: railEl.lang, labels: [...railEl.querySelectorAll('.label')].map((l) => l.textContent),
        navLabel: railEl.getAttribute('aria-label'), tag: railEl.tagName,
        buttons: [...railEl.querySelectorAll('.station')].map((b) => [b.tagName, b.type, b.getAttribute('aria-label')]) };
    }, { WEATHER, GAP });
    report[vp.name] = { rail: [Math.round(r.rail.left), Math.round(r.rail.right), Math.round(r.rail.bottom)],
      targets: r.targets.map((t) => `${t.width}×${t.height}`).join(' '), overlaps: r.overlaps,
      strip: [Math.round(r.strip.top), Math.round(r.strip.bottom)], perf: [Math.round(r.perf.top), Math.round(r.perf.bottom)], lang: r.lang, labels: r.labels };
    assert.equal(r.mobile, true, `${vp.name}: mobile profile`);
    assert.ok(near(r.rail.left, MARGIN), `${vp.name}: rail left ${r.rail.left}`);
    assert.ok(near(r.rail.bottom, vp.height - MARGIN), `${vp.name}: rail bottom ${r.rail.bottom}`);
    assert.ok(near(r.rail.right, vp.width - MARGIN - WEATHER - GAP), `${vp.name}: rail right ${r.rail.right}`);
    assert.ok(r.slotInView && r.slotFree, `${vp.name}: the weather slot is free and on screen`);
    for (const t of r.targets) assert.ok(t.width >= TOUCH && t.height >= TOUCH, `${vp.name}: ${t.name} ${t.width}×${t.height}`);
    assert.deepEqual(r.overlaps, [0, 0, 0], `${vp.name}: rail / strip / perf overlap`);
    assert.ok(r.stripInView, `${vp.name}: strip and perf on screen`);
    assert.equal(r.tag, 'NAV');
    const uk = vp.locale.startsWith('uk');
    assert.equal(r.lang, uk ? 'uk' : 'en');
    assert.deepEqual(r.labels, uk ? ['Острів', 'Берег', 'Історія', 'Мить'] : ['Island', 'Shore', 'Story', 'Moment']);
    assert.equal(r.navLabel, uk ? 'Опорні точки камери' : 'Camera stations');
    for (const [tag, type, label] of r.buttons) assert.deepEqual([tag, type, Boolean(label)], ['BUTTON', 'button', true]);

    if (vp.name === 'nord4') {
      // a tap flies to «Берег»: aria-current on it alone
      await page.tap('#stationRail .station[data-station="shore"]');
      await page.waitForFunction(() => app.stations.current === 'shore'
        && document.querySelector('#stationRail [data-station="shore"]').hasAttribute('aria-current'), {}, { timeout: 15000 });
      const current = await page.evaluate(() => [...document.querySelectorAll('#stationRail [aria-current]')]
        .map((b) => [b.dataset.station, b.getAttribute('aria-current')]));
      assert.deepEqual(current, [['shore', 'location']]);
      // no tiles: story and frame say why they are off
      const off = await page.evaluate(() => [...document.querySelectorAll('#stationRail [aria-disabled="true"]')]
        .map((b) => b.getAttribute('aria-label')));
      assert.deepEqual(off, ['Історія — Історію не завантажено', 'Мить — Історію не завантажено']);
      report.tap = { current, off };
    }
    if (vp.name === 'narrow') {
      // keyboard: Tab reaches the first station with a visible ring, Enter flies there
      let focus = null;
      for (let i = 0; i < 12 && !focus?.station; i++) {
        await page.keyboard.press('Tab');
        focus = await page.evaluate(() => {
          const el = document.activeElement, cs = getComputedStyle(el);
          return { station: el.dataset?.station ?? null, visible: el.matches(':focus-visible'),
            outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` };
        });
      }
      assert.equal(focus.station, 'island', 'Tab reaches «Island» first');
      assert.ok(focus.visible && focus.outline.startsWith('solid 2px'), `focus ring: ${focus.outline}`);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => app.stations.current === 'island', {}, { timeout: 15000 });
      report.keyboard = focus;
    }
    await page.close();
    await context.close();
  }
  assert.deepEqual(errors, []);
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(report, null, 1));
  console.log('PASS probe-scene-mobile');
} catch (error) {
  console.log(JSON.stringify({ report, errors }, null, 1));
  console.error('FAIL probe-scene-mobile:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
