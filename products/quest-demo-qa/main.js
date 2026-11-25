// quest-demo-qa — the QA stand of scene states (docs/story-quest/quest-demo-qa.md; STORY-QUEST-SPEC
// §4.4). One scene in one iframe; the zones: Story, States (the cards of states.json), Weather,
// Quests and Cards (the product's quest layer, Q6), Tech. A card reloads the scene and brings it to its state by the
// contract's commands alone; ?card=<id> opens the stand in that state. Nothing of src/** is
// imported and the iframe's window.app is never read (guard BOUNDARY-5).
import { mountShell } from '../shared/shell.js';
import { createSceneHost } from '../shared/sceneHost.js';
import { renderZones, t } from '../shared/zones.js';
import { storyZone, weatherZone } from '../shared/storyZones.js';
import { createQuestLayer } from '../shared/questZones.js';
import { openQuestStore } from '../shared/questStore.js';
import questData from '../shared/quests.json';
import { checkCards, runCard } from './cards.js';
import uiMap from './ui-map.json';
import data from './states.json';

const TEXT = {
  uk: { run: 'Зібрати', load: 'чиста сцена й історія', expect: 'очікування (state.read)', covers: 'скорочує',
    wait: 'чекає', running: 'виконується', done: 'виконано', failed: 'відмова', controls: 'Панель Controls', fps: 'Панель FPS',
    rate: (n) => `${n ?? '–'} fps`, story: (id) => `Історія: ${id}`, bad: 'states.json має помилки:' },
  en: { run: 'Build', load: 'a clean scene and the story', expect: 'expectation (state.read)', covers: 'shortens',
    wait: 'waiting', running: 'running', done: 'done', failed: 'refused', controls: 'Controls panel', fps: 'FPS panel',
    rate: (n) => `${n ?? '–'} fps`, story: (id) => `Story: ${id}`, bad: 'states.json has problems:' },
};
const DEFAULT_FLAGS = ['walk', 'minis'];

const params = new URLSearchParams(location.search);
let story = params.get('story');            // the stand's story; a card's own when none is chosen
let active = null;                          // { card, plan, ok }
let runId = 0;

const shell = mountShell({ key: 'quest-demo-qa', title: 'quest-demo-qa', onLocale: () => draw() });
const host = createSceneHost({ iframe: shell.iframe });
// the same quest layer as the product, its own database: a card's facts show up as the product's would
const quests = createQuestLayer({ host, store: openQuestStore('quest-demo-qa'), data: questData, locale: () => shell.locale });
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const problems = checkCards(data);

function syncUrl() {
  const q = new URLSearchParams();
  if (story) q.set('story', story);
  if (active) q.set('card', active.card.id);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q.toString().replace(/%2F/gi, '/')}` : ''}`);
}

/** the scene with the stand's story, no card */
function openStory(id) {
  story = id;
  active = null;
  runId++;
  document.body.dataset.cardState = '';
  syncUrl();
  host.load({ story, flags: DEFAULT_FLAGS });
  draw();
}

async function run(card) {
  const mine = ++runId;
  active = { card, plan: [], ok: null };
  document.body.dataset.card = card.id;
  document.body.dataset.cardState = 'running';
  syncUrl();
  shell.yieldToScene();
  const result = await runCard(card, { load: (p) => host.load(p), call: (c, a, o) => host.call(c, a, o) }, {
    story,
    onChange: (plan) => { if (mine === runId) { active.plan = plan; drawSteps(); } },
  });
  if (mine !== runId) return;
  active.ok = result.ok;
  document.body.dataset.cardState = result.ok ? 'done' : 'failed';
  drawCards();
}

