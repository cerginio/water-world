import * as THREE from 'three';
import { FullscreenQuad, rawPass } from './fullscreen.js';
import { Atmosphere, ATMOSPHERE_GLSL } from './atmosphere.js';

// Hillaire 2020 atmosphere (atmosphere.js) + clouds baked into a mipmapped HDR cube whenever the
// sun or sky params change; nothing runs per frame. The cube is the background, the water's
// reflection/fog source and the terrain IBL. The sun disc is analytic (skyBackground.js + water
// specular), so it's left out of the cube; alpha holds the cloud transmittance (1 = clear) so the
// disc can hide behind clouds.
//
// Units: the sky is lit by sun illuminance pi * sunIntensity at the top of the atmosphere, i.e. the
// cube is radiance in the same units as the sun colour (sun.js; the host feeds its DirectionalLight
// pi * color). No extra scale: against the old Preetham cube the +Y face averages ~0.55x at 52 deg
// sun, ~1.2x at 22 deg and ~3x at 3.5 deg (Preetham's sky dims too fast near the horizon).
const CLOUD_H = 2.5;   // cloud deck altitude for lighting / aerial perspective (km)

// One cube face per draw: GL cube-map texel -> world direction (three's cube render targets are
// sampled with plain world directions).
const CUBE_FRAG = ATMOSPHERE_GLSL + /* glsl */`
const float CLOUD_H = ${CLOUD_H.toFixed(2)};
const vec3 WATER = vec3(0.02, 0.035, 0.045);  // deep-water body reflectance for the lower hemisphere
uniform int uFace;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloudCoverage;
in vec2 vUv;
out vec4 fragColor;

vec3 faceDir(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  if (uFace == 0) return vec3(1.0, -c.y, -c.x);
  if (uFace == 1) return vec3(-1.0, -c.y, c.x);
  if (uFace == 2) return vec3(c.x, 1.0, c.y);
  if (uFace == 3) return vec3(c.x, -1.0, -c.y);
  if (uFace == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}

// cloud layer ported from three's Sky.js (static: time = 0, its cloudScale/elevation/density)
vec2 gradient(vec2 i) {
  vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradient(i), f);
  float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
float fbm(vec2 p) {
  float s = 0.0, a = 1.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); a *= 0.5; p *= 2.0; }
  return s;
}

void main() {
  vec3 d = normalize(faceDir(vUv));
  vec3 up = skyView(vec3(0.0, 1.0, 0.0), uSunDir);
  if (d.y < 0.0) {
    // below the horizon: sea, Fresnel between the mirrored sky and a dark water body
    float F = 0.02 + 0.98 * pow(1.0 + d.y, 5.0);
    vec3 body = WATER * (uSunColor * max(uSunDir.y, 0.0) + up);
    fragColor = vec4(mix(body, skyView(vec3(d.x, -d.y, d.z), uSunDir), F), 1.0);
    return;
  }
  vec3 col = skyView(d, uSunDir);
  float vis = 1.0;
  if (d.y > 1e-3 && uCloudCoverage > 0.0) {
    vec2 p = d.xz / d.y * 0.396;   // cloudScale 2e-4 * 1000 / mix(1, 0.1, cloudElevation 0.55)
    float n = clamp(fbm(p) * 0.7 + 0.5, 0.0, 1.0);
    float th = 1.0 - clamp(uCloudCoverage + noise(p * 0.3) * 0.222, 0.0, 1.0);  // clear gaps / dense banks
    float fade = smoothstep(0.0, 0.063, d.y);
    float mask = smoothstep(th, th + 0.3, n) * fade;
    float depth = max(0.0, n - th);
    float beer = exp(-4.0 * depth);
    float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));  // beer-powder
    float c = dot(d, uSunDir);
    float silver = clamp(0.51 / pow(1.49 - c * 1.4, 1.5), 0.0, 3.0);  // HG g = 0.7 rim toward the sun
    float edge = mask * (1.0 - mask) * 4.0;
    float alpha = (1.0 - exp(-depth * 6.6)) * fade;                    // cloudDensity 0.55

    // the deck point along d: sunlight through the atmosphere (and planet shadow) to it, and the
    // eye-to-deck transmittance so distant clouds dissolve into the haze
    float r0 = RB + OBS_H, rc = RB + CLOUD_H;
    float t = -r0 * d.y + sqrt(r0 * r0 * d.y * d.y + (rc - r0) * (rc + r0));
    float muV = (r0 * d.y + t) / rc;
    float muS = clamp((r0 * uSunDir.y + t * c) / rc, -1.0, 1.0);
    vec3 sun = uSunIllum * transmittance(CLOUD_H, muS) * sunVisible(CLOUD_H, rc, muS) * 0.22;  // albedo/pi
    vec3 cloud = up + sun * (shade + silver * edge * 0.6);
    vec3 tv = clamp(transmittance(OBS_H, d.y) / max(transmittance(CLOUD_H, muV), vec3(1e-4)), 0.0, 1.0);
    col = mix(col, mix(col, cloud, tv), alpha);
    vis = 1.0 - alpha;
  }
  fragColor = vec4(col, vis);
}`;


export class SkyBake {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} cubeSize
   * @param {THREE.Vector3} sunDir   held, not copied
   * @param {THREE.Vector3} sunColor held, not copied
   */
  constructor(renderer, cubeSize, sunDir, sunColor) {
    this.renderer = renderer;
    this.sunDir = sunDir;
    this.atmosphere = new Atmosphere();
    this.cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
      type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.cubePass = new FullscreenQuad(rawPass(CUBE_FRAG, {
      ...this.atmosphere.uniforms,
      uFace: { value: 0 }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor },
      uCloudCoverage: { value: 0 },
    }));
    this.camera = new THREE.Camera();   // unused by the fullscreen vertex shader
  }

  // the three atmosphere LUTs, for coefficients c (sun.js) and the sun's illuminance
  bakeLuts(c, sunIntensity) {
    const r = this.renderer;
    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    this.atmosphere.update(r, c, this.sunDir.y, Math.PI * sunIntensity);
    r.setRenderTarget(target, face, mip);
  }

  // six cube faces + mip chain into any cube target; PMREM is rebuilt lazily by three on the
  // next render that uses the cube
  bakeCubeInto(cubeRT, cloudCoverage) {
    const r = this.renderer;
    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const u = this.cubePass.material.uniforms;
    u.uCloudCoverage.value = cloudCoverage;
    // three builds the mip chain after a render into the cube, so only after the last face
    for (let f = 0; f < 6; f++) {
      u.uFace.value = f;
      cubeRT.texture.generateMipmaps = f === 5;
      r.setRenderTarget(cubeRT, f);
      r.render(this.cubePass.mesh, this.camera);
    }
    r.setRenderTarget(target, face, mip);
    cubeRT.texture.needsPMREMUpdate = true;
  }

  dispose() {
    this.cubeRT.dispose();
    this.cubePass.material.dispose();
    this.atmosphere.dispose();
  }
}
