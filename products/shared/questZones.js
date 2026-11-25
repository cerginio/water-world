// The Quests and Cards zones (STORY-QUEST-SPEC §3; quest-demo-qa.md «Сторінка»): the quest layer
// bound to a page's scene host. The facts come as the contract's events (§4.4); the log is keyed
// by the story + the model's fingerprint and kept in the product's IndexedDB; the export is a file
// made in the page (a Blob) — nothing goes to the network. The logic is quests.js; here the DOM.
import {
  applyEvent, bindingLabel, deleteCard, exportJson, exportMarkdown, exportName, logKey, promptText,
  restoreLog, saveCard, setStatus, tasksView, tick, words,
} from './quests.js';

const TEXT = {
  uk: {
    wait: 'Задачі з’являться, коли історія завантажиться.',
    byFact: 'зроблено за фактом', byHand: 'позначено вручну',
    defer: 'Відкласти', remove: 'Прибрати', back: 'Повернути',
    deferred: 'Відкладене', removed: (n) => `Прибране (${n})`,
    offer: 'Записати, як саме і чому?', write: 'Записати', later: 'Не зараз',
    add: 'Нова картка', prompt: 'Підказка', noPrompt: '— без підказки —', text: 'Текст', bind: 'Прив’язка',
    here: 'Це місце', save: 'Зберегти', cancel: 'Скасувати', edit: 'Змінити', del: 'Видалити', sure: 'Точно видалити?',
    none: 'Карток поки немає.', json: 'Експорт JSON', md: 'Експорт Markdown', card: 'Картка',
    memory: 'Сховище пристрою недоступне: записи житимуть, доки відкрита сторінка.',
  },
  en: {
    wait: 'The tasks appear once the story has loaded.',
    byFact: 'done by the fact', byHand: 'ticked by hand',
    defer: 'Put aside', remove: 'Take off', back: 'Bring back',
    deferred: 'Put aside', removed: (n) => `Taken off (${n})`,
    offer: 'Write down how exactly, and why?', write: 'Write', later: 'Not now',
    add: 'New card', prompt: 'Prompt', noPrompt: '— no prompt —', text: 'Text', bind: 'Bound to',
    here: 'This place', save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', sure: 'Delete for sure?',
    none: 'No cards yet.', json: 'Export JSON', md: 'Export Markdown', card: 'Card',
    memory: 'The device storage is unavailable: the notes live while the page is open.',
  },
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const button = (text, onClick, data = {}) => {
  const b = el('button', { type: 'button', textContent: text });
  Object.assign(b.dataset, data);
  b.addEventListener('click', onClick);
  return b;
};

/**
 * @param {{ host: { call: Function, on: Function }, store: Promise<import('./questStore.js').QuestStore>, data: any,
 *   locale: () => string }} options
 */
export function createQuestLayer({ host, store, data, locale }) {
  let log = null, key = null, scene = null;
  let queue = [];                  // events before the log is read from the store
  let saving = Promise.resolve();
  let offer = null;                // a task ticked by hand: the offer of a card
  let editing = null;              // { id?, text, prompt, bind, binds } while the editor is open
  let showRemoved = false, confirmDelete = null;
  const bodies = { quests: null, cards: null };
  const listeners = new Set();

  const persist = () => {
    const k = key, value = log;
    saving = saving.then(async () => (await store).put(k, value)).catch((err) => console.error('[quests] save', err));
    return saving;
  };
  const change = (next) => {
    if (next === log) return;
    log = next;
    persist();
    redraw();
    for (const fn of listeners) fn(log);
  };

  async function attach(detail) {
    const story = detail?.story ?? null;
    if (!story) return;
    const fingerprint = detail.fingerprint ?? null;
    const s = await host.call('state.read', {}, { timeout: 15000 });
    const frames = s.ok ? s.value.frames.map((f) => ({ id: f.id, index: f.index })) : [];
    const k = logKey(story, fingerprint);
    await saving;   // the same story reloaded: read what was just written
    const saved = await (await store).get(k);
    scene = { story, fingerprint };
    key = k;
    let next = restoreLog(saved, { story, fingerprint, frames });
    for (const [name, d] of queue) next = applyEvent(next, name, d);
    queue = [];
    log = null;
    change(next);
  }

  host.on((name, detail) => {
    if (name === 'scene.ready') { log = null; key = null; queue = []; attach(detail).catch((err) => console.error('[quests]', err)); return; }
    if (name === 'catalog.change' && detail?.state === 'pending') { log = null; key = null; queue = []; editing = null; redraw(); return; }
    if (!log) { queue.push([name, detail]); return; }
    change(applyEvent(log, name, detail));
  });

  // --- the Quests zone --------------------------------------------------------------------------
  function drawQuests() {
    // the renderer runs before renderZones puts the zone into the page: no isConnected test
    const body = bodies.quests;
    if (!body) return;
    const loc = locale(), w = TEXT[loc];
    if (!log) { body.replaceChildren(el('p', { className: 'zone-note', textContent: w.wait })); return; }
    const rows = tasksView(log, data, loc);
    const row = (t) => {
      // done by the fact: a full tick like a hand one (not greyed as disabled), it does not untick
      const box = el('input', { type: 'checkbox', checked: t.done });
      box.dataset.task = t.id;
      if (t.auto) box.dataset.auto = 'true';
      box.addEventListener('change', () => {
        if (t.auto) { box.checked = true; return; }
        offer = box.checked ? t.id : null;
        change(tick(log, t.id, box.checked));
      });
      const how = t.done ? (t.auto ? w.byFact : w.byHand) : '';
      const label = el('label', { className: 'quest-title' }, box, ` ${t.title}`);
      if (how) label.title = how;
      const li = el('li', { className: 'quest' }, label);
      li.dataset.task = t.id;
      li.dataset.done = String(t.done);
      if (t.fact) li.append(el('div', { className: 'quest-fact', textContent: t.fact }));
      const acts = el('div', { className: 'quest-actions' });
      if (t.status === 'open') acts.append(button(w.defer, () => change(setStatus(log, t.id, 'deferred')), { act: 'defer' }),
        button(w.remove, () => change(setStatus(log, t.id, 'removed')), { act: 'remove' }));
      else acts.append(button(w.back, () => change(setStatus(log, t.id, 'open')), { act: 'back' }));
      li.append(acts);
      if (offer === t.id && t.status === 'open') {
        li.append(el('div', { className: 'quest-offer' }, el('span', { textContent: w.offer }), ' ',
          button(w.write, () => { offer = null; openEditor({ prompt: data.manualPrompt.id, bind: { kind: 'task', task: t.id } }); }, { act: 'write' }),
          button(w.later, () => { offer = null; drawQuests(); }, { act: 'later' })));
      }
      return li;
    };
    const open = rows.filter((t) => t.status === 'open');
    const put = rows.filter((t) => t.status === 'deferred');
    const off = rows.filter((t) => t.status === 'removed');
    const parts = [el('ul', { className: 'quests', id: 'questList' }, ...open.map(row))];
    if (put.length) parts.push(el('h3', { textContent: w.deferred }), el('ul', { className: 'quests deferred' }, ...put.map(row)));
    if (off.length) {
      parts.push(button(w.removed(off.length), () => { showRemoved = !showRemoved; drawQuests(); }, { act: 'show-removed' }));
      if (showRemoved) parts.push(el('ul', { className: 'quests removed' }, ...off.map(row)));
    }
    body.replaceChildren(...parts);
  }

  // --- the Cards zone ---------------------------------------------------------------------------
  let cardsList = null, editorBox = null, storeNote = null;

  async function openEditor(preset = {}) {
    const s = await host.call('state.read', {}, { timeout: 5000 });
    const st = s.ok ? s.value : null;
    const here = st?.walker ? { kind: 'place', x: Math.round(st.walker.x * 10) / 10, z: Math.round(st.walker.z * 10) / 10 } : null;   // as saved
    const frameAt = (index) => st?.frames.find((f) => f.index === index);
    const nowFrame = st ? frameAt(st.walker?.deck ?? st.carried ?? -1) : null;
    const bind = preset.bind ?? (nowFrame ? { kind: 'frame', frameId: nowFrame.id, index: nowFrame.index } : here ?? { kind: 'none' });
    editing = { id: preset.id ?? null, text: preset.text ?? '', prompt: preset.prompt ?? null, bind, here };
    bodies.cards?.closest('details')?.setAttribute('open', '');
    drawEditor();
    editorBox?.querySelector('textarea')?.focus();
  }

  function drawEditor() {
    if (!editorBox) return;
    if (!editing || !log) { editorBox.replaceChildren(); editorBox.hidden = true; return; }
    const loc = locale(), w = TEXT[loc];
    editorBox.hidden = false;
    const prompts = [...data.prompts, ...(editing.prompt === data.manualPrompt.id ? [data.manualPrompt] : [])];
    const promptSel = el('select', { id: 'cardPrompt' }, el('option', { value: '', textContent: w.noPrompt }),
      ...prompts.map((p) => el('option', { value: p.id, textContent: words(p, loc) })));
    promptSel.value = editing.prompt ?? '';
    promptSel.addEventListener('change', () => { editing.prompt = promptSel.value || null; });
    const text = el('textarea', { id: 'cardText', rows: 4, value: editing.text });
    text.placeholder = promptText(editing.prompt, data, loc);
    text.addEventListener('input', () => { editing.text = text.value; });
    promptSel.addEventListener('change', () => { text.placeholder = promptText(editing.prompt, data, loc); });

    // the bindings to choose from: none, this place, every frame, every task — the current first
    const options = [{ kind: 'none' }];
    if (editing.here) options.push(editing.here);
    if (editing.bind.kind === 'place' && editing.bind !== editing.here) options.push(editing.bind);
    for (const f of log.frames) options.push({ kind: 'frame', frameId: f.id, index: f.index });
    for (const t of data.tasks) options.push({ kind: 'task', task: t.id });
    const same = (a, b) => a.kind === b.kind && (a.kind !== 'frame' || a.frameId === b.frameId) && (a.kind !== 'task' || a.task === b.task)
      && (a.kind !== 'place' || (a.x === b.x && a.z === b.z));
    const bindSel = el('select', { id: 'cardBind' }, ...options.map((o, i) => el('option', {
      value: String(i), textContent: o === editing.here ? `${w.here} · ${bindingLabel(o, data, loc)}` : bindingLabel(o, data, loc) })));
    bindSel.value = String(Math.max(0, options.findIndex((o) => same(o, editing.bind))));
    bindSel.addEventListener('change', () => { editing.bind = options[Number(bindSel.value)]; });

    editorBox.replaceChildren(
      el('label', { className: 'card-field' }, w.prompt, promptSel),
      el('label', { className: 'card-field' }, w.text, text),
      el('label', { className: 'card-field' }, w.bind, bindSel),
      el('div', { className: 'card-buttons' },
        button(w.save, () => {
          if (!editing.text.trim()) { text.focus(); return; }
          const next = saveCard(log, { id: editing.id ?? undefined, text: editing.text, prompt: editing.prompt, bind: editing.bind });
          editing = null;
          drawEditor();
          change(next);
        }, { act: 'save' }),
        button(w.cancel, () => { editing = null; drawEditor(); }, { act: 'cancel' })));
  }

  function drawCardList() {
    if (!cardsList) return;
    const loc = locale(), w = TEXT[loc];
    if (!log) { cardsList.replaceChildren(); return; }
    if (!log.cards.length) { cardsList.replaceChildren(el('p', { className: 'zone-note', textContent: w.none })); return; }
    cardsList.replaceChildren(el('ul', { className: 'cards', id: 'cardList' }, ...[...log.cards].reverse().map((c) => {
      const li = el('li', { className: 'note-card' },
        el('div', { className: 'note-head', textContent: promptText(c.prompt, data, loc) || w.card }),
        el('div', { className: 'zone-meta', textContent: `${bindingLabel(c.bind, data, loc)} · ${new Date(c.updated).toLocaleString(loc)}` }),
        el('p', { className: 'note-text', textContent: c.text }),
        el('div', { className: 'card-buttons' },
          button(w.edit, () => openEditor({ id: c.id, text: c.text, prompt: c.prompt, bind: c.bind }), { act: 'edit' }),
          button(confirmDelete === c.id ? w.sure : w.del, () => {
            if (confirmDelete !== c.id) { confirmDelete = c.id; drawCardList(); return; }
            confirmDelete = null;
            change(deleteCard(log, c.id));
          }, { act: 'delete' })));
      li.dataset.card = c.id;
      return li;
    })));
  }

  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function drawCards() {
    const body = bodies.cards;
    if (!body) return;
    const loc = locale(), w = TEXT[loc];
    if (!log) { body.replaceChildren(el('p', { className: 'zone-note', textContent: w.wait })); cardsList = editorBox = null; return; }
    editorBox = el('div', { className: 'card-editor', id: 'cardEditor' });
    cardsList = el('div');
    storeNote = el('p', { className: 'zone-note', hidden: true, textContent: w.memory });
    store.then((s) => { if (storeNote) storeNote.hidden = s.kind !== 'memory'; });
    body.replaceChildren(
      button(w.add, () => openEditor(), { act: 'add' }),
      editorBox, cardsList,
      el('div', { className: 'card-buttons' },
        button(w.json, () => download(exportJson(log, data, locale()), exportName(log, 'json'), 'application/json'), { act: 'export-json' }),
        button(w.md, () => download(exportMarkdown(log, data, locale()), exportName(log, 'md'), 'text/markdown'), { act: 'export-md' })),
      storeNote);
    drawEditor();
    drawCardList();
  }

  function redraw() {
    drawQuests();
    if (!log || !cardsList) drawCards(); else drawCardList();
  }

  return {
    get log() { return log; },
    get key() { return key; },
    get scene() { return scene; },
    /** @param {(log: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** zone renderers for renderZones */
    quests: (body) => { bodies.quests = body; drawQuests(); },
    cards: (body) => { bodies.cards = body; cardsList = null; drawCards(); },
    openEditor,
  };
}
