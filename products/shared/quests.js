// The quest layer (STORY-QUEST-SPEC §3): the tasks a story offers, the facts the scene's contract
// events bring (§4.4), the person's own ticks, and the cards. DOM-free and pure: every change is a
// function (log, …) → new log, so the page saves what it gets and the unit tests drive it directly.
// No points, no order, no grades (§3.2, Edge §7): a task is done by its fact or by the person's own
// tick, the two weigh the same; a task can be put aside or taken off the list, and nothing says
// «skipped». The words — task titles, facts, card prompts — are data (quests.json), uk + en.

export const QUEST_LOG_VERSION = 1;
export const TASK_IDS = Object.freeze(['find', 'water', 'sea', 'fate', 'note']);
export const FATE_KINDS = Object.freeze(['release', 'sink', 'break']);
export const BINDINGS = Object.freeze(['none', 'place', 'frame', 'task']);

const freeze = (o) => Object.freeze(o);
const uniq = (list, id) => (list.includes(id) ? list : [...list, id]);

/**
 * @typedef {{ kind: 'none' } | { kind: 'place', x: number, z: number } | { kind: 'frame', frameId: string, index: number }
 *   | { kind: 'task', task: string }} Binding
 * @typedef {{ id: string, text: string, prompt: string | null, bind: Binding, created: string, updated: string }} Card
 * @typedef {{ manual: boolean, auto: boolean, status: 'open' | 'deferred' | 'removed' }} TaskMark
 * @typedef {{ version: number, story: string, fingerprint: string | null, frames: { id: string, index: number }[],
 *   found: string[], water: string[], sea: boolean, fates: Record<string, { kind: string, kept: boolean }>,
 *   tasks: Record<string, TaskMark>, cards: Card[] }} QuestLog
 */

/** The store's key: the story's slug + the model's fingerprint (spec §3.3). */
export const logKey = (story, fingerprint) => `${story}#${fingerprint ?? 'none'}`;

/**
 * @param {{ story: string, fingerprint?: string | null, frames?: { id: any, index: number }[] }} scene
 * @returns {QuestLog}
 */
export function createLog({ story, fingerprint = null, frames = [] }) {
  return freeze({
    version: QUEST_LOG_VERSION, story, fingerprint,
    frames: frames.map((f) => ({ id: String(f.id), index: f.index })),
    found: [], water: [], sea: false, fates: {},
    tasks: Object.fromEntries(TASK_IDS.map((id) => [id, { manual: false, auto: false, status: 'open' }])),
    cards: [],
  });
}

/**
 * A saved log back, or a fresh one when it is not ours (another version, another story).
 * The frames come from the scene each time: the model is the same (the key has its fingerprint).
 * @param {any} saved @param {{ story: string, fingerprint?: string | null, frames?: { id: any, index: number }[] }} scene
 */
export function restoreLog(saved, scene) {
  const fresh = createLog(scene);
  if (!saved || saved.version !== QUEST_LOG_VERSION || saved.story !== scene.story) return fresh;
  const tasks = { ...fresh.tasks };
  for (const id of TASK_IDS) if (saved.tasks?.[id]) tasks[id] = { ...fresh.tasks[id], ...saved.tasks[id] };
  return freeze({ ...fresh, found: [...(saved.found ?? [])], water: [...(saved.water ?? [])], sea: !!saved.sea,
    fates: { ...(saved.fates ?? {}) }, tasks, cards: [...(saved.cards ?? [])],
    frames: fresh.frames.length ? fresh.frames : [...(saved.frames ?? [])] });
}

const mark = (log, id, patch) => ({ ...log.tasks, [id]: { ...log.tasks[id], ...patch } });
const auto = (log, id, done) => (done && !log.tasks[id].auto ? mark(log, id, { auto: true }) : log.tasks);

/**
 * One event of the scene's contract → the log with its fact. Facts are kept as they happened:
 * a frame found stays found; a fate undone to the end leaves the frame without one, and the task
 * done by it stays done (it was decided once; nothing turns into «not done»).
 * @param {QuestLog} log @param {string} name @param {any} detail
 */
export function applyEvent(log, name, detail) {
  const id = detail?.frameId === undefined || detail?.frameId === null ? null : String(detail.frameId);
  if (name === 'minis.take' && id) {
    const next = { ...log, found: uniq(log.found, id) };
    return freeze({ ...next, tasks: auto(next, 'find', true) });
  }
  if (name === 'minis.hydrate' && id) {
    // a part in the water was found, even when a card of the stand put it there by a command
    const next = { ...log, found: uniq(log.found, id), water: uniq(log.water, id) };
    const found = { ...next, tasks: auto(next, 'find', true) };
    return freeze({ ...found, tasks: auto(found, 'water', true) });
  }
  if (name === 'raft.sea' && detail?.inSea === true) {
    if (log.sea) return log;
    return freeze({ ...log, sea: true, tasks: auto(log, 'sea', true) });
  }
  if (name === 'fate.change' && id && FATE_KINDS.includes(detail?.kind)) {
    const fates = { ...log.fates };
    if (detail.phase === 'begin') fates[id] = { kind: detail.kind, kept: false };
    else if (detail.phase === 'keep') fates[id] = { kind: detail.kind, kept: true };
    else if (detail.phase === 'afloat') delete fates[id];
    else if (!fates[id]) fates[id] = { kind: detail.kind, kept: false };
    const next = { ...log, fates };
    return freeze({ ...next, tasks: auto(next, 'fate', Object.keys(fates).length > 0) });
  }
  return log;
}

