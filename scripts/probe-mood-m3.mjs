// MOOD-WEATHER M3: the widget's content (spec §4.1, §4.2).
//   1. desktop, uk — the first open: the invitation whole, «спокій · умиротворення» under the window
//      (§6 p.7), the four edge words and the arc's three, nine pictures; no digits, no inputs
//      (§6 p.9); a mouse over the window names the anchor; a click on the A9/A6 border shows the
//      first word of each; the first gesture folds the invitation to its first sentence, it is
//      still there on the next open (§6 p.12) and a touch unfolds it; the thumbnail follows the
//      state; the ring fills monotonically while the world is on its way and goes at rest.
//   2. desktop, en — the language follows navigator.languages: «calm · peace», English names.
//   3. phones — a long press names the anchor and the name goes after release; the sheet with the
//      invitation unfolded and folded fits the screen above the rail.
// Expected strings come from the spec (§3.1, §4.2), not from moodPad.js. Needs the stand on
// localhost:5199. Writes nothing.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
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
// what the widget shows: the words on top, the invitation, the name, the edges, the boxes
const view = (page) => page.evaluate(() => {
  const root = document.getElementById('moodPad');
  const q = (s) => root.querySelector(s);
  const rect = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  const invite = q('.mood-invite');
  return {
    words: q('.mood-words span.on')?.textContent ?? '',
    wordsOpacity: Number(getComputedStyle(q('.mood-words span.on')).opacity),
    invite: { text: invite.innerText.trim(), short: invite.classList.contains('short'), visible: visible(invite) && rect(invite).height > 0,
      expanded: invite.getAttribute('aria-expanded') },
    name: { text: q('.mood-name').textContent, show: q('.mood-name').classList.contains('show') },
    edges: [...root.querySelectorAll('.mood-edge')].map((e) => e.textContent),
    day: [...root.querySelectorAll('.mood-day-words text')].map((e) => e.textContent),
    cells: root.querySelectorAll('.mood-cell').length, motifs: root.querySelectorAll('.mood-motifs g[data-anchor]').length,
    thumb: q('.mood-thumb').style.background, moving: root.classList.contains('moving'),
    ring: Number(q('.mood-ring').style.getPropertyValue('--progress') || 'NaN'),
    text: root.textContent, inputs: root.querySelectorAll('input').length,
    attrs: [...root.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' '),
    pad: rect(q('.mood-window')), panel: rect(q('.mood-panel')), wordsBox: rect(q('.mood-words')),
    rail: rect(document.getElementById('stationRail')), hidden: q('.mood-panel').hidden, inner: [innerWidth, innerHeight],
  };
});
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const within = (r, [w, h]) => r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h;
const inside = (r, o) => r.left >= o.left - 0.5 && r.top >= o.top - 0.5 && r.right <= o.right + 0.5 && r.bottom <= o.bottom + 0.5;
// a point of the window for (v, a) — the spec's axes (§4.2): x cloudy → clear, y wind → quiet
const at = (pad, v, a) => ({ x: pad.left + ((v + 1) / 2) * pad.width, y: pad.top + ((1 - a) / 2) * pad.height });
const FIRST_UK = 'Зробіть вдих і довгий видих.';

