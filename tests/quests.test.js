// story-quest Q6: the quest layer (STORY-QUEST-SPEC §3) — an event becomes a fact, a hand tick weighs
// the same, put aside / taken off never reads «skipped», the cards, the store and the export.
import { describe, expect, it } from 'vitest';
import {
  applyEvent, bindingLabel, createLog, deleteCard, exportJson, exportMarkdown, exportName, logKey, restoreLog,
  saveCard, setStatus, tasksView, tick, TASK_IDS, words,
} from '../products/shared/quests.js';
import { memoryStore, openQuestStore } from '../products/shared/questStore.js';
import { fingerprintOf } from '../src/catalog/catalog.js';
import data from '../products/shared/quests.json';

const scene = { story: 'test-2025/my-day-3-moments', fingerprint: 'fnv1a-00000001-1', frames: [{ id: 'a', index: 0 }, { id: 'b', index: 1 }, { id: 'c', index: 2 }] };
const view = (log, locale = 'uk') => Object.fromEntries(tasksView(log, data, locale).map((t) => [t.id, t]));
const play = (log, events) => events.reduce((l, [name, detail]) => applyEvent(l, name, detail), log);
const fixed = { now: () => new Date('2026-11-25T10:00:00Z'), newId: (() => { let n = 0; return () => `c${++n}`; })() };

describe('quest data', () => {
  it('has every task of §3.1 in uk and en, and prompts in both languages', () => {
    expect(data.tasks.map((t) => t.id)).toEqual([...TASK_IDS]);
    for (const t of data.tasks) for (const l of ['uk', 'en']) expect(words(t.title, l)).not.toBe('');
    for (const p of [...data.prompts, data.manualPrompt]) { expect(p.uk).toBeTruthy(); expect(p.en).toBeTruthy(); }
  });
});

describe('events → facts', () => {
  it('a taken miniature is found: «Знайдено 1 з 3», the task done by the fact', () => {
    const log = applyEvent(createLog(scene), 'minis.take', { frameId: 'a', x: 1, z: 2 });
    expect(view(log).find).toMatchObject({ fact: 'Знайдено 1 з 3', done: true, auto: true, manual: false });
    expect(view(log, 'en').find.fact).toBe('Found 1 of 3');
    // the same part taken again is not counted twice
    expect(view(applyEvent(log, 'minis.take', { frameId: 'a' })).find.fact).toBe('Знайдено 1 з 3');
  });

  it('hydrated parts are in the water, with Ukrainian plurals; a part in the water was found', () => {
    const one = applyEvent(createLog(scene), 'minis.hydrate', { frameId: 'b' });
    expect(view(one).water).toMatchObject({ fact: '1 частина у воді', done: true });
    expect(view(one).find.fact).toBe('Знайдено 1 з 3');
    const two = applyEvent(one, 'minis.hydrate', { frameId: 'c' });
    expect(view(two).water.fact).toBe('2 частини у воді');
    expect(view(two, 'en').water.fact).toBe('2 parts in the water');
  });

  it('at sea only when the walker crossed the edge; coming back keeps the fact', () => {
    const log = play(createLog(scene), [['raft.sea', { frameId: 'a', inSea: false }]]);
    expect(view(log).sea.done).toBe(false);
    const sea = play(log, [['raft.sea', { frameId: 'a', inSea: true }], ['raft.sea', { frameId: 'a', inSea: false }]]);
    expect(view(sea).sea).toMatchObject({ fact: 'У морі', done: true });
  });

  it('fates are facts as they are: released 1 · sunk 1, no grade; undone to the end leaves the task done', () => {
    let log = play(createLog(scene), [
      ['fate.change', { frameId: 'a', kind: 'release', phase: 'begin' }],
      ['fate.change', { frameId: 'b', kind: 'sink', phase: 'begin' }],
      ['fate.change', { frameId: 'b', kind: 'sink', phase: 'settled' }],
    ]);
    expect(view(log).fate).toMatchObject({ fact: 'Відпущено 1 · втоплено 1', done: true, auto: true });
    expect(view(log, 'en').fate.fact).toBe('Released 1 · sunk 1');
    log = play(log, [['fate.change', { frameId: 'b', kind: 'sink', phase: 'keep' }]]);
    expect(view(log).fate.fact).toBe('Відпущено 1 · втоплено 1 · залишено так 1');
    log = play(log, [['fate.change', { frameId: 'a', kind: 'release', phase: 'undo' }], ['fate.change', { frameId: 'a', kind: 'release', phase: 'afloat' }]]);
    expect(view(log).fate).toMatchObject({ fact: 'Втоплено 1 · залишено так 1', done: true });
  });

  it('events that are not facts change nothing', () => {
    const log = createLog(scene);
    expect(applyEvent(log, 'raft.kite', { frameId: 'a', up: true })).toBe(log);
    expect(applyEvent(log, 'minis.take', {})).toBe(log);
    expect(applyEvent(log, 'fate.change', { frameId: 'a', kind: 'bury', phase: 'begin' })).toBe(log);
  });
});