/** The person's own tick (or untick): weighs the same as the fact (§3.2). @param {QuestLog} log @param {string} task @param {boolean} [on] */
export function tick(log, task, on = true) {
  if (!TASK_IDS.includes(task)) return log;
  return freeze({ ...log, tasks: mark(log, task, { manual: on }) });
}

/** Put aside, take off the list, or bring back. Nothing reminds of it afterwards. @param {QuestLog} log @param {string} task @param {'open' | 'deferred' | 'removed'} status */
export function setStatus(log, task, status) {
  if (!TASK_IDS.includes(task) || !['open', 'deferred', 'removed'].includes(status)) return log;
  return freeze({ ...log, tasks: mark(log, task, { status }) });
}

/**
 * @param {Binding | null | undefined} bind @param {QuestLog} log
 * @returns {Binding}
 */
export function cleanBinding(bind, log) {
  if (!bind || typeof bind !== 'object') return { kind: 'none' };
  if (bind.kind === 'place' && Number.isFinite(bind.x) && Number.isFinite(bind.z)) return { kind: 'place', x: Math.round(bind.x * 10) / 10, z: Math.round(bind.z * 10) / 10 };
  if (bind.kind === 'frame' && bind.frameId !== undefined && bind.frameId !== null) {
    const frameId = String(bind.frameId);
    const index = log.frames.find((f) => f.id === frameId)?.index ?? (Number.isInteger(bind.index) ? bind.index : -1);
    return { kind: 'frame', frameId, index };
  }
  if (bind.kind === 'task' && TASK_IDS.includes(bind.task)) return { kind: 'task', task: bind.task };
  return { kind: 'none' };
}

/**
 * Save a card: a new one (no id), or the same id edited. Empty text is not a card.
 * @param {QuestLog} log
 * @param {{ id?: string, text: string, prompt?: string | null, bind?: Binding }} card
 * @param {{ now?: () => Date, newId?: () => string }} [options]
 */
