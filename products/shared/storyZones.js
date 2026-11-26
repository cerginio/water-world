// The zones both pages have (quest-demo-qa.md «Сторінка»): the story (the R2 catalog by folders,
// through the contract's catalog.list — the product reads no catalog of its own) and the weather
// (the mood map's nine anchors and the time of day, through mood.set).
import { t } from './zones.js';

const TEXT = {
  uk: { loading: 'Читаємо каталог…', failed: 'Каталог недоступний', fallback: 'Каталог R2 недоступний — локальні історії для розробки:',
    frames: (n) => `${n} кадр.`, by: (c) => `автор: ${c}`, day: 'Час доби', folderDown: (f, c) => `${f}/: ${c}` },
  en: { loading: 'Reading the catalog…', failed: 'The catalog is unreachable', fallback: 'The R2 catalog is unreachable — local stories for development:',
    frames: (n) => `${n} frames`, by: (c) => `by ${c}`, day: 'Time of day', folderDown: (f, c) => `${f}/: ${c}` },
};

/** The mood map's anchors (MOOD-WEATHER, src/environment/mood.js MOOD_MAP_V1): valence, arousal. */
export const WEATHER = Object.freeze([
  { id: 'calm', v: 1, a: -1, title: { uk: 'Штиль', en: 'Calm' } },
  { id: 'warm-sun', v: 1, a: 0, title: { uk: 'Тепле сонце', en: 'Warm sun' } },
  { id: 'breeze', v: 1, a: 1, title: { uk: 'Бриз', en: 'Breeze' } },
  { id: 'quiet-cloudy', v: 0, a: -1, title: { uk: 'Тиха хмарність', en: 'Quiet cloudy' } },
  { id: 'sun-through-clouds', v: 0, a: 0, title: { uk: 'Сонце крізь хмари', en: 'Sun through clouds' } },
  { id: 'torn-clouds', v: 0, a: 1, title: { uk: 'Рвані хмари', en: 'Torn clouds' } },
  { id: 'fog', v: -1, a: -1, title: { uk: 'Туман', en: 'Fog' } },
  { id: 'overcast', v: -1, a: 0, title: { uk: 'Похмуро', en: 'Overcast' } },
  { id: 'storm', v: -1, a: 1, title: { uk: 'Шторм', en: 'Storm' } },
]);
export const weatherOf = (id) => WEATHER.find((w) => w.id === id) ?? null;

/** A story's line under its title: the author and the frames, as there are. */
export function storyMeta(story, locale) {
  const w = TEXT[locale] ?? TEXT.en;
  return [story.credit ? w.by(story.credit) : '', story.frameCount ? w.frames(story.frameCount) : ''].filter(Boolean).join(' · ');
}

/** Stories grouped by folder, in the order the catalog gave them. DOM-free. */
export function byFolder(stories) {
  const groups = new Map();
  for (const s of stories) {
    if (!groups.has(s.folder)) groups.set(s.folder, []);
    groups.get(s.folder).push(s);
  }
  return [...groups].map(([folder, list]) => ({ folder, stories: list }));
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {{ host: { call: Function }, current: () => string | null, pick: (id: string) => void, local?: boolean }} options
 * @returns {(body: HTMLElement, locale: string) => void}
 */
export function storyZone({ host, current, pick, local = false }) {
  let listed = null;   // the catalog changes rarely: one list per page
  return (body, locale) => {
    const w = TEXT[locale];
    const draw = (res) => {
      if (!res.ok) { body.replaceChildren(el('p', { className: 'zone-error', textContent: `${w.failed}: ${res.message}` })); return; }
      const { stories, errors, fallback } = res.value;
      const now = current();
      body.replaceChildren(
        ...(fallback ? [el('p', { className: 'zone-note', textContent: w.fallback })] : []),
        ...errors.map((e) => el('p', { className: 'zone-note', textContent: w.folderDown(e.folder, e.code) })),
        ...byFolder(stories).map(({ folder, stories: list }) => el('div', { className: 'story-folder' },
          el('h3', { textContent: `${folder}/` }),
          el('ul', {}, ...list.map((s) => {
            const b = el('button', { type: 'button', className: 'story-pick', textContent: s.title });
            b.dataset.story = s.id;
            if (s.id === now) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', () => pick(s.id));
            const meta = storyMeta(s, locale);
            return el('li', {}, b, meta ? el('span', { className: 'zone-meta', textContent: ` ${meta}` }) : '');
          })))));
    };
    if (listed?.ok) { draw(listed); return; }
    body.replaceChildren(el('p', { className: 'zone-note', textContent: w.loading }));
    host.call('catalog.list', { local }, { timeout: 30000 }).then((res) => { listed = res.ok ? res : null; draw(res); });
  };
}

/**
 * @param {{ host: { call: Function } }} options
 * @returns {((body: HTMLElement, locale: string) => void) & { mark: (id: string) => void }}
 *   mark — the weather was set elsewhere («Затихнути»): its button pressed, no call
 */
export function weatherZone({ host }) {
  const state = { id: null, t: 0.45 };
  let grid = null;
  const apply = () => {
    const w = weatherOf(state.id) ?? weatherOf('sun-through-clouds');
    return host.call('mood.set', { v: w.v, a: w.a, t: state.t });
  };
  const render = (body, locale) => {
    grid = el('div', { className: 'weather-grid' }, ...WEATHER.map((w) => {
      const b = el('button', { type: 'button', textContent: t(w.title, locale) });
      b.dataset.weather = w.id;
      b.setAttribute('aria-pressed', String(state.id === w.id));
      b.addEventListener('click', () => {
        state.id = w.id;
        for (const x of grid.children) x.setAttribute('aria-pressed', String(x === b));
        apply();
      });
      return b;
    }));
    const day = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(state.t) });
    day.addEventListener('change', () => { state.t = Number(day.value); apply(); });
    body.replaceChildren(grid, el('label', { className: 'weather-day' }, TEXT[locale].day, ' ', day));
  };
  return Object.assign(render, {
    mark(id) {
      state.id = id;
      for (const x of grid?.children ?? []) x.setAttribute('aria-pressed', String(x.dataset.weather === id));
    },
  });
}
