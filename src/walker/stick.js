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
// Q4b: an optional third button, `flight` — «take off» on the board / «land» ('fly' / 'land';
// Q9: «onto the board»).
// Q5b: the same button — «into the water» ('water'), «dive» / «surface» in it ('dive' / 'rise').
// Q5: an optional column of the frame's fates, `fates` — `hints()` names the buttons now
// (release / sink / break for the frame at hand, call / raise / gather and keep for the open
// fate), `run(name)` does one. Under «Leave it so» a quiet line says what it means (Edge §4.4).
//
// Q9 (§4.2a): every button carries the icon of its subject left of its word (icons.js); the
// knob carries the walker's. «Take off» is «Onto the board»: the board goes onto the water.
//
// Q10 (§4.2a «Меню малюнку»): the fates' column hides under one button with the picture's icon,
// `menu`. A touch opens it: the slots (the miniature in the hands, then the backpack — drawings
// from `thumb(id)`, three in view, the row scrolls; a touch on a backpack slot takes it into the
// hands), «Put down» and «Take into the hands» (`actions()`), then the fates (`fates()`). The
// button shows while the menu has anything; a deed in it (a fate, put, lift) folds it again.
//
// The stick: x to the right, y forward (screen up), both -1..1, length ≤ 1. Inside the
// dead zone it is 0; past it the length starts at 0 again, so there is no jump at the
// rim of the dead zone. The head turns by a drag on the scene (keyboard.js), not here.
import { iconOf } from './icons.js';

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
 *   action?: { hint: () => 'take' | 'put' | 'kite' | 'unkite' | 'fly' | null, run: () => unknown },
 *   flight?: { hint: () => 'fly' | 'land' | 'water' | 'dive' | 'rise' | null, run: () => unknown },
 *   menu?: Menu }} options
 */
export function createWalkerStick({ parent = document.body, host, onToggle, labels: words = LABELS.en, action, flight, menu }) {
  let labels = words;
  const root = document.createElement('div');
  root.id = 'walkerControls';
  const zone = document.createElement('div');
  zone.className = 'walker-stick';
  zone.setAttribute('role', 'application');
  zone.setAttribute('aria-label', labels.stick);
  const knob = document.createElement('div');
  knob.className = 'walker-knob';
  knob.append(iconNode('stick'));
  zone.append(knob);
  const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-toggle' });
  const act = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-action', hidden: true });
  const fly = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-fly', hidden: true });
  // Q10: the picture's menu — its button, and the panel it opens (slots, deeds, fates)
  const menuButton = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-menu-toggle', hidden: true });
  menuButton.setAttribute('aria-expanded', 'false');
  const panel = Object.assign(document.createElement('div'), { className: 'walker-menu', hidden: true });
  panel.id = 'walkerMenu';
  menuButton.setAttribute('aria-controls', panel.id);
  const slotRow = Object.assign(document.createElement('div'), { className: 'walker-slots', hidden: true });
  slotRow.setAttribute('role', 'list');
  const deeds = Object.assign(document.createElement('div'), { className: 'walker-deeds', hidden: true });
  const column = Object.assign(document.createElement('div'), { className: 'walker-fates', hidden: true });
  const note = Object.assign(document.createElement('p'), { className: 'walker-note', hidden: true });
  panel.append(slotRow, deeds, column);
  root.append(zone, toggle, act, fly, menuButton, panel);
  parent.append(root);
  let open = false;
  const setOpen = (next) => {
    open = !!next;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.dataset.open = String(open);
    update();
  };
  /** @type {Map<string, HTMLButtonElement>} */
  const fateButtons = new Map();
  const fateButton = (name) => {
    let b = fateButtons.get(name);
    if (!b) {
      b = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-fate' });
      say(b, name, labels[name] ?? name);
      b.dataset.action = name;
      b.dataset.undo = String(UNDOING.has(name));
      // a deed done folds the menu: the scene is what to look at now
      b.addEventListener('click', () => { const done = menu?.run(name); if (done) setOpen(false); });
      fateButtons.set(name, b);
    }
    return b;
  };
  /** One slot: the drawing of the miniature, «in the hands» or a touch to take it out of the backpack. */
  const slotButton = (slot) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'walker-slot' });
    b.setAttribute('role', 'listitem');
    b.dataset.frame = String(slot.index);
    b.dataset.where = slot.where;
    const named = `${frameWord(labels, slot.index)} · ${slot.where === 'hands' ? labels.inHands : labels.inPack}`;
    b.setAttribute('aria-label', named);
    b.title = named;
    const url = menu?.thumb(slot.id) ?? null;
    if (url) b.append(Object.assign(document.createElement('img'), { src: url, alt: '', draggable: false }));
    else b.append(Object.assign(document.createElement('span'), { className: 'walker-slot-word', textContent: String(slot.index + 1) }));
    b.disabled = slot.where === 'hands';
    b.addEventListener('click', () => { if (slot.where === 'pack') menu?.unpack(slot.id); update(); });
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
  const flip = () => setOpen(!open);
  menuButton.addEventListener('click', flip);
  addEventListener('blur', release);

  /** The button's words follow the host's mode; the controls show once the walker is placed. */
  function update() {
    const mode = host.mode;
    root.hidden = mode === 'off';
    const turn = mode === 'standing' ? 'enter' : 'leave';
    say(toggle, turn, labels[turn]);
    zone.dataset.mode = mode;
    const hint = action?.hint() ?? null;
    act.hidden = !hint;
    say(act, hint, hint ? labels[hint] : '');
    act.dataset.action = hint ?? '';
    const hop = flight?.hint() ?? null;
    fly.hidden = !hop;
    say(fly, hop, hop ? labels[hop] : '');
    fly.dataset.action = hop ?? '';
    const off = mode === 'off' || !menu;
    const slots = off ? [] : menu.slots();
    const doing = off ? [] : menu.actions();
    const names = off ? [] : menu.fates();
    const any = slots.length + doing.length + names.length > 0;
    if (!any && open) { open = false; menuButton.setAttribute('aria-expanded', 'false'); menuButton.dataset.open = 'false'; }
    menuButton.hidden = !any;
    say(menuButton, 'menu', labels.menu);
    panel.hidden = !open;
    if (!open) return;
    const slotKey = slots.map((s) => `${s.index}:${s.where}`).join(' ');
    if (slotRow.dataset.slots !== slotKey || slotRow.dataset.locale !== labels.menu) {
      slotRow.dataset.slots = slotKey;
      slotRow.dataset.locale = labels.menu;
      // three places in view, empty ones drawn as such; more scroll along the row
      const empty = Array.from({ length: Math.max(0, MENU.slots - slots.length) }, () => {
        const s = Object.assign(document.createElement('span'), { className: 'walker-slot empty' });
        s.setAttribute('aria-hidden', 'true');
        return s;
      });
      slotRow.replaceChildren(...slots.map(slotButton), ...empty);
      slotRow.hidden = !slots.length;
    }
    const deedKey = doing.join(' ');
    if (deeds.dataset.names !== deedKey) {
      deeds.dataset.names = deedKey;
      deeds.replaceChildren(...doing.map(fateButton));
      deeds.hidden = !doing.length;
    }
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
      for (const [name, b] of fateButtons) say(b, name, labels[name] ?? name);
      note.textContent = labels.keepNote;
      update();
    },
    dispose() {
      release();
      removeEventListener('blur', release);
      toggle.removeEventListener('click', click);
      act.removeEventListener('click', run);
      fly.removeEventListener('click', runFly);
      menuButton.removeEventListener('click', flip);
      root.remove();
    },
  };
}

