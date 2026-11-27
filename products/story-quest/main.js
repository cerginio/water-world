// Story Quest — the product (STORY-QUEST-SPEC §2, §4, §4.4). A host page: the platform scene in an
// <iframe ?story=…&walk&minis&embed> — the whole route by default (Q7) — and the shared panel with
// the product's zones; the catalog's state and the choice of a story are words over the scene;
// «На берег» and «Затихнути» are always in sight (Edge §7). The product talks to the scene only
// through the contract — nothing of src/** is imported, window.app is not read (guard BOUNDARY-5).
import { mountShell } from '../shared/shell.js';
import { createSceneHost } from '../shared/sceneHost.js';
import { DEFAULT_SCENE_MAP, knownMap } from '../shared/contract.js';
import { renderZones } from '../shared/zones.js';
import { storyMeta, storyZone, weatherZone } from '../shared/storyZones.js';
import { packZone } from '../shared/packZone.js';
import { sayWithIcon } from '../shared/icons.js';
import { createQuestLayer } from '../shared/questZones.js';
import { openQuestStore } from '../shared/questStore.js';
import { mountProductEmbed } from '../shared/productEmbed.js';
import questData from '../shared/quests.json';
import uiMap from './ui-map.json';
import { placeChoice, placeSearch } from './place.js';

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
    shore: 'На берег', quiet: 'Затихнути', calm: 'Спокій',
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
    shore: 'To the shore', quiet: 'Quiet down', calm: 'Calm',
  },
};
// the route of §2 is the product: the walker and the miniatures always (Q7)
const ROUTE = ['walk', 'minis'];
// the scene's own switches a product link may carry through
const PASS = ['stick', 'mobile', 'desktop', 'fps', 'controls', 'debug'];

const params = new URLSearchParams(location.search);
let story = params.get('story');
// the map (ISLAND-MAPS-SPEC §2): stays in the product's URL as given; only a known id reaches the
// iframe, an unknown one opens the default island there
const map = () => knownMap(new URLSearchParams(location.search).get('map'));
// the map the choice «Місце» shows: the scene's own word in scene.ready, until then what was asked
let shownMap = map() ?? DEFAULT_SCENE_MAP;
const passed = PASS.filter((f) => params.has(f));
// without a story the scene is only the island behind the choice: no walker, no stick yet
const flags = () => [...(story ? ROUTE : []), ...passed];
let catalogState = story ? { state: 'pending', story, error: null } : { state: 'idle', story: null, error: null };

const shell = mountShell({ key: 'story-quest', title: 'Story Quest', onLocale: (locale) => {
  draw(); words(); calmWords();
  host.call('scene.locale', { locale }, { timeout: 5000 });
} });
const host = createSceneHost({ iframe: shell.iframe });
// the quest layer (spec §3): facts from the scene's events, the log and the cards on this device
const quests = createQuestLayer({ host, store: openQuestStore('story-quest'), data: questData, locale: () => shell.locale });

function open(id) {
  story = id;
  const q = new URLSearchParams(location.search);
  q.set('story', id);
  history.replaceState(null, '', `${location.pathname}?${q.toString().replace(/%2F/gi, '/')}`);
  catalogState = { state: 'pending', story: id, error: null };
  host.load({ story, flags: flags(), lang: shell.locale, map: map() });
  shell.yieldToScene();
  draw();
  words();
}

// «Місце» (ISLAND-MAPS-SPEC §2): the id into the product's URL, the scene reloaded with the same
// story and language — the route starts over; the cards and quests are the story's, not the map's
function place(id) {
  if (!knownMap(id)) return;
  history.replaceState(null, '', `${location.pathname}${placeSearch(location.search, id)}`);
  shownMap = id;
  if (story) catalogState = { state: 'pending', story, error: null };
  document.body.dataset.storyState = catalogState.state;
  host.load({ story, flags: flags(), lang: shell.locale, map: map() });
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
  ul.className = 'story-choice';
  for (const s of list.stories) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'story-choice-pick' });
    b.append(Object.assign(document.createElement('span'), { className: 'story-choice-title', textContent: s.title }));
    const meta = storyMeta(s, shell.locale);
    if (meta) b.append(Object.assign(document.createElement('span'), { className: 'story-choice-meta', textContent: meta }));
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
  else if (name === 'scene.ready') {
    catalogState = { ...catalogState, state: 'ready' };
    if (detail?.map && detail.map !== shownMap) { shownMap = detail.map; draw(); }
  }
  else if (name === 'scene.failed' && catalogState.state !== 'failed') catalogState = { ...catalogState, state: 'failed', error: { code: detail?.reason ?? 'unknown' } };
  else return;
  document.body.dataset.storyState = catalogState.state;
  words();
});

const weather = weatherZone({ host });
// the story zone of the product: «Місце» above the stories (the stand's story zone has no map, §4.5)
const placeData = uiMap.zones.find((z) => z.id === 'story').place;
function storyAndPlace(stories) {
  return (body, locale) => {
    const list = document.createElement('div');
    body.replaceChildren(placeChoice({ place: placeData, locale, current: shownMap, pick: place }), list);
    stories(list, locale);
  };
}
const zoneRender = {
  story: storyAndPlace(storyZone({ host, current: () => story, pick: open })),
  pack: packZone({ host }),
  weather,
  quests: quests.quests,
  cards: quests.cards,
};

// «На берег» (a calm state: the walker on the beach) and «Затихнути» (the calm weather), always in
// sight over the scene (Edge §7); nothing is undone by them — the frames keep their fates
const calm = document.createElement('nav');
calm.id = 'calmBar';
const shore = Object.assign(document.createElement('button'), { type: 'button', id: 'toShore' });
const quiet = Object.assign(document.createElement('button'), { type: 'button', id: 'quietDown' });
shore.addEventListener('click', () => { if (story) host.call('walker.shore', {}, { timeout: 20000 }); shell.yieldToScene(); });
quiet.addEventListener('click', () => { host.call('mood.quiet', {}, { timeout: 5000 }); weather.mark('calm'); });
calm.append(shore, quiet);
document.body.append(calm);
function calmWords() {
  const w = TEXT[shell.locale];
  calm.setAttribute('aria-label', w.calm);
  sayWithIcon(shore, 'toShore', w.shore);
  quiet.textContent = w.quiet;
}
calmWords();
function draw() { renderZones(shell.zones, uiMap, { locale: shell.locale, render: zoneRender }); }

// a handle for probe-story-quests (the page's own state; the scene's is read through the contract)
Object.assign(window, { storyQuest: { host, quests } });

document.body.dataset.storyState = catalogState.state;
document.body.dataset.product = 'story-quest';
host.load({ story, flags: flags(), lang: shell.locale, map: map() });
draw();
words();
if (params.has('embed')) mountProductEmbed({ host, iframe: shell.iframe, quests, shell, devOrigin: import.meta.env.DEV ? 'http://127.0.0.1:8184' : null });
