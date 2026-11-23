// The station rail (SCENE-UI-SPEC §4.1–4.5): four nodes at the bottom of the screen that
// fly the camera to a station. A node is filled (●) while the camera stands on its
// station; once the person moves the camera away (> 5 % of the station's distance or
// > 8° of turn) none is filled and the last station shows as a ring (◎). A bead runs
// along the rail during a flight. With prefers-reduced-motion there is no flight: the
// screen fades out for 250 ms, the camera is placed, the screen fades back in.
//
// Station «Мить» (§4.3) walks the story's frames: from another station it flies to the
// frame last in focus (the first one at the start), again on the frame — to the next,
// wrapping round; ←/→ and a swipe across its node step back and forth. On a drifting
// frame the camera follows it (≤ 2 m/s) until the person's first touch.
//
// The rail never writes the camera itself and never touches the sun: poses go to the
// camera owner (cameraRig.js).
import { isEditing } from './techPanels.js';
import { stepFrame } from '../scene/frameFocus.js';

export const STATIONS = ['island', 'shore', 'story', 'frame'];

const LABELS = {
  uk: { island: 'Острів', shore: 'Берег', story: 'Історія', frame: 'Мить', rail: 'Опорні точки камери',
    noStory: 'Історію не завантажено' },
  en: { island: 'Island', shore: 'Shore', story: 'Story', frame: 'Moment', rail: 'Camera stations',
    noStory: 'Story not loaded' },
};

export const railLanguage = (languages) => (languages.some((l) => /^uk\b/i.test(l)) ? 'uk' : 'en');

const FADE_MS = 250;
const MOVED_SHARE = 0.05, TURN_DEG = 8;
const SWIPE_PX = 30;      // a horizontal swipe across the «Мить» node, not a tap
const FOLLOW_SPEED = 2;   // m/s: the camera after a drifting frame (§4.3)

/**
 * True while the camera still stands on the station pose: moved less than 5 % of the
 * station's camera–target distance and turned less than 8°.
 */
export function onStation(camera, target, pose) {
  const reach = pose.position.distanceTo(pose.target);
  if (camera.distanceTo(pose.position) > MOVED_SHARE * reach) return false;
  const a = target.clone().sub(camera), b = pose.target.clone().sub(pose.position);
  return a.angleTo(b) <= (TURN_DEG * Math.PI) / 180;
}

/**
 * @param {{ rig: import('../scene/cameraRig.js').CameraRig,
 *   poseOf: (id: string) => ({ position: any, target: any } | null),
 *   frames: { count: () => number, pose: (i: number) => Promise<{ position: any, target: any } | null>,
 *     aim: (i: number) => any },
 *   isActive: (id: string) => boolean,
 *   reducedMotion?: () => boolean, language?: string }} options
 *   `poseOf(id)` — the station's pose now; `isActive(id)` — can the camera go there;
 *   `frames` — the story's frames for station `frame` (frameFocus.js).
 */
