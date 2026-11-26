// The scene as the contract sees it (STORY-QUEST-SPEC §4.4): one facade over window.app and the
// few things main.js keeps to itself (the walker's spawn, the sea edge). The commands, the
// anchors and state.read take this, never window.app directly — the unit tests give a fake.

/**
 * @typedef {{
 *   host: any, raft: any, fates: any, minis: any,
 *   ready: () => boolean, failed: () => string | null, story: () => string | null, fingerprint: () => string | null,
 *   map?: () => string,
 *   openSea?: () => ({ x: number, z: number, yaw: number } | null),
 *   ensureHost: () => Promise<any>,
 *   ground: (x: number, z: number) => ({ height: number } | null),
 *   spawn: () => { x: number, z: number, yaw: number },
 *   center: () => { x: number, z: number },
 *   frames: () => { index: number, id: any, x: number, z: number }[],
 *   decks: () => any[],
 *   hints: () => any,
 *   flyAction: () => string | null,
 *   mood: any,
 *   catalog: any,
 *   tech: { controls: boolean, fps: boolean, toggle: (name: string) => void },
 *   fps: () => number | null,
 *   setLocale: (locale: string) => string,
 * }} EmbedWorld
 */

/**
 * @param {{ app: any, spawn: () => { x: number, z: number, yaw: number } }} options
 * @returns {EmbedWorld}
 */
export function worldFromApp({ app, spawn }) {
  return {
    get host() { return app.walker; },
    get raft() { return app.raft; },
    get fates() { return app.fates; },
    get minis() { return app.minis; },
    ready: () => !!(app.tiles.loaded && app.raft && app.fates),
    failed: () => (app.catalog.state === 'failed' ? app.catalog.error?.code ?? 'unknown' : null),
    story: () => app.catalog.story?.id ?? null,
    fingerprint: () => app.catalog.fingerprint ?? null,
    // the map the scene was built on (ISLAND-MAPS-SPEC §4.3): its profile's id, never the raw ?map
    map: () => app.map ?? 'island',
    // the profile's own open-sea point where a ray from the centre would cross land (spec §4.2)
    openSea: () => app.openSea ?? null,
    // the walker host without the overview flight: startWalk() resolves once it is there
    ensureHost: async () => app.walker ?? app.startWalk({ overview: false }),
    ground: app.ground,
    spawn,
    center: () => ({ x: app.tiles.center.x, z: app.tiles.center.z }),
    frames: () => app.tiles.frameRegistry.entries.map((e, index) => {
      // a frame still a miniature is where the miniature is (on the shore, in the hands)
      const mini = app.minis?.active ? app.minis.get(e.id) : null;
      const at = mini && mini.state !== 'water' ? mini.root.position : e.world;
      return { index, id: e.id, x: at.x, z: at.z };
    }),
    decks: () => app.raft?.decks() ?? [],
    hints: () => ({ fly: app.flyHint(), kite: app.kiteHint(), mini: app.miniHint(), fates: app.fateHints() }),
    flyAction: app.flyAction,
    mood: app.mood,
    catalog: app.catalog,
    tech: app.techPanels,
    fps: () => app.fps(),
    setLocale: (locale) => app.setLocale(locale),
  };
}
