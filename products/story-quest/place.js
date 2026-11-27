// The choice «Місце» (ISLAND-MAPS-SPEC §2, §4.3): the map the story is walked on, in the story zone
// of the product's ui-map. The words and the maps' titles are the map's data; the ids are the
// contract's SCENE_MAPS. The choice shows the map the scene reported in scene.ready; a tap writes
// the id into the product's URL and reloads the scene with the same story and language.
import { t } from '../shared/zones.js';

/**
 * The product's address with the map set, everything else kept (the story's `/` readable).
 * DOM-free. @param {string} search location.search @param {string} id a known map
 */
export function placeSearch(search, id) {
  const q = new URLSearchParams(search);
  q.set('map', id);
  return `?${q.toString().replace(/%2F/gi, '/')}`;
}

/**
 * @param {any} place the story zone's `place` from ui-map.json: { title, note, maps: [{ id, title }] }
 * @param {string} locale
 * @returns {{ title: string, note: string, maps: { id: string, title: string }[] }}
 */
export function placeOf(place, locale) {
  if (!place || !Array.isArray(place.maps)) throw new Error('ui-map: place.maps is a list');
  return { title: t(place.title, locale), note: t(place.note, locale), maps: place.maps.map((m) => ({ id: m.id, title: t(m.title, locale) || m.id })) };
}

/**
 * @param {{ place: any, locale: string, current: string, pick: (id: string) => void }} options
 * @returns {HTMLElement} a <fieldset> of one button per map, the current one pressed
 */
export function placeChoice({ place, locale, current, pick }) {
  const p = placeOf(place, locale);
  const box = document.createElement('fieldset');
  box.className = 'place-choice';
  box.append(Object.assign(document.createElement('legend'), { textContent: p.title }));
  const row = Object.assign(document.createElement('div'), { className: 'place-maps' });
  for (const m of p.maps) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'place-pick', textContent: m.title });
    b.dataset.map = m.id;
    b.setAttribute('aria-pressed', String(m.id === current));
    b.addEventListener('click', () => { if (m.id !== current) pick(m.id); });
    row.append(b);
  }
  box.append(row, Object.assign(document.createElement('p'), { className: 'zone-note place-note', textContent: p.note }));
  return box;
}
