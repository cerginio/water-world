// The mood weather widget (MOOD-WEATHER-SPEC §4.1, §4.2, §4.5): a round 56 px button that opens
// the sun's arc over the weather window. The pebble in the window is the weather (x → valence:
// cloudy … clear, y → arousal: wind at the top … quiet at the bottom), the sun on the arc is the
// time of day (dawn on the left … sunset on the right).
//
// M1b: the button, the arc, the window, the pebble. M3: the content — the nine anchors'
// illustrations, the four edge words and the arc's three, the emotional words under the window
// (the nearest anchor's; on the border of two cells the first word of each, crossfaded), the
// anchor's name on hover or a long press, the invitation (collapses to its first sentence after
// the first gesture of the session, a touch opens it again), the thumbnail and the progress ring
// on the button, uk/en. «Quiet down», the day's flow, the keyboard and ARIA sliders come in M3b.
//
// No numbers and no range inputs (spec §6 p.9).
//
// The widget owns no world state. The host gives `get()` → { t, v, a, custom } and takes
// `input({ t, v, a }, final)`: `final` is false while a finger moves and true on release.
// `custom` (spec §4.5) — the Controls changed the world by hand: the pebble and the sun are
// shown half transparent until the next touch, which hands the world back to the widget.
// The host reports how far the world is on its way with `progress(p)`, p ∈ [0, 1] (1 at rest).
//
// Portable like the rest of src/environment/ (guard BOUNDARY-2): imports only its own folder.
import { MOOD_MAP_V1 } from '../mood.js';

/** the arc's SVG box; the window's width equals ARC_W in the same units; the words sit under the arc */
export const ARC_W = 240, ARC_H = 84;
const ARC = { cx: ARC_W / 2, cy: 60, rx: ARC_W / 2 - 16, ry: 48 };

/** on the border of two cells, this close to it (in v/a units) both anchors' first words show */
export const WORDS_BORDER = 0.1;
/** a touch held this long without moving shows the anchor's name (spec §4.2) */
const LONG_PRESS_MS = 500, LONG_PRESS_SLOP = 8, NAME_LINGER_MS = 1200;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/**
 * A point in the weather window → mood. x left → right is cloudy → clear, y top → bottom is
 * wind → quiet; outside the window it clamps to the edge.
 * @param {number} x @param {number} y pixels from the window's top-left corner
 * @param {number} size the window's side in pixels
 */
export function padToMood(x, y, size) {
  return { v: clamp((2 * x) / size - 1, -1, 1), a: clamp(1 - (2 * y) / size, -1, 1) };
}

/** mood → the point in the window, as shares of its side (0 … 1) */
export function moodToPad(v, a) {
  return { x: (clamp(v, -1, 1) + 1) / 2, y: (1 - clamp(a, -1, 1)) / 2 };
}

/** the sun on the arc at day t ∈ [0, 1], in the arc's SVG units */
export function arcPoint(t) {
  const th = Math.PI * (1 - clamp(t, 0, 1));
  return { x: ARC.cx + ARC.rx * Math.cos(th), y: ARC.cy - ARC.ry * Math.sin(th) };
}

/**
 * A point near the arc (SVG units) → the day under it: the angle seen from the arc's centre.
 * Below the arc's ends it clamps to dawn or sunset (spec §4.3: the arc does not go past them).
 */
export function arcToDay(x, y) {
  const th = Math.atan2((ARC.cy - y) / ARC.ry, (x - ARC.cx) / ARC.rx);
  const c = th < 0 ? (th < -Math.PI / 2 ? Math.PI : 0) : th;
  return 1 - c / Math.PI;
}

/** the grid cell of the anchor nearest to (v, a): row by a (−1, 0, +1), column by v, as in MOOD_MAP_V1 */
export function nearestCell(v, a) {
  return { row: Math.round(clamp(a, -1, 1) + 1), col: Math.round(clamp(v, -1, 1) + 1) };
}

/**
 * Whose words show under the window (spec §4.2, §6 p.7): the nearest anchor; within
 * WORDS_BORDER of a cell border, the nearest two (nearest first) — each gives its first word.
 * @returns {{ row: number, col: number }[]} one or two cells
 */
