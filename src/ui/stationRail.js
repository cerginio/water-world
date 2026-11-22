// The station rail (SCENE-UI-SPEC §4.1–4.5): four nodes at the bottom of the screen that
// fly the camera to a station. A node is filled (●) while the camera stands on its
// station; once the person moves the camera away (> 5 % of the station's distance or
// > 8° of turn) none is filled and the last station shows as a ring (◎). A bead runs
// along the rail during a flight. With prefers-reduced-motion there is no flight: the
// screen fades out for 250 ms, the camera is placed, the screen fades back in.
//
// The rail never writes the camera itself and never touches the sun: poses go to the
// camera owner (cameraRig.js).
import { isEditing } from './techPanels.js';

export const STATIONS = ['island', 'shore', 'story', 'frame'];

const LABELS = {
  uk: { island: 'Острів', shore: 'Берег', story: 'Історія', frame: 'Мить', rail: 'Опорні точки камери',
    noStory: 'Історію не завантажено', soon: 'Мить — ще не готова' },
  en: { island: 'Island', shore: 'Shore', story: 'Story', frame: 'Moment', rail: 'Camera stations',
    noStory: 'Story not loaded', soon: 'Moment — not ready yet' },
};

export const railLanguage = (languages) => (languages.some((l) => /^uk\b/i.test(l)) ? 'uk' : 'en');

const FADE_MS = 250;
const MOVED_SHARE = 0.05, TURN_DEG = 8;

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
 *   isActive: (id: string) => boolean, hasStory: () => boolean,
 *   reducedMotion?: () => boolean, language?: string }} options
 *   `poseOf(id)` — the station's pose now; `isActive(id)` — can the camera go there.
 */
export function createStationRail({ rig, poseOf, isActive, hasStory,
  reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  language = railLanguage([...navigator.languages, navigator.language]) }) {
  const text = LABELS[language] ?? LABELS.en;
  const state = { arrived: null, flying: null, from: null, progress: 0, fading: null, seq: 0 };

  const rail = document.createElement('nav');
  rail.id = 'stationRail';
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
    button.setAttribute('aria-keyshortcuts', String(i + 1));
    button.addEventListener('click', () => go(id));
    rail.append(button);
    nodes[id] = button;
  }
  document.body.append(rail);

  const fade = document.createElement('div');
  fade.id = 'stationFade';
  document.body.append(fade);

  const shown = {};   // last DOM state per node, so update() writes only on change
  function render() {
    const current = currentStation();
    for (const id of STATIONS) {
      const active = isActive(id);
      const mark = current === id ? 'on' : !current && !state.flying && state.arrived?.id === id ? 'last' : '';
      const hint = active ? '' : id === 'frame' && hasStory() ? text.soon : text.noStory;
      const key = `${active}|${mark}|${hint}`;
      if (shown[id] === key) continue;
      shown[id] = key;
      const node = nodes[id];
      node.setAttribute('aria-disabled', String(!active));
      node.classList.toggle('on', mark === 'on');
      node.classList.toggle('last', mark === 'last');
      if (mark === 'on') node.setAttribute('aria-current', 'location');
      else node.removeAttribute('aria-current');
      node.title = hint;
      node.setAttribute('aria-label', hint ? `${text[id]} — ${hint}` : text[id]);
    }
    if (state.flying) {
      const a = STATIONS.indexOf(state.from ?? state.flying), b = STATIONS.indexOf(state.flying);
      bead.hidden = false;
      bead.style.left = `${((a + (b - a) * state.progress) / (STATIONS.length - 1)) * 100}%`;
    } else bead.hidden = true;
  }

  function currentStation() {
    const a = state.arrived;
    if (!a || state.flying || rig.flying) return null;
    return onStation(rig.camera.position, rig.controls.target, a.pose) ? a.id : null;
  }

  /** Flies (or, with reduced motion, fades) to station `id`. Resolves true on arrival. */
  function go(id) {
    if (!STATIONS.includes(id) || !isActive(id)) return Promise.resolve(false);
    if (state.fading) return state.fading;
    const pose = poseOf(id);
    if (!pose) return Promise.resolve(false);
    state.from = currentStation() ?? state.arrived?.id ?? null;
    state.flying = id;
    state.progress = 0;
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
    const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
    if (!n || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isEditing(e.target)) return;
    e.preventDefault();
    go(STATIONS[Number(n) - 1]);
  });

  render();
  return {
    go,
    // Station `frame` arrives in U2 (SCENE-UI-SPEC §4.3).
    nextFrame: () => Promise.resolve(false),
    prevFrame: () => Promise.resolve(false),
    get current() { return currentStation(); },
    get last() { return state.arrived?.id ?? null; },
    get flying() { return state.flying; },
    update: render,
    element: rail,
  };
}
