// The Tilecraft entry of the walker (BOUNDARY-3): the figure and the sheet motion are
// Tilecraft's own modules (STORY-QUEST-SPEC §4.1 «Персонаж»), imported, not copied.
// avatar.js builds its THREE.Group with this build's three (HANDOFF Q0). Nothing else in
// src/walker/ knows where they come from.

let runtime = null;

/** @returns {Promise<{ moveOnSheet: Function, createGamifierAvatar: () => any }>} */
export function loadWalkerModules() {
  runtime ??= Promise.all([
    import('@tilecraft/viewer/engines/three/core/gamifier/sheet-motion.js'),
    import('@tilecraft/viewer/engines/three/core/gamifier/avatar.js'),
  ]).then(([sheet, avatar]) => ({ moveOnSheet: sheet.moveOnSheet, createGamifierAvatar: avatar.createGamifierAvatar }));
  runtime.catch(() => (runtime = null));
  return runtime;
}
