// The walker's touch controls (STORY-QUEST-SPEC §2 п.2; story-quest Q2b): a stick in the
// lower left and one button «out of the body» / «eyes». A UI entry of its own, like
// ui/moodPad.js: the walker host (index.js) knows nothing of the DOM it lives in.
//
// Tilecraft's gamifier-stick.js is not taken: it is built around the gamifier's control()
// (HANDOFF «Персонаж», Q0), and the part worth sharing — a deflection from a drag — is the
// few lines of stickVector below.
//
// Q3: an optional second button for the miniatures — «take» / «put down», shown only while
// `action.hint()` names one (the host of the miniatures decides, the button only words it).
// Q4: the same button puts the kite up / lets it go on a raft ('kite' / 'unkite').
// Q4b: an optional third button, `flight` — «take off» on the board / «land» ('fly' / 'land').
// Q5b: the same button — «into the water» ('water'), «dive» / «surface» in it ('dive' / 'rise').
// Q5: an optional column of the frame's fates, `fates` — `hints()` names the buttons now
// (release / sink / break for the frame at hand, call / raise / gather and keep for the open
// fate), `run(name)` does one. Under «Leave it so» a quiet line says what it means (Edge §4.4).
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
 *   onToggle: () => void, labels?: Record<string, string>,
 *   action?: { hint: () => 'take' | 'put' | 'kite' | 'unkite' | null, run: () => unknown },
 *   flight?: { hint: () => 'fly' | 'land' | 'water' | 'dive' | 'rise' | null, run: () => unknown },
 *   fates?: { hints: () => string[], run: (name: string) => unknown } }} options
 */
export function createWalkerStick({ parent = document.body, host, onToggle, labels: words = LABELS.en, action, flight, fates }) {
  let labels = words;
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
  const act = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-action', hidden: true });
  const fly = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-fly', hidden: true });
  const column = Object.assign(document.createElement('div'), { className: 'walker-fates', hidden: true });
  const note = Object.assign(document.createElement('p'), { className: 'walker-note', hidden: true });
  root.append(zone, toggle, act, fly, column);
  parent.append(root);
  /** @type {Map<string, HTMLButtonElement>} */
  const fateButtons = new Map();
  const fateButton = (name) => {
    let b = fateButtons.get(name);
    if (!b) {
      b = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-fate', textContent: labels[name] ?? name });
      b.dataset.action = name;
      b.dataset.undo = String(UNDOING.has(name));
      b.addEventListener('click', () => fates?.run(name));
      fateButtons.set(name, b);
    }
    return b;
  };

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
  const run = () => action?.run();
  act.addEventListener('click', run);
  const runFly = () => flight?.run();
  fly.addEventListener('click', runFly);
  addEventListener('blur', release);

  /** The button's words follow the host's mode; the controls show once the walker is placed. */
  function update() {
    const mode = host.mode;
    root.hidden = mode === 'off';
    const text = mode === 'standing' ? labels.enter : labels.leave;
    if (toggle.textContent !== text) toggle.textContent = text;
    zone.dataset.mode = mode;
    const hint = action?.hint() ?? null;
    act.hidden = !hint;
    const word = hint ? labels[hint] : '';
    if (act.textContent !== word) act.textContent = word;
    act.dataset.action = hint ?? '';
    const hop = flight?.hint() ?? null;
    fly.hidden = !hop;
    const flyWord = hop ? labels[hop] : '';
    if (fly.textContent !== flyWord) fly.textContent = flyWord;
    fly.dataset.action = hop ?? '';
    const names = mode === 'off' ? [] : fates?.hints() ?? [];
    const key = names.join(' ');
    if (column.dataset.names !== key) {
      column.dataset.names = key;
      column.replaceChildren(...names.map(fateButton));
      if (names.includes('keep')) {
        note.textContent = labels.keepNote;
        column.append(note);
      }
      note.hidden = !names.includes('keep');
      column.hidden = !names.length;
    }
  }
  update();
  return {
    element: root,
    update,
    /** Another language (Q7: the product's switch): every button says it from the next update. */
    setLabels(next) {
      labels = next;
      zone.setAttribute('aria-label', labels.stick);
      for (const [name, b] of fateButtons) b.textContent = labels[name] ?? name;
      note.textContent = labels.keepNote;
      toggle.textContent = act.textContent = fly.textContent = '';
      update();
    },
    dispose() {
      release();
      removeEventListener('blur', release);
      toggle.removeEventListener('click', click);
      act.removeEventListener('click', run);
      fly.removeEventListener('click', runFly);
      root.remove();
    },
  };
}

/** The fates' ways back and «keep»: drawn softer than the fates themselves. */
const UNDOING = new Set(['call', 'raise', 'gather', 'keep']);

export const LABELS = Object.freeze({
  en: { stick: 'Walk', leave: 'Out of the body', enter: 'Eyes', take: 'Take', put: 'Put down',
    kite: 'Kite', unkite: 'Let go of the kite', fly: 'Take off', land: 'Land',
    water: 'Into the water', dive: 'Dive', rise: 'Surface',
    release: 'Let it go', sink: 'Sink it', break: 'Let it come apart',
    call: 'Call it back', raise: 'Raise it', gather: 'Gather it', keep: 'Leave it so',
    keepNote: 'The world will remember this.' },
  uk: { stick: 'Іти', leave: 'Вийти з тіла', enter: 'Очима', take: 'Взяти', put: 'Покласти',
    kite: 'Кайт', unkite: 'Відпустити кайт', fly: 'Злетіти', land: 'Сісти',
    water: 'У воду', dive: 'Пірнути', rise: 'Випливти',
    release: 'Відпустити', sink: 'Втопити', break: 'Дати розпастися',
    call: 'Покликати', raise: 'Підняти', gather: 'Зібрати', keep: 'Залишити так',
    keepNote: 'Світ запам’ятає це.' },
});
