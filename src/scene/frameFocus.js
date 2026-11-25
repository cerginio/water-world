// Station «Мить» (SCENE-UI-SPEC §4.3): the story's frames in story order, a camera pose
// per frame and, in drift, the frame's live centre for the camera to follow.
//
// Drift moves tiles on the GPU only: `entry.world` stays where the frame was put. The
// live centre is the middle of the frame's GPU footprint (TileField.frameFootprint).
import * as THREE from 'three';
import { frameKey } from '../tiles/TileFrames.js';
import { fitPose, storyPose } from './stationPoses.js';

const REFRESH_MS = 250;   // how often the live centre of a drifting frame is re-read

/** Frame index after `step` from `focus` in a story of `count` frames, wrapping round. */
export function stepFrame(focus, count, step) {
  if (count <= 0) return -1;
  const from = focus ?? (step > 0 ? -1 : 0);
  return (((from + step) % count) + count) % count;
}

/** Rest centre of a frame's tile box in the world: bounds (rest-local) through the field matrix. */
export function frameRestCenter(entry, matrix) {
  const c = entry.bounds.getCenter(new THREE.Vector2());
  return new THREE.Vector3(c.x + entry.offset.x, 0, c.y + entry.offset.z).applyMatrix4(matrix);
}

/** The eight corners of a frame's tile box (water line and tile tops), moved by `shift`. */
export function frameCorners(entry, matrix, shift = new THREE.Vector3()) {
  const b = entry.bounds, top = entry.selectionHeight ?? 0, out = [];
  for (const x of [b.min.x, b.max.x]) for (const z of [b.min.y, b.max.y]) for (const y of [0, top]) {
    out.push(new THREE.Vector3(x + entry.offset.x, y, z + entry.offset.z).applyMatrix4(matrix).add(shift));
  }
  return out;
}

/** The eight corners of a world box. @param {THREE.Box3} box */
export function boxCorners(box) {
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/**
 * @param {{ tiles: any, camera: THREE.PerspectiveCamera,
 *   locate?: (entry: any) => THREE.Box3 | null }} options
 * `locate` — where the frame is drawn now when that is not the field (story-quest: a
 * miniature on the shore or in the hands; the field's frame is hidden then and still lies
 * where the story put it — the camera flew there), as a world box; null — the field's frame.
 */
export function createFrameFocus({ tiles, camera, locate = () => null }) {
  const live = { entry: null, center: null, at: -Infinity, pending: false };

  /**
   * Frames on the water in story order (`tiles.frames`); a story without frame ids is one
   * frame; the `frame` filter (`?tilesFrame=`) leaves one.
   */
  function list() {
    if (!tiles.loaded) return [];
    const registry = tiles.frameRegistry, only = tiles.params.frame;
    const ordered = tiles.frames.map((id) => registry.byId.get(frameKey(id))).filter(Boolean);
    const all = ordered.length ? ordered : registry.entries.slice();
    return only === 'all' ? all : all.filter((e) => e.id === only);
  }

  const drifting = () => tiles.params.mode === 'drift';
  const located = (entry) => { const b = locate(entry); return b && !b.isEmpty() ? b : null; };

  async function measure(entry) {
    const box = await tiles.frameFootprint(entry).catch((error) => { console.error('[frame focus]', error); return null; });
    return box ? new THREE.Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2) : null;
  }

  /**
   * Camera pose that holds frame `i` at ~75 % of the screen: the story view direction
   * (35°, `fieldYaw`), the distance fitted to the frame's corners (margin 1.3).
   */
  async function pose(i) {
    const entry = list()[i];
    if (!entry) return null;
    const view = { fov: camera.fov, aspect: camera.aspect };
    const box = located(entry);
    if (box) {
      // a miniature: the story view direction onto what is drawn, lifted to where it lies
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const start = storyPose({ center: new THREE.Vector3(c.x, 0, c.z), extent: new THREE.Vector2(size.x, size.z),
        yawDeg: tiles.params.fieldYaw, ...view });
      start.position.y += c.y; start.target.y = c.y;
      return fitPose(start, boxCorners(box), view);
    }
    tiles.group.updateWorldMatrix(true, false);
    const matrix = tiles.group.matrixWorld, rest = frameRestCenter(entry, matrix);
    const center = (drifting() && await measure(entry)) || rest;
    if (drifting()) Object.assign(live, { entry, center: center.clone(), at: performance.now() });
    const start = storyPose({ center, extent: entry.bounds.getSize(new THREE.Vector2()), yawDeg: tiles.params.fieldYaw, ...view });
    return fitPose(start, frameCorners(entry, matrix, center.clone().sub(rest)), view);
  }

  /**
   * Where frame `i` is now, for the camera to follow; null outside drift. Synchronous:
   * returns the last read and starts a new one when it is older than 250 ms.
   */
  function aim(i) {
    const entry = list()[i];
    if (!entry) return null;
    // a miniature carried along, or a placed frame (a raft, a fate) moved on the CPU: no GPU read
    const box = located(entry);
    if (box) return box.getCenter(new THREE.Vector3());
    if (!drifting()) {
      if (entry.mode !== 'placed') return null;
      tiles.group.updateWorldMatrix(true, false);
      return frameRestCenter(entry, tiles.group.matrixWorld);
    }
    if (live.entry !== entry) Object.assign(live, { entry, center: null, at: -Infinity });
    if (!live.pending && performance.now() - live.at >= REFRESH_MS) {
      live.pending = true;
      measure(entry).then((center) => {
        if (live.entry === entry && center) Object.assign(live, { center, at: performance.now() });
      }).finally(() => { live.pending = false; });
    }
    return live.center;
  }

  return { count: () => list().length, entry: (i) => list()[i] ?? null, pose, aim };
}