describe('freedom (§3.2)', () => {
  it('any task can be done first, by hand, and weighs the same as the fact', () => {
    for (const id of TASK_IDS) {
      const log = tick(createLog(scene), id);
      expect(view(log)[id]).toMatchObject({ done: true, manual: true, auto: false });
      expect(tasksView(log, data, 'uk').filter((t) => t.done)).toHaveLength(1);
    }
    expect(view(tick(tick(createLog(scene), 'sea'), 'sea', false)).sea.done).toBe(false);
  });

  it('a task done by its fact stays done when the hand tick is taken back', () => {
    const log = tick(applyEvent(tick(createLog(scene), 'find'), 'minis.take', { frameId: 'a' }), 'find', false);
    expect(view(log).find).toMatchObject({ done: true, auto: true, manual: false });
  });

  it('put aside or taken off is a status, never «skipped»: no word of it in the view or the export', () => {
    let log = setStatus(setStatus(createLog(scene), 'sea', 'deferred'), 'fate', 'removed');
    expect(view(log).sea.status).toBe('deferred');
    expect(view(log).fate.status).toBe('removed');
    const all = JSON.stringify(tasksView(log, data, 'uk')) + exportMarkdown(log, data, 'uk') + exportMarkdown(log, data, 'en');
    expect(all).not.toMatch(/пропущ|skipp|missed|не зроблено|not done/i);
    log = setStatus(log, 'sea', 'open');
    expect(view(log).sea.status).toBe('open');
    expect(setStatus(log, 'sea', 'skipped')).toBe(log);
  });

  it('facts still arrive for a task put aside', () => {
    const log = applyEvent(setStatus(createLog(scene), 'find', 'deferred'), 'minis.take', { frameId: 'c' });
    expect(view(log).find).toMatchObject({ status: 'deferred', done: true, fact: 'Знайдено 1 з 3' });
  });
});

describe('cards (§3.3)', () => {
  it('saves, binds, edits and deletes; the note task counts the cards', () => {
    let log = saveCard(createLog(scene), { text: '  тихо  ', prompt: 'feel', bind: { kind: 'frame', frameId: 'b' } }, fixed);
    expect(log.cards).toHaveLength(1);
    expect(log.cards[0]).toMatchObject({ text: 'тихо', prompt: 'feel', bind: { kind: 'frame', frameId: 'b', index: 1 } });
    expect(view(log).note).toMatchObject({ fact: '1 картка', done: true, auto: true });
    log = saveCard(log, { text: 'two', bind: { kind: 'place', x: 12.345, z: -3.21 } }, fixed);
    expect(log.cards[1].bind).toEqual({ kind: 'place', x: 12.3, z: -3.2 });
    expect(view(log, 'en').note.fact).toBe('2 cards');
    const id = log.cards[0].id;
    log = saveCard(log, { id, text: 'змінено', prompt: null, bind: { kind: 'task', task: 'sea' } }, fixed);
    expect(log.cards).toHaveLength(2);
    expect(log.cards[0]).toMatchObject({ id, text: 'змінено', prompt: null, bind: { kind: 'task', task: 'sea' } });
    log = deleteCard(log, id);
    expect(log.cards.map((c) => c.text)).toEqual(['two']);
    expect(saveCard(log, { text: '   ' })).toBe(log);
  });

  it('a binding that is not one of the four becomes «none»', () => {
    const log = saveCard(createLog(scene), { text: 'x', bind: { kind: 'task', task: 'win' } }, fixed);
    expect(log.cards[0].bind).toEqual({ kind: 'none' });
    expect(bindingLabel({ kind: 'frame', frameId: 'a', index: 0 }, data, 'uk')).toBe('Кадр 1');
    expect(bindingLabel({ kind: 'task', task: 'sea' }, data, 'en')).toBe('Task: Go out to sea');
  });
});

