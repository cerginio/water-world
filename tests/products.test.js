// story-quest QDb: the shared shell's DOM-free parts (the contract client, the scene address, the
// zones of a ui-map) and the QA stand's cards (the expectation, the cards file, a run that refuses).
import { describe, expect, it } from 'vitest';
import { CHANNEL, createSceneClient, sceneUrl } from '../products/shared/contract.js';
import { pickLocale, t, zonesOf } from '../products/shared/zones.js';
import { byFolder, storyMeta, WEATHER } from '../products/shared/storyZones.js';
import { packView } from '../products/shared/packZone.js';
import * as productIcons from '../products/shared/icons.js';
import * as sceneIcons from '../src/walker/icons.js';
import { readFileSync } from 'node:fs';
import { checkCards, mismatches, planOf, readPath, runCard } from '../products/quest-demo-qa/cards.js';
import { CHANNEL as SCENE_CHANNEL } from '../src/embed/protocol.js';
import { createCommands } from '../src/embed/commands.js';
import { MOOD_MAP_V1 } from '../src/environment/mood.js';
import states from '../products/quest-demo-qa/states.json';
import standMap from '../products/quest-demo-qa/ui-map.json';
import productMap from '../products/story-quest/ui-map.json';
import { mountProductEmbed } from '../products/shared/productEmbed.js';