export function wordsCells(v, a, border = WORDS_BORDER) {
  const x = clamp(v, -1, 1) + 1, y = clamp(a, -1, 1) + 1;
  const home = nearestCell(v, a);
  const near = (/** @type {number} */ p, /** @type {number} */ c) => {
    const side = p >= c ? 1 : -1, other = c + side;       // the border is half way to `other`
    return other >= 0 && other <= 2 && Math.abs(p - (c + side / 2)) < border ? other : c;
  };
  const cols = [...new Set([home.col, near(x, home.col)])], rows = [...new Set([home.row, near(y, home.row)])];
  const cells = rows.flatMap((row) => cols.map((col) => ({ row, col, d: Math.hypot(x - col, y - row) })));
  cells.sort((p, q) => p.d - q.d || (p.row === home.row && p.col === home.col ? -1 : 1));
  return cells.slice(0, 2).map(({ row, col }) => ({ row, col }));
}

/** the anchors' words on screen: one anchor — both its words; two — the first word of each */
export function wordsText(/** @type {{ row: number, col: number }[]} */ cells, /** @type {(key: string) => string} */ word) {
  const anchors = cells.map(({ row, col }) => MOOD_MAP_V1.grid[row][col]);
  return (anchors.length === 1 ? anchors[0].words : anchors.map((m) => m.words[0])).map(word).join(' · ');
}

const mixRgb = (/** @type {number[]} */ p, /** @type {number[]} */ q, f) => p.map((x, i) => x + (q[i] - x) * f);
const css = (/** @type {number[]} */ c) => `rgb(${c.map((x) => Math.round(clamp(x, 0, 1) * 255)).join(' ')})`;

/**
 * The colours of a small picture of the world (spec §4.1): sky over sea. Valence clears the sky
 * and turns the sea turquoise, arousal darkens the sea, the ends of the day warm the horizon.
 * An illustration, not the renderer's colours.
 */
export function moodColors(v, a, t) {
  const clear = (clamp(v, -1, 1) + 1) / 2, wind = (clamp(a, -1, 1) + 1) / 2;
  const warm = (1 - Math.sin(Math.PI * clamp(t, 0, 1))) ** 2;
  let skyTop = mixRgb([0.46, 0.49, 0.53], [0.2, 0.46, 0.82], clear);
  let skyLow = mixRgb([0.72, 0.74, 0.76], [0.66, 0.83, 0.95], clear);
  skyTop = mixRgb(skyTop, [0.26, 0.29, 0.5], warm * 0.5);
  skyLow = mixRgb(skyLow, [1, 0.68, 0.44], warm * 0.75);
  let sea = mixRgb([0.33, 0.4, 0.44], [0.1, 0.6, 0.68], clear);
  sea = mixRgb(sea, [0.14, 0.21, 0.26], wind * 0.4);
  return { skyTop: css(skyTop), skyLow: css(skyLow), sea: css(sea), seaDeep: css(sea.map((x) => x * 0.55)) };
}

const LOCALES = {
  uk: {
    button: 'Погода й час доби', arc: 'Час доби', pad: 'Погода',
    day: ['світанок', 'полудень', 'захід'],
    edges: { wind: 'вітер', quiet: 'тиша', cloudy: 'хмарно', clear: 'ясно' },
    invite: ['Зробіть вдих і довгий видих.', 'Спрямуйте внутрішній зір на те, що ви відчуваєте.',
      'Оберіть погоду, яка відповідає вашому стану або стану, до якого ви хотіли б прийти.'],
    names: { storm: 'Шторм', 'torn-clouds': 'Рвані хмари', breeze: 'Бриз', overcast: 'Похмуро',
      'sun-through-clouds': 'Сонце з-за хмар', 'warm-sun': 'Тепле сонце', fog: 'Туман',
      'quiet-cloudy': 'Тихо й хмарно', calm: 'Штиль' },
    words: { tension: 'напруга', 'too-much': 'забагато всього', excitement: 'хвилювання', focus: 'зібраність',
      joy: 'радість', energy: 'енергія', sadness: 'смуток', heaviness: 'важкість', balance: 'рівновага',
      ordinary: 'звичайно', contentment: 'задоволення', gratitude: 'вдячність', muted: 'приглушено',
      distant: 'віддалено', tiredness: 'втома', pensiveness: 'задумливість', calm: 'спокій', peace: 'умиротворення' },
  },
  en: {
    button: 'Weather and time of day', arc: 'Time of day', pad: 'Weather',
    day: ['dawn', 'noon', 'sunset'],
    edges: { wind: 'wind', quiet: 'quiet', cloudy: 'cloudy', clear: 'clear' },
    invite: ['Breathe in, and breathe out slowly.', 'Turn your inner eye to what you feel.',
      'Choose the weather that matches your state, or the state you would like to reach.'],
    names: { storm: 'Storm', 'torn-clouds': 'Torn clouds', breeze: 'Breeze', overcast: 'Overcast',
      'sun-through-clouds': 'Sun through clouds', 'warm-sun': 'Warm sun', fog: 'Fog',
      'quiet-cloudy': 'Quiet and cloudy', calm: 'Calm' },
    words: { tension: 'tension', 'too-much': 'too much at once', excitement: 'excitement', focus: 'focus',
      joy: 'joy', energy: 'energy', sadness: 'sadness', heaviness: 'heaviness', balance: 'balance',
      ordinary: 'ordinary', contentment: 'contentment', gratitude: 'gratitude', muted: 'muted',
      distant: 'distant', tiredness: 'tiredness', pensiveness: 'pensiveness', calm: 'calm', peace: 'peace' },
  },
};
/** the strings of both locales, for the unit test that every key of the map has its words */
export const MOOD_LOCALES = LOCALES;

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (/** @type {string} */ tag, /** @type {Record<string, string | number>} */ attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, String(val));
  return el;
};

