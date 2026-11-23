import * as THREE from 'three';

// The sky as the scene background: a unit box at the far plane that samples the baked cube and
// adds the analytic sun disc (left out of the cube; the cube's alpha hides it behind clouds).
const BG_VERT = /* glsl */`
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // far plane
}`;

const BG_FRAG = /* glsl */`
uniform samplerCube uCube;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
in vec3 vDir;
out vec4 fragColor;
void main() {
  vec3 d = normalize(vDir);
  vec4 sky = textureLod(uCube, vec3(d.x, max(d.y, 0.0), d.z), 0.0);
  float c = dot(d, uSunDir);
  // 0.27 deg disc with limb darkening, plus a tight glow; hidden by clouds (cube alpha)
  float disc = smoothstep(0.999985, 0.999992, c) * (0.6 + 0.4 * smoothstep(0.999985, 1.0, c));
  vec3 col = sky.rgb + uSunColor * (disc * 900.0 + pow(max(c, 0.0), 2200.0) * 1.5) * step(0.0, d.y) * sky.a;
  fragColor = vec4(col, 1.0);
}`;

/**
 * @param {THREE.Texture} cube
 * @param {THREE.Vector3} sunDir   held, not copied
 * @param {THREE.Vector3} sunColor held, not copied
 */
export function createSkyBackground(cube, sunDir, sunColor) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: BG_VERT, fragmentShader: BG_FRAG,
      uniforms: { uCube: { value: cube }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor } },
      side: THREE.BackSide, depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  // drawn after the opaque scene at the far plane, so only visible sky pixels shade
  mesh.renderOrder = 1000;
  return mesh;
}