export function createStationRail({ rig, poseOf, frames, isActive,
  reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  language = railLanguage([...navigator.languages, navigator.language]) }) {
  const lang = LABELS[language] ? language : 'en';
  const text = LABELS[lang];
  const state = { arrived: null, flying: null, from: null, progress: 0, fading: null, seq: 0, focus: null, request: 0 };

  const rail = document.createElement('nav');
  rail.id = 'stationRail';
  rail.lang = lang;   // a screen reader reads «Острів» in Ukrainian on an English page
  rail.setAttribute('aria-label', text.rail);
  const track = document.createElement('div');
  track.className = 'track';
  const bead = document.createElement('span');
  bead.className = 'bead';
  bead.hidden = true;
  track.append(bead);
  rail.append(track);
  const nodes = {};
  for (const [i, id] of STATIONS.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'station';
    button.dataset.station = id;
    button.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="label"></span>';
    button.querySelector('.label').textContent = text[id];
    button.setAttribute('aria-keyshortcuts', id === 'frame' ? '4 ArrowLeft ArrowRight' : String(i + 1));
    button.addEventListener('click', () => { if (!swiped) go(id); swiped = false; });
    rail.append(button);
    nodes[id] = button;
  }
  document.body.append(rail);

  // Swipe across «Мить»: left — the previous frame, right — the next (§4.3).
  let swiped = false, swipe = null;
  const frameNode = nodes.frame;
  frameNode.style.touchAction = 'none';
  frameNode.addEventListener('pointerdown', (e) => {
    swiped = false;
    swipe = { id: e.pointerId, x: e.clientX };
    frameNode.setPointerCapture?.(e.pointerId);
  });
  frameNode.addEventListener('pointerup', (e) => {
    if (swipe?.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    swipe = null;
    if (Math.abs(dx) < SWIPE_PX || !isActive('frame')) return;
    swiped = true;   // the click that follows is part of the swipe
    stepTo(dx > 0 ? 1 : -1);
  });
  frameNode.addEventListener('pointercancel', () => { swipe = null; });

  const fade = document.createElement('div');
  fade.id = 'stationFade';
  fade.setAttribute('aria-hidden', 'true');
  document.body.append(fade);

  const shown = {};   // last DOM state per node, so update() writes only on change
  function render() {
    const current = currentStation();
    for (const id of STATIONS) {
      const active = isActive(id);
      const mark = current === id ? 'on' : !current && !state.flying && state.arrived?.id === id ? 'last' : '';
      const hint = active ? '' : text.noStory;
      const label = id === 'frame' ? frameLabel() : text[id];
      const key = `${active}|${mark}|${hint}|${label}`;
      if (shown[id] === key) continue;
      shown[id] = key;
      const node = nodes[id];
      node.setAttribute('aria-disabled', String(!active));
      node.classList.toggle('on', mark === 'on');
      node.classList.toggle('last', mark === 'last');
      if (mark === 'on') node.setAttribute('aria-current', 'location');
      else node.removeAttribute('aria-current');
      node.title = hint;
      node.querySelector('.label').textContent = label;
      node.setAttribute('aria-label', hint ? `${label} — ${hint}` : label);
    }
    if (state.flying) {
      const a = STATIONS.indexOf(state.from ?? state.flying), b = STATIONS.indexOf(state.flying);
      bead.hidden = false;
      bead.style.left = `${((a + (b - a) * state.progress) / (STATIONS.length - 1)) * 100}%`;
    } else bead.hidden = true;
  }

  /** «Мить 2/5»: the frame in focus (or the one the node would fly to) of all frames. */
  function frameLabel() {
    const count = frames.count();
    return count ? `${text.frame} ${Math.min(state.focus ?? 0, count - 1) + 1}/${count}` : text.frame;
  }

  /** Station `frame` is the active one: flying there, or the last arrival. */
  const onFrame = () => state.flying === 'frame' || (!state.flying && state.arrived?.id === 'frame');

  function currentStation() {
    const a = state.arrived;
    if (!a || state.flying || rig.flying) return null;
    return onStation(rig.camera.position, rig.controls.target, a.pose) ? a.id : null;
  }

  /**
   * Flies (or, with reduced motion, fades) to station `id`. Resolves true on arrival.
   * `frame` from another station — the frame last in focus; on the frame — the next one.
   */
  function go(id) {
    if (!STATIONS.includes(id) || !isActive(id)) return Promise.resolve(false);
    if (id === 'frame') {
      const again = state.flying === 'frame' || currentStation() === 'frame';
      return goFrame(again ? stepFrame(state.focus, frames.count(), 1) : (state.focus ?? 0));
    }
    return travel(id, poseOf(id));
  }

  /** Steps `step` frames from the one in focus. */
  function stepTo(step) {
    if (!isActive('frame')) return Promise.resolve(false);
    return goFrame(stepFrame(state.focus, frames.count(), step));
  }

  async function goFrame(index) {
    if (state.fading) return state.fading;
    if (index < 0 || index >= frames.count()) return false;
    state.focus = index;
    const request = ++state.request;
    // The bead starts at once; a drifting frame's pose waits for one GPU read.
    if (!state.flying) { state.from = currentStation() ?? state.arrived?.id ?? null; state.progress = 0; }
    state.flying = 'frame';
    const pose = await frames.pose(index);
    if (request !== state.request) return false;   // a newer press took over
    if (!pose) { state.flying = null; return false; }
    const arrived = await travel('frame', pose, true);
    if (arrived && request === state.request && state.arrived?.pose === pose) {
      rig.follow(() => frames.aim(index), { speed: FOLLOW_SPEED, onShift: (d) => { pose.position.add(d); pose.target.add(d); } });
    }
    return arrived;
  }

  function travel(id, pose, keepFrom = false) {
    if (state.fading) return state.fading;
    if (!pose) return Promise.resolve(false);
    if (id !== 'frame') state.request++;   // a frame pose still being read must not fly after this
    if (!keepFrom) { state.from = currentStation() ?? state.arrived?.id ?? null; state.progress = 0; }
    state.flying = id;
    if (reducedMotion()) {
      const token = rig.lock('fade');
      // Place the camera only once the screen is fully dark: a timer alone fires at ~93 %.
      const dark = () => /** @type {Promise<void>} */ (new Promise((resolve) => {
        const done = () => { clearTimeout(timer); fade.removeEventListener('transitionend', done); resolve(); };
        const timer = setTimeout(done, FADE_MS + 150);
        fade.addEventListener('transitionend', done);
      }));
      state.fading = new Promise((resolve) => {
        fade.classList.add('dark');
        dark().then(() => {
          rig.place(pose.position, pose.target);
          state.arrived = { id, pose };
          state.flying = null;
          fade.classList.remove('dark');
          setTimeout(() => { rig.release(token); state.fading = null; resolve(true); }, FADE_MS);
        });
      });
      return state.fading;
    }
    const seq = ++state.seq;
    return rig.flyTo(pose, { onProgress: (p) => { if (state.seq === seq) state.progress = p; } }).then((arrived) => {
      if (state.seq === seq) state.flying = null;
      if (arrived) state.arrived = { id, pose };
      return arrived;
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isEditing(e.target)) return;
    const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
    const arrow = { ArrowLeft: -1, ArrowRight: 1 }[e.code];
    if (n) go(STATIONS[Number(n) - 1]);
    else if (arrow && onFrame()) stepTo(arrow);
    else return;
    e.preventDefault();
  });

  render();
  return {
    go,
    nextFrame: () => stepTo(1),
    prevFrame: () => stepTo(-1),
    /** Index of the frame in focus (0-based), null before the first visit. */
    get focus() { return state.focus; },
    get current() { return currentStation(); },
    get last() { return state.arrived?.id ?? null; },
    get flying() { return state.flying; },
    update: render,
    element: rail,
  };
}
