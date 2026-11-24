// Story Quest — the product shell (STORY-QUEST-SPEC §4, phase Q1). The platform scene
// (src/main.js) reads ?story=<folder>/<slug> itself; the product only words the catalog
// state for a person. products/** imports src/**, never the other way (BOUNDARY-4).
import '../../src/main.js';

const uk = (navigator.language ?? '').toLowerCase().startsWith('uk');
const TEXT = uk ? {
  none: 'Історію не вибрано. Додайте до адреси ?story=<папка>/<історія>, наприклад:',
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
} : {
  none: 'No story chosen. Add ?story=<folder>/<story> to the address, for example:',
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
};

const { catalog } = window.app;
const box = document.getElementById('storyStatus');

function show(state, lines, stories = []) {
  box.hidden = false;
  box.dataset.state = state;
  box.replaceChildren(...lines.map((text) => Object.assign(document.createElement('div'), { textContent: text })));
  if (!stories.length) return;
  const list = document.createElement('ul');
  for (const story of stories.slice(0, 8)) {
    const url = new URL(location.href);
    url.searchParams.set('story', story.id);
    const link = Object.assign(document.createElement('a'), { href: url.href, textContent: `${story.title} (${story.id})` });
    const item = document.createElement('li');
    item.append(link);
    list.append(item);
  }
  box.append(list);
}

// stories to offer when there is no story or it failed; the dev fallback when R2 is down
async function offer(state, lines) {
  show(state, lines);
  try {
    const { stories, fallback } = await catalog.list();
    const heading = fallback ? [TEXT.fallback] : state === 'failed' ? [TEXT.others] : [];
    show(state, [...lines, ...heading], stories);
  } catch {
    show(state, lines);
  }
}

function render() {
  const { state, story, error } = catalog;
  if (state === 'pending') show(state, [TEXT.pending(story.id)]);
  else if (state === 'ready') box.hidden = true;
  else if (state === 'failed') offer(state, [TEXT.failed[error.code] ?? TEXT.failed.unknown]);
}
catalog.addEventListener('change', render);
if (!new URLSearchParams(location.search).has('story')) offer('idle', [TEXT.none]);
else render();
