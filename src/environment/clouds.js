// The cloud deck (SCENE-ENVIRONMENT-SPEC §3.3, E2b), shared by the sky background (every visible
// sky pixel, every frame) and the cube bake (water reflection, fog, IBL): the same function and the
// same offset, so the reflection is the sky as it was when its faces were last baked.
//
// The deck drifts with the cloud wind: the offset is integrated from cloudSpeed × CLOUD_WIND, not
// time × speed, so a change of speed never jumps the clouds. Units: the deck plane p = d.xz / d.y
// × 0.396 (three's Sky.js scale), 1 unit ≈ 6 km at the 2.5 km deck.

export const CLOUD_H = 2.5;   // cloud deck altitude for lighting / aerial perspective (km)

/** deck units per second at cloudSpeed 1: ≈ 0.43°/s overhead, ~19 m/s at the deck */
export const CLOUD_WIND = 0.003;
/** where the deck drifts, a unit vector in the world xz plane */
export const CLOUD_WIND_DIR = Object.freeze([0.8, 0.6]);

// Needs ATMOSPHERE_GLSL before it (skyView, transmittance, sunVisible, RB, OBS_H, uSunIllum).
export const CLOUD_GLSL = /* glsl */`
const float CLOUD_H = ${CLOUD_H.toFixed(2)};

// cloud layer ported from three's Sky.js (its cloudScale/elevation/density), moved by an offset
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

// the sky along d (d.y >= 0) with the deck over it; a = the clear fraction (1 = no cloud), which
// hides the analytic sun disc. up = skyView(+Y), the deck's ambient light.
vec4 skyWithClouds(vec3 d, vec3 sunDir, vec3 up, float coverage, vec2 offset) {
  vec3 col = skyView(d, sunDir);
  if (d.y <= 1e-3 || coverage <= 0.0) return vec4(col, 1.0);
  vec2 p = d.xz / d.y * 0.396 + offset;   // cloudScale 2e-4 * 1000 / mix(1, 0.1, cloudElevation 0.55)
  float n = clamp(fbm(p) * 0.7 + 0.5, 0.0, 1.0);
  float th = 1.0 - clamp(coverage + noise(p * 0.3) * 0.222, 0.0, 1.0);  // clear gaps / dense banks
  float fade = smoothstep(0.0, 0.063, d.y);
  float mask = smoothstep(th, th + 0.3, n) * fade;
  float depth = max(0.0, n - th);
  float beer = exp(-4.0 * depth);
  float shade = mix(0.45, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));  // beer-powder
  float c = dot(d, sunDir);
  float silver = clamp(0.51 / pow(1.49 - c * 1.4, 1.5), 0.0, 3.0);  // HG g = 0.7 rim toward the sun
  float edge = mask * (1.0 - mask) * 4.0;
  float alpha = (1.0 - exp(-depth * 6.6)) * fade;                    // cloudDensity 0.55

  // the deck point along d: sunlight through the atmosphere (and planet shadow) to it, and the
  // eye-to-deck transmittance so distant clouds dissolve into the haze
  float r0 = RB + OBS_H, rc = RB + CLOUD_H;
  float t = -r0 * d.y + sqrt(r0 * r0 * d.y * d.y + (rc - r0) * (rc + r0));
  float muV = (r0 * d.y + t) / rc;
  float muS = clamp((r0 * sunDir.y + t * c) / rc, -1.0, 1.0);
  vec3 sun = uSunIllum * transmittance(CLOUD_H, muS) * sunVisible(CLOUD_H, rc, muS) * 0.22;  // albedo/pi
  vec3 cloud = up + sun * (shade + silver * edge * 0.6);
  vec3 tv = clamp(transmittance(OBS_H, d.y) / max(transmittance(CLOUD_H, muV), vec3(1e-4)), 0.0, 1.0);
  return vec4(mix(col, mix(col, cloud, tv), alpha), 1.0 - alpha);
}
`;
