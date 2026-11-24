// The walker on the island (STORY-QUEST-SPEC §2 п.2, §4.1 «Персонаж»; story-quest Q2a):
// Tilecraft's figure, walking by walkOnGround, the camera through its eyes via the
// camera owner (CameraRig.ride — OWNER-3: nothing here writes the camera).
//
// Modes: 'off' — not placed; 'eyes' — the person walks, the camera is the eyes, the
// figure is hidden (the camera would sit inside its head); 'standing' — the figure stands
// where it was left and the camera is free (out of the body proper, with its own keys and
// stick, is Q2b).
import { createWalker, PACE } from './walker.js';
import { WALK, isWater, walkOnGround } from './groundWalk.js';
import { bindWalkerInput, keyIntent } from './keyboard.js';
import { loadWalkerModules } from './tilecraftWalker.js';

export { WALK, PACE, isWater, walkOnGround, keyIntent };

/**
 * @param {{ scene: any, rig: any, ground: (x: number, z: number) => any,
 *   canvas: HTMLElement, isEditing: (target: EventTarget | null) => boolean,
 *   character?: string }} options
 */
export async function createWalkerHost({ scene, rig, ground, canvas, isEditing, character = 'explorer' }) {
  const { moveOnSheet, createGamifierAvatar } = await loadWalkerModules();
  const walker = createWalker({ moveOnSheet, ground });
  const avatar = createGamifierAvatar();
  avatar.setCharacter(character);
  avatar.group.name = 'walker';
  avatar.group.visible = false;
  scene.add(avatar.group);
  const input = bindWalkerInput(canvas, isEditing, () => mode === 'eyes');
  /** @type {'off' | 'eyes' | 'standing'} */
  let mode = 'off';

  const host = {
    walker,
    avatar,
    get mode() { return mode; },
    get state() { return walker.state; },
    /** Feet on the ground at (x, z), facing yaw; keeps the mode. */
    place(x, z, yaw) {
      walker.place(x, z, yaw);
      if (mode === 'off') mode = 'standing';
    },
    /** The camera into the walker's eyes at once (the smooth descent is Q2b). */
    enterEyes() {
      if (mode === 'off') throw new Error('walker: place() first');
      input.clear();
      rig.ride(() => walker.eyes(), { onEnd: () => { input.clear(); if (mode === 'eyes') mode = 'standing'; } });
      mode = 'eyes';
    },
    /** The camera stays where the eyes were and is free again; the figure stands. */
    leaveEyes() { rig.dismount(); },
    toggleEyes() { if (mode === 'eyes') host.leaveEyes(); else if (mode !== 'off') host.enterEyes(); },
    /**
     * Once a frame before rig.update(): steps the walker by the held keys and the drag
     * (only in 'eyes'), then poses the figure. `intent` replaces the input (probes).
     * @param {number} dt seconds @param {number} now ms @param {any} [intent]
     */
    update(dt, now, intent) {
      const own = input.intent();
      if (mode === 'eyes') walker.step(dt, intent ?? own);
      else walker.state.moving = false;
      const s = walker.state;
      avatar.update({ pose: mode === 'off' ? null : { x: s.x, y: s.y, z: s.z }, unit: walker.bodyScale,
        bodyYaw: s.yaw, motion: s.moving ? 'WALKING' : 'GROUNDED', now });
      avatar.group.visible = mode === 'standing';
    },
    dispose() {
      host.leaveEyes();
      input.dispose();
      avatar.dispose();
      mode = 'off';
    },
  };
  return host;
}
