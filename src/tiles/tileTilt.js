import * as THREE from 'three';

// Rotation vector about a horizontal axis, shared by simulation and every render pass.
export const TILE_TILT_GLSL = /* glsl */`
mat3 tileTilt(vec2 a) {
  float angle = length(a);
  if (angle < 1e-8) return mat3(1.0);
  vec3 k = vec3(a.x, 0.0, a.y) / angle;
  float c = cos(angle), s = sin(angle), v = 1.0 - c;
  return mat3(c + k.x*k.x*v, k.z*s, k.x*k.z*v,
    -k.z*s, c, k.x*s,
    k.x*k.z*v, -k.x*s, c + k.z*k.z*v);
}
vec2 normalTilt(vec3 n, float limit) {
  vec2 axis = vec2(n.z, -n.x);
  float l = length(axis);
  return l < 1e-8 ? vec2(0.0) : axis / l * min(atan(l, n.y), limit);
}
`;

export function tileTiltMatrix(x, z) {
  const angle = Math.hypot(x, z);
  return angle < 1e-8 ? new THREE.Matrix4() : new THREE.Matrix4()
    .makeRotationAxis(new THREE.Vector3(x / angle, 0, z / angle), angle);
}
