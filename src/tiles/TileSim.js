import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { WATER_GLSL } from '../water/OceanSurface.js';

const WIDTH = 512;
const FRAG = /* glsl */`
precision highp float;
precision highp int;
${WATER_GLSL}
uniform highp sampler2D uRest0, uRest1, uState0, uState1, uState2, uState3;
uniform mat4 uFieldMatrix;
uniform int uTileCount;
uniform float uDt, uSampleDt, uDensity, uBuoyancy, uDrag, uAngularDrag, uOrbit, uAnchorPeriod;
uniform bool uReset;
layout(location = 0) out vec4 state0;
layout(location = 1) out vec4 state1;
layout(location = 2) out vec4 state2;
layout(location = 3) out vec4 state3;
// Classify exponent bits so non-finite texture values also recover on ANGLE/D3D.
bool bad(vec4 v) { return any(equal(floatBitsToUint(v) & uvec4(0x7f800000u), uvec4(0x7f800000u))); }
void rest() { state0 = vec4(0.0); state1 = vec4(0.0); state2 = vec4(0.0); state3 = vec4(0.0); }
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  if (uReset || uv.y * 512 + uv.x >= uTileCount) { rest(); return; }
  vec4 s0 = texelFetch(uState0, uv, 0), s1 = texelFetch(uState1, uv, 0);
  vec4 s2 = texelFetch(uState2, uv, 0), s3 = texelFetch(uState3, uv, 0);
  if (bad(s0) || bad(s1) || bad(s2) || bad(s3)) { rest(); return; }
  vec4 r = texelFetch(uRest0, uv, 0), r1 = texelFetch(uRest1, uv, 0);
  // The field is a rigid yaw transform. Dynamics and orbital offsets use FIELD axes.
  mat2 worldXZ = mat2(uFieldMatrix[0].xz, uFieldMatrix[2].xz);
  vec2 q = (uFieldMatrix * vec4(r.x + s0.z, 0.0, r.y + s0.w, 1.0)).xz;
  vec3 disp = waterAt(q, vec3(0.0));
  vec2 orbit = transpose(worldXZ) * disp.xz * uOrbit;
  vec3 waterVelocity = vec3(0.0);
  if (s3.w > 0.5) {
    waterVelocity = clamp((disp - vec3(s2.z, s3.x, s2.w)) / uSampleDt,
      vec3(-3.0, -0.8, -3.0), vec3(3.0, 0.8, 3.0));
  }
  // Four queries total, outside the substep loop: centre + triangular rim.
  // Zero-width stroke ends have no meaningful rotational inertia; use a 1 mm disc.
  float radius = max(r.w, 0.001), thickness = max(r1.y, 0.001);
  vec2 rim[4]; float heights[4];
  rim[0] = vec2(0.0); heights[0] = disp.y;
  for (int i = 1; i < 4; i++) {
    float a = r.z + float(i - 1) * 2.0943951024;
    rim[i] = 0.7 * radius * vec2(cos(a), sin(a));
    heights[i] = waterAt(q + worldXZ * rim[i], vec3(0.0)).y;
  }
  vec2 spring = s0.zw;
  if (s3.w > 0.5) spring -= transpose(worldXZ) * s2.zw * s3.y;
  vec2 velocity = s2.xy;
  float frequency = 6.283185307 / uAnchorPeriod;
  int steps = min(8, max(1, int(ceil(uDt * 240.0))));
  float dt = uDt / float(steps);
  for (int step = 0; step < 8; step++) {
    if (step >= steps) break;
    // Divide forces by mass analytically. V and m cancel; I/m = radius^2/4.
    float ay = -9.81; vec2 torquePerMass = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 lever = vec2(-rim[i].y, rim[i].x);
      float y = r1.x + s0.x + dot(lever, s1.xy);
      float pointVelocity = s0.y + dot(lever, s1.zw);
      float sub = clamp((heights[i] - y) / thickness + 0.5, 0.0, 1.0);
      float forcePerMass = 0.25 * sub * (1025.0 * 9.81 / uDensity * uBuoyancy
        - 1.5 * uDrag * (pointVelocity - waterVelocity.y));
      ay += forcePerMass;
      torquePerMass += lever * forcePerMass;
    }
    s0.y = clamp(s0.y + ay * dt, -10.0, 10.0);
    s0.x += s0.y * dt;
    s1.zw = (s1.zw + torquePerMass * (4.0 / (radius * radius)) * dt) * exp(-uAngularDrag * dt);
    s1.xy += s1.zw * dt;
    float tilt = length(s1.xy);
    if (tilt > 1.0471975512) {
      vec2 normal = s1.xy / tilt;
      s1.xy = normal * 1.0471975512;
      s1.zw -= normal * max(0.0, dot(s1.zw, normal));
    }
    velocity += (-frequency * frequency * spring - 2.0 * frequency * velocity) * dt;
    spring += velocity * dt;
  }
  state0 = vec4(s0.xy, orbit + spring);
  state1 = s1;
  state2 = vec4(velocity, disp.xz);
  // y remembers the orbital gain so changing orbit does not create spring energy.
  // w is per-tile history validity, also cleared by the NaN recovery path.
  state3 = vec4(disp.y, uOrbit, 0.0, 1.0);
  if (bad(state0) || bad(state1) || bad(state2) || bad(state3)) rest();
}`;