// --- zones ---------------------------------------------------------------------------------
let statesBody = null;
function drawCards() {
  if (!statesBody) return;
  const locale = shell.locale, w = TEXT[locale];
  statesBody.replaceChildren(
    ...(problems.length ? [el('p', { className: 'zone-error', textContent: `${w.bad} ${problems.join('; ')}` })] : []),
    ...data.groups.map((g) => el('div', { className: 'card-group' },
      el('h3', { textContent: t(g.title, locale) }),
      el('ul', {}, ...data.cards.filter((c) => c.group === g.id).map((c) => {
        const b = el('button', { type: 'button', className: 'card-pick', textContent: t(c.title, locale) });
        b.dataset.card = c.id;
        if (active?.card.id === c.id) {
          b.setAttribute('aria-current', 'true');
          b.dataset.state = active.ok === null ? 'running' : active.ok ? 'done' : 'failed';
        }
        b.title = `${w.covers}: ${c.covers.join(', ')}`;
        b.addEventListener('click', () => run(c));
        const li = el('li', {}, b);
        if (active?.card.id === c.id) li.append(el('ol', { className: 'card-steps', id: 'cardSteps' }));
        return li;
      })))));
  drawSteps();
}
function drawSteps() {
  const list = document.getElementById('cardSteps');
  if (!list || !active) return;
  const w = TEXT[shell.locale];
  list.replaceChildren(...active.plan.map((p) => {
    const name = p.kind === 'load' ? w.load : p.kind === 'expect' ? w.expect : `${p.cmd} ${Object.keys(p.args).length ? JSON.stringify(p.args) : ''}`;
    const word = { wait: w.wait, run: w.running, done: w.done, failed: w.failed }[p.status];
    const li = el('li', { textContent: `${name} — ${word}${p.ms !== undefined ? ` · ${(p.ms / 1000).toFixed(1)} s` : ''}` });
    li.dataset.status = p.status;
    if (p.status === 'failed') li.append(el('div', { className: 'card-reason', textContent: `${p.reason}${p.message ? `: ${p.message}` : ''}` }));
    return li;
  }));
}

function techZone(body, locale) {
  const w = TEXT[locale];
  const box = (label, key) => {
    const input = el('input', { type: 'checkbox' });
    input.dataset.tech = key;
    input.addEventListener('change', () => host.call('scene.tech', { [key]: input.checked }).then(show));
    return el('label', { className: 'tech-toggle' }, input, ` ${label}`);
  };
  const rate = el('div', { className: 'tech-rate' });
  const out = el('pre', { className: 'tech-state', id: 'techState' });
  body.replaceChildren(box(w.controls, 'controls'), box(w.fps, 'fps'), rate, out);
  function show(r) {
    if (!r.ok) return;
    for (const input of body.querySelectorAll('input[data-tech]')) input.checked = r.value[input.dataset.tech];
    rate.textContent = w.rate(r.value.rate);
  }
  // while the zone is open: the panels, the frame rate and state.read as text, once a second
  const zone = body.closest('details');
  const tick = async () => {
    if (!zone?.isConnected) return;
    if (zone.open && host.client?.info) {
      show(await host.call('scene.tech', {}, { timeout: 5000 }));
      const s = await host.call('state.read', {}, { timeout: 5000 });
      out.textContent = s.ok ? JSON.stringify({ ...s.value, frames: s.value.frames.map((f) => ({ ...f, id: undefined })) }, null, 1) : `${s.reason}: ${s.message}`;
    }
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 0);   // the zone is put into the page after its renderer returns
}

const zoneRender = {
  story: storyZone({ host, current: () => story ?? active?.card.story ?? null, pick: openStory, local: true }),
  states: (body) => { statesBody = body; drawCards(); },
  weather: weatherZone({ host }),
  quests: quests.quests,
  cards: quests.cards,
  tech: techZone,
};
function draw() { renderZones(shell.zones, uiMap, { locale: shell.locale, render: zoneRender }); }

// the stand's own debugging handle for probe-story-states (the stand reads nothing of the scene's)
Object.assign(window, { questDemo: { host, quests, cards: data.cards, run: (id) => run(data.cards.find((c) => c.id === id)) } });

// the scene first: the zones ask it (the catalog) as they are drawn
const first = data.cards.find((c) => c.id === params.get('card'));
if (first) run(first);
else host.load({ story: story ?? data.cards[0].story, flags: DEFAULT_FLAGS });
draw();