try {
  // ── 1. desktop, uk ──────────────────────────────────────────────────────────────────
  {
    const ts = performance.now();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'uk-UA' });
    const page = await open(context, '?desktop&controls');
    const thumb0 = (await view(page)).thumb;
    await page.click('#moodPad .mood-button');
    await page.waitForTimeout(700);
    let s = await view(page);
    assert.ok(!s.hidden, 'open after a click');
    assert.equal(s.words, 'спокій · умиротворення', 'A9 words on the first open (§6 p.7)');
    assert.ok(s.wordsOpacity > 0.99, `the words are shown (${s.wordsOpacity})`);
    assert.ok(s.invite.visible && !s.invite.short && s.invite.text.startsWith(FIRST_UK) && s.invite.text.includes('Оберіть погоду'),
      `the invitation whole on the first open: «${s.invite.text}»`);
    assert.deepEqual([...s.edges].sort(), ['вітер', 'тиша', 'хмарно', 'ясно'].sort(), 'four edge words');
    assert.deepEqual(s.day, ['світанок', 'полудень', 'захід'], 'the arc\'s words');
    assert.equal(s.cells, 9, 'nine pictures'); assert.equal(s.motifs, 9, 'nine motifs');
    assert.ok(!/\d/.test(s.text + s.attrs), `no digits in the widget: «${s.text}»`);
    assert.equal(s.inputs, 0, 'no inputs (no sliders) in the widget');
    assert.ok(inside(s.wordsBox, s.panel), 'the words inside the panel');

    // a mouse over the centre names A5; leaving hides it; over the top-left — A1
    let p = at(s.pad, 0, 0);
    await page.mouse.move(p.x, p.y);
    s = await view(page);
    assert.ok(s.name.show && s.name.text === 'Сонце з-за хмар', `hover over the centre → «${s.name.text}» ${s.name.show}`);
    p = at(s.pad, -0.9, 0.9);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    assert.equal((await view(page)).name.text, 'Шторм', 'hover top-left → Шторм');
    await page.mouse.move(10, 10);
    assert.equal((await view(page)).name.show, false, 'leaving the window hides the name');

    // a click on the A9/A6 border: the first word of each, A9's first (nearer)
    p = at(s.pad, 1, -0.53);
    await page.mouse.click(p.x - 1, p.y);
    await page.waitForTimeout(700);
    s = await view(page);
    assert.equal(s.words, 'спокій · задоволення', 'the A9/A6 border shows the first word of each (§4.2)');
    assert.ok(s.invite.short && s.invite.text === FIRST_UK, `the first gesture folds the invitation: «${s.invite.text}»`);
    assert.equal(s.invite.expanded, 'false');

    // into A6: its own two words, crossfaded
    p = at(s.pad, 0.9, 0);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(700);
    assert.equal((await view(page)).words, 'задоволення · вдячність', 'A6 words');

    // the next open: the invitation is still there (folded); a touch unfolds it (§6 p.12)
    await page.click('#moodPad .mood-button');
    await page.click('#moodPad .mood-button');
    s = await view(page);
    assert.ok(s.invite.visible && s.invite.text === FIRST_UK, `the invitation on the next open: «${s.invite.text}»`);
    await page.click('#moodPad .mood-invite');
    s = await view(page);
    assert.ok(!s.invite.short && s.invite.text.includes('Оберіть погоду'), 'a touch unfolds the invitation');

    // the ring: A9 at rest → no ring; A9 → A1 smoothly — the ring fills monotonically
    await page.evaluate(() => app.mood.set(1, -1, 0.5));
    await page.waitForTimeout(400);
    s = await view(page);
    assert.ok(!s.moving, 'at rest: no ring');
    const thumbA9 = s.thumb;
    await page.evaluate(() => app.mood.to(-1, 1));
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1000);
      samples.push(await page.evaluate(() => ({ p: app.mood.state().progress, ring: document.querySelector('#moodPad').classList.contains('moving') })));
    }
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i].p >= samples[i - 1].p - 1e-6, `progress monotonic: ${samples.map((x) => x.p.toFixed(3))}`);
    assert.ok(samples[0].p > 0 && samples[0].p < 0.5 && samples.at(-1).p > samples[0].p, `progress grows: ${samples.map((x) => x.p.toFixed(3))}`);
    assert.ok(samples.every((x) => x.ring), 'the ring shows while the world moves');
    s = await view(page);
    assert.ok(Math.abs(s.ring - samples.at(-1).p) < 0.1, `the ring draws the progress (${s.ring} vs ${samples.at(-1).p})`);
    assert.notEqual(s.thumb, thumbA9, 'the thumbnail follows the chosen weather');
    assert.notEqual(thumbA9, thumb0, 'the thumbnail follows the time of day');
    await page.evaluate(() => app.mood.set(-1, 1));
    await page.waitForTimeout(400);
    assert.equal((await view(page)).moving, false, 'at the target the ring goes');
    await context.close();
    report.push(`desktop uk: first open — invitation whole, «спокій · умиротворення», 4 edge + 3 arc words, 9 pictures, `
      + `no digits; hover names A5/A1; border A9/A6 → «спокій · задоволення»; invitation folds, stays, unfolds; `
      + `ring ${samples.map((x) => x.p.toFixed(2)).join('→')} (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
  }

  // ── 2. desktop, en ──────────────────────────────────────────────────────────────────
  {
    const ts = performance.now();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
    const page = await open(context, '?desktop');
    await page.click('#moodPad .mood-button');
    await page.waitForTimeout(700);
    let s = await view(page);
    assert.equal(s.words, 'calm · peace', 'en: A9 words');
    assert.ok(s.invite.text.startsWith('Breathe in'), `en invitation: «${s.invite.text}»`);
    assert.deepEqual([...s.edges].sort(), ['clear', 'cloudy', 'quiet', 'wind'], 'en edge words');
    const p = at(s.pad, -1, 1);
    await page.mouse.click(p.x + 2, p.y + 2);
    await page.mouse.move(p.x + 20, p.y + 20);
    await page.waitForTimeout(700);
    s = await view(page);
    assert.equal(s.words, 'tension · too much at once', 'en: A1 words');
    assert.equal(s.name.text, 'Storm', 'en: the name on hover');
    await context.close();
    report.push(`desktop en: «calm · peace», «tension · too much at once», Storm (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
  }

  // ── 3. phones ───────────────────────────────────────────────────────────────────────
  for (const vp of PHONES) {
    const ts = performance.now();
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2,
      hasTouch: true, isMobile: true, locale: 'uk-UA' });
    const page = await open(context, '?mobile');
    await page.tap('#moodPad .mood-button');
    await page.waitForTimeout(500);
    let s = await view(page);
    const fits = (what) => {
      assert.equal(overlap(s.panel, s.rail), 0, `${vp.name} ${what}: the sheet does not cover the rail`);
      assert.ok(within(s.panel, s.inner), `${vp.name} ${what}: the sheet fits the screen ${JSON.stringify(s.panel)}`);
      assert.ok(inside(s.wordsBox, s.panel), `${vp.name} ${what}: the words inside the sheet`);
    };
    assert.ok(!s.invite.short, `${vp.name}: the invitation whole on the first open`);
    fits('invitation unfolded');
    const unfolded = Math.round(s.panel.height);

    // a long press (no move) names the anchor under the finger; it goes after release
    const cdp = await context.newCDPSession(page);
    const p = at(s.pad, 0, -1);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: p.x, y: p.y - 4 }]);
    await page.waitForTimeout(250);
    assert.equal((await view(page)).name.show, false, `${vp.name}: no name before the long press`);
    await page.waitForTimeout(450);
    s = await view(page);
    assert.ok(s.name.show && s.name.text === 'Тихо й хмарно', `${vp.name}: a long press names A8: «${s.name.text}» ${s.name.show}`);
    await touch('touchEnd', []);
    await page.waitForTimeout(1600);
    s = await view(page);
    assert.equal(s.name.show, false, `${vp.name}: the name goes after release`);
    assert.equal(s.words, 'втома · задумливість', `${vp.name}: A8 words`);
    assert.ok(s.invite.short, `${vp.name}: the gesture folds the invitation`);
    fits('invitation folded');
    report.push(`${vp.name} ${vp.width}×${vp.height}: sheet ${unfolded} → ${Math.round(s.panel.height)} px high, window `
      + `${Math.round(s.pad.width)} px, long press → «Тихо й хмарно» (${((performance.now() - ts) / 1000).toFixed(1)} s)`);
    await context.close();
  }

  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
}
for (const line of report) console.log(line);
console.log(`probe-mood-m3 PASS (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
