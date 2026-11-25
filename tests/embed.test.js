// The scene's contract for products (STORY-QUEST-SPEC §4.4; HANDOFF story-quest QDa): the
// protocol, the closed list of commands, the anchors on a fake island, a step's timeout.
import { describe, expect, it } from 'vitest';
import { CHANNEL, createEmbedServer, EmbedError, until, VERSION } from '../src/embed/protocol.js';
import { ANCHOR, resolveAnchor, shallowPoint } from '../src/embed/anchors.js';
import { createCommands } from '../src/embed/commands.js';

const serverWith = (commands) => {
  const sent = [];
  return { sent, server: createEmbedServer({ commands, send: (m) => sent.push(m) }) };
};

describe('embed protocol', () => {
  it('answers hello with the version and the command names', async () => {
    const { sent, server } = serverWith({ 'a.b': () => 1, 'c.d': () => 2 });
    expect(await server.receive({ channel: CHANNEL, type: 'hello' })).toBe(true);
    expect(sent).toEqual([{ channel: CHANNEL, type: 'ready', version: VERSION, commands: ['a.b', 'c.d'] }]);
  });

  it('ignores what is not on its channel', async () => {
    const { sent, server } = serverWith({ x: () => 1 });
    expect(await server.receive({ type: 'hello' })).toBe(false);
    expect(await server.receive('hello')).toBe(false);
    expect(await server.receive({ channel: 'other', type: 'call', id: 1, cmd: 'x' })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('an unknown command is a refusal, not an exception — also for Object.prototype names', async () => {
    const { sent, server } = serverWith({ x: () => 1 });
    await server.receive({ channel: CHANNEL, type: 'call', id: 7, cmd: 'nope' });
    await server.receive({ channel: CHANNEL, type: 'call', id: 8, cmd: 'toString' });
    expect(sent.map((m) => [m.id, m.ok, m.reason])).toEqual([[7, false, 'unknown-command'], [8, false, 'unknown-command']]);
  });

  it('a result carries the value; a refusal carries the reason', async () => {
    const { sent, server } = serverWith({
      ok: (args) => args.n * 2,
      no: () => { throw new EmbedError('not-possible', 'nope'); },
      bug: () => { throw new Error('boom'); },
    });
    await server.receive({ channel: CHANNEL, type: 'call', id: 1, cmd: 'ok', args: { n: 21 } });
    await server.receive({ channel: CHANNEL, type: 'call', id: 2, cmd: 'no' });
    await server.receive({ channel: CHANNEL, type: 'call', id: 3, cmd: 'bug' });
    expect(sent[0]).toMatchObject({ id: 1, ok: true, value: 42 });
    expect(sent[1]).toMatchObject({ id: 2, ok: false, reason: 'not-possible', message: 'nope' });
    expect(sent[2]).toMatchObject({ id: 3, ok: false, reason: 'failed', message: 'boom' });
  });

  it('events go out on the channel', () => {
    const { sent, server } = serverWith({});
    server.emit('raft.sea', { frameId: '2' });
    expect(sent).toEqual([{ channel: CHANNEL, type: 'event', name: 'raft.sea', detail: { frameId: '2' } }]);
  });

  it('until: the value once true, a timeout refusal otherwise', async () => {
    let n = 0;
    await expect(until(() => (++n >= 3 ? 'there' : null), 1000, 'n', 1)).resolves.toBe('there');
    await expect(until(() => false, 20, 'never', 5)).rejects.toMatchObject({ reason: 'timeout' });
  });
});

// a round island 100 m in radius, sloping 0.1 down from its 10 m top; the field 300 m out on +x
const island = {
  ground: (x, z) => ({ height: 10 - Math.hypot(x, z) * 0.1 }),
  spawn: () => ({ x: 95, z: 0, yaw: Math.PI / 2 }),
  center: () => ({ x: 300, z: 0 }),
  frames: () => [{ index: 0, id: 'a', x: 300, z: 0 }, { index: 1, id: 'b', x: 310, z: 5 }],
  decks: () => [{ id: 'a', x: 300, z: 0, ux: 0, uz: 1, hu: 4, hv: 3 }],
};

describe('embed anchors', () => {
  it('shallow: the last step before the wading line on the field side, facing out', () => {
    const p = shallowPoint(island);
    const h = island.ground(p.x, p.z).height;
    expect(h).toBeGreaterThanOrEqual(ANCHOR.wade);
    expect(island.ground(p.x + ANCHOR.step, p.z).height).toBeLessThan(ANCHOR.wade);
    expect(p.z).toBe(0);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('open-sea: the field\'s bearing, past the shore map and the bed', () => {
    const p = resolveAnchor('open-sea', island);
    expect([p.x, p.z]).toEqual([ANCHOR.openSea, 0]);
    expect(ANCHOR.openSea).toBeGreaterThan(1200);
  });

  it('frame / over / beside by the frame index; beside clears both rims by 6 m', () => {
    expect(resolveAnchor('frame:1', island)).toEqual({ x: 310, z: 5 });
    expect(resolveAnchor('over:0', island)).toEqual({ x: 300, z: 0 });
    const p = resolveAnchor('beside:0', island, { deck: { hu: 2 } });
    expect([p.x, p.z]).toEqual([300, 4 + 2 + ANCHOR.beside]);
  });

  it('refusals: unknown anchor, unknown frame, a frame not on the water', () => {
    expect(() => resolveAnchor('moon', island)).toThrow(expect.objectContaining({ reason: 'unknown-anchor' }));
    expect(() => resolveAnchor('frame:9', island)).toThrow(expect.objectContaining({ reason: 'unknown-frame' }));
    expect(() => resolveAnchor('beside:1', island)).toThrow(expect.objectContaining({ reason: 'not-on-water' }));
  });
});

describe('embed commands', () => {
  const world = (over = {}) => ({ ...island, host: null, raft: null, fates: null, minis: null,
    ready: () => true, failed: () => null, story: () => 'test/x', hints: () => ({}), ...over });

  it('the list is closed: the cards\' steps Q2a–Q5b and the weather, nothing else', () => {
    expect(Object.keys(createCommands(world())).sort()).toEqual([
      'fate.give', 'fate.keep', 'fate.undo', 'fly.land', 'fly.takeOff', 'fly.to', 'kite.set',
      'minis.hydrate', 'minis.take', 'mood.set', 'raft.board', 'raft.moveTo', 'state.read',
      'swim.dive', 'swim.in', 'swim.rise', 'walker.eyes', 'walker.look', 'walker.place']);
    expect(Object.isFrozen(createCommands(world()))).toBe(true);
  });

  it('a step whose state does not come refuses with timeout', async () => {
    const c = createCommands(world({ ready: () => false }), { wait: { ready: 30 } });
    await expect(c['walker.place']({})).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('a story that failed refuses with story-failed', async () => {
    const c = createCommands(world({ ready: () => false, failed: () => 'network' }));
    await expect(c['raft.board']({ frame: 0 })).rejects.toMatchObject({ reason: 'story-failed' });
  });

  it('bad args are refused before the scene is touched', async () => {
    const c = createCommands(world({ fates: { give: () => { throw new Error('touched'); } } }));
    await expect(c['fate.give']({ frame: 0, kind: 'burn' })).rejects.toMatchObject({ reason: 'bad-args' });
    await expect(c['mood.set']({ v: 2, a: 0 })).rejects.toMatchObject({ reason: 'bad-args' });
  });

  it('a frame that is not a deck cannot be boarded', async () => {
    const host = { mode: 'eyes', state: {}, walker: { board: () => { throw new Error('touched'); } } };
    const c = createCommands(world({ ensureHost: async () => host }));
    await expect(c['raft.board']({ frame: 1 })).rejects.toMatchObject({ reason: 'not-on-water' });
  });
});
