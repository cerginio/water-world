import { describe, expect, test } from 'vitest';
import { FATE, UNDO, afloat, begin, fateLook, keep, settled, stepFate, undo } from '../src/tiles/frameFate.js';
import { TileFates } from '../src/tiles/TileFates.js';
import { deckAtHand, deckGap, rimDistance } from '../src/walker/deck.js';

// story-quest Q5 (STORY-QUEST-SPEC §2 п.6, §4.1 «Долі кадру»; Edge §4.4): every fate has its
// way back, «Leave it so» fixes it; the way back is the same path run back, so the frame comes
// home to the pose it left. And which frame a fate goes to: from a raft, from the air, from a
// deck next to another frame.
const run = (fate, seconds, dt = 1 / 60) => {
  for (let i = 0; i < seconds / dt; i++) fate = stepFate(fate, dt);
  return fate;
};
const origin = { x: 950, z: -120 }, away = { x: 3, z: -4 };

describe('frameFate', () => {
  test.each(['release', 'sink', 'break'])('%s runs to its end in its time and settles', (kind) => {
    const f = run(begin(afloat(), kind, { origin, away }), FATE[kind].seconds + 0.1);
    expect(f.kind).toBe(kind);
    expect(settled(f)).toBe(true);
    expect(f.dir).toBe(0);
  });

  test.each(['release', 'sink', 'break'])('the way back of %s — from half-way and from the end — ends afloat where it began', (kind) => {
    for (const share of [0.5, 1.2]) {
      let f = run(begin(afloat(), kind, { origin, away }), FATE[kind].seconds * share);
      f = undo(f);
      expect(f.dir).toBe(-1);
      f = run(f, FATE[kind].seconds / FATE.back + 0.1);
      expect(f).toEqual(afloat());
      expect(fateLook(f)).toEqual({ at: null, sink: 0, clock: 0, hidden: false });
    }
  });

  test('release: out along `away`, 600 m, dips under at the end, then gone; the look at t = 0 is the origin', () => {
    const f = begin(afloat(), 'release', { origin, away });
    expect(fateLook(f).at).toEqual(origin);
    const mid = fateLook(run(f, 30));
    expect(mid.hidden).toBe(false);
    expect(mid.sink).toBe(0);
    const end = fateLook(run(f, 61));
    expect(Math.hypot(end.at.x - origin.x, end.at.z - origin.z)).toBeCloseTo(FATE.release.distance, 6);
    expect((end.at.x - origin.x) / (end.at.z - origin.z)).toBeCloseTo(3 / -4, 6);
    expect(end.sink).toBeCloseTo(FATE.release.dip, 6);
    expect(end.hidden).toBe(true);
  });

  test('sink goes down slowly to 40 m; break runs its clock to 24 s', () => {
    const s = fateLook(run(begin(afloat(), 'sink'), 3));
    expect(s.sink).toBeGreaterThan(0);
    expect(s.sink).toBeLessThan(0.3 * FATE.sink.depth * 3 / FATE.sink.seconds);   // slow at first: under a third of the even pace
    expect(fateLook(run(begin(afloat(), 'sink'), 31)).sink).toBeCloseTo(FATE.sink.depth, 6);
    expect(fateLook(run(begin(afloat(), 'break'), 30)).clock).toBeCloseTo(FATE.break.seconds, 6);
    expect(FATE.break.stagger + FATE.break.tile).toBe(FATE.break.seconds);
  });

  test('«Leave it so» fixes the fate: no way back, it runs on to its end; not while undoing', () => {
    let f = keep(run(begin(afloat(), 'sink'), 10));
    expect(f.kept).toBe(true);
    expect(undo(f)).toBeNull();
    expect(keep(f)).toBeNull();
    f = run(f, 25);
    expect(settled(f)).toBe(true);
    expect(begin(f, 'release')).toBeNull();
    expect(keep(undo(run(begin(afloat(), 'break'), 5)))).toBeNull();
  });

  test('a fate begins only afloat; the way back once; the names of the ways back', () => {
    const f = begin(afloat(), 'release', { origin, away });
    expect(begin(f, 'sink')).toBeNull();
    expect(begin(afloat(), 'burn')).toBeNull();
    expect(undo(undo(f))).toBeNull();
    expect(undo(afloat())).toBeNull();
    expect(UNDO).toEqual({ release: 'call', sink: 'raise', break: 'gather' });
  });
});

/** A field with two frames, as TileFates sees it. */
function fakeField() {
  const frames = new Map([['a', { id: 'a', index: 0, world: { x: 950, z: 0 } }], ['b', { id: 'b', index: 1, world: { x: 0, z: 0.5 } }]]);
  const fates = [];
  return {
    rest: {}, busyFrames: new Set(), fates,
    frameRegistry: { get: (id) => { const f = frames.get(id); if (!f) throw new Error('Unknown frame'); return f; } },
    moveFrame(id, x, z) { Object.assign(frames.get(id).world, { x, z }); },
    sim: { setFate: (index, sink, clock, hidden) => { fates[index] = { sink, clock, hidden }; } },
  };
}