export function saveCard(log, card, { now = () => new Date(), newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` } = {}) {
  const text = String(card.text ?? '').trim();
  if (!text) return log;
  const at = now().toISOString();
  const bind = cleanBinding(card.bind, log);
  const prompt = card.prompt ? String(card.prompt) : null;
  const old = card.id ? log.cards.find((c) => c.id === card.id) : null;
  const cards = old
    ? log.cards.map((c) => (c.id === old.id ? { ...c, text, prompt, bind, updated: at } : c))
    : [...log.cards, { id: newId(), text, prompt, bind, created: at, updated: at }];
  const next = { ...log, cards };
  return freeze({ ...next, tasks: auto(next, 'note', cards.length > 0) });
}

/** @param {QuestLog} log @param {string} id */
export function deleteCard(log, id) {
  if (!log.cards.some((c) => c.id === id)) return log;
  return freeze({ ...log, cards: log.cards.filter((c) => c.id !== id) });
}

// --- words --------------------------------------------------------------------------------------

/** A text of the data: { uk, en } or a string; plural forms { one, few, many, other } by Intl. */
export function words(text, locale, k = null) {
  if (text === null || text === undefined) return '';
  let s = typeof text === 'object' ? (text[locale] ?? text.en ?? text.uk ?? '') : String(text);
  if (s && typeof s === 'object') s = s[new Intl.PluralRules(locale).select(k ?? 0)] ?? s.other ?? '';
  return String(s).replaceAll('{k}', String(k ?? ''));
}

/**
 * The tasks as the person sees them: title, the fact (no grade), done by fact or by hand.
 * @param {QuestLog} log @param {any} data quests.json @param {string} locale
 * @returns {{ id: string, title: string, fact: string, done: boolean, auto: boolean, manual: boolean, status: string }[]}
 */
export function tasksView(log, data, locale) {
  return data.tasks.filter((t) => TASK_IDS.includes(t.id)).map((t) => {
    const m = log.tasks[t.id];
    return { id: t.id, title: words(t.title, locale), fact: factOf(log, t, locale), done: m.auto || m.manual, auto: m.auto, manual: m.manual, status: m.status };
  });
}

function factOf(log, task, locale) {
  const n = log.frames.length;
  if (task.id === 'find') return n ? words(task.fact, locale, log.found.length).replaceAll('{n}', String(n)) : '';
  if (task.id === 'water') return log.water.length ? words(task.fact, locale, log.water.length) : '';
  if (task.id === 'sea') return log.sea ? words(task.fact, locale) : '';
  if (task.id === 'note') return log.cards.length ? words(task.fact, locale, log.cards.length) : '';
  if (task.id === 'fate') {
    const all = Object.values(log.fates);
    const parts = FATE_KINDS.map((kind) => [kind, all.filter((f) => f.kind === kind).length]).filter(([, k]) => k > 0)
      .map(([kind, k]) => words(task.fact[kind], locale, k));
    const kept = all.filter((f) => f.kept).length;
    if (kept) parts.push(words(task.fact.kept, locale, kept));
    const s = parts.join(' · ');
    return s ? s[0].toLocaleUpperCase(locale) + s.slice(1) : '';
  }
  return '';
}

const BIND_WORDS = {
  uk: { none: 'Без прив’язки', place: (x, z) => `Місце (${x}, ${z})`, frame: (i) => `Кадр ${i}`, task: (t) => `Задача: ${t}` },
  en: { none: 'Not bound', place: (x, z) => `A place (${x}, ${z})`, frame: (i) => `Frame ${i}`, task: (t) => `Task: ${t}` },
};

/** @param {Binding} bind @param {any} data @param {string} locale */
export function bindingLabel(bind, data, locale) {
  const w = BIND_WORDS[locale] ?? BIND_WORDS.en;
  if (bind.kind === 'place') return w.place(bind.x, bind.z);
  if (bind.kind === 'frame') return w.frame(bind.index >= 0 ? bind.index + 1 : '?');
  if (bind.kind === 'task') return w.task(words(data.tasks.find((t) => t.id === bind.task)?.title, locale));
  return w.none;
}

/** @param {string | null} id @param {any} data @param {string} locale */
export function promptText(id, data, locale) {
  if (!id) return '';
  const p = id === data.manualPrompt.id ? data.manualPrompt : data.prompts.find((x) => x.id === id);
  return p ? words(p, locale) : '';
}

// --- export (spec §3.3: a file on the device; no import in v1) ------------------------------------

/** @param {QuestLog} log @param {any} data @param {string} locale @param {Date} [at] */
export function exportJson(log, data, locale, at = new Date()) {
  return JSON.stringify({
    format: 'story-quest/log', version: QUEST_LOG_VERSION, exported: at.toISOString(), locale,
    story: log.story, fingerprint: log.fingerprint,
    tasks: tasksView(log, data, locale).map(({ id, title, fact, done, auto: a, manual, status }) => ({ id, title, fact, done, auto: a, manual, status })),
    facts: { found: log.found, water: log.water, sea: log.sea, fates: log.fates },
    cards: log.cards.map((c) => ({ ...c, promptText: promptText(c.prompt, data, locale), binding: bindingLabel(c.bind, data, locale) })),
  }, null, 2);
}

const MD = {
  uk: { tasks: 'Задачі', cards: 'Картки', card: 'Картка', put: 'відкладено', off: 'прибрано', none: 'Карток немає.', exported: 'Експортовано' },
  en: { tasks: 'Tasks', cards: 'Cards', card: 'Card', put: 'put aside', off: 'taken off the list', none: 'No cards.', exported: 'Exported' },
};

/** @param {QuestLog} log @param {any} data @param {string} locale @param {Date} [at] */
export function exportMarkdown(log, data, locale, at = new Date()) {
  const w = MD[locale] ?? MD.en;
  const lines = [`# ${log.story}`, '', `${w.exported}: ${at.toISOString()} · \`${log.fingerprint ?? '–'}\``, '', `## ${w.tasks}`, ''];
  for (const t of tasksView(log, data, locale)) {
    const note = t.status === 'deferred' ? ` _(${w.put})_` : t.status === 'removed' ? ` _(${w.off})_` : '';
    lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${t.fact ? ` — ${t.fact}` : ''}${note}`);
  }
  lines.push('', `## ${w.cards}`, '');
  if (!log.cards.length) lines.push(w.none);
  for (const c of log.cards) {
    lines.push(`### ${promptText(c.prompt, data, locale) || w.card}`, '', `_${bindingLabel(c.bind, data, locale)} · ${c.updated}_`, '', c.text, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** A file name for the export: the story's slug and the date, no folder slash. */
export const exportName = (log, ext, at = new Date()) => {
  const day = [at.getFullYear(), at.getMonth() + 1, at.getDate()].map((n) => String(n).padStart(2, '0')).join('-');   // the device's day
  return `story-quest-${log.story.replace(/[^a-z0-9-]+/gi, '-')}-${day}.${ext}`;
};
