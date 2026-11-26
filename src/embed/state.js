// state.read (STORY-QUEST-SPEC §4.4): what a product or a probe needs to know the scene is where
// a card put it. Plain data: ids are strings, numbers rounded to the centimetre.
/** @typedef {import('./world.js').EmbedWorld} EmbedWorld */

const cm = (v) => Math.round(v * 100) / 100;

/** @param {EmbedWorld} world */
export function readState(world) {
  const host = world.host, raft = world.raft, fates = world.fates, minis = world.minis;
  const s = host?.state ?? null;
  const decks = raft?.decks() ?? [];
  const frames = world.frames().map((f) => {
    const fate = fates?.of(f.id);
    const mini = minis?.active ? minis.get(f.id) : null;
    return { index: f.index, id: String(f.id), x: cm(f.x), z: cm(f.z), mini: mini?.state ?? null,
      deck: decks.some((d) => d.id === f.id),
      fate: fate?.kind ? { kind: fate.kind, t: cm(fate.t), back: fate.dir === -1, kept: !!fate.kept } : null };
  });
  const deckId = s?.deck ? s.deck.id : null;
  const carried = minis?.carried ?? null;
  return {
    story: world.story(),
    fingerprint: world.fingerprint?.() ?? null,
    ready: world.ready(),
    mode: host?.mode ?? 'off',
    walker: s && { x: cm(s.x), y: cm(s.y), z: cm(s.z), yaw: cm(s.yaw), pitch: cm(s.pitch),
      deck: deckId === null ? null : frames.find((f) => f.id === String(deckId))?.index ?? null,
      flight: !!s.flight, landing: s.flight ? host.walker.landing() : null,
      swim: s.swim && { depth: cm(s.swim.depth), target: cm(s.swim.target) } },
    kite: !!raft?.kite.up,
    openSea: !!raft?.inSea,
    carried: carried ? frames.find((f) => f.id === String(carried.frameId))?.index ?? null : null,
    pack: minis?.active ? minis.packed.map((m) => frames.find((f) => f.id === String(m.frameId))?.index ?? null) : [],
    hints: world.hints(),
    frames,
  };
}
