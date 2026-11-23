// The mood weather widget (MOOD-WEATHER-SPEC §4.1, §4.2, §4.5; phase M1b): a round 56 px button
// that opens the sun's arc over the weather window. The pebble in the window is the weather
// (x → valence: cloudy … clear, y → arousal: wind at the top … quiet at the bottom), the sun
// on the arc is the time of day (dawn on the left … sunset on the right).
//
// No numbers and no range inputs (spec §6 p.9). The illustrations, the words and the thumbnail
// on the button come in M3, the smooth transitions in M2, the keyboard and sliders' ARIA in M3b.
//
// The widget owns no world state. The host gives `get()` → { t, v, a, custom } and takes
// `input({ t, v, a }, final)`: `final` is false while a finger moves (the host may skip the
// expensive sky bake) and true on release (spec M1: the sky is re-baked on release).
// `custom` (spec §4.5) — the Controls changed the world by hand: the pebble and the sun are
// shown half transparent until the next touch, which hands the world back to the widget.
//
// Portable like the rest of src/environment/ (guard BOUNDARY-2): imports nothing.

/** the arc's SVG box; the window's width equals ARC_W in the same units */
export const ARC_W = 240, ARC_H = 70;
const ARC = { cx: ARC_W / 2, cy: ARC_H - 10, rx: ARC_W / 2 - 16, ry: ARC_H - 22 };

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

const LABELS = {
  uk: { button: 'Погода й час доби', arc: 'Час доби', pad: 'Погода' },
  en: { button: 'Weather and time of day', arc: 'Time of day', pad: 'Weather' },
};

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (/** @type {string} */ tag, /** @type {Record<string, string | number>} */ attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, String(val));
  return el;
};

/**
 * @param {{ get: () => { t: number, v: number, a: number, custom: boolean },
 *   input: (state: { t: number, v: number, a: number }, final: boolean) => void,
 *   language?: string, parent?: HTMLElement }} options
 */
export function createMoodPad({ get, input, language = 'en', parent = document.body }) {
  const text = LABELS[language] ?? LABELS.en;
  const root = document.createElement('div');
  root.id = 'moodPad';
  root.lang = LABELS[language] ? language : 'en';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mood-button';
  button.setAttribute('aria-label', text.button);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'moodPanel');
  button.innerHTML = '<span class="mood-thumb" aria-hidden="true"></span>';

  const panel = document.createElement('div');
  panel.id = 'moodPanel';
  panel.className = 'mood-panel';
  panel.hidden = true;

  // the sun's arc: warm at the ends, white at the top (spec §4.2)
  const arc = svgEl('svg', { class: 'mood-arc', viewBox: `0 0 ${ARC_W} ${ARC_H}`, role: 'group', 'aria-label': text.arc });
  const grad = svgEl('linearGradient', { id: 'moodArcGrad', x1: 0, x2: 1, y1: 0, y2: 0 });
  for (const [offset, color] of [[0, '#ffad66'], [0.5, '#ffffff'], [1, '#ff9457']]) {
    grad.append(svgEl('stop', { offset, 'stop-color': color }));
  }
  const defs = svgEl('defs', {});
  defs.append(grad);
  const { cx, cy, rx, ry } = ARC;
  const path = svgEl('path', { class: 'mood-arc-path', d: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`,
    fill: 'none', stroke: 'url(#moodArcGrad)', 'stroke-width': 3, 'stroke-linecap': 'round' });
  const sun = svgEl('circle', { class: 'mood-sun', r: 9 });
  arc.append(defs, path, sun);

  const pad = document.createElement('div');
  pad.className = 'mood-window';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', text.pad);
  const pebble = document.createElement('span');
  pebble.className = 'mood-pebble';
  pad.append(pebble);

  panel.append(arc, pad);
  root.append(panel, button);
  parent.append(root);

  /** the state on screen: the host's, or the widget's own while a finger is down */
  let shown = { ...get() };
  let drag = /** @type {null | { id: number, what: 'pad' | 'arc' }} */ (null);

  function place() {
    const p = moodToPad(shown.v, shown.a), s = arcPoint(shown.t);
    pebble.style.left = `${p.x * 100}%`;
    pebble.style.top = `${p.y * 100}%`;
    sun.setAttribute('cx', s.x.toFixed(2));
    sun.setAttribute('cy', s.y.toFixed(2));
    panel.classList.toggle('custom', Boolean(shown.custom));
  }

  /** read the host's state again (after app.mood.set, a Controls change, or on open) */
  function sync() {
    if (drag) return;
    shown = { ...get() };
    place();
  }

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
      drag = { id: e.pointerId, what };
      el.setPointerCapture?.(e.pointerId);
      fromPointer(e, what);
      send(false);
    });
    el.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
      if (drag?.id !== e.pointerId) return;
      fromPointer(e, what);
      send(false);
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      send(true);
      sync();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  const setOpen = (/** @type {boolean} */ open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
    if (open) sync();
  };
  button.addEventListener('click', () => setOpen(!root.classList.contains('open')));

  place();
  return {
    element: root,
    sync,
    open: () => setOpen(true),
    close: () => setOpen(false),
    get expanded() { return !panel.hidden; },
  };
}