// ── the anchors' pictures: simple SVG motifs in a 300×300 box, one per anchor (spec §4.2) ────
const INK = '#f4f1ea';
const cloud = (/** @type {number} */ x, /** @type {number} */ y, s, fill = INK, op = 0.85) => {
  const g = svgEl('g', { transform: `translate(${x} ${y}) scale(${s})`, fill, opacity: op });
  for (const [cx, cy, r] of [[-14, 4, 10], [0, -4, 14], [15, 3, 11]]) g.append(svgEl('circle', { cx, cy, r }));
  g.append(svgEl('rect', { x: -24, y: 3, width: 50, height: 11, rx: 5.5 }));
  return g;
};
const sun = (x, y, r, fill = '#fff1c2', glow = 0.35) => {
  const g = svgEl('g');
  g.append(svgEl('circle', { cx: x, cy: y, r: r * 1.9, fill, opacity: glow }), svgEl('circle', { cx: x, cy: y, r, fill }));
  return g;
};
const wave = (x, y, w, amp, op = 0.8) => {
  let d = `M ${x - w / 2} ${y}`;
  for (let i = 0; i < 4; i++) d += ` q ${w / 8} ${-amp} ${w / 4} 0`;
  return svgEl('path', { d, fill: 'none', stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: op });
};
const line = (x1, y1, x2, y2, op = 0.6, width = 2.2) =>
  svgEl('line', { x1, y1, x2, y2, stroke: INK, 'stroke-width': width, 'stroke-linecap': 'round', opacity: op });

/** @type {Record<string, (x: number, y: number) => SVGElement[]>} keyed by the anchor's name key */
const MOTIFS = {
  storm: (x, y) => [cloud(x, y - 14, 1.15, '#4a525c', 0.95), line(x - 22, y + 8, x - 30, y + 20), line(x - 4, y + 8, x - 12, y + 20),
    line(x + 14, y + 8, x + 6, y + 20), wave(x, y + 30, 56, 12)],
  'torn-clouds': (x, y) => [cloud(x - 14, y - 16, 0.6), cloud(x + 16, y - 6, 0.55), wave(x, y + 22, 52, 8),
    svgEl('circle', { cx: x + 18, cy: y + 12, r: 2, fill: INK, opacity: 0.8 }), svgEl('circle', { cx: x + 24, cy: y + 8, r: 1.6, fill: INK, opacity: 0.7 })],
  breeze: (x, y) => [sun(x + 12, y - 16, 9), cloud(x - 12, y - 6, 0.5), wave(x, y + 20, 50, 6)],
  overcast: (x, y) => [svgEl('rect', { x: x - 34, y: y - 26, width: 68, height: 20, rx: 10, fill: '#cfd3d6', opacity: 0.75 }),
    cloud(x + 6, y - 10, 0.7, '#dde0e2', 0.8), line(x - 24, y + 20, x + 24, y + 20, 0.55)],
  'sun-through-clouds': (x, y) => [sun(x + 8, y - 16, 10), cloud(x - 4, y - 6, 0.7), wave(x, y + 20, 48, 4, 0.7)],
  'warm-sun': (x, y) => [sun(x, y - 12, 12, '#ffd98a', 0.4), line(x - 16, y + 16, x - 4, y + 16, 0.8), line(x + 2, y + 22, x + 16, y + 22, 0.7),
    line(x - 8, y + 28, x + 6, y + 28, 0.6)],
  fog: (x, y) => [line(x - 30, y - 14, x + 26, y - 14, 0.55, 5), line(x - 22, y - 2, x + 32, y - 2, 0.45, 5),
    line(x - 32, y + 10, x + 20, y + 10, 0.5, 5), line(x - 20, y + 22, x + 28, y + 22, 0.35, 5)],
  'quiet-cloudy': (x, y) => [svgEl('ellipse', { cx: x - 8, cy: y - 18, rx: 26, ry: 4, fill: INK, opacity: 0.6 }),
    svgEl('ellipse', { cx: x + 12, cy: y - 8, rx: 22, ry: 3.5, fill: INK, opacity: 0.5 }), line(x - 26, y + 18, x + 26, y + 18, 0.6)],
  calm: (x, y) => [sun(x, y - 14, 9), line(x - 28, y + 8, x + 28, y + 8, 0.7),
    svgEl('ellipse', { cx: x, cy: y + 16, rx: 7, ry: 2.5, fill: '#fff1c2', opacity: 0.7 })],
};
/** a motif's centre: the anchor's place, kept far enough from the window's edge to be whole */
const MOTIF_AT = [48, 150, 252];

