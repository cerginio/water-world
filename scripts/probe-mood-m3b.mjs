// MOOD-WEATHER M3b: behaviour and safety (spec §4.3, §4.6).
//   1. desktop, uk — the first open: the day's flow off (§6 p.11), «Quiet down» hidden at A9,
//      three role="slider" with the spec's names, the words in a polite live region, no digits;
//      the keyboard: the arc ←/→ 0.05 of the day, the window's arrows 0.25 (the window points at
//      the slider its last arrow moved), Enter to the nearest anchor, Esc folds and gives the
//      focus back to the button.
//   2. «Quiet down» from A1 — the world reaches A9 in 25 ± 5 s (95 % of every channel, frame
//      clock), the time of day does not change (§6 p.4); the button goes once the pebble is quiet.
//   3. the day's flow — on from the morning it walks the sun to sunset in 20 ± 1 min (a compressed
//      clock, app.mood.flowScale) and switches itself off (§6 p.11); a touch on the arc during the
//      flow moves the sun and the flow goes on from there.
//   4. prefers-reduced-motion — the pebble in A1 gives the sea of a = 0.3: wind ≤ 11, waves ≤ 0.21
//      (§6 p.6, owner 2026-11-24); τ ×1.5; the setting changing on the open page is followed.
// Expected numbers come from the spec (§3.2 anchors, §4.3, §4.4, §4.6), not from main.js.
// Needs the stand on localhost:5199. Writes nothing. ~100 s.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199/';
// spec §3.2: A9 and A1
const A9 = { windSpeed: 1.5, waveScale: 0.04, cloudCoverage: 0.12, sunIntensity: 9, turbidity: 1.6, keyValue: 0.2, saturation: 1.3 };
const A1 = { windSpeed: 22, waveScale: 0.45, cloudCoverage: 0.95, sunIntensity: 7, turbidity: 5, keyValue: 0.12, saturation: 0.8 };
// A4 → A1 at a = 0.3 (spec §3.3 bilinear): the reduced-motion sea in A1
const A1_REDUCED = { windSpeed: 6 + 0.3 * (22 - 6), waveScale: 0.1 + 0.3 * (0.45 - 0.1) };

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
// every rendered frame for `seconds` of the frame clock (sum of dt, capped at 0.1 s a frame, as in
// probe-mood-m2) after `start` runs in the page; `until` (code) may end it early
const record = (page, start, seconds, until = 'false') => page.evaluate(async ([code, secs, stop]) => {
  const { env, ocean, post } = window.app;
  const frames = [];
  let clock = 0;
  const oceanUpdate = ocean.update;
  ocean.update = function (dt, ...rest) { clock += dt; return oceanUpdate.call(this, dt, ...rest); };
  // eslint-disable-next-line no-new-func
  new Function('app', code)(window.app);
  // eslint-disable-next-line no-new-func
  const done = new Function('app', `return (${stop});`);
  const begin = performance.now();
  clock = 0;
  await new Promise((resolve) => {
    const tick = () => {
      const p = env.params, o = ocean.params, g = post.params, s = window.app.mood.state();
      frames.push({ t: clock, windSpeed: o.windSpeed, waveScale: o.waveScale,
        cloudCoverage: p.cloudCoverage, sunIntensity: p.sunIntensity, turbidity: p.turbidity,
        elevation: p.elevation, azimuth: p.azimuth, keyValue: g.keyValue, saturation: g.saturation,
        day: s.t, flow: s.flow });
      if (clock < secs && !done(window.app) && performance.now() - begin < secs * 4000) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  ocean.update = oceanUpdate;
  return { frames, state: window.app.mood.state() };
}, [start, seconds, until]);
const close = (a, b, what, eps) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const widget = (page) => page.evaluate(() => {
  const root = document.getElementById('moodPad'), q = (s) => root.querySelector(s);
  return {
    hidden: q('.mood-panel').hidden,
    quiet: getComputedStyle(q('.mood-quiet')).visibility === 'visible',
    flow: q('.mood-flow').getAttribute('aria-pressed'),
    sliders: [...root.querySelectorAll('[role="slider"]')].map((e) => ({ label: e.getAttribute('aria-label'), text: e.getAttribute('aria-valuetext') })),
    active: q('.mood-window').getAttribute('aria-activedescendant'),
    live: [...root.querySelectorAll('[aria-live]')].map((e) => ({ mode: e.getAttribute('aria-live'), text: e.textContent })),
    focus: document.activeElement?.className?.baseVal ?? document.activeElement?.className ?? '',
    text: root.textContent, attrs: [...root.querySelectorAll('[aria-label], [aria-valuetext], [title]')]
      .map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('aria-valuetext') ?? ''} ${e.getAttribute('title') ?? ''}`).join(' '),
  };
});
const state = (page) => page.evaluate(() => app.mood.state());

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'uk-UA' });
  const page = await open(context, '?desktop&controls');

  // ── 1. the first open, ARIA, the keyboard ──────────────────────────────────────────────
  {
    await page.click('#moodPad .mood-button');
    await page.waitForTimeout(400);
    let w = await widget(page);
    assert.equal(w.flow, 'false', 'the day\'s flow is off after the first open (§6 p.11)');
    assert.equal((await state(page)).flow, false, 'state: flow off');
    assert.equal(w.quiet, false, '«Затихнути» hidden at A9 (a ≤ 0.3)');
    assert.deepEqual(w.sliders.map((x) => x.label), ['Час доби', 'Ясно — хмарно', 'Тиша — вітер'], 'three role="slider" (§4.6)');
    assert.deepEqual(w.sliders.map((x) => x.text), ['ранок', 'ясно', 'тиша'], 'the sliders say where they are in words');
    assert.ok(w.live.length === 1 && w.live[0].mode === 'polite' && w.live[0].text === 'спокій · умиротворення', `the words are a polite live region: ${JSON.stringify(w.live)}`);
    assert.ok(!/\d/.test(w.text + w.attrs), `no digits in the widget's text and labels: «${w.text}» «${w.attrs}»`);

    // the arc: ←/→ 0.05 of the day
    await page.focus('#moodPad .mood-arc');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    close((await state(page)).t, 0.2, 'arc → → from 0.1', 1e-9);
    await page.keyboard.press('ArrowLeft');
    close((await state(page)).t, 0.15, 'arc ← ', 1e-9);
    // the window: ↑ 0.25 of wind, ← 0.25 cloudier; the window points at the moved slider
    await page.focus('#moodPad .mood-window');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
    let s = await state(page);
    close(s.a, 0, 'window ↑ ×4 from quiet', 1e-9);
    w = await widget(page);
    assert.equal(w.active, 'moodSliderA', 'the window points at «Тиша — вітер» after ↑');
    assert.equal(w.quiet, false, '«Затихнути» still hidden at a = 0');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    s = await state(page);
    close(s.a, 0.5, 'window ↑ ×6', 1e-9);
    close(s.v, 0.75, 'window ←', 1e-9);
    w = await widget(page);
    assert.equal(w.active, 'moodSliderV', 'the window points at «Ясно — хмарно» after ←');
    assert.equal(w.quiet, true, '«Затихнути» shows at a = 0.5 (> 0.3)');
    await page.keyboard.press('Enter');
    s = await state(page);
    assert.ok(s.v === 1 && s.a === 1 && s.anchor === 'A3', `Enter → the nearest anchor A3: ${s.v}, ${s.a} ${s.anchor}`);
    await page.keyboard.press('Escape');
    w = await widget(page);
    assert.ok(w.hidden, 'Esc folds the widget');
    assert.match(String(w.focus), /mood-button/, 'the focus goes back to the button');
    // from the button Enter opens, Tab goes into the panel: the invitation, then the arc
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.match(String((await widget(page)).focus), /mood-invite/, 'Tab from the button goes into the open panel');
    await page.keyboard.press('Tab');
    assert.match(String((await widget(page)).focus), /mood-arc/, 'then to the arc');
    await page.keyboard.press('Escape');
    report.push('first open: flow off, «Затихнути» hidden, 3 sliders («ранок», «ясно», «тиша»), polite words, no digits; '
      + 'keys: arc 0.1→0.2→0.15, window a −1→0→0.5, v 1→0.75, Enter → A3, Esc folds → button');
  }

  // ── 2. «Quiet down» from A1 ─────────────────────────────────────────────────────────────
  {
    await page.evaluate(() => app.mood.set(-1, 1, 0.3));
    await page.waitForFunction(() => !app.env.dirty);
    await page.click('#moodPad .mood-button');
    await page.waitForTimeout(300);
    assert.equal((await widget(page)).quiet, true, '«Затихнути» shows in A1');
    const sun0 = await page.evaluate(() => ({ e: app.env.params.elevation, a: app.env.params.azimuth }));
    const { frames, state: s } = await record(page, "document.querySelector('#moodPad .mood-quiet').click()", 34);
    assert.equal(s.anchor, 'A9', 'the target is A9 at once');
    close(s.t, 0.3, 'the time of day does not change (§6 p.4)', 1e-12);
    let slowest = 0, worst = '';
    for (const k of Object.keys(A9)) {
      const range = A9[k] - A1[k];
      close(frames[0][k] - A1[k], 0, `${k} starts at A1`, Math.abs(range) * 0.05);
      const at = frames.find((f) => (f[k] - A1[k]) / range >= 0.95)?.t ?? Infinity;
      slowest = Math.max(slowest, at);
      worst += ` ${k} ${at.toFixed(1)}s`;
      // spec §4.4: «Затихнути» — τ 8 for all the weather, so every channel arrives at ~3τ = 24 s
      // (a plain move would bring the sky at 18 s and the sea at 30 s — still inside 25 ± 5)
      assert.ok(Math.abs(at - 24) <= 1.5, `${k}: 95 % at ${at.toFixed(1)} s, τ 8 → 24 s`);
    }
    assert.ok(slowest >= 20 && slowest <= 30, `the world reaches A9 in 25 ± 5 s (95 %): the slowest channel at ${slowest.toFixed(1)} s;${worst}`);
    const drift = Math.max(...frames.map((f) => Math.max(Math.abs(f.elevation - sun0.e), Math.abs(f.azimuth - sun0.a))));
    assert.ok(drift < 1e-6, `the sun stays: ${drift}° at most`);
    assert.equal((await widget(page)).quiet, false, '«Затихнути» goes once the pebble is quiet');
    report.push(`«Затихнути» A1→A9: 95 % at${worst}; slowest ${slowest.toFixed(1)} s (25 ± 5); sun moved ${drift}°`);
  }

  // ── 3. the day's flow ───────────────────────────────────────────────────────────────────
  {
    const SCALE = 120;
    await page.evaluate(() => app.mood.set(1, -1, 0.1));
    await page.waitForFunction(() => !app.env.dirty);
    await page.evaluate((k) => { app.mood.flowScale = k; }, SCALE);
    const { frames, state: s } = await record(page, "document.querySelector('#moodPad .mood-flow').click()", 14, '!app.mood.state().flow');
    const end = frames.find((f) => !f.flow);
    assert.ok(frames[0].flow, 'the toggle switches the flow on');
    assert.ok(end, `the flow switches itself off at sunset (ran ${frames.at(-1).t.toFixed(1)} s)`);
    const minutes = (end.t * SCALE) / 60 / 0.9;            // 0.1 → 1 is 0.9 of the day
    assert.ok(Math.abs(minutes - 20) <= 1, `dawn → sunset takes 20 ± 1 min: ${minutes.toFixed(2)} min`);
    assert.equal(s.t, 1, 'the sun stops at sunset');
    assert.equal(s.flow, false, 'state: flow off');
    assert.equal((await widget(page)).flow, 'false', 'the toggle shows off');
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].azimuth >= frames[i - 1].azimuth - 1e-6, `the sun walks west: frame ${i}`);
    await page.waitForTimeout(1500);
    assert.equal((await state(page)).t, 1, 'no jump back to dawn');

    // a touch on the arc during the flow: the sun goes there and the flow goes on from it
    await page.evaluate(() => app.mood.set(1, -1, 0.1));
    await page.click('#moodPad .mood-flow');
    await page.waitForTimeout(500);
    const arc = await page.evaluate(() => { const b = document.querySelector('#moodPad .mood-arc').getBoundingClientRect(); return { x: b.left, y: b.top, k: b.width / 240 }; });
    await page.mouse.click(arc.x + 120 * arc.k, arc.y + 12 * arc.k);           // the top of the arc: noon
    const a = await state(page);
    await page.waitForTimeout(1500);
    const b = await state(page);
    assert.ok(Math.abs(a.t - 0.5) < 0.02 && a.flow, `a touch moves the sun to noon, the flow stays on: ${a.t.toFixed(3)} ${a.flow}`);
    assert.ok(b.t > a.t + 0.05 && b.flow, `the flow goes on from noon: ${a.t.toFixed(3)} → ${b.t.toFixed(3)}`);
    await page.click('#moodPad .mood-flow');
    assert.equal((await state(page)).flow, false, 'the toggle switches it off');
    await page.evaluate(() => { app.mood.flowScale = 1; });
    report.push(`flow ×${SCALE}: 0.1 → sunset in ${end.t.toFixed(2)} s = ${minutes.toFixed(2)} min a day, off at sunset, stays at 1; `
      + `touch at noon ${a.t.toFixed(3)} → ${b.t.toFixed(3)} still flowing`);
  }
  await context.close();

  // ── 4. prefers-reduced-motion ───────────────────────────────────────────────────────────
  {
    const rm = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'uk-UA', reducedMotion: 'reduce' });
    const p = await open(rm, '?desktop&controls');
    await p.evaluate(() => app.mood.set(-1, 1, 0.5));
    await p.waitForFunction(() => !app.env.dirty);
    const sea = await p.evaluate(() => ({ s: app.mood.state(), wind: app.ocean.params.windSpeed, waves: app.ocean.params.waveScale }));
    assert.ok(sea.s.reduced && sea.s.a === 1 && sea.s.worldA === 0.3, `the pebble in A1, the world at a = 0.3: ${JSON.stringify({ a: sea.s.a, worldA: sea.s.worldA })}`);
    assert.ok(sea.wind <= 11 && sea.waves <= 0.21, `A1 under reduced motion: wind ${sea.wind} ≤ 11, waves ${sea.waves} ≤ 0.21 (§6 p.6)`);
    close(sea.wind, A1_REDUCED.windSpeed, 'the wind of a = 0.3', 0.05);

    // τ ×1.5: A9 → A1 — after 6 s the wind has gone 1 − e^(−6/15) ≈ 33 % of the way (not 45 %)
    await p.evaluate(() => app.mood.set(1, -1, 0.5));
    await p.waitForFunction(() => !app.env.dirty);
    const { frames } = await record(p, 'app.mood.to(-1, 1)', 6.2);
    const f6 = frames.find((f) => f.t >= 6);
    const share = (f6.windSpeed - A9.windSpeed) / (A1_REDUCED.windSpeed - A9.windSpeed);
    assert.ok(Math.abs(share - (1 - Math.exp(-6 / 15))) < 0.05, `the sea τ 15 s: ${(share * 100).toFixed(1)} % at 6 s`);

    // the setting goes off on the open page: the world follows the pebble up to A1
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.waitForTimeout(500);
    const after = await state(p);
    assert.ok(!after.reduced && after.worldA === 1, `reduced motion off → the world's a = 1: ${after.worldA}`);
    await rm.close();
    report.push(`reduced motion: A1 → wind ${sea.wind.toFixed(2)}, waves ${sea.waves.toFixed(3)}; τ ×1.5 — ${(share * 100).toFixed(1)} % at 6 s; off → a 1`);
  }
  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
}
for (const line of report) console.log(line);
console.log(`probe-mood-m3b PASS (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
