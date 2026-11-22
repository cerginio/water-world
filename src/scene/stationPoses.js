// Camera poses of the rail stations (SCENE-UI-SPEC §4.2). Pure functions of the world:
// the island's height field, the story field's anchor and the camera's lens.
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

/** Half-angles of the view cone, radians: { v, h }. */
function halfAngles(fov, aspect) {
  const v = deg(fov / 2);
  return { v, h: Math.atan(Math.tan(v) * aspect) };
}

/** Farthest coastline radius over `bearings` directions (the shore is where height drops to 0). */
export function islandRadius(heightAt, bearings = 48) {
  let radius = 0;
  for (let i = 0; i < bearings; i++) {
    const a = (i / bearings) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    let r = 100;
    while (r < 1200 && heightAt(c * r, s * r) > 0) r += 4;
    radius = Math.max(radius, r);
  }
  return radius;
}

/**
 * Island: from high up, the whole coast and the story field in view. The sphere around
 * the island centre that holds both the coast and the field is fitted into the narrower
 * half of the view cone, 35° below the horizon, from the north-east as the Aerial shot.
 */
export function islandPose({ radius, field, fov, aspect }) {
  let r = radius;
  if (field) r = Math.max(r, Math.hypot(field.center.x, field.center.z) + Math.hypot(field.extent.x, field.extent.y) / 2);
  const { v, h } = halfAngles(fov, aspect);
  const d = (r * 1.05) / Math.sin(Math.min(v, h));
  const tilt = deg(35), bearing = deg(45);
  const target = new THREE.Vector3(0, 0, 0);
  const position = new THREE.Vector3(
    Math.cos(bearing) * Math.cos(tilt) * d, Math.sin(tilt) * d, Math.sin(bearing) * Math.cos(tilt) * d);
  return { position, target };
}

/**
 * Shore («just be»): a seated person's eyes, 1.6 m over the sand of the beach nearest
 * to the story field, looking at the field and the sea behind it. Walks inland from the
 * waterline along the field's bearing to the first ground 0.5 m high (beaches are 0.5–1.5 m).
 * @param {{ heightAt: (x: number, z: number) => number, coast: THREE.Vector2,
 *   out: THREE.Vector2, look: THREE.Vector3 }} options
 *   `coast` — the waterline point, `out` — unit direction out to sea, `look` — field centre.
 */
export function shorePose({ heightAt, coast, out, look }) {
  let x = coast.x, z = coast.y, h = heightAt(x, z);
  for (let step = 0; step < 200 && h < 0.5; step++) {
    x -= out.x;
    z -= out.y;
    h = heightAt(x, z);
  }
  const position = new THREE.Vector3(x, h + 1.6, z);
  const target = new THREE.Vector3(look.x, 0, look.z);
  return { position, target };
}

/**
 * Story: the whole field read as in Tilecraft — 35° off the vertical, from the field's
 * +z side, so source x reads right and y down. `margin` is the room around the field.
 */
export function storyPose({ center, extent, yawDeg, fov, aspect, margin = 1.3 }) {
  const yaw = deg(yawDeg), half = Math.tan(deg(fov / 2));
  const d = Math.max(extent.x / 2 / (half * aspect), extent.y / 2 / half) * margin;
  const tilt = deg(35);
  const position = new THREE.Vector3(
    center.x + Math.sin(yaw) * d * Math.sin(tilt), d * Math.cos(tilt), center.z + Math.cos(yaw) * d * Math.sin(tilt));
  return { position, target: center.clone() };
}
