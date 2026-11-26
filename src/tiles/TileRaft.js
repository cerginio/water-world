import * as THREE from 'three';
import { TileFrameQuery } from './TileFrameQuery.js';
import { RAFT, inOpenSea, openWater, stepRaft } from './raftMotion.js';
import { createCKite } from './cKite.js';

// The raft and the kite (STORY-QUEST-SPEC §2 п.5, §4.2, §4.3; story-quest Q4). Every frame
// of the field that is drawn on the water (a hydrated miniature, or any frame without
// miniatures) is a deck the walker can step onto (walker/deck.js). The deck the walker
// stands on is the raft: with the kite up, the walk input is its course (walker/index.js)
// and the kite pulls it there with a constant force (raftMotion.js); let go, it drifts.
//
// The raft moves the frame of the field (TileField.moveFrame — a 'placed' frame, its tiles
// go on riding the waves where it is); no new axis enters TileSim. The deck's height is the
// GPU's: the highest tile top near the feet (TileFrameQuery mode 3), read 1–3 frames late.
//
// Events (EventTarget), detail { frameId, x, z }: 'board', 'leave' (the walker onto / off a
// deck), 'kite' (+ up), 'sea' (+ inSea: the walker on the raft crossed the edge of the
// shore map, spec §4.3 / §3.1 «Вийти в море»).
//
// Q4b: the kite also flies the walker on the board (walker/flight.js). Off the raft into the
// air the kite stays up and the raft left behind coasts down to the drift, as one let go;
// landed on a deck, that deck is the raft under the kite; landed on the ground, the kite is
// gone. Events 'takeoff' and 'land' (+ on: 'ground' | 'deck' | 'water' — into it, Q5b: the
// kite is gone as on the ground).

const RAFT_DECK_Y = 0.15;   // m: a deck's height until the GPU has answered (a tile top over still water)
// m around the feet the deck height is read in (TileFrameQuery mode 3, + each tile's radius):
// at 0.4 m the gaps between my-day's polyline strips left the height unread for 0.6–0.8 s
const DECK_REACH = 1.2;
export const KITE = Object.freeze({
  ahead: 28,     // m ahead of the walker along the course
  height: 9,     // m above the deck: ~18° over the horizon, in view of the eyes (16 m at 24 m was out of it)
  follow: 0.6,   // s: the kite swings round to a new course
  barAhead: 0.45, // m: the control bar (cKite.js) this far in front of the body, towards the kite…
  barHeight: 1.0, // …at the waist, this high over the feet
});

/**
 * @param {any} field a TileField
 * @param {{ ground: (x: number, z: number) => any, scene: any, seaEdge?: number }} options
 */
export class TileRaft extends EventTarget {
  constructor(field, { ground, scene, seaEdge = RAFT.seaEdge }) {
    super();
    this.field = field;
    this.ground = ground;
    this.scene = scene;
    this.seaEdge = seaEdge;
    /** @type {Map<any, { x: number, z: number, vx: number, vz: number, blocked: boolean }>} frame id → motion */
    this.motion = new Map();
    this.reading = false;
    /** @type {THREE.Vector3 | null} the kite relative to the walker's feet */
    this.kiteAt = null;
    /** @type {THREE.Vector3 | null} */
    this.bar = null;
    /** @type {{ up: boolean, course: { x: number, z: number } | null, heading: { x: number, z: number } | null }} */
    this.kite = { up: false, course: null, heading: null };
    this.deckId = null;   // the deck the walker is on, or null
    this.flying = false;  // the walker on the board in the air (Q4b)
    this.inSea = false;
    this.heights = new Map();   // frame id → last deck height read
    this.rest = null;
    this.query = null;
    this.list = [];
    this.kiteGroup = this.buildKite();
    scene.add(this.kiteGroup);
  }

  buildKite() {
    const group = new THREE.Group();
    group.name = 'kite';
    group.visible = false;
    // the C-kite: wing, four lines, node and bar (cKite.js, Q5a; was a diamond on two lines)
    this.model = createCKite(group);
    return group;
  }

  /** The decks of the scene now (walker/deck.js), built once per update. */
  decks() { return this.list; }

  /** Is the walker on a deck now. */
  get boarded() { return this.deckId !== null; }

  /** Kite up / let go; only on a deck (or in the air, where it holds the board). @returns {boolean} up */
  setKite(up, airborne = false) {
    // airborne: the walker has just taken off out of the water (Q8), update() has not seen it yet
    const next = !!up && (this.boarded || this.flying || airborne);
    if (next === this.kite.up) return next;
    this.kite.up = next;
    this.kite.course = null;
    if (!next) { this.kite.heading = null; this.kiteAt = null; }
    this.emitAt('kite', { up: next });
    return next;
  }