describe('TileFates', () => {
  test('release → call back: the frame goes out to sea, away from the island, and comes home', () => {
    const field = fakeField(), fates = new TileFates(field), events = [];
    fates.addEventListener('change', (e) => events.push(e.detail.phase));
    expect(fates.give('a', 'release')).toBe(true);
    expect(field.busyFrames.has('a')).toBe(true);
    for (let i = 0; i < 61 * 10; i++) fates.update(0.1);
    const a = field.frameRegistry.get('a');
    expect(a.world.x).toBeCloseTo(950 + FATE.release.distance, 3);
    expect(a.world.z).toBeCloseTo(0, 6);
    expect(field.fates[0].hidden).toBe(true);
    expect(fates.undoHint()).toBe('call');
    expect(fates.undo()).toBe(true);
    for (let i = 0; i < 31 * 10; i++) fates.update(0.1);
    expect(a.world).toEqual({ x: 950, z: 0 });
    expect(field.fates[0]).toEqual({ sink: 0, clock: 0, hidden: false });
    expect(fates.busy('a')).toBe(false);
    expect(field.busyFrames.has('a')).toBe(false);
    expect(events).toEqual(['begin', 'settled', 'undo', 'afloat']);
  });

  test('the way back and «keep» go to the latest open fate; a kept one is passed over', () => {
    const field = fakeField(), fates = new TileFates(field);
    fates.give('a', 'sink');
    fates.give('b', 'break');
    expect(fates.open()).toBe('b');
    expect(fates.keep()).toBe(true);
    expect(fates.open()).toBe('a');
    expect(fates.undoHint()).toBe('raise');
    expect(fates.facts()).toEqual({ release: 0, sink: 1, break: 1 });
    expect(fates.undo()).toBe(true);
    expect(fates.facts()).toEqual({ release: 0, sink: 0, break: 1 });
    expect(fates.open()).toBeNull();
    expect(fates.undo('b')).toBe(false);
  });

  test('a frame near the island centre is released along +x; a new model makes every frame afloat', () => {
    const field = fakeField(), fates = new TileFates(field);
    fates.give('b', 'release');
    for (let i = 0; i < 10; i++) fates.update(1);
    expect(field.frameRegistry.get('b').world.x).toBeGreaterThan(1);
    field.rest = {};
    fates.update(0.1);
    expect(fates.busy('b')).toBe(false);
    expect(field.busyFrames.size).toBe(0);
  });

  test('the probe rate runs the clocks faster', () => {
    const field = fakeField(), fates = new TileFates(field);
    fates.rate = 20;
    fates.give('a', 'sink');
    for (let i = 0; i < 20; i++) fates.update(0.1);
    expect(settled(fates.of('a'))).toBe(true);
  });
});

const deck = (id, x, z, hu = 5, hv = 3) => ({ id, x, z, ux: 1, uz: 0, vx: 0, vz: 1, hu, hv, y: 0.2 });

describe('deckAtHand', () => {
  test('rim distances and gaps between decks', () => {
    const a = deck('a', 0, 0);
    expect(rimDistance(a, 3, 1)).toBe(0);
    expect(rimDistance(a, 8, 7)).toBeCloseTo(5, 9);
    expect(deckGap(a, deck('b', 14, 0))).toBeCloseTo(4, 9);
    expect(deckGap(a, deck('c', 6, 0))).toBe(0);
  });

  test('on a raft alone — the raft itself (take off first); another frame near — that one, the walker stays', () => {
    const raft = deck('raft', 0, 0);
    expect(deckAtHand([raft], { deckId: 'raft', flying: false, x: 0, z: 0 }, FATE.near)).toEqual({ id: 'raft', own: true });
    const decks = [raft, deck('far', 40, 0), deck('near', 16, 0)];
    expect(deckAtHand(decks, { deckId: 'raft', flying: false, x: 0, z: 0 }, FATE.near)).toEqual({ id: 'near', own: false });
  });

  test('in the air — the frame below or within reach; on the ground — none', () => {
    const decks = [deck('a', 0, 0), deck('b', 40, 0)];
    expect(deckAtHand(decks, { deckId: null, flying: true, x: 1, z: 1 }, FATE.near)).toEqual({ id: 'a', own: false });
    expect(deckAtHand(decks, { deckId: null, flying: true, x: 30, z: 0 }, FATE.near)).toEqual({ id: 'b', own: false });
    expect(deckAtHand(decks, { deckId: null, flying: true, x: 20, z: 20 }, FATE.near)).toBeNull();
    expect(deckAtHand(decks, { deckId: null, flying: false, x: 0, z: 0 }, FATE.near)).toBeNull();
  });
});
