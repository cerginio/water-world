import * as THREE from 'three';
import { FullscreenQuad, rawPass } from './fullscreen.js';
import { Atmosphere, ATMOSPHERE_GLSL } from './atmosphere.js';
import { CLOUD_GLSL } from './clouds.js';

// Hillaire 2020 atmosphere (atmosphere.js) + clouds (clouds.js) baked into a mipmapped HDR cube
// when the sky changes or the clouds have drifted (index.js schedules it). The cube is the water's
// reflection/fog source and the source of the terrain IBL; the background draws the same sky per
// pixel with live clouds (skyBackground.js, E2b). The sun disc is analytic (skyBackground.js + water
// specular), so it's left out of the cube; alpha holds the cloud transmittance (1 = clear) so the
// disc can hide behind clouds. The bake reads the clouds at `cloudOffset`.
//
// Units: the sky is lit by sun illuminance pi * sunIntensity at the top of the atmosphere, i.e. the
// cube is radiance in the same units as the sun colour (sun.js; the host feeds its DirectionalLight
// pi * color). No extra scale: against the old Preetham cube the +Y face averages ~0.55x at 52 deg
// sun, ~1.2x at 22 deg and ~3x at 3.5 deg (Preetham's sky dims too fast near the horizon).

// One cube face per draw: GL cube-map texel -> world direction (three's cube render targets are
// sampled with plain world directions).
const CUBE_FRAG = ATMOSPHERE_GLSL + CLOUD_GLSL + /* glsl */`
const vec3 WATER = vec3(0.02, 0.035, 0.045);  // deep-water body reflectance for the lower hemisphere
const vec3 GROUND = vec3(0.18, 0.17, 0.15);   // lowerHemisphere 'ground': a neutral, slightly warm soil
uniform int uFace;
uniform float uOutScale;                      // 1 for HDR; the LDR exposure (ldr.js) for 'ldr'
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloudCoverage;
uniform vec2 uCloudOffset;
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

void main() {
  vec3 d = normalize(faceDir(vUv));
  vec3 up = skyView(vec3(0.0, 1.0, 0.0), uSunDir);
  if (d.y < 0.0) {
#ifdef LOWER_GROUND
    // below the horizon: lit ground, the haze of the horizon over its last degrees
    vec3 soil = GROUND * (uSunColor * max(uSunDir.y, 0.0) + up);
    fragColor = vec4(mix(soil, skyView(vec3(d.x, 0.0, d.z), uSunDir), exp(d.y * 40.0)) * uOutScale, 1.0);
#else
    // below the horizon: sea, Fresnel between the mirrored sky and a dark water body
    float F = 0.02 + 0.98 * pow(1.0 + d.y, 5.0);
    vec3 body = WATER * (uSunColor * max(uSunDir.y, 0.0) + up);
    fragColor = vec4(mix(body, skyView(vec3(d.x, -d.y, d.z), uSunDir), F) * uOutScale, 1.0);
#endif
    return;
  }
  vec4 sky = skyWithClouds(d, uSunDir, up, uCloudCoverage, uCloudOffset);
  fragColor = vec4(sky.rgb * uOutScale, sky.a);
}`;


export class SkyBake {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} cubeSize
   * @param {THREE.Vector3} sunDir   held, not copied
   * @param {THREE.Vector3} sunColor held, not copied
   * @param {{ lowerHemisphere?: 'sea' | 'ground' }} [options]
   */
  constructor(renderer, cubeSize, sunDir, sunColor, { lowerHemisphere = 'sea' } = {}) {
    this.renderer = renderer;
    this.sunDir = sunDir;
    this.atmosphere = new Atmosphere();
    /** where the clouds were for the faces baked next (written in place by the caller) */
    this.cloudOffset = new THREE.Vector2();
    this.cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, {
      type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    const frag = lowerHemisphere === 'ground' ? `#define LOWER_GROUND\n${CUBE_FRAG}` : CUBE_FRAG;
    this.cubePass = new FullscreenQuad(rawPass(frag, {
      ...this.atmosphere.uniforms,
      uFace: { value: 0 }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor },
      uCloudCoverage: { value: 0 }, uCloudOffset: { value: this.cloudOffset }, uOutScale: { value: 1 },
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

  // six cube faces + mip chain into any cube target
  bakeCubeInto(cubeRT, cloudCoverage) {
    // three builds the mip chain after a render into the cube, so only after the last face
    for (let f = 0; f < 6; f++) this.bakeFaceInto(cubeRT, f, cloudCoverage, f === 5);
  }

  // one face (E2: one per frame while the sky moves); `mips` rebuilds the whole cube's mip chain
  bakeFaceInto(cubeRT, f, cloudCoverage, mips) {
    const r = this.renderer;
    const target = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const u = this.cubePass.material.uniforms;
    u.uCloudCoverage.value = cloudCoverage;
    u.uFace.value = f;
    cubeRT.texture.generateMipmaps = mips;
    r.setRenderTarget(cubeRT, f);
    r.render(this.cubePass.mesh, this.camera);
    r.setRenderTarget(target, face, mip);
  }

  dispose() {
    this.cubeRT.dispose();
    this.cubePass.material.dispose();
    this.atmosphere.dispose();
  }
}
