// The panel's zones from a product's ui-map (quest-demo-qa.md «Сторінка»): the stand and the product
// differ only by which zones their map lists. The map is data; what a zone holds is the page's
// renderer for that zone id. zonesOf is DOM-free (unit-tested), renderZones builds the <details>.

export const LOCALES = Object.freeze(['uk', 'en']);

/** @param {readonly string[]} languages navigator.languages @param {string | null} [stored] */
export function pickLocale(languages, stored = null) {
  if (stored && LOCALES.includes(stored)) return stored;
  return languages.some((l) => String(l).toLowerCase().startsWith('uk')) ? 'uk' : 'en';
}

/** A text of the map or the data: { uk, en } or a plain string. */
export function t(text, locale) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'object') return String(text);
  return text[locale] ?? text.en ?? text.uk ?? '';
}

/**
 * @param {{ zones: { id: string, title: any, open?: boolean, empty?: any }[] }} uiMap
 * @param {string} locale
 * @returns {{ id: string, title: string, open: boolean, empty: string }[]}
 */
export function zonesOf(uiMap, locale) {
  if (!uiMap || !Array.isArray(uiMap.zones)) throw new Error('ui-map: zones is a list');
  const seen = new Set();
  return uiMap.zones.map((z) => {
    if (!z || typeof z.id !== 'string' || !z.id) throw new Error('ui-map: a zone needs an id');
    if (seen.has(z.id)) throw new Error(`ui-map: zone ${z.id} twice`);
    seen.add(z.id);
    return { id: z.id, title: t(z.title, locale) || z.id, open: z.open !== false, empty: t(z.empty, locale) };
  });
}

/**
 * @param {HTMLElement} root
 * @param {any} uiMap
 * @param {{ locale: string, render: Record<string, (body: HTMLElement, locale: string) => void> }} options
 *   a zone without a renderer shows its `empty` text (the Quests zone until Q6)
 */
export function renderZones(root, uiMap, { locale, render }) {
  const was = new Map([...root.querySelectorAll('details.zone')].map((d) => [d.dataset.zone, d.open]));
  root.replaceChildren(...zonesOf(uiMap, locale).map((z) => {
    const box = document.createElement('details');
    box.className = 'zone';
    box.dataset.zone = z.id;
    box.open = was.get(z.id) ?? z.open;
    const head = document.createElement('summary');
    head.textContent = z.title;
    const body = document.createElement('div');
    body.className = 'zone-body';
    box.append(head, body);
    if (render[z.id]) render[z.id](body, locale);
    else body.append(Object.assign(document.createElement('p'), { className: 'zone-empty', textContent: z.empty }));
    return box;
  }));
}