describe('explore product bridge', () => {
  const fixture = () => {
    const sent = [], calls = [], listeners = new Set();
    const parent = { postMessage: (m, origin) => sent.push({ m, origin }) };
    const target = { parent, location: { origin: 'https://water.storytilecraft.space', href: 'https://water.storytilecraft.space/products/story-quest/?embed-origin=https://explore.storytilecraft.space' },
      addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
    let removed = false, closed = false;
    mountProductEmbed({ target,
      host: { on: () => () => {}, call: async (cmd) => { calls.push(cmd); return { ok: true, value: { active: false, disposed: cmd === 'dispose' } }; }, dispose: () => { closed = true; } },
      quests: { start: async (id) => { calls.push(id); return id === 'find' || id === 'note' ? { ok: true, value: { id, status: 'started' } } : { ok: false, reason: 'unknown-quest' }; } },
      shell: { setOpen() {}, zones: { querySelector: () => null } }, iframe: { remove: () => { removed = true; } } });
    return { sent, calls, listeners, gone: () => removed && closed,
      receive: async (data, overrides = {}) => { for (const fn of listeners) await fn({ source: parent, origin: 'https://explore.storytilecraft.space', data: { channel: CHANNEL, ...data }, ...overrides }); } };
  };
  it('rejects the wrong origin or window before dispatch; replies to the exact allowed origin', async () => {
    const f = fixture();
    await f.receive({ type: 'hello' }, { origin: 'https://evil.example' });
    await f.receive({ type: 'call', cmd: 'quest.start', args: { id: 'find' } }, { source: {} });
    expect(f.sent).toEqual([]); expect(f.calls).toEqual([]);
    await f.receive({ type: 'hello' });
    expect(f.sent[0]).toMatchObject({ origin: 'https://explore.storytilecraft.space', m: { type: 'ready', commands: expect.arrayContaining(['quest.start', 'deactivate']) } });
  });
  it('forwards only the closed commands, acknowledges both quests, removes the scene on disposal', async () => {
    const f = fixture();
    await f.receive({ type: 'call', id: 1, cmd: 'eval' });
    expect(f.sent.at(-1).m).toMatchObject({ ok: false, reason: 'unknown-command' });
    for (const id of ['find', 'note']) {
      await f.receive({ type: 'call', cmd: 'quest.start', args: { id } });
      expect(f.sent.at(-1).m).toMatchObject({ ok: true, value: { id, status: 'started' } });
    }
    await f.receive({ type: 'call', cmd: 'quest.start', args: { id: 'other' } });
    expect(f.sent.at(-1).m.reason).toBe('unknown-quest');
    await f.receive({ type: 'call', cmd: 'deactivate' });
    await f.receive({ type: 'call', cmd: 'dispose' });
    expect(f.calls).toEqual(['find', 'note', 'other', 'deactivate', 'dispose']);
    expect(f.gone()).toBe(true); expect(f.listeners.size).toBe(0);
  });
});

// timers the test drives: nothing fires unless asked
const manualTimers = () => {
  const due = new Map();
  let n = 0;
  return {
    due,
    setInterval: (fn) => { due.set(++n, fn); return n; },
    clearInterval: (id) => due.delete(id),
    setTimeout: (fn) => { due.set(++n, fn); return n; },
    clearTimeout: (id) => due.delete(id),
    fire: () => { for (const fn of [...due.values()]) fn(); },
  };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('contract client', () => {
  it('a missing ready times out without dispatching a stale command after a late handshake', async () => {
    const sent = [], timers = manualTimers();
    const c = createSceneClient({ post: (m) => sent.push(m), timers });
    const early = c.call('deactivate', {}, { timeout: 10 });
    timers.fire();
    await expect(early).resolves.toMatchObject({ ok: false, reason: 'timeout' });
    c.receive({ channel: CHANNEL, type: 'ready', version: 1, commands: [] });
    await tick();
    expect(sent).toEqual([]);
    c.close();
  });
  it('speaks the scene\'s channel', () => {
    expect(CHANNEL).toBe(SCENE_CHANNEL);
  });

  it('hello repeats until ready, then stops; ready resolves with the command list', async () => {
    const sent = [], timers = manualTimers();
    const c = createSceneClient({ post: (m) => sent.push(m), timers });
    const ready = c.connect();
    timers.fire();
    expect(sent.map((m) => m.type)).toEqual(['hello', 'hello']);
    expect(c.receive({ channel: CHANNEL, type: 'ready', version: 1, commands: ['state.read'] })).toBe(true);
    await expect(ready).resolves.toEqual({ version: 1, commands: ['state.read'] });
    expect(timers.due.size).toBe(0);
  });

  it('a call waits for ready, then resolves with the result; a refusal is a result, not a throw', async () => {
    const sent = [];
    const c = createSceneClient({ post: (m) => sent.push(m), timers: manualTimers() });
    const early = c.call('state.read');
    await tick();
    expect(sent.filter((m) => m.type === 'call')).toEqual([]);   // not lost to a scene not yet listening
    c.receive({ channel: CHANNEL, type: 'ready', version: 1, commands: [] });
    await tick();
    const call = sent.find((m) => m.type === 'call');
    expect(call).toMatchObject({ channel: CHANNEL, cmd: 'state.read', args: {} });
    c.receive({ channel: CHANNEL, type: 'result', id: call.id, ok: true, value: { mode: 'eyes' } });
    await expect(early).resolves.toEqual({ ok: true, value: { mode: 'eyes' } });
    const no = c.call('kite.set', { up: true });
    await tick();
    const id = sent.at(-1).id;
    c.receive({ channel: CHANNEL, type: 'result', id, ok: false, reason: 'not-possible', message: 'no deck' });
    await expect(no).resolves.toEqual({ ok: false, reason: 'not-possible', message: 'no deck' });
  });

  it('no answer in time → a timeout result; a reload closes calls in flight', async () => {
    const timers = manualTimers();
    const c = createSceneClient({ post: () => {}, timers });
    c.receive({ channel: CHANNEL, type: 'ready', version: 1, commands: [] });
    const slow = c.call('fate.give', {}, { timeout: 5 });
    await tick();
    timers.fire();
    await expect(slow).resolves.toMatchObject({ ok: false, reason: 'timeout' });
    const inFlight = c.call('state.read');
    await tick();
    c.close();
    await expect(inFlight).resolves.toMatchObject({ ok: false, reason: 'closed' });
    await expect(c.call('state.read')).resolves.toMatchObject({ ok: false, reason: 'closed' });
  });

  it('events go to their listeners and to *; other channels are not heard', () => {
    const c = createSceneClient({ post: () => {} });
    const got = [];
    c.on('raft.sea', (d) => got.push(['sea', d]));
    c.on('*', (d, name) => got.push(['*', name]));
    expect(c.receive({ channel: 'other', type: 'event', name: 'raft.sea' })).toBe(false);
    c.receive({ channel: CHANNEL, type: 'event', name: 'raft.sea', detail: { frameId: '2' } });
    expect(got).toEqual([['sea', { frameId: '2' }], ['*', 'raft.sea']]);
  });

  it('the scene address: the story readable, bare flags, embed always once', () => {
    expect(sceneUrl('http://localhost:5199/', { story: 'test-2025/my-day-3-moments', flags: ['walk', 'minis', 'embed'] }))
      .toBe('http://localhost:5199/?story=test-2025/my-day-3-moments&walk&minis&embed');
    expect(sceneUrl('http://localhost:5199/')).toBe('http://localhost:5199/?embed');
    expect(sceneUrl('http://localhost:5199/', { story: 'a/b', flags: ['walk'], lang: 'uk' })).toBe('http://localhost:5199/?story=a/b&lang=uk&walk&embed');
    expect(() => sceneUrl('http://localhost:5199/', { lang: 'uk&x' })).toThrow();
    expect(() => sceneUrl('http://localhost:5199/', { flags: ['a&b'] })).toThrow();
  });
});

describe('panel zones', () => {
  // an invariant, not an inventory (spec §4.4, §8 Q7): the product is the stand without its
  // technical zones; both carry the quest layer. Adding a zone to both is a legal change.
  it('the product\'s zones are the stand\'s without States and Tech; both have Quests and Cards', () => {
    const stand = zonesOf(standMap, 'uk').map((z) => z.id), product = zonesOf(productMap, 'en').map((z) => z.id);
    expect(product.filter((id) => !stand.includes(id))).toEqual([]);
    expect(product).not.toContain('states');
    expect(product).not.toContain('tech');
    for (const ids of [stand, product]) expect(ids).toEqual(expect.arrayContaining(['story', 'quests', 'cards', 'weather']));
  });

  it('a map with a zone twice or without an id is refused', () => {
    expect(() => zonesOf({ zones: [{ id: 'a' }, { id: 'a' }] }, 'en')).toThrow(/twice/);
    expect(() => zonesOf({ zones: [{ title: 'x' }] }, 'en')).toThrow(/id/);
  });

  it('locale: the stored one, else uk for a Ukrainian browser, else en; texts fall back to en', () => {
    expect(pickLocale(['en-US'], 'uk')).toBe('uk');
    expect(pickLocale(['uk-UA', 'en'])).toBe('uk');
    expect(pickLocale(['de'], 'fr')).toBe('en');
    expect(t({ en: 'Story' }, 'uk')).toBe('Story');
    expect(t('plain', 'uk')).toBe('plain');
  });

  it('stories by folder, in the catalog\'s order', () => {
    const groups = byFolder([{ id: 'a/1', folder: 'a' }, { id: 'b/1', folder: 'b' }, { id: 'a/2', folder: 'a' }]);
    expect(groups.map((g) => [g.folder, g.stories.map((s) => s.id)])).toEqual([['a', ['a/1', 'a/2']], ['b', ['b/1']]]);
  });

  it('a story\'s line: the author and the frames, whichever the catalog has', () => {
    expect(storyMeta({ credit: 'Ann', frameCount: 8 }, 'uk')).toBe('автор: Ann · 8 кадр.');
    expect(storyMeta({ frameCount: 3 }, 'en')).toBe('3 frames');
    expect(storyMeta({}, 'en')).toBe('');
  });

  it('the backpack zone: the hands and the backpack from state.read; no miniatures — none', () => {
    const frames = [{ mini: 'carried' }, { mini: 'packed' }, { mini: 'ground' }];
    expect(packView({ carried: 0, pack: [1], frames })).toEqual({ minis: true, hands: 0, pack: [1] });
    expect(packView({ carried: null, pack: [], frames: [{ mini: null }] })).toEqual({ minis: false, hands: null, pack: [] });
    expect(packView(null)).toEqual({ minis: false, hands: null, pack: [] });
  });

  it('the weather buttons are the mood map\'s nine anchors at their (v, a)', () => {
    const grid = MOOD_MAP_V1.grid;   // rows a = −1, 0, 1; columns v = −1, 0, 1
    for (const w of WEATHER) expect(grid[w.a + 1][w.v + 1].name).toBe(w.id);
    expect(WEATHER).toHaveLength(9);
  });
});

describe('state cards', () => {
  const sceneCommands = Object.keys(createCommands({}));

  it('states.json: 14 cards, every step a scene command, every group known, uk + en', () => {
    expect(checkCards(states, sceneCommands)).toEqual([]);
    expect(states.cards).toHaveLength(14);
  });

  it('a card with a command the scene does not have is caught when read', () => {
    const bad = { groups: [{ id: 'g' }], cards: [{ id: 'x', group: 'g', title: { uk: 'х', en: 'x' }, story: 'a/b',
      steps: [{ cmd: 'walker.fly' }], expect: { mode: 'eyes' } }] };
    expect(checkCards(bad, sceneCommands)).toEqual(['card x: walker.fly is not a scene command']);
  });

  it('expectation: equal, truthy / falsy, bounds; a path through the frames', () => {
    const s = { mode: 'eyes', kite: true, walker: { deck: null, swim: { depth: 27.5 } }, frames: [{ fate: null }, { fate: { kind: 'sink' } }] };
    expect(readPath(s, 'frames.1.fate.kind')).toBe('sink');
    expect(mismatches(s, { mode: 'eyes', kite: true, 'walker.deck': null, 'walker.swim.depth': { min: 25 }, 'frames.1.fate.kind': 'sink' })).toEqual([]);
    expect(mismatches(s, { 'walker.deck': 0, 'walker.swim.depth': { max: 3 }, 'frames.0.fate.kind': 'sink' }).map((m) => m.path))
      .toEqual(['walker.deck', 'walker.swim.depth', 'frames.0.fate.kind']);
  });

  it('the plan: load, weather, each step, expectation', () => {
    const card = { steps: [{ cmd: 'a' }, { cmd: 'b', args: { x: 1 } }], weather: { preset: 'calm' } };
    expect(planOf(card).map((p) => p.kind === 'step' ? p.cmd : p.kind)).toEqual(['load', 'mood.set', 'a', 'b', 'expect']);
  });

  const fakeScene = (refuse = {}) => {
    const calls = [];
    return {
      calls,
      load: async (p) => { calls.push(['load', p]); },
      call: async (cmd, args) => {
        calls.push([cmd, args]);
        if (refuse[cmd]) return { ok: false, reason: refuse[cmd], message: `${cmd} refused` };
        if (cmd === 'state.read') return { ok: true, value: { ready: true, mode: 'eyes', kite: true, walker: { deck: 0 } } };
        return { ok: true, value: { mode: 'eyes' } };
      },
    };
  };
  const card = { id: 'c', story: 'test-2025/x', flags: ['walk'], steps: [{ cmd: 'raft.board', args: { frame: 0 } }, { cmd: 'kite.set', args: { up: true } }],
    expect: { 'walker.deck': 0, kite: true } };

  it('a run: a clean load with the stand\'s story, the steps in order, the expectation met', async () => {
    const io = fakeScene();
    const r = await runCard(card, io, { story: 'public-test/frog', sleep: async () => {} });
    expect(r.ok).toBe(true);
    expect(r.plan.map((p) => p.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(io.calls[0]).toEqual(['load', { story: 'public-test/frog', flags: ['walk'] }]);
    expect(io.calls.filter(([c]) => c !== 'state.read').map(([c]) => c)).toEqual(['load', 'raft.board', 'kite.set']);
  });

  it('a step refused → the card stops there, marked failed with the reason; later steps wait', async () => {
    const io = fakeScene({ 'raft.board': 'not-on-water' });
    const r = await runCard(card, io, { sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(r.plan.map((p) => p.status)).toEqual(['done', 'failed', 'wait', 'wait']);
    expect(r.plan[1]).toMatchObject({ reason: 'not-on-water', message: 'raft.board refused' });
    expect(io.calls.some(([c]) => c === 'kite.set')).toBe(false);
  });

  it('an expectation never met → failed «expect» with what differs', async () => {
    let clock = 0;
    const r = await runCard({ ...card, expect: { 'walker.deck': 1 } }, fakeScene(),
      { now: () => clock, sleep: async (ms) => { clock += ms; }, wait: { expect: 1000 } });
    expect(r.ok).toBe(false);
    expect(r.plan.at(-1)).toMatchObject({ status: 'failed', reason: 'expect', message: 'walker.deck: 0 ≠ 1' });
  });

  it('a story that fails to load stops the card at the load', async () => {
    const io = {
      load: async () => {},
      call: async (cmd) => (cmd === 'catalog.read' ? { ok: true, value: { state: 'failed', error: { code: 'not-found' } } }
        : { ok: true, value: { ready: false } }),
    };
    const r = await runCard(card, io, { sleep: async () => {} });
    expect(r.plan[0]).toMatchObject({ status: 'failed', reason: 'story-failed', message: 'not-found' });
  });
});

// story-quest Q9 (STORY-QUEST-SPEC §4.2a): the product's buttons carry the same four drawings as the scene's
describe('subject icons of the product buttons', () => {
  it('the drawings are the same as the scene ones (the copy cannot import src/, BOUNDARY-5)', () => {
    expect(productIcons.ICONS).toEqual(sceneIcons.ICONS);
  });
  it('every button the product makes over the scene has a subject, or is named as without one', () => {
    const src = readFileSync(new URL('../products/story-quest/main.js', import.meta.url), 'utf8');
    const ids = [...src.matchAll(/createElement\('button'\), \{[^}]*id: '([^']+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) expect([id, id in productIcons.SUBJECTS || productIcons.NO_SUBJECT.has(id)]).toEqual([id, true]);
    expect(productIcons.SUBJECTS.toShore).toBe('walker');
    expect([productIcons.SUBJECTS.stow, productIcons.SUBJECTS.unpack]).toEqual(['frame', 'frame']);
  });
});