  toggleKite() { return this.setKite(!this.kite.up); }

  /** The raft's speed under the walker now (world XZ, m/s): the board takes off with it. */
  velocity() {
    const m = this.deckId === null ? null : this.motion.get(this.deckId);
    return m ? { x: m.vx, z: m.vz } : { x: 0, z: 0 };
  }

  /** The kite's course from the walk input: a unit {x, z}, or null — slack, the raft coasts. */
  course(dir) { this.kite.course = dir; if (dir) this.kite.heading = dir; }

  /** Probes and the GUI: the raft's deck centre straight to world (x, z), at rest. */
  moveTo(frameId, x, z) {
    const deck = this.list.find((d) => d.id === frameId);
    const frame = this.field.frameRegistry.get(frameId);
    // the deck centre is the frame's tile box centre, not its pivot
    const dx = deck ? deck.x - frame.world.x : 0, dz = deck ? deck.z - frame.world.z : 0;
    this.field.moveFrame(frameId, x - dx, z - dz);
    this.motion.set(frameId, { x, z, vx: 0, vz: 0, blocked: false });
    this.build();
  }

  /** A let-go raft's speed: the wind × windage, as TileSim drifts a frame (world XZ, m/s). */
  drift() {
    const wind = this.field.surface?.sim?.params, k = (wind?.windSpeed ?? 0) * this.field.params.windage;
    const a = (wind?.windDirection ?? 0) * Math.PI / 180;
    return { x: Math.cos(a) * k, z: Math.sin(a) * k };
  }

  /** The frames drawn on the water: a miniature hides its frame (TileMiniatures.syncFrames). */
  shown() {
    const ids = new Map();
    for (const e of this.field.boundsEntries) {
      const frame = this.field.frameRegistry.entries[e.frameIndex];
      if (!frame) continue;
      ids.set(frame, (ids.get(frame) ?? false) || e.mesh.visible);
    }
    return [...ids].filter(([, visible]) => visible).map(([frame]) => frame);
  }

  build() {
    const m = this.field.group.matrixWorld.elements;
    // the field's x and z axes in world XZ (a yaw: unit, orthogonal)
    const ux = m[0], uz = m[2], vx = m[8], vz = m[10];
    // a frame under a fate (TileFates, Q5) is no deck and no raft: it goes its own way
    const busy = this.field.busyFrames;
    for (const id of busy ?? []) this.motion.delete(id);
    this.list = this.shown().filter((f) => f.bounds && !f.bounds.isEmpty() && !busy?.has(f.id)).map((f) => {
      const b = f.bounds;
      const cx = (b.min.x + b.max.x) / 2 + f.offset.x, cz = (b.min.y + b.max.y) / 2 + f.offset.z;
      const c = new THREE.Vector3(cx, 0, cz).applyMatrix4(this.field.group.matrixWorld);
      return { id: f.id, x: c.x, z: c.z, ux, uz, vx, vz, hu: (b.max.x - b.min.x) / 2, hv: (b.max.y - b.min.y) / 2,
        y: this.heights.get(f.id) ?? RAFT_DECK_Y };
    });
  }

  /** The frame's tiles left the GPU (load, rebuild): every raft starts again. */
  sync() {
    if (this.field.rest === this.rest) return;
    this.rest = this.field.rest;
    this.query?.dispose();
    this.query = null;
    this.motion.clear();
    this.heights.clear();
    this.list = [];
    if (this.deckId !== null) this.setKite(false);
    this.deckId = null;
    this.inSea = false;
    this.field.lockedFrames?.clear();
  }

