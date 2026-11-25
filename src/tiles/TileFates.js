import { FATE, UNDO, afloat, begin, fateLook, keep, settled, stepFate, undo } from './frameFate.js';

// The frames' fates at sea (STORY-QUEST-SPEC §2 п.6, §4.1 «Долі кадру»; story-quest Q5). The
// clocks are frameFate.js; this keeps one per frame of the field and puts it on the scene:
// a released frame is moved out to sea (TileField.moveFrame, a 'placed' frame, as the raft);
// how deep it is, the break clock and «gone» go to TileSim.setFate, where the sim and the tile
// material take them (TILE_FATE_GLSL).
//
// A frame under a fate is no deck (TileRaft leaves it out) and no pointer grabs it
// (TileField.busyFrames): it is going its own way. Kept, it stays so: no way back here (Edge
// §4.4 — the way back after «Leave it so» is a saved state, not this).
//
// Events (EventTarget) 'change', detail { frameId, kind, phase }: 'begin', 'undo' (the way
// back began), 'keep', 'settled' (gone / on the bed / all sunk), 'afloat' (undone to the end).
// The quests (Q6) count facts from them: «released 1 · sunk 1».

const ISLAND = { x: 0, z: 0 };   // the island's centre: a released frame goes away from it

export class TileFates extends EventTarget {
  /** @param {any} field a TileField */
  constructor(field) {
    super();
    this.field = field;
    /** @type {Map<any, import('./frameFate.js').Fate>} */
    this.fates = new Map();
    this.order = [];    // frame ids by when their fate began, latest last
    this.rate = 1;      // probes: the fates' clock runs this many times faster
    this.rest = null;
  }

  /** The fate of a frame now (afloat when it has none). */
  of(frameId) { return this.fates.get(frameId) ?? afloat(); }

  /** Under a fate (and not afloat): no deck, no drag. */
  busy(frameId) { return this.of(frameId).kind !== null; }

  /**
   * A fate for a frame afloat: 'release', 'sink' or 'break'. @returns {boolean} begun
   */
  give(frameId, kind) {
    this.sync();
    const frame = this.frame(frameId);
    if (!frame) return false;
    const origin = { x: frame.world.x, z: frame.world.z };
    let away = { x: origin.x - ISLAND.x, z: origin.z - ISLAND.z };
    if (Math.hypot(away.x, away.z) < 1) away = { x: 1, z: 0 };
    const next = begin(this.of(frameId), kind, { origin, away });
    if (!next) return false;
    this.set(frameId, next, 'begin');
    this.order = [...this.order.filter((id) => id !== frameId), frameId];
    this.field.busyFrames?.add(frameId);
    return true;
  }

  /** The frame whose fate can still be undone or kept: the latest begun, or null. */
  open() {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const f = this.of(this.order[i]);
      if (f.kind !== null && !f.kept && f.dir !== -1) return this.order[i];
    }
    return null;
  }

  /** The way back (call / raise / gather) of a frame, by default the latest. @returns {boolean} */
  undo(frameId = this.open()) {
    const next = frameId === null ? null : undo(this.of(frameId));
    if (!next) return false;
    this.set(frameId, next, 'undo');
    return true;
  }

  /** «Leave it so», by default for the latest. @returns {boolean} */
  keep(frameId = this.open()) {
    const next = frameId === null ? null : keep(this.of(frameId));
    if (!next) return false;
    this.set(frameId, next, 'keep');
    return true;
  }

  /** What the way back of the open fate is called: 'call', 'raise', 'gather' or null. */
  undoHint() {
    const id = this.open();
    return id === null ? null : UNDO[this.of(id).kind];
  }

  /** Facts for the quests: how many frames are released / sunk / broken now (begun, not undone). */
  facts() {
    const n = { release: 0, sink: 0, break: 0 };
    for (const f of this.fates.values()) if (f.kind !== null && f.dir !== -1) n[f.kind]++;
    return n;
  }

  /** A new model on the GPU: every frame is afloat again. */
  sync() {
    if (this.field.rest === this.rest) return;
    this.rest = this.field.rest;
    this.fates.clear();
    this.order = [];
    this.field.busyFrames?.clear();
  }

  frame(frameId) {
    try { return this.field.frameRegistry.get(frameId); } catch { return null; }
  }

  set(frameId, fate, phase) {
    if (fate.kind === null) this.fates.delete(frameId); else this.fates.set(frameId, fate);
    const kind = fate.kind ?? this.fates.get(frameId)?.kind ?? null;
    this.dispatchEvent(new CustomEvent('change', { detail: { frameId, kind, phase } }));
  }

  /** Once a frame, before TileRaft builds its decks: the clocks run, the frames follow. */
  update(dt) {
    this.sync();
    const sim = this.field.sim;
    if (!sim) return;
    for (const [id, fate] of [...this.fates]) {
      const frame = this.frame(id);
      if (!frame) { this.fates.delete(id); continue; }
      const next = stepFate(fate, dt * this.rate);
      if (next !== fate) {
        if (next.kind === null) {
          this.fates.delete(id);
          this.order = this.order.filter((o) => o !== id);
          this.field.busyFrames?.delete(id);
          this.dispatchEvent(new CustomEvent('change', { detail: { frameId: id, kind: fate.kind, phase: 'afloat' } }));
        } else {
          this.fates.set(id, next);
          if (settled(next) && !settled(fate)) this.dispatchEvent(new CustomEvent('change', { detail: { frameId: id, kind: next.kind, phase: 'settled' } }));
        }
      }
      // undone to the end: back where it began, whole and afloat
      const look = next.kind === null ? fateLook(fate.kind === 'release' ? { ...fate, t: 0 } : afloat()) : fateLook(next);
      if (look.at && (Math.abs(frame.world.x - look.at.x) > 1e-4 || Math.abs(frame.world.z - look.at.z) > 1e-4)) {
        this.field.moveFrame(id, look.at.x, look.at.z);
      }
      sim.setFate(frame.index, look.sink, look.clock, look.hidden);
    }
  }
}

export { FATE };
