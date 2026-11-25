// The product page around the scene (STORY-QUEST-SPEC §4.4), laid out like Tilecraft's story-demo:
// the scene's <iframe> fills the screen, a side panel slides it aside (or lies over it), ☰ opens the
// panel. Built here so the stand and the product have the same chrome; each page brings its zones.
import { LOCALES, pickLocale } from './zones.js';

const TEXT = {
  uk: { open: 'Відкрити панель', close: 'Закрити панель', layout: 'Панель', slide: 'Ковзна', overlay: 'Накладна', language: 'Мова' },
  en: { open: 'Open the panel', close: 'Close the panel', layout: 'Panel', slide: 'Sliding', overlay: 'Overlay', language: 'Language' },
};
const NARROW = '(max-width: 760px)';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {{ key: string, title: string, onLocale: (locale: string) => void }} options
 *   key — the product's localStorage prefix (layout and language survive a reload)
 */
export function mountShell({ key, title, onLocale }) {
  const store = {
    get: (k) => { try { return localStorage.getItem(`${key}.${k}`); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(`${key}.${k}`, v); } catch { /* private mode */ } },
  };
  let locale = pickLocale([...navigator.languages, navigator.language], store.get('locale'));

  const iframe = el('iframe', { id: 'scene', title });
  iframe.setAttribute('allow', 'fullscreen');
  const status = el('div', { id: 'sceneStatus', role: 'status', hidden: true });
  status.setAttribute('aria-live', 'polite');
  const workspace = el('main', { className: 'product-workspace' }, iframe, status);

  const zones = el('div', { id: 'zones', className: 'zones' });
  const closeBtn = el('button', { type: 'button', className: 'panel-close', textContent: '×' });
  const layoutSel = el('select', { id: 'productLayout' });
  const localeSel = el('select', { id: 'productLocale' });
  const layoutLabel = el('span'), localeLabel = el('span');
  const panel = el('aside', { id: 'productPanel', className: 'product-panel' },
    el('header', { className: 'product-panel-head' }, el('h1', { textContent: title }), closeBtn),
    el('div', { className: 'product-panel-scroll' }, zones,
      el('div', { className: 'product-preferences' },
        el('label', {}, layoutLabel, ' ', layoutSel), el('label', {}, localeLabel, ' ', localeSel))));
  const openBtn = el('button', { type: 'button', className: 'panel-open', textContent: '☰' });
  openBtn.setAttribute('aria-controls', 'productPanel');
  const dismiss = el('button', { type: 'button', className: 'panel-dismiss', tabIndex: -1, hidden: true });
  document.body.append(workspace, dismiss, panel, openBtn);

  function setOpen(open) {
    document.body.dataset.panelOpen = String(open);
    panel.inert = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    dismiss.hidden = !(open && (matchMedia(NARROW).matches || document.body.dataset.layout === 'overlay'));
  }
  function setLayout(v) {
    document.body.dataset.layout = v === 'overlay' ? 'overlay' : 'slide';
    layoutSel.value = document.body.dataset.layout;
    store.set('layout', document.body.dataset.layout);
    setOpen(document.body.dataset.panelOpen === 'true');
  }
  function words() {
    const w = TEXT[locale];
    document.documentElement.lang = locale;
    openBtn.setAttribute('aria-label', w.open);
    closeBtn.setAttribute('aria-label', w.close);
    dismiss.setAttribute('aria-label', w.close);
    layoutLabel.textContent = w.layout;
    localeLabel.textContent = w.language;
    layoutSel.replaceChildren(el('option', { value: 'slide', textContent: w.slide }), el('option', { value: 'overlay', textContent: w.overlay }));
    layoutSel.value = document.body.dataset.layout ?? 'slide';
    localeSel.replaceChildren(...LOCALES.map((l) => el('option', { value: l, textContent: l === 'uk' ? 'Українська' : 'English' })));
    localeSel.value = locale;
  }

  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  dismiss.addEventListener('click', () => setOpen(false));
  layoutSel.addEventListener('change', () => setLayout(layoutSel.value));
  localeSel.addEventListener('change', () => {
    locale = localeSel.value;
    store.set('locale', locale);
    words();
    onLocale(locale);
  });

  words();
  setLayout(store.get('layout') ?? 'slide');
  setOpen(!matchMedia(NARROW).matches);   // a phone opens on the scene, ☰ brings the panel

  return {
    iframe, zones, status,
    get locale() { return locale; },
    setOpen,
    /** after a choice on a phone the scene is what the person touches next */
    yieldToScene() { if (matchMedia(NARROW).matches) setOpen(false); },
    /** a line over the scene (loading, failed); null hides it */
    say(text, state = 'info', extra = []) {
      status.hidden = text === null;
      if (text === null) return;
      status.dataset.state = state;
      status.replaceChildren(el('div', { textContent: text }), ...extra);
    },
  };
}
