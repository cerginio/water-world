// The closed list of the scene's commands (STORY-QUEST-SPEC §4.4; quest-demo-qa.md «Контракт
// сцени»). A card's step is one of these. Each puts the scene into a state at once — no walk
// is played out (the owner's decision: a teleport by commands) — through the same functions
// the keys and the buttons call, and resolves once the state is there, or refuses with a
// reason. The camera is never touched here: it follows the walker through CameraRig (OWNER-3).
import { EmbedError, until } from './protocol.js';
import { frameOf, resolveAnchor } from './anchors.js';
import { readState } from './state.js';

export const WAIT = Object.freeze({
  ready: 90000,   // ms for the story to load and the scene to be up
  step: 15000,    // ms for a command's state to come
  fate: 45000,    // ms for a fate to play out at FAST_FATE (release: 60 s / 10)
  fateRate: 10,   // a fate's clock while a command waits for it (probe-story-q5's RATE)
});
const KINDS = ['release', 'sink', 'break'];

/** @typedef {import('./world.js').EmbedWorld} EmbedWorld */

/**
 * @param {EmbedWorld} world
 * @param {{ wait?: Partial<typeof WAIT> }} [options]
 * @returns {Record<string, (args: any) => Promise<any>>}
 */
export function createCommands(world, { wait = {} } = {}) {
  const W = { ...WAIT, ...wait };

  const ready = async () => {
    await until(() => world.ready() || world.failed(), W.ready, 'the story to load');
    const failed = world.failed();
    if (failed) throw new EmbedError('story-failed', `the story did not load: ${failed}`);
  };
  /** The walker host, in the eyes. */
  const eyes = async () => {
    const host = await world.ensureHost();
    if (host.mode !== 'eyes') {
      if (host.mode !== 'boarding') host.enterEyes({ approach: false });
      await until(() => host.mode === 'eyes', W.step, 'the eyes');
    }
    return host;
  };
  const frame = (args) => frameOf(world, args.frame);
  const deckOf = (f) => {
    const d = world.decks().find((x) => x.id === f.id);
    if (!d) throw new EmbedError('not-on-water', `frame ${f.index} is not a deck on the water`);
    return d;
  };
  const miniOf = (f) => {
    const m = world.minis?.active ? world.minis.get(f.id) : null;
    if (!m) throw new EmbedError('no-miniature', 'no miniatures in this scene (&minis)');
    return m;
  };
  const place = (args, fallback) => (args.at === undefined ? fallback() : resolveAnchor(args.at, world));
  const settleFate = async (id, test) => {
    const fates = world.fates, rate = fates.rate;
    fates.rate = W.fateRate;
    try { await until(test, W.fate, 'the fate to play out'); } finally { fates.rate = rate; }
  };

  /** Each: (args) → a promise of state.read once there. */
  const commands = {
    'state.read': async () => readState(world),

    /** Feet on the ground at an anchor ('beach' by default), in the eyes, facing `yaw` or out. */
    'walker.place': async (args) => {
      await ready();
      const host = await eyes();
      const p = place(args, () => world.spawn());
      if (!world.ground(p.x, p.z)) throw new EmbedError('not-possible', `no ground at ${args.at}`);
      host.place(p.x, p.z, args.yaw ?? p.yaw ?? host.state.yaw);
      return readState(world);
    },
    /** Out of the body (`on: false`, the camera stays free) or back into the eyes. */
    'walker.eyes': async ({ on = true }) => {
      await ready();
      const host = await world.ensureHost();
      if (!on) {
        if (host.mode === 'eyes' || host.mode === 'boarding') host.leaveEyes();
        await until(() => host.mode === 'standing', W.step, 'out of the body');
        return readState(world);
      }
      await eyes();
      return readState(world);
    },
    /** The gaze: `yaw` / `pitch` in radians, or `at` an anchor (looked at level). */
    'walker.look': async (args) => {
      await ready();
      const host = await eyes(), s = host.state;
      if (args.at !== undefined) {
        const p = resolveAnchor(args.at, world);
        s.yaw = Math.atan2(p.x - s.x, p.z - s.z);
      }
      if (typeof args.yaw === 'number') s.yaw = args.yaw;
      if (typeof args.pitch === 'number') s.pitch = args.pitch;
      return readState(world);
    },

    /** Frame n's miniature into the hands: the walker steps up to it and takes it (G). */
    'minis.take': async (args) => {
      await ready();
      const host = await eyes(), f = frame(args), item = miniOf(f), minis = world.minis;
      if (item.state === 'carried') return readState(world);
      if (item.state !== 'ground') throw new EmbedError('not-possible', `miniature ${f.index} is ${item.state}`);
      if (minis.carried) throw new EmbedError('not-possible', 'the hands are full');
      const m = item.root.position;
      host.place(m.x - 1.5, m.z, Math.PI / 2);
      if (!minis.take(item.frameId, host.state)) throw new EmbedError('not-possible', `miniature ${f.index} not taken`);
      return readState(world);
    },
    /** Frame n onto the water off the beach: taken if need be, put down at 'shallow', unfolded. */
    'minis.hydrate': async (args) => {
      await ready();
      const host = await eyes(), f = frame(args), item = miniOf(f), minis = world.minis;
      if (item.state === 'water') return readState(world);
      if (item.state === 'ground') await commands['minis.take'](args);
      else if (item.state !== 'carried') throw new EmbedError('not-possible', `miniature ${f.index} is ${item.state}`);
      const p = resolveAnchor('shallow', world);
      host.place(p.x, p.z, p.yaw);
      if (minis.put(host.state) !== 'unfolding') throw new EmbedError('not-possible', 'the shallows put it on the ground');
      // on the water, then a deck: TileRaft rebuilds its decks in its own step
      await until(() => item.state === 'water' && world.decks().some((d) => d.id === f.id), W.step, 'the frame a deck on the water');
      return readState(world);
    },

    /** Onto frame n's deck at (u, v), facing out to sea; it is a raft from then on. */
    'raft.board': async (args) => {
      await ready();
      const host = await eyes(), f = frame(args), d = deckOf(f);
      host.walker.board(d, args.u ?? 0, args.v ?? 0, args.yaw ?? Math.atan2(d.x, d.z));
      await until(() => world.raft.deckId === d.id, W.step, 'the walker on the deck');
      return readState(world);
    },
    /** Frame n's deck (with the walker on it, if it is the raft) straight to an anchor, at rest. */
    'raft.moveTo': async (args) => {
      await ready();
      const f = frame(args), d = deckOf(f), p = resolveAnchor(args.at, world, { deck: d });
      world.raft.moveTo(d.id, p.x, p.z);
      // the deck there, and the walker on it carried along (ride() next frame)
      const s = world.host?.state, aboard = s?.deck && s.deck.id === d.id, reach = Math.hypot(d.hu, d.hv) + 2;
      await until(() => {
        const now = world.decks().find((x) => x.id === d.id);
        return now && Math.hypot(now.x - p.x, now.z - p.z) < 2 && (!aboard || Math.hypot(s.x - p.x, s.z - p.z) < reach);
      }, W.step, 'the deck at the anchor');
      return readState(world);
    },
    /** The kite up or let go (K): only on a deck or in the air. */
    'kite.set': async ({ up = true }) => {
      await ready();
      if (world.raft.setKite(up) !== !!up) throw new EmbedError('not-possible', 'the kite needs a deck or the air');
      return readState(world);
    },

    /** Off the raft on the board (Space with the kite up); the kite goes up first if it is down. */
    'fly.takeOff': async () => {
      await ready();
      const host = await eyes(), raft = world.raft;
      if (host.state.flight) return readState(world);
      if (!raft.boarded) throw new EmbedError('not-possible', 'take-off is from a raft');
      raft.setKite(true);
      if (!host.walker.takeOff(raft.velocity())) throw new EmbedError('not-possible', 'did not take off');
      return readState(world);
    },
    /** In the air, straight over an anchor (the board keeps its height band). */
    'fly.to': async (args) => {
      await ready();
      const host = await eyes();
      if (!host.state.flight) throw new EmbedError('not-possible', 'not in the air');
      const p = resolveAnchor(args.at, world);
      Object.assign(host.state, { x: p.x, z: p.z });
      if (p.yaw !== undefined) host.state.yaw = p.yaw;
      return readState(world);
    },
    /** Down from the board (Space): onto the feet, a deck, or over deep water into it. */
    'fly.land': async () => {
      await ready();
      const host = await eyes();
      if (!host.state.flight) throw new EmbedError('not-possible', 'not in the air');
      if (!world.flyAction()) throw new EmbedError('not-possible', 'did not land');
      await until(() => !host.state.flight, W.step, 'the landing');
      return readState(world);
    },

    /**
     * A fate for frame n: 'release', 'sink' or 'break' (Z / X / C). From its own deck the kite
     * lifts the walker first, as on the raft. `settle` (default) waits it out at a fast clock.
     */
    'fate.give': async (args) => {
      await ready();
      const f = frame(args), fates = world.fates;
      if (!KINDS.includes(args.kind)) throw new EmbedError('bad-args', `kind is one of ${KINDS.join(', ')}`);
      const host = world.host;
      if (host?.state.deck && host.state.deck.id === f.id) await commands['fly.takeOff']();
      if (!fates.give(f.id, args.kind)) throw new EmbedError('not-possible', `frame ${f.index} is not afloat`);
      if (args.settle !== false) await settleFate(f.id, () => fates.of(f.id).t >= 1);
      return readState(world);
    },
    /** The way back (H) of frame n's fate, or of the latest; `settle` waits until it is afloat. */
    'fate.undo': async (args) => {
      await ready();
      const fates = world.fates, id = args.frame === undefined ? fates.open() : frame(args).id;
      if (id === null || !fates.undo(id)) throw new EmbedError('not-possible', 'no fate to undo');
      if (args.settle !== false) await settleFate(id, () => !fates.busy(id));
      return readState(world);
    },
    /** «Leave it so» (L) for frame n's fate, or the latest. */
    'fate.keep': async (args) => {
      await ready();
      const fates = world.fates, id = args.frame === undefined ? fates.open() : frame(args).id;
      if (id === null || !fates.keep(id)) throw new EmbedError('not-possible', 'no fate to keep');
      return readState(world);
    },

    /**
     * Into the water: at an anchor (`at`, `depth` m under), or the way the button goes — off the
     * raft's rim with the kite let go, or from the board over deep water.
     */
    'swim.in': async (args) => {
      await ready();
      const host = await eyes(), s = host.state;
      if (args.at !== undefined) {
        const p = resolveAnchor(args.at, world);
        world.raft.setKite(false);
        host.walker.swimAt(p.x, p.z, args.depth ?? 0);
      } else if (s.flight) {
        if (host.walker.landing() !== 'water') throw new EmbedError('not-possible', 'not over deep water');
        world.flyAction();
      } else if (s.deck) {
        world.raft.setKite(false);
        if (host.walker.jumpIn() !== 'water') throw new EmbedError('not-possible', 'no deep water off the rim');
      } else if (!s.swim) throw new EmbedError('not-possible', 'into the water is from a raft, the air or an anchor');
      await until(() => host.state.swim, W.step, 'in the water');
      return readState(world);
    },
    /** In the water, at `depth` m under the surface at once (Dive goes 3 m deeper by default). */
    'swim.dive': async (args) => {
      await ready();
      const host = await eyes(), s = host.state;
      if (!s.swim) throw new EmbedError('not-possible', 'not in the water');
      host.walker.swimAt(s.x, s.z, args.depth ?? s.swim.depth + 3);
      return readState(world);
    },
    /** Up to the surface at once. */
    'swim.rise': async () => {
      await ready();
      const host = await eyes(), s = host.state;
      if (!s.swim) throw new EmbedError('not-possible', 'not in the water');
      host.walker.swimAt(s.x, s.z, 0);
      return readState(world);
    },

    /** The weather: valence, arousal and the time of day, at once (app.mood.set). */
    'mood.set': async ({ v, a, t }) => {
      if (![v, a].every((n) => typeof n === 'number' && n >= -1 && n <= 1)) throw new EmbedError('bad-args', 'v and a are in -1..1');
      return world.mood.set(v, a, t);
    },
  };
  return Object.freeze(commands);
}
