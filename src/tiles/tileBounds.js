import * as THREE from 'three';

// Render-only safety envelope. The soft drift wall and sinking integrator are
// unbounded in time; pretending their rest bounds were conservative is incorrect.
// Keep simulation untouched, but contain pathological excursions in ALL passes.
export const TILE_VERTICAL_LIMIT = 256;
export function tileMotionLimit(driftRadius, hasDrift = true) {
  return hasDrift ? Math.max(0, driftRadius) + 64 : 8;
}

export function tileBounds(restSphere, motionLimit, maxOffset, surfaceOffset) {
  const sphere = restSphere.clone();
  // Any rotation moves a rest vertex by at most twice its owner-relative radius.
  sphere.radius += Math.hypot(motionLimit, TILE_VERTICAL_LIMIT) + 2 * maxOffset + surfaceOffset;
  return sphere;
}

export function applyTileBounds(mesh, sphere) {
  // InstancedMesh owns its bounds; ordinary Mesh uses geometry bounds.
  if (mesh.isInstancedMesh) mesh.boundingSphere = sphere;
  else mesh.geometry.boundingSphere = sphere;
  mesh.frustumCulled = true;
}

// The float-shadow camera is fitted around its casters every frame, at 1024² texels.
// Fitting it to the culling envelope (driftRadius + 64 m) made 1 m texels: blocky bed
// shadows and every tile shadowing its own top (T5 owner QA). Fit the field at rest
// plus this margin; tiles drifted further out simply cast no float shadow.
export const TILE_SHADOW_MARGIN = 16;
export function fieldShadowBody(entries, body) {
  const sphere = new THREE.Sphere();
  sphere.makeEmpty();
  for (const { mesh, restSphere, maxOffset, surfaceOffset } of entries) {
    mesh.updateWorldMatrix(true, false);
    const s = restSphere.clone().applyMatrix4(mesh.matrixWorld);
    s.radius += 2 * maxOffset + surfaceOffset;
    sphere.union(s);
  }
  body.pos.copy(sphere.center);
  body.radius = Math.max(1, sphere.radius + TILE_SHADOW_MARGIN);
  return body;
}