  /**
   * Once a frame, before the walker steps (it reads the decks): moves the rafts, rebuilds
   * the decks, reads the deck height under the feet, poses the kite, emits the events.
   * `walker` — the walker's state (x, y, z, deck) or null.
   */
  update(dt, walker) {
    this.sync();
    if (!this.field.sim || !this.field.rest) { this.kiteGroup.visible = false; return; }
    this.build();
    const onId = walker?.deck ? walker.deck.id : null;
    const flying = !!walker?.flight;
    if (flying && !this.flying) { this.flying = true; this.emitAt('takeoff', { frameId: this.deckId }, walker); }
    if (onId !== this.deckId) {
      const was = this.deckId;
      this.deckId = onId;
      if (was !== null) {
        this.field.lockedFrames?.delete(was);
        if (!flying) this.setKite(false);
        // the raft left under the kite coasts on (stepRaft without the pull) from its speed
        this.emitAt('leave', { frameId: was }, walker);
      }
      if (onId !== null) { (this.field.lockedFrames ??= new Set()).add(onId); this.emitAt('board', { frameId: onId }, walker); }
    }
    if (!flying && this.flying) {
      this.flying = false;
      this.emitAt('land', { on: onId !== null ? 'deck' : walker?.swim ? 'water' : 'ground' }, walker);
      if (onId === null) this.setKite(false);
    }
    // the rafts: the one under the kite, and any still coasting
    const drift = this.drift();
    for (const deck of this.list) {
      const pulled = this.kite.up && deck.id === this.deckId;
      let s = this.motion.get(deck.id);
      if (!s && !pulled) continue;
      s ??= { x: deck.x, z: deck.z, vx: 0, vz: 0, blocked: false };
      // the deck centre as the frame has it now (a drag or a placement may have moved it)
      s.x = deck.x; s.z = deck.z;
      const radius = Math.hypot(deck.hu, deck.hv);
      const next = stepRaft(s, dt, { pull: pulled ? this.kite.course : null, drift,
        open: (x, z) => openWater(this.ground, x, z, radius) });
      this.motion.set(deck.id, next);
      if (next.x !== s.x || next.z !== s.z) {
        const frame = this.field.frameRegistry.get(deck.id);
        this.field.moveFrame(deck.id, frame.world.x + next.x - s.x, frame.world.z + next.z - s.z);
        deck.x = next.x; deck.z = next.z;
      }
    }
    this.readHeight(walker);
    const inSea = !!walker && this.deckId !== null && inOpenSea(walker.x, walker.z, this.seaEdge);
    if (inSea !== this.inSea) { this.inSea = inSea; this.emitAt('sea', { frameId: this.deckId, inSea }, walker); }
  }

  /** The GPU's deck height under the feet, one read in flight at a time. */
  readHeight(walker) {
    if (this.deckId === null || !walker || this.reading) return;
    const id = this.deckId;
    this.query ??= new TileFrameQuery(this.field, 3);
    const frame = this.field.frameRegistry.get(id);
    this.reading = true;
    this.query.query(frame, undefined, 0, { x: walker.x, z: walker.z, radius: DECK_REACH })
      .then((r) => { if (r && r[1] > 0.5 && Number.isFinite(r[0])) this.heights.set(id, r[0]); })
      .catch(() => {})
      .finally(() => { this.reading = false; });
  }

  /**
   * Once a frame AFTER the walker has stepped and ridden (main.js): the kite and its four lines
   * from the walker as the camera has it this frame. Posed before, from last frame's feet,
   * the bar lagged up to 0.13 m behind at 8 m/s and swung on screen (Q4 review).
   * The kite keeps its place relative to the walker (it is carried with the raft) and swings
   * round to a new course in KITE.follow.
   */
  pose(dt, walker) {
    const g = this.kiteGroup;
    // landed on the ground this frame: update() lets the kite go only next frame (Q4b)
    g.visible = this.kite.up && !!walker && (!!walker.deck || !!walker.flight);
    if (!g.visible) return;
    const motion = this.motion.get(this.deckId);
    const along = this.kite.heading ?? (motion && Math.hypot(motion.vx, motion.vz) > 0.1
      ? { x: motion.vx, z: motion.vz } : { x: Math.sin(walker.yaw ?? 0), z: Math.cos(walker.yaw ?? 0) });
    const l = Math.hypot(along.x, along.z) || 1;
    const target = new THREE.Vector3(along.x / l * KITE.ahead, KITE.height, along.z / l * KITE.ahead);
    if (!this.kiteAt) this.kiteAt = target.clone();
    this.kiteAt.lerp(target, 1 - Math.exp(-Math.max(0, dt) / KITE.follow));
    const kite = new THREE.Vector3(walker.x, walker.y, walker.z).add(this.kiteAt);
    // the bar: in front of the waist towards the kite, across the line of pull
    const h = new THREE.Vector3(this.kiteAt.x, 0, this.kiteAt.z).normalize();
    const bar = new THREE.Vector3(walker.x, walker.y + KITE.barHeight, walker.z).addScaledVector(h, KITE.barAhead);
    const wind = this.field.surface?.sim?.params?.windSpeed ?? 0;
    this.model.pose(dt, { kite, bar, along: h, wind });
    /** for probes: the bar's centre, world */
    this.bar = bar;
  }

  emitAt(type, detail, at = null) {
    this.dispatchEvent(new CustomEvent(type, { detail: { frameId: this.deckId, x: at?.x ?? null, z: at?.z ?? null, ...detail } }));
  }

  dispose() {
    this.query?.dispose();
    this.scene.remove(this.kiteGroup);
    this.model.dispose();
  }
}
