// The walker's touch controls (STORY-QUEST-SPEC §2 п.2; story-quest Q2b): a stick in the
// lower left and one button «out of the body» / «eyes». A UI entry of its own, like
// ui/moodPad.js: the walker host (index.js) knows nothing of the DOM it lives in.
//
// Tilecraft's gamifier-stick.js is not taken: it is built around the gamifier's control()
// (HANDOFF «Персонаж», Q0), and the part worth sharing — a deflection from a drag — is the
// few lines of stickVector below.
//
// The stick: x to the right, y forward (screen up), both -1..1, length ≤ 1. Inside the
// dead zone it is 0; past it the length starts at 0 again, so there is no jump at the
// rim of the dead zone. The head turns by a drag on the scene (keyboard.js), not here.

export const STICK = Object.freeze({
  radius: 56,    // CSS px from the centre to the rim, where the deflection is 1
  dead: 0.12,    // share of the radius that gives 0
});

/**
 * Deflection of a drag (dx, dy) in CSS px from the stick's centre, screen y down.
 * @returns {{ x: number, y: number }}
 */
export function stickVector(dx, dy, radius = STICK.radius, dead = STICK.dead) {
  const length = Math.hypot(dx, dy) / radius;
  if (length <= dead) return { x: 0, y: 0 };
  const m = Math.min(1, (length - dead) / (1 - dead)) / length / radius;
  return { x: dx * m, y: -dy * m };
}

/**
 * @param {{ parent?: HTMLElement, host: { mode: string, setStick: (v: {x: number, y: number}) => void },
 *   onToggle: () => void, labels?: { stick: string, leave: string, enter: string } }} options
 */
export function createWalkerStick({ parent = document.body, host, onToggle, labels = LABELS.en }) {
  const root = document.createElement('div');
  root.id = 'walkerControls';
  const zone = document.createElement('div');
  zone.className = 'walker-stick';
  zone.setAttribute('role', 'application');
  zone.setAttribute('aria-label', labels.stick);
  const knob = document.createElement('div');
  knob.className = 'walker-knob';
  zone.append(knob);
  const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-toggle' });
  root.append(zone, toggle);
  parent.append(root);

  let drag = null;
  const set = (dx, dy) => {
    const v = stickVector(dx, dy);
    knob.style.transform = `translate(${v.x * STICK.radius}px, ${-v.y * STICK.radius}px)`;
    zone.dataset.x = v.x.toFixed(3);
    zone.dataset.y = v.y.toFixed(3);
    host.setStick(v);
  };
  const release = () => { drag = null; set(0, 0); };
  const down = (e) => {
    if (drag) return;
    const r = zone.getBoundingClientRect();
    drag = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    zone.setPointerCapture?.(e.pointerId);
    set(e.clientX - drag.x, e.clientY - drag.y);
    e.preventDefault();
  };
  const move = (e) => { if (drag && e.pointerId === drag.id) set(e.clientX - drag.x, e.clientY - drag.y); };
  const up = (e) => { if (drag && e.pointerId === drag.id) release(); };
  zone.addEventListener('pointerdown', down);
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('lostpointercapture', up);
  const click = () => onToggle();
  toggle.addEventListener('click', click);
  addEventListener('blur', release);

  /** The button's words follow the host's mode; the controls show once the walker is placed. */
  function update() {
    const mode = host.mode;
    root.hidden = mode === 'off';
    const text = mode === 'standing' ? labels.enter : labels.leave;
    if (toggle.textContent !== text) toggle.textContent = text;
    zone.dataset.mode = mode;
  }
  update();
  return {
    element: root,
    update,
    dispose() {
      release();
      removeEventListener('blur', release);
      toggle.removeEventListener('click', click);
      root.remove();
    },
  };
}

export const LABELS = Object.freeze({
  en: { stick: 'Walk', leave: 'Out of the body', enter: 'Eyes' },
  uk: { stick: 'Іти', leave: 'Вийти з тіла', enter: 'Очима' },
});