function restTexture(data, height) {
  const texture = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

// One MRT pass per frame; no CPU state readback or per-tile CPU work after load.
export class TileSim {
  constructor(renderer, surface, tiles) {
    this.renderer = renderer;
    this.height = Math.max(1, Math.ceil(tiles.count / WIDTH));
    const r0 = new Float32Array(WIDTH * this.height * 4), r1 = new Float32Array(r0.length);
    for (let i = 0; i < tiles.count; i++) {
      r0.set([tiles.x[i], tiles.z[i], tiles.yaw[i], tiles.radius[i]], i * 4);
      r1.set([tiles.y0[i], tiles.thickness[i], tiles.runId[i], tiles.flags[i]], i * 4);
    }
    this.rest0 = restTexture(r0, this.height);
    this.rest1 = restTexture(r1, this.height);
    this.targets = Array.from({ length: 2 }, () => new THREE.WebGLRenderTarget(WIDTH, this.height, {
      count: 4, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    }));
    this.current = 0;
    this.uniforms = {
      uRest0: { value: this.rest0 }, uRest1: { value: this.rest1 },
      ...Object.fromEntries(this.target.textures.map((texture, i) => [`uState${i}`, { value: texture }])),
    };
    this.quad = new FullscreenQuad(rawPass(FRAG, {
      ...surface.uniforms, ...this.uniforms,
      uFieldMatrix: { value: new THREE.Matrix4() }, uTileCount: { value: tiles.count },
      uDt: { value: 0 }, uSampleDt: { value: 1 / 60 }, uReset: { value: false },
      uDensity: { value: 500 }, uBuoyancy: { value: 1 }, uDrag: { value: 1.6 },
      uAngularDrag: { value: 0.8 }, uOrbit: { value: 1 }, uAnchorPeriod: { value: 4 },
    }));
    this.reset();
  }

  get target() { return this.targets[this.current]; }

  pass() {
    const previous = this.renderer.getRenderTarget();
    const next = 1 - this.current;
    try { this.quad.render(this.renderer, this.targets[next]); }
    finally { this.renderer.setRenderTarget(previous); }
    this.current = next;
    this.target.textures.forEach((texture, i) => { this.uniforms[`uState${i}`].value = texture; });
  }

  reset() {
    this.quad.material.uniforms.uReset.value = true;
    try { this.pass(); this.pass(); }
    finally { this.quad.material.uniforms.uReset.value = false; }
  }

  update(matrix, dt, params) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const u = this.quad.material.uniforms;
    u.uFieldMatrix.value.copy(matrix);
    // At most eight 1/240 s steps, even after a suspended tab or a long frame.
    u.uDt.value = Math.min(dt, 8 / 240);
    u.uSampleDt.value = Math.max(dt, 1e-4);
    for (const name of ['density', 'buoyancy', 'drag', 'angularDrag', 'orbit', 'anchorPeriod']) {
      u[`u${name[0].toUpperCase()}${name.slice(1)}`].value = params[name];
    }
    this.pass();
  }

  dispose() {
    this.rest0.dispose(); this.rest1.dispose(); this.targets.forEach((t) => t.dispose()); this.quad.material.dispose();
  }
}
