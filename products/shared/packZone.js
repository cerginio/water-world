// The backpack zone (STORY-QUEST-SPEC §4.1 «Персонаж», story-quest Q7): one miniature in the
// hands, the others in the backpack. The scene keeps them (state.read: `carried`, `pack`); the
// zone words them and moves one between the hands and the backpack through the contract
// (minis.stow / minis.unpack). It redraws on the scene's miniature events.
import { sayWithIcon } from './icons.js';

const TEXT = {
  uk: { hands: 'У руках', free: 'Руки вільні', pack: 'У рюкзаку', empty: 'Рюкзак порожній',
    frame: (n) => `Кадр ${n}`, stow: 'У рюкзак', unpack: 'У руки', none: 'Мініатюр у цій сцені немає',
    note: 'Узяти ще одну — та, що в руках, піде в рюкзак. Покласти можна ту, що в руках.' },
  en: { hands: 'In the hands', free: 'The hands are free', pack: 'In the backpack', empty: 'The backpack is empty',
    frame: (n) => `Frame ${n}`, stow: 'Into the backpack', unpack: 'Into the hands', none: 'No miniatures in this scene',
    note: 'Take another and the one in the hands goes into the backpack. Only the one in the hands is put down.' },
};
const REDRAW = new Set(['scene.ready', 'minis.take', 'minis.put', 'minis.unfold', 'minis.pack', 'minis.unpack']);

/**
 * What the zone shows, from state.read. DOM-free.
 * @param {{ carried?: number | null, pack?: number[], frames?: { mini: string | null }[] } | null} state
 * @returns {{ minis: boolean, hands: number | null, pack: number[] }}
 */
export function packView(state) {
  const minis = !!state?.frames?.some((f) => f.mini !== null);
  return { minis, hands: state?.carried ?? null, pack: [...(state?.pack ?? [])] };
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {{ host: { call: Function, on: (fn: (name: string, detail: any) => void) => () => void } }} options
 * @returns {(body: HTMLElement, locale: string) => void}
 */
export function packZone({ host }) {
  let body = null, locale = 'en', seq = 0;
  const draw = async () => {
    if (!body) return;
    const mine = ++seq, res = await host.call('state.read', {}, { timeout: 5000 });
    if (mine !== seq || !body) return;
    const w = TEXT[locale], v = packView(res.ok ? res.value : null);
    body.dataset.hands = v.hands === null ? '' : String(v.hands);
    body.dataset.pack = v.pack.join(' ');
    if (!v.minis) { body.replaceChildren(el('p', { className: 'zone-empty', textContent: w.none })); return; }
    const move = (text, cmd, args) => {
      const b = el('button', { type: 'button' });
      sayWithIcon(b, cmd === 'minis.stow' ? 'stow' : 'unpack', text);
      b.dataset.cmd = cmd;
      b.addEventListener('click', () => { b.disabled = true; host.call(cmd, args).then(draw); });
      return b;
    };
    const hands = v.hands === null ? el('p', { className: 'zone-note', textContent: w.free })
      : el('div', { className: 'pack-row' }, el('span', { textContent: w.frame(v.hands + 1) }), move(w.stow, 'minis.stow', {}));
    const pack = v.pack.length ? el('ul', {}, ...v.pack.map((i) => {
      const li = el('li', { className: 'pack-row' }, el('span', { textContent: w.frame(i + 1) }), move(w.unpack, 'minis.unpack', { frame: i }));
      li.dataset.frame = String(i);
      return li;
    })) : el('p', { className: 'zone-note', textContent: w.empty });
    body.replaceChildren(el('h3', { textContent: w.hands }), hands, el('h3', { textContent: w.pack }), pack,
      el('p', { className: 'zone-note', textContent: w.note }));
  };
  host.on((name) => { if (REDRAW.has(name)) draw(); });
  return (b, l) => { body = b; locale = l; draw(); };
}