/** The icon of a button's subject (icons.js), aria-hidden; an empty node without one. */
function iconNode(name) {
  const svg = iconOf(name);
  const span = Object.assign(document.createElement('span'), { className: 'cmd-icon' });
  span.setAttribute('aria-hidden', 'true');
  if (svg) span.innerHTML = svg;
  return span;
}
/**
 * A button says `text` with the icon of `name`'s subject before it; nothing is rebuilt while
 * the two stay the same (update() runs every frame). The button's textContent is the word.
 */
function say(button, name, text) {
  const key = `${name ?? ''}|${text}`;
  if (button.dataset.say === key) return;
  button.dataset.say = key;
  const icon = name && iconOf(name);
  button.replaceChildren(...(icon ? [iconNode(name)] : []), ...(text ? [document.createTextNode(text)] : []));
}

/** The fates' ways back and «keep»: drawn softer than the fates themselves. */
const UNDOING = new Set(['call', 'raise', 'gather', 'keep']);

/** Q10: places of the menu's slot row in view. */
export const MENU = Object.freeze({ slots: 3 });

/**
 * @typedef {{ id: any, index: number, where: 'hands' | 'pack' }} Slot
 * @typedef {{ slots: () => Slot[], thumb: (id: any) => string | null, unpack: (id: any) => unknown,
 *   actions: () => string[], fates: () => string[], run: (name: string) => unknown }} Menu
 *   `actions` — 'put' / 'lift' that can be done now; `run` does one of them or of the fates
 */

/** «Frame n» of the frame at `index` (0-based). */
const frameWord = (labels, index) => labels.frameN.replace('{n}', String(index + 1));

export const LABELS = Object.freeze({
  en: { stick: 'Walk', leave: 'Out of the body', enter: 'Eyes', take: 'Take', put: 'Put down',
    kite: 'Kite', unkite: 'Let go of the kite', fly: 'Onto the board', land: 'Land',
    water: 'Into the water', dive: 'Dive', rise: 'Surface',
    release: 'Let it go', sink: 'Sink it', break: 'Let it come apart',
    call: 'Call it back', raise: 'Raise it', gather: 'Gather it', keep: 'Leave it so',
    keepNote: 'The world will remember this.',
    menu: 'Picture', lift: 'Take into the hands', frameN: 'Frame {n}', inHands: 'in the hands', inPack: 'in the backpack' },
  uk: { stick: 'Іти', leave: 'Вийти з тіла', enter: 'Очима', take: 'Взяти', put: 'Покласти',
    kite: 'Кайт', unkite: 'Відпустити кайт', fly: 'На дошку', land: 'Сісти',
    water: 'У воду', dive: 'Пірнути', rise: 'Випливти',
    release: 'Відпустити', sink: 'Втопити', break: 'Дати розпастися',
    call: 'Покликати', raise: 'Підняти', gather: 'Зібрати', keep: 'Залишити так',
    keepNote: 'Світ запам’ятає це.',
    menu: 'Малюнок', lift: 'Взяти в руки', frameN: 'Кадр {n}', inHands: 'у руках', inPack: 'у рюкзаку' },
});
