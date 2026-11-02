import * as THREE from 'three';

// Render-only safety envelope. The soft drift wall and sinking integrator are
// unbounded in time; pretending their rest bounds were conservative is incorrect.
// Keep simulation untouched, but contain pathological excursions in ALL passes.
export const TILE_VERTICAL_LIMIT = 64;
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

export function fieldShadowBody(group, meshes, body) {
  const sphere = new THREE.Sphere();
  sphere.makeEmpty();
  group.updateWorldMatrix(true, true);
  for (const mesh of meshes) {
    const local = mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry.boundingSphere;
    sphere.union(local.clone().applyMatrix4(mesh.matrixWorld));
  }
  body.pos.copy(sphere.center);
  body.radius = Math.max(1, sphere.radius);
  return body;
}