describe('the store and the key', () => {
  it('keys by the story and the fingerprint; a reload restores ticks, facts and cards', async () => {
    const store = memoryStore();
    let log = play(createLog(scene), [['minis.take', { frameId: 'a' }], ['raft.sea', { inSea: true }]]);
    log = setStatus(tick(saveCard(log, { text: 'n' }, fixed), 'fate'), 'water', 'deferred');
    const key = logKey(scene.story, scene.fingerprint);
    await store.put(key, log);
    const back = restoreLog(await store.get(key), scene);
    expect(back).toEqual(log);
    // another model under the same slug is another key; another story's record is not taken
    expect(logKey(scene.story, 'fnv1a-00000002-1')).not.toBe(key);
    expect(restoreLog({ ...log, story: 'public-test/other' }, scene)).toEqual(createLog(scene));
  });

  it('without IndexedDB the store lives in memory', async () => {
    const store = await openQuestStore('q6-test', { indexedDB: undefined });
    expect(store.kind).toBe('memory');
  });

  it('the fingerprint: the same model gives the same print, a changed one another', () => {
    const model = { frames: [{ id: 1, points: [[0, 0]] }], tiles: [{ f: 1, x: 0, y: 0 }] };
    expect(fingerprintOf(model)).toBe(fingerprintOf(structuredClone(model)));
    expect(fingerprintOf(model)).toMatch(/^fnv1a-[0-9a-f]{8}-[0-9a-z]+$/);
    expect(fingerprintOf({ ...model, tiles: [{ f: 1, x: 0, y: 1 }] })).not.toBe(fingerprintOf(model));
  });
});

describe('export', () => {
  const log = saveCard(play(createLog(scene), [['minis.take', { frameId: 'a' }], ['fate.change', { frameId: 'a', kind: 'break', phase: 'begin' }]]),
    { text: 'рядок 1\nрядок 2', prompt: 'part', bind: { kind: 'frame', frameId: 'a' } }, fixed);
  const at = new Date('2026-11-25T12:00:00Z');

  it('JSON carries the story, the fingerprint, the tasks with facts and the cards', () => {
    const out = JSON.parse(exportJson(log, data, 'uk', at));
    expect(out).toMatchObject({ format: 'story-quest/log', story: scene.story, fingerprint: scene.fingerprint, exported: at.toISOString() });
    expect(out.tasks.find((t) => t.id === 'fate').fact).toBe('Розпалось 1');
    expect(out.cards[0]).toMatchObject({ text: 'рядок 1\nрядок 2', promptText: 'Що ця частина для мене?', binding: 'Кадр 1' });
  });

  it('Markdown lists the tasks with ticks and the cards under their prompts', () => {
    const md = exportMarkdown(log, data, 'en', at);
    expect(md).toContain('# test-2025/my-day-3-moments');
    expect(md).toContain('- [x] Find the parts — Found 1 of 3');
    expect(md).toContain('- [ ] Go out to sea');
    expect(md).toContain('### What is this part to me?');
    expect(md).toContain('rядок 1'.replace('r', 'р'));
    expect(exportName(log, 'md', at)).toBe('story-quest-test-2025-my-day-3-moments-2026-11-25.md');
  });
});
