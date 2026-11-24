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
#ifdef ENV_LDR
uniform float uExposure;
// three's AgXToneMapping (tonemapping_pars_fragment), which a NoToneMapping host never gets
const mat3 SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AGX_INSET = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
  vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AGX_OUTSET = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
  vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
vec3 agx(vec3 color) {
  color = AGX_INSET * (SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.499999, 0.0, 1.0);
  vec3 x2 = color * color, x4 = x2 * x2;
  color = 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
  color = pow(max(vec3(0.0), AGX_OUTSET * color), vec3(2.2));
  return clamp(REC2020_TO_SRGB * color, 0.0, 1.0);
}
#endif
void main() {
  vec3 d = normalize(vDir);
  vec3 up = skyView(vec3(0.0, 1.0, 0.0), uSunDir);
#ifdef BG_GRADIENT
  // the restrained background (spec §5.4, §8 п.1): zenith to horizon, the horizon averaged round
  // the compass, greyed by the cloud cover; no deck, no disc
  vec3 hor = 0.25 * (skyView(normalize(vec3(1.0, 0.03, 0.0)), uSunDir) + skyView(normalize(vec3(-1.0, 0.03, 0.0)), uSunDir)
    + skyView(normalize(vec3(0.0, 0.03, 1.0)), uSunDir) + skyView(normalize(vec3(0.0, 0.03, -1.0)), uSunDir));
  vec3 col = mix(hor, up, sqrt(max(d.y, 0.0)));
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), 0.8 * uCloudCoverage);
#else
  vec4 sky = skyWithClouds(normalize(vec3(d.x, max(d.y, 0.0), d.z)), uSunDir, up, uCloudCoverage, uCloudOffset);
  float c = dot(d, uSunDir);
  // 0.27 deg disc with limb darkening, plus a tight glow; hidden by clouds (alpha)
  float disc = smoothstep(0.999985, 0.999992, c) * (0.6 + 0.4 * smoothstep(0.999985, 1.0, c));
  vec3 col = sky.rgb + uSunColor * (disc * 900.0 + pow(max(c, 0.0), 2200.0) * 1.5) * step(0.0, d.y) * sky.a;
#endif
#ifdef ENV_LDR
  // an LDR host keeps NoToneMapping (its MeshBasic frames must not change): the sky does its own
  // exposure and AgX curve and writes the canvas's colour space
  fragColor = linearToOutputTexel(vec4(agx(col * uExposure), 1.0));
#else
  fragColor = vec4(col, 1.0);
#endif
}`;

/**
 * @param {{ uSunDir: { value: THREE.Vector3 }, uSunColor: { value: THREE.Vector3 },
 *   uCloudCoverage: { value: number }, uCloudOffset: { value: THREE.Vector2 } } & Record<string, { value: unknown }>} uniforms
 *   the atmosphere's uniforms (its LUTs) and the live sky (+ uExposure for ldr); held, not copied
 * @param {{ ldr?: boolean, gradient?: boolean }} [options] ldr — exposure + AgX + output colour space
 *   inside the background (spec §5.4); gradient — the restrained sky without clouds or disc
 */
export function createSkyBackground(uniforms, { ldr = false, gradient = false } = {}) {
  /** @type {Record<string, string>} */
  const defines = {};
  if (ldr) defines.ENV_LDR = '';
  if (gradient) defines.BG_GRADIENT = '';
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: BG_VERT, fragmentShader: BG_FRAG,
      uniforms, defines, side: THREE.BackSide, depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  // drawn after the opaque scene at the far plane, so only visible sky pixels shade
  mesh.renderOrder = 1000;
  return mesh;
}
