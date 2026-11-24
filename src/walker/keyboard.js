// The walker's own thin input (story-quest Q2a): keys and a drag on the canvas give a
// WalkIntent. Tilecraft's gamifier-input works through the gamifier's control() (22
// members, HANDOFF «Персонаж»), so it is not taken here; the mobile stick is Q2b.
//
// W/S or ↑/↓ — forward and back, A/D — sideways, ←/→ or Q/E — turn, R/F — look up and
// down, Shift — run. A drag on the canvas turns the head; a drag that grabbed a frame
// never reaches here (TileInteraction stops it on the canvas).

const FORWARD = { KeyW: 1, ArrowUp: 1, KeyS: -1, ArrowDown: -1 };
const STRAFE = { KeyD: 1, KeyA: -1 };
const TURN = { ArrowLeft: 1, KeyQ: 1, ArrowRight: -1, KeyE: -1 };
const PITCH = { KeyR: 1, KeyF: -1 };
const KEYS = new Set([...Object.keys(FORWARD), ...Object.keys(STRAFE), ...Object.keys(TURN), ...Object.keys(PITCH)]);
const DRAG = 0.004;   // rad per CSS pixel

/** Sum of the held keys' values on one axis, clamped to -1..1. */
export function axis(held, map) {
  let v = 0;
  for (const code of held) v += map[code] ?? 0;
  return Math.max(-1, Math.min(1, v));
}

/** The intent of a set of held key codes (pure; the binding below feeds it). */
export function keyIntent(held, shift = false) {
  return { forward: axis(held, FORWARD), strafe: axis(held, STRAFE), turn: axis(held, TURN),
    pitch: axis(held, PITCH), run: shift };
}

/**
 * @param {HTMLElement} canvas
 * @param {(target: EventTarget | null) => boolean} isEditing
 * @param {() => boolean} active  keys are taken (preventDefault) only while this holds
 */
export function bindWalkerInput(canvas, isEditing, active) {
  const held = new Set(), offs = [];
  let shift = false, drag = null, look = { yaw: 0, pitch: 0 };
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    offs.push(() => target.removeEventListener(type, fn, options));
  };
  const clear = () => { held.clear(); shift = false; drag = null; };
  on(window, 'keydown', (e) => {
    shift = e.shiftKey;
    if (!active() || !KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
    held.add(e.code);
    e.preventDefault();
  });
  on(window, 'keyup', (e) => { held.delete(e.code); shift = e.shiftKey; });
  on(window, 'blur', clear);
  on(document, 'visibilitychange', clear);
  on(document, 'focusin', (e) => { if (isEditing(e.target)) clear(); });
  on(canvas, 'pointerdown', (e) => {
    if (!active() || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  on(window, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    look.yaw -= (e.clientX - drag.x) * DRAG;
    look.pitch -= (e.clientY - drag.y) * DRAG;
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  on(window, 'pointerup', end);
  on(window, 'pointercancel', end);
  return {
    /** The intent since the last call: held keys now plus the drag accumulated. */
    intent() {
      const intent = { ...keyIntent(held, shift), look };
      look = { yaw: 0, pitch: 0 };
      return intent;
    },
    clear,
    dispose() { for (const off of offs) off(); offs.length = 0; clear(); },
  };
}
