import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';
import { CLOUD_GLSL } from './clouds.js';

// The sky as the scene background: a unit box at the far plane. Since E2b (SCENE-ENVIRONMENT-SPEC
// §3.3) it draws the sky per pixel — the sky-view LUT plus the cloud deck at the live offset — so
// the clouds move every frame while the cube (reflection, IBL) is re-baked only now and then. Plus
// the analytic sun disc, hidden by the clouds in front of it. Below the horizon it shows the
// horizon, as the cube lookup with max(d.y, 0) did before.
const BG_VERT = /* glsl */`
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // far plane
}`;

// three's ShaderMaterial prefix has no PI; ATMOSPHERE_GLSL defines its own
const BG_FRAG = ATMOSPHERE_GLSL + CLOUD_GLSL + /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloudCoverage;
uniform vec2 uCloudOffset;
in vec3 vDir;
out vec4 fragColor;
void main() {
  vec3 d = normalize(vDir);
  vec3 up = skyView(vec3(0.0, 1.0, 0.0), uSunDir);
  vec4 sky = skyWithClouds(normalize(vec3(d.x, max(d.y, 0.0), d.z)), uSunDir, up, uCloudCoverage, uCloudOffset);
  float c = dot(d, uSunDir);
  // 0.27 deg disc with limb darkening, plus a tight glow; hidden by clouds (alpha)
  float disc = smoothstep(0.999985, 0.999992, c) * (0.6 + 0.4 * smoothstep(0.999985, 1.0, c));
  vec3 col = sky.rgb + uSunColor * (disc * 900.0 + pow(max(c, 0.0), 2200.0) * 1.5) * step(0.0, d.y) * sky.a;
  fragColor = vec4(col, 1.0);
}`;

/**
 * @param {{ uSunDir: { value: THREE.Vector3 }, uSunColor: { value: THREE.Vector3 },
 *   uCloudCoverage: { value: number }, uCloudOffset: { value: THREE.Vector2 } } & Record<string, { value: unknown }>} uniforms
 *   the atmosphere's uniforms (its LUTs) and the live sky; held, not copied
 */
export function createSkyBackground(uniforms) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: BG_VERT, fragmentShader: BG_FRAG,
      uniforms, side: THREE.BackSide, depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  // drawn after the opaque scene at the far plane, so only visible sky pixels shade
  mesh.renderOrder = 1000;
  return mesh;
}
