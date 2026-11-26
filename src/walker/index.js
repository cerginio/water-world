// The walker on the island (STORY-QUEST-SPEC §2 п.2, §4.1 «Персонаж»; story-quest Q2a):
// Tilecraft's figure, walking by walkOnGround, the camera through its eyes via the
// camera owner (CameraRig.ride — OWNER-3: nothing here writes the camera).
//
// Modes: 'off' — not placed; 'boarding' — the camera is on its way into the eyes (Q2b:
// the figure stands and is shown, nothing walks); 'eyes' — the person walks, the camera is
// the eyes, the figure is hidden (the camera would sit inside its head); 'standing' — out
// of the body: the figure stands where it was left, the camera is free and goes by the
// rig's keys and by the stick (rig.steer).
//
// Q4: `decks` — the frames on the water the walker can stand on (walker.js); `pull` — the
// kite: while it flies and the walker is on a deck in the eyes, the walk input (keys, stick)
// sets the kite's course instead of walking; the head still turns.
//
// Q4b: in the air (walker.state.flight) the same input is the board's course (flight.js),
// and the kite's; the board is a mesh of its own under the feet, shown only in the air (Q8: a
// twin-tip kiteboard, kiteboard.js).
//
// Q5b: in the water (walker.state.swim, swim.js) the same input strokes; `water(x, z)` — the
// water's height there (main.js: the one read at the camera). The camera stays the eyes, so
// it goes under the water with them; nothing here writes it (OWNER-3).
import { createWalker, PACE } from './walker.js';
import { WALK, isWater, walkOnGround } from './groundWalk.js';
import { bindWalkerInput, keyIntent } from './keyboard.js';
import { loadWalkerModules } from './tilecraftWalker.js';
import { KITEBOARD, createKiteboard, disposeKiteboard } from './kiteboard.js';

export { WALK, PACE, isWater, walkOnGround, keyIntent };
export { FLIGHT, stepFlight, landing } from './flight.js';
export { SWIM, stepSwim, eyeLevel } from './swim.js';

const HIDE_NEAR = 1.5;   // m from the eyes: closer, a boarding camera would see the inside of the head
/** The board under the feet in the air: m, its long side along the flight (kiteboard.js). */
export const BOARD = KITEBOARD;

/**
 * @param {{ scene: any, rig: any, ground: (x: number, z: number) => any,
 *   canvas: HTMLElement, isEditing: (target: EventTarget | null) => boolean,
 *   character?: string, decks?: () => import('./deck.js').Deck[],
 *   pull?: { active: () => boolean, course: (dir: { x: number, z: number } | null) => void },
 *   water?: (x: number, z: number) => number }} options
 */
export async function createWalkerHost({ scene, rig, ground, canvas, isEditing, character = 'explorer', decks, pull, water }) {
  const { moveOnSheet, createGamifierAvatar } = await loadWalkerModules();
  const walker = createWalker({ moveOnSheet, ground, decks, water });
  const avatar = createGamifierAvatar();
  avatar.setCharacter(character);
  avatar.group.name = 'walker';
  avatar.group.visible = false;
  scene.add(avatar.group);
  const board = createKiteboard();
  scene.add(board);
  const input = bindWalkerInput(canvas, isEditing, () => mode === 'eyes');
  /** @type {'off' | 'boarding' | 'eyes' | 'standing'} */
  let mode = 'off';
  let stick = { x: 0, y: 0 };

  const host = {
    walker,
    avatar,
    board,
    get mode() { return mode; },
    get state() { return walker.state; },
    /** Feet on the ground at (x, z), facing yaw; keeps the mode. */
    place(x, z, yaw) {
      walker.place(x, z, yaw);
      if (mode === 'off') mode = 'standing';
    },
    /**
     * The camera into the walker's eyes: at once, or with `approach` (true or seconds) from
     * where the camera is now — mode 'boarding' until it arrives (CameraRig.ride).
     * @param {{ approach?: boolean | number }} [options]
     */
    enterEyes({ approach = false } = {}) {
      if (mode === 'off') throw new Error('walker: place() first');
      input.clear();
      rig.steer(0, 0);
      mode = 'boarding';
      rig.ride(() => walker.eyes(), {
        approach,
        onArrive: () => { input.clear(); if (mode === 'boarding') mode = 'eyes'; },
        onEnd: () => { input.clear(); if (mode === 'eyes' || mode === 'boarding') mode = 'standing'; },
      });
    },
    /** The camera stays where the eyes were and is free again; the figure stands. */
    leaveEyes() { rig.dismount(); },
    /** Out of the body and back; back in goes smoothly into the same eyes. */
    toggleEyes() {
      if (mode === 'eyes' || mode === 'boarding') host.leaveEyes();
      else if (mode !== 'off') host.enterEyes({ approach: true });
    },
    /**
     * The stick (stick.js), held until changed: x to the right, y forward, both -1..1. In the
     * eyes it walks the walker (full deflection runs), out of the body it steers the camera.
     * @param {{ x: number, y: number }} value
     */
    setStick(value) { stick = { x: value.x, y: value.y }; },
    /**
     * Once a frame before rig.update(): steps the walker by the held keys and the drag
     * (only in 'eyes'), then poses the figure. `intent` replaces the input (probes).
     * @param {number} dt seconds @param {number} now ms @param {any} [intent]
     */
    update(dt, now, intent) {
      const own = input.intent();
      if (!own.forward && !own.strafe && (stick.x || stick.y)) {
        const m = Math.hypot(stick.x, stick.y);
        Object.assign(own, { forward: stick.y, strafe: stick.x, run: m > 0.95 });
      }
      walker.ride(dt);
      const it = intent ?? own;
      const flying = !!walker.state.flight;
      const kite = !!pull?.active() && (!!walker.state.deck || flying);
      const course = mode === 'eyes' ? walker.direction(it) : null;
      if (kite) pull.course(course);
      if (flying) walker.fly(dt, course, mode === 'eyes' ? it : {});
      else if (mode === 'eyes') walker.step(dt, kite ? { ...it, forward: 0, strafe: 0 } : it);
      else walker.state.moving = false;
      rig.steer(mode === 'standing' ? stick.y : 0, mode === 'standing' ? stick.x : 0);
      const s = walker.state;
      board.visible = !!s.flight;
      if (s.flight) {
        const v = Math.hypot(s.flight.vx, s.flight.vz);
        board.position.set(s.x, s.y, s.z);   // the feet on the middle of the deck
        board.rotation.y = v > 0.5 ? Math.atan2(s.flight.vx, s.flight.vz) : s.yaw;
      }
      avatar.update({ pose: mode === 'off' ? null : { x: s.x, y: s.y, z: s.z }, unit: walker.bodyScale,
        bodyYaw: s.yaw, motion: s.moving ? 'WALKING' : 'GROUNDED', now });
      // boarding: shown until the camera is about to enter the head
      const e = walker.eyes().position, c = rig.camera.position;
      avatar.group.visible = mode === 'standing'
        || (mode === 'boarding' && Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z) > HIDE_NEAR);
    },
    dispose() {
      host.leaveEyes();
      rig.steer(0, 0);
      input.dispose();
      avatar.dispose();
      scene.remove(board);
      disposeKiteboard(board);
      mode = 'off';
    },
  };
  return host;
}