/**
 * @param {{ get: () => { t: number, v: number, a: number, custom: boolean },
 *   input: (state: { t: number, v: number, a: number }, final: boolean) => void,
 *   language?: string, parent?: HTMLElement }} options
 */
export function createMoodPad({ get, input, language = 'en', parent = document.body }) {
  const lang = LOCALES[language] ? language : 'en';
  const text = LOCALES[lang];
  const anchorAt = (/** @type {{ row: number, col: number }} */ c) => MOOD_MAP_V1.grid[c.row][c.col];
  const root = document.createElement('div');
  root.id = 'moodPad';
  root.lang = lang;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mood-button';
  button.setAttribute('aria-label', text.button);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'moodPanel');
  const thumb = document.createElement('span');
  thumb.className = 'mood-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('span');
  ring.className = 'mood-ring';
  ring.setAttribute('aria-hidden', 'true');
  button.append(ring, thumb);

  const panel = document.createElement('div');
  panel.id = 'moodPanel';
  panel.className = 'mood-panel';
  panel.hidden = true;

  // the invitation (spec §4.2): whole on the first open; after the first gesture, the first sentence
  const invite = document.createElement('button');
  invite.type = 'button';
  invite.className = 'mood-invite';
  invite.setAttribute('aria-expanded', 'true');
  const [first, ...rest] = text.invite;
  const inviteFirst = document.createElement('span'), inviteRest = document.createElement('span');
  inviteFirst.textContent = first;
  inviteRest.className = 'mood-invite-rest';
  inviteRest.textContent = ' ' + rest.join(' ');
  invite.append(inviteFirst, inviteRest);

  // the sun's arc: warm at the ends, white at the top; dawn · noon · sunset under it (spec §4.2)
  const arc = svgEl('svg', { class: 'mood-arc', viewBox: `0 0 ${ARC_W} ${ARC_H}`, role: 'group', 'aria-label': text.arc });
  const grad = svgEl('linearGradient', { id: 'moodArcGrad', x1: 0, x2: 1, y1: 0, y2: 0 });
  for (const [offset, color] of [[0, '#ffad66'], [0.5, '#ffffff'], [1, '#ff9457']]) {
    grad.append(svgEl('stop', { offset, 'stop-color': color }));
  }
  const defs = svgEl('defs');
  defs.append(grad);
  const { cx, cy, rx, ry } = ARC;
  const path = svgEl('path', { class: 'mood-arc-path', d: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`,
    fill: 'none', stroke: 'url(#moodArcGrad)', 'stroke-width': 3, 'stroke-linecap': 'round' });
  const dayWords = svgEl('g', { class: 'mood-day-words' });
  for (const [i, anchor, x] of /** @type {[number, string, number][]} */ ([[0, 'start', 2], [1, 'middle', ARC_W / 2], [2, 'end', ARC_W - 2]])) {
    const w = svgEl('text', { x, y: ARC_H - 4, 'text-anchor': anchor });
    w.textContent = text.day[i];
    dayWords.append(w);
  }
  const sunDot = svgEl('circle', { class: 'mood-sun', r: 9 });
  arc.append(defs, path, dayWords, sunDot);

  const pad = document.createElement('div');
  pad.className = 'mood-window';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', text.pad);
  // the illustrations: nine soft sky-over-sea cells that flow into each other, and a motif on each
  const art = document.createElement('div');
  art.className = 'mood-art';
  art.setAttribute('aria-hidden', 'true');
  const motifs = svgEl('svg', { class: 'mood-motifs', viewBox: '0 0 300 300' });
  MOOD_MAP_V1.grid.forEach((cells, row) => cells.forEach((m, col) => {
    const cell = document.createElement('span');
    cell.className = 'mood-cell';
    cell.dataset.anchor = m.id;
    const c = moodColors(col - 1, row - 1, 0.5);
    cell.style.left = `${col * 50}%`;
    cell.style.top = `${(2 - row) * 50}%`;
    cell.style.background = `linear-gradient(${c.skyTop}, ${c.skyLow} 50%, ${c.sea} 62%, ${c.seaDeep})`;
    art.append(cell);
    const g = svgEl('g', { 'data-anchor': m.id });
    g.append(...MOTIFS[m.name](MOTIF_AT[col], MOTIF_AT[2 - row]));
    motifs.append(g);
  }));
  art.append(motifs);
  const edges = Object.entries(text.edges).map(([where, word]) => {
    const e = document.createElement('span');
    e.className = `mood-edge ${where}`;
    e.textContent = word;
    return e;
  });
  const name = document.createElement('span');
  name.className = 'mood-name';
  name.setAttribute('aria-hidden', 'true');
  const pebble = document.createElement('span');
  pebble.className = 'mood-pebble';
  pad.append(art, ...edges, pebble, name);

  // the emotional words (spec §4.2): two layers, the new words fade in over the old
  const words = document.createElement('div');
  words.className = 'mood-words';
  const layers = [document.createElement('span'), document.createElement('span')];
  layers[0].className = 'on';
  layers[1].setAttribute('aria-hidden', 'true');
  words.append(...layers);

  panel.append(invite, arc, pad, words);
  root.append(panel, button);
  parent.append(root);

  /** the state on screen: the host's, or the widget's own while a finger is down */
  let shown = { ...get() };
  let drag = /** @type {null | { id: number, what: 'pad' | 'arc', x: number, y: number, timer: number }} */ (null);
  let wordsShown = '', thumbKey = '', gestured = false, nameTimer = 0;

  function setWords(next) {
    if (next === wordsShown) return;
    wordsShown = next;
    const [on, off] = layers[0].classList.contains('on') ? layers : [layers[1], layers[0]];
    off.textContent = next;
    off.classList.add('on');
    off.removeAttribute('aria-hidden');
    on.classList.remove('on');
    on.setAttribute('aria-hidden', 'true');
  }

  function place() {
    const p = moodToPad(shown.v, shown.a), s = arcPoint(shown.t);
    pebble.style.left = `${p.x * 100}%`;
    pebble.style.top = `${p.y * 100}%`;
    sunDot.setAttribute('cx', s.x.toFixed(2));
    sunDot.setAttribute('cy', s.y.toFixed(2));
    panel.classList.toggle('custom', Boolean(shown.custom));
    setWords(wordsText(wordsCells(shown.v, shown.a), (k) => text.words[k] ?? k));
    // the thumbnail: the chosen weather and time of day, the sun where it stands on the arc
    const key = `${shown.v.toFixed(3)},${shown.a.toFixed(3)},${shown.t.toFixed(3)}`;
    if (key !== thumbKey) {
      thumbKey = key;
      const c = moodColors(shown.v, shown.a, shown.t);
      const sx = 15 + 70 * clamp(shown.t, 0, 1), sy = 58 - 40 * Math.sin(Math.PI * clamp(shown.t, 0, 1));
      thumb.style.background = `radial-gradient(circle at ${sx.toFixed(1)}% ${sy.toFixed(1)}%, #fff6d8 0 9%, rgb(255 240 200 / 0.45) 12%, transparent 20%),`
        + ` linear-gradient(${c.skyTop}, ${c.skyLow} 58%, ${c.sea} 58%, ${c.seaDeep})`;
    }
  }

  /** read the host's state again (after app.mood.set, a Controls change, or on open) */
  function sync() {
    if (drag) return;
    shown = { ...get() };
    place();
  }

  /** the anchor's name over its picture (spec §4.2); null hides it */
  function showName(/** @type {null | { x: number, y: number }} */ at) {
    clearTimeout(nameTimer);
    if (!at) { name.classList.remove('show'); return; }
    const r = pad.getBoundingClientRect();
    const m = padToMood(at.x - r.left, at.y - r.top, r.width), cell = nearestCell(m.v, m.a);
    name.textContent = text.names[anchorAt(cell).name] ?? anchorAt(cell).name;
    name.dataset.anchor = anchorAt(cell).id;
    name.style.left = `${clamp(cell.col * 50, 22, 78)}%`;
    name.style.top = `${clamp((2 - cell.row) * 50, 12, 88)}%`;
    name.classList.add('show');
  }
  const hideNameLater = () => { clearTimeout(nameTimer); nameTimer = setTimeout(() => showName(null), NAME_LINGER_MS); };

  function setInviteOpen(/** @type {boolean} */ open) {
    invite.classList.toggle('short', !open);
    invite.setAttribute('aria-expanded', String(open));
  }
  invite.addEventListener('click', () => setInviteOpen(invite.classList.contains('short')));

  function fromPointer(/** @type {PointerEvent} */ e, /** @type {'pad' | 'arc'} */ what) {
    if (what === 'pad') {
      const r = pad.getBoundingClientRect();
      Object.assign(shown, padToMood(e.clientX - r.left, e.clientY - r.top, r.width));
    } else {
      const r = arc.getBoundingClientRect(), k = ARC_W / r.width;
      shown.t = arcToDay((e.clientX - r.left) * k, (e.clientY - r.top) * k);
    }
    shown.custom = false;
    place();
  }

  const send = (/** @type {boolean} */ final) => input({ t: shown.t, v: shown.v, a: shown.a }, final);

  for (const [el, what] of /** @type {[Element, 'pad' | 'arc'][]} */ ([[pad, 'pad'], [arc, 'arc']])) {
    el.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      // the first gesture of the session folds the invitation to its first sentence (spec §4.2)
      if (!gestured) { gestured = true; setInviteOpen(false); }
      const timer = what === 'pad' && e.pointerType !== 'mouse'
        ? setTimeout(() => { if (drag) showName({ x: drag.x, y: drag.y }); }, LONG_PRESS_MS) : 0;
      drag = { id: e.pointerId, what, x: e.clientX, y: e.clientY, timer };
      if (e.pointerType === 'mouse') showName(null);
      el.setPointerCapture?.(e.pointerId);
      fromPointer(e, what);
      send(false);
    });
    el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (drag?.id !== e.pointerId) {
        // a mouse over the pictures names the anchor under it
        if (!drag && what === 'pad' && e.pointerType === 'mouse') showName({ x: e.clientX, y: e.clientY });
        return;
      }
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > LONG_PRESS_SLOP) {
        clearTimeout(drag.timer);
        // a name already shown by the long press follows the finger
        if (name.classList.contains('show')) showName({ x: e.clientX, y: e.clientY });
      }
      fromPointer(e, what);
      send(false);
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (drag?.id !== e.pointerId) return;
      clearTimeout(drag.timer);
      if (e.pointerType !== 'mouse' && name.classList.contains('show')) hideNameLater();
      drag = null;
      send(true);
      sync();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  pad.addEventListener('pointerleave', (/** @type {PointerEvent} */ e) => { if (e.pointerType === 'mouse' && !drag) showName(null); });

  const setOpen = (/** @type {boolean} */ open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
    if (open) sync();
    else showName(null);
  };
  button.addEventListener('click', () => setOpen(!root.classList.contains('open')));

  let progressShown = 1;
  place();
  return {
    element: root,
    sync,
    open: () => setOpen(true),
    close: () => setOpen(false),
    get expanded() { return !panel.hidden; },
    /**
     * How far the world is on its way to the chosen state (spec §4.1): a thin ring round the
     * button while p < 1. Cheap to call every frame: the DOM changes only in visible steps.
     * @param {number} p 0 … 1; 1 — at rest
     */
    progress(p) {
      const q = clamp(p, 0, 1);
      const moving = q < 0.995;
      if (moving === (progressShown < 0.995) && Math.abs(q - progressShown) < 0.005) return;
      progressShown = q;
      root.classList.toggle('moving', moving);
      ring.style.setProperty('--progress', q.toFixed(3));
    },
  };
}
