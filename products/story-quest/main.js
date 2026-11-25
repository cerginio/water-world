// Story Quest — the product (STORY-QUEST-SPEC §4, §4.4). Since QDb a host page: the platform scene
// in an <iframe ?story=…&embed>, the shared panel with the Story and Weather zones; the catalog's
// state is words over the scene. The product talks to the scene only through the contract —
// nothing of src/** is imported, the iframe's window.app is not read (guard BOUNDARY-5).
import { mountShell } from '../shared/shell.js';
import { createSceneHost } from '../shared/sceneHost.js';
import { renderZones } from '../shared/zones.js';
import { storyZone, weatherZone } from '../shared/storyZones.js';
import { createQuestLayer } from '../shared/questZones.js';
import { openQuestStore } from '../shared/questStore.js';
import questData from '../shared/quests.json';
import uiMap from './ui-map.json';

const TEXT = {
  uk: {
    none: 'Історію не вибрано. Оберіть одну:',
    pending: (id) => `Завантажуємо історію «${id}»…`,
    failed: {
      network: 'Немає зв’язку з каталогом історій. Перевірте інтернет і оновіть сторінку.',
      'not-found': 'Такої історії в каталозі немає.',
      'unknown-story': 'Адреса історії має вигляд ?story=<папка>/<історія>.',
      invalid: 'Історію не вдалося прочитати: файл пошкоджений або в іншому форматі.',
      http: 'Каталог історій відповів помилкою. Спробуйте пізніше.',
      unknown: 'Історію не вдалося завантажити.',
    },
    fallback: 'Каталог недоступний — ось локальні історії для розробки:',
    others: 'Інші історії:',
  },
  en: {
    none: 'No story chosen. Pick one:',
    pending: (id) => `Loading the story «${id}»…`,
    failed: {
      network: 'The story catalog cannot be reached. Check the connection and reload the page.',
      'not-found': 'There is no such story in the catalog.',
      'unknown-story': 'A story address looks like ?story=<folder>/<story>.',
      invalid: 'The story could not be read: the file is damaged or in another format.',
      http: 'The story catalog answered with an error. Try again later.',
      unknown: 'The story could not be loaded.',
    },
    fallback: 'The catalog is unreachable — local stories for development:',
    others: 'Other stories:',
  },
};
// the scene's own switches a product link may carry through (walk, minis until Q7 makes them default)
const PASS = ['walk', 'minis', 'stick', 'mobile', 'desktop', 'fps', 'controls', 'debug'];

const params = new URLSearchParams(location.search);
let story = params.get('story');
const flags = PASS.filter((f) => params.has(f));
let catalogState = story ? { state: 'pending', story, error: null } : { state: 'idle', story: null, error: null };

const shell = mountShell({ key: 'story-quest', title: 'Story Quest', onLocale: () => { draw(); words(); } });
const host = createSceneHost({ iframe: shell.iframe });
// the quest layer (spec §3): facts from the scene's events, the log and the cards on this device
const quests = createQuestLayer({ host, store: openQuestStore('story-quest'), data: questData, locale: () => shell.locale });

function open(id) {
  story = id;
  const q = new URLSearchParams(location.search);
  q.set('story', id);
  history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/%2F/gi, '/')}`);
  catalogState = { state: 'pending', story: id, error: null };
  host.load({ story, flags });
  shell.yieldToScene();
  draw();
  words();
}

// the stories to offer over the scene: no story, or it failed
let offered = null;
async function offer() {
  offered ??= host.call('catalog.list', {}, { timeout: 30000 });
  const res = await offered;
  if (!res.ok) { offered = null; return null; }
  return res.value;
}

async function words() {
  const w = TEXT[shell.locale], { state, error } = catalogState;
  if (state === 'ready') { shell.say(null); return; }
  if (state === 'pending') { shell.say(w.pending(catalogState.story), 'pending'); return; }
  const lines = state === 'failed' ? [w.failed[error?.code] ?? w.failed.unknown] : [w.none];
  shell.say(lines[0], state);
  const list = await offer();
  if (!list || catalogState.state === 'pending' || catalogState.state === 'ready') return;
  const head = list.fallback ? w.fallback : state === 'failed' ? w.others : null;
  const ul = document.createElement('ul');
  for (const s of list.stories.slice(0, 8)) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `${s.title} (${s.id})` });
    b.dataset.story = s.id;
    b.addEventListener('click', () => open(s.id));
    const li = document.createElement('li');
    li.append(b);
    ul.append(li);
  }
  shell.say(lines[0], state, [...(head ? [Object.assign(document.createElement('div'), { textContent: head })] : []), ul]);
}

host.on((name, detail) => {
  // the catalog's «ready» is the file fetched; the field still compiles — «loading» until scene.ready
  if (name === 'catalog.change') catalogState = detail.state === 'ready' ? { ...detail, state: 'pending' } : detail;
  else if (name === 'scene.ready') catalogState = { ...catalogState, state: 'ready' };
  else if (name === 'scene.failed' && catalogState.state !== 'failed') catalogState = { ...catalogState, state: 'failed', error: { code: detail?.reason ?? 'unknown' } };
  else return;
  document.body.dataset.storyState = catalogState.state;
  words();
});

const zoneRender = {
  story: storyZone({ host, current: () => story, pick: open }),
  weather: weatherZone({ host }),
  quests: quests.quests,
  cards: quests.cards,
};
function draw() { renderZones(shell.zones, uiMap, { locale: shell.locale, render: zoneRender }); }

// a handle for probe-story-quests (the page's own state; the scene's is read through the contract)
Object.assign(window, { storyQuest: { host, quests } });

document.body.dataset.storyState = catalogState.state;
host.load({ story, flags });
draw();
words();
