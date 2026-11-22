// Technical panels (SCENE-UI-SPEC §3): lil-gui "Controls" and the #perf FPS panel are
// hidden by default. F2 / F3 toggle them; ?controls, ?fps and ?debug open the page with
// them shown. A three-finger tap on touch screens shows a strip with the same two buttons.
// Visibility is not persisted: after a reload the world is clean again.

/** True while focus is in a text field, where F2/F3 and WASD must not fire. */
export const isEditing = (target) => target instanceof HTMLElement
  && (target.isContentEditable || !!target.closest('input, textarea, select'));

/** Which panels a URL asks to show at start. */
export function panelsFromUrl(args) {
  const debug = args.has('debug');
  return { controls: debug || args.has('controls'), fps: debug || args.has('fps') };
}

const TAP_TOUCHES = 3, TAP_DOWN_MS = 300, TAP_UP_MS = 500, TAP_SLOP_PX = 10;

/**
 * Three-finger tap detector, DOM-free so it can be unit-tested. A tap is exactly three
 * touches, all down within 300 ms of the first, none moved 10 px or more, all lifted
 * within 500 ms of the third touch going down. A fourth touch or a cancel voids it.
 */
export class TripleTap {
  constructor(onTap) {
    this.onTap = onTap;
    this.touches = new Map();
    this.session = null;
  }

  down(id, x, y, t) {
    if (this.touches.size === 0) this.session = { t0: t, t3: -1, valid: true };
    const s = this.session;
    this.touches.set(id, { x, y });
    if (this.touches.size > TAP_TOUCHES) s.valid = false;
    else if (this.touches.size === TAP_TOUCHES) {
      if (t - s.t0 > TAP_DOWN_MS) s.valid = false;
      s.t3 = t;
    }
  }

  move(id, x, y) {
    const p = this.touches.get(id);
    if (p && Math.hypot(x - p.x, y - p.y) >= TAP_SLOP_PX) this.session.valid = false;
  }

  up(id, x, y, t) {
    if (!this.touches.has(id)) return;
    this.move(id, x, y);
    this.touches.delete(id);
    if (this.touches.size > 0) return;
    const s = this.session;
    this.session = null;
    if (s.valid && s.t3 >= 0 && t - s.t3 <= TAP_UP_MS) this.onTap();
  }

  cancel(id) {
    if (!this.touches.has(id)) return;
    this.session.valid = false;
    this.touches.delete(id);
    if (this.touches.size === 0) this.session = null;
  }
}

/**
 * Wires the panels to keys, URL and the touch strip.
 * @param {{ gui: { show(v?: boolean): unknown }, perf: HTMLElement, args: URLSearchParams }} options
 */
export function createTechPanels({ gui, perf, args }) {
  const state = { ...panelsFromUrl(args), strip: false };

  const strip = document.createElement('div');
  strip.id = 'techStrip';
  strip.hidden = true;
  const buttons = {
    controls: Object.assign(document.createElement('button'), { type: 'button', textContent: 'F2 Controls' }),
    fps: Object.assign(document.createElement('button'), { type: 'button', textContent: 'F3 FPS' }),
  };
  for (const [name, button] of Object.entries(buttons)) {
    button.dataset.panel = name;
    button.addEventListener('click', () => toggle(name));
    strip.append(button);
  }
  document.body.append(strip);

  function apply() {
    gui.show(state.controls);
    perf.hidden = !state.fps;
    strip.hidden = !state.strip;
    document.body.classList.toggle('tech-strip', state.strip);
    for (const [name, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(state[name]));
  }

  function toggle(name) {
    state[name] = !state[name];
    apply();
  }

  const KEYS = { F2: 'controls', F3: 'fps' };
  window.addEventListener('keydown', (event) => {
    const name = KEYS[event.code];
    if (!name || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isEditing(event.target)) return;
    event.preventDefault();   // F3 is "find next" in Chromium and Firefox
    if (!event.repeat) toggle(name);
  });

  const tap = new TripleTap(() => toggle('strip'));
  const touch = (handler) => (event) => { if (event.pointerType === 'touch') handler(event); };
  window.addEventListener('pointerdown', touch((e) => tap.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)), true);
  window.addEventListener('pointermove', touch((e) => tap.move(e.pointerId, e.clientX, e.clientY)), true);
  window.addEventListener('pointerup', touch((e) => tap.up(e.pointerId, e.clientX, e.clientY, e.timeStamp)), true);
  window.addEventListener('pointercancel', touch((e) => tap.cancel(e.pointerId)), true);

  apply();
  return {
    get controls() { return state.controls; },
    get fps() { return state.fps; },
    get strip() { return state.strip; },
    toggle,
  };
}
