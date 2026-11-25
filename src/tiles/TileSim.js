import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { TERRAIN_CONTACT_GLSL } from '../scene/TerrainContact.js';
import { TILE_TILT_GLSL } from './tileTilt.js';
import { TILE_CONTACT_GLSL } from './tileContact.js';
import { WATER_GLSL } from '../water/OceanSurface.js';

const WIDTH = 512;
// Shared by polygon tiles and run centroids. Positions/velocities use field axes.
const HORIZONTAL = /* glsl */`
uniform bool uDrift;
#ifdef TILE_FRAME_TEXTURE
uniform highp sampler2D uFrames;
vec4 framePose(int id) { return texelFetch(uFrames, ivec2(0, id), 0); }
vec2 framePivot(int id) { return texelFetch(uFrames, ivec2(1, id), 0).xy; }
#else
uniform vec4 uFramePose[TILE_FRAME_COUNT];
uniform vec2 uFramePivot[TILE_FRAME_COUNT];
vec4 framePose(int id) { return uFramePose[id]; }
vec2 framePivot(int id) { return uFramePivot[id]; }
#endif
bool frameDrift(vec4 pose) { return uDrift && pose.z < 0.5; }
uniform float uWindage, uDriftRadius;
uniform vec2 uWindVelocity;
vec2 horizontalAcceleration(vec2 p, vec2 v, vec2 rest, vec2 waterVelocity, bool drift) {
  float frequency = 6.283185307 / uAnchorPeriod;
  if (!drift) return -frequency * frequency * p - 2.0 * frequency * v;
  mat2 worldXZ = mat2(uFieldMatrix[0].xz, uFieldMatrix[2].xz);
  vec2 a = uDrag * (waterVelocity + transpose(worldXZ) * uWindVelocity * uWindage - v);
  vec2 fromCenter = rest + p;
  float distance = length(fromCenter);
  if (distance > uDriftRadius) {
    vec2 n = fromCenter / distance;
    a -= n * (4.0 * (distance - uDriftRadius) + 4.0 * max(0.0, dot(v, n)));
  }
  return a;
}
// Exponent-bit classification also catches poisoned textures on ANGLE/D3D.
bool bad(vec4 v) { return any(equal(floatBitsToUint(v) & uvec4(0x7f800000u), uvec4(0x7f800000u))); }
`;
export const TILE_PROFILES = Object.freeze({
  desktop: Object.freeze({ maxSteps: 8, waterSamples: 4, fieldShadow: true }),
  mobile: Object.freeze({ maxSteps: 2, waterSamples: 2, fieldShadow: false }),
});
const FRAG = /* glsl */`
precision highp float;
precision highp int;
${WATER_GLSL}
uniform highp sampler2D uRest0, uRest1, uState0, uState1, uState2, uState3;
uniform mat4 uFieldMatrix;
uniform int uTileCount;
uniform float uDt, uSampleDt, uDensity, uBuoyancy, uDrag, uAngularDrag, uOrbit, uAnchorPeriod;
uniform bool uReset;
uniform highp sampler2D uRun;
${HORIZONTAL}
${TILE_TILT_GLSL}
#ifdef TILE_TERRAIN_CONTACT
${TERRAIN_CONTACT_GLSL}
${TILE_CONTACT_GLSL}
#endif
layout(location = 0) out vec4 state0;
layout(location = 1) out vec4 state1;
layout(location = 2) out vec4 state2;
layout(location = 3) out vec4 state3;
void rest() { state0 = vec4(0.0); state1 = vec4(0.0); state2 = vec4(0.0); state3 = vec4(0.0); }
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  if (uReset || uv.y * 512 + uv.x >= uTileCount) { rest(); return; }
  vec4 s0 = texelFetch(uState0, uv, 0), s1 = texelFetch(uState1, uv, 0);
  vec4 s2 = texelFetch(uState2, uv, 0), s3 = texelFetch(uState3, uv, 0);
  if (bad(s0) || bad(s1) || bad(s2) || bad(s3)) { rest(); return; }
  vec4 r = texelFetch(uRest0, uv, 0), r1 = texelFetch(uRest1, uv, 0);
  int frameId = int(r1.w) >> 2;
  vec4 pose = framePose(frameId);
  bool drift = frameDrift(pose);
  // The field is a rigid yaw transform. Dynamics and orbital offsets use FIELD axes.
  mat2 worldXZ = mat2(uFieldMatrix[0].xz, uFieldMatrix[2].xz);
  bool polyline = (int(r1.w) & 1) != 0;
  // Sample the water at the tile's anchor, without last frame's orbit: the water's
  // displacement is a function of the rest point. Fed back, the orbit makes x = x0 + D(x)
  // a fixed-point iteration, which where a wave breaks (dD/dx < -1) swings between two
  // positions every frame — a frame in the surf drawn twice (story-quest Q4, INVARIANTS).
  vec2 anchor = s0.zw;
  if (abs(s3.w) > 0.01 && (polyline || s3.z < 0.5)) anchor -= transpose(worldXZ) * s2.zw * s3.y;
  vec2 q = (uFieldMatrix * vec4(r.x + anchor.x + pose.x, 0.0, r.y + anchor.y + pose.y, 1.0)).xz;
  vec3 disp = waterAt(q, vec3(0.0));
  // state1.xy: horizontal rotation vector; z: support blend; w: 2/5 cm latch.
  float contact = s1.z;
  float orbitGain = uOrbit * (1.0-contact);
  vec2 orbit = transpose(worldXZ) * disp.xz * orbitGain;
  vec3 waterVelocity = vec3(0.0);
  if (abs(s3.w) > 0.01) {
    waterVelocity = clamp((disp - vec3(s2.z, s3.x, s2.w)) / uSampleDt,
      vec3(-3.0, -0.8, -3.0), vec3(3.0, 0.8, 3.0));
  }
  // Both tile types follow the surface without ballistic launches. A finite
  // sampling footprint also prevents noisy slopes on tiny tiles/tapered ends.
  float radius = max(r.w, 0.15), thickness = max(r1.y, 0.001);
  vec2 rim[4]; float heights[4];
  rim[0] = vec2(0.0); heights[0] = disp.y;
  for (int i = 1; i < TILE_WATER_SAMPLES; i++) {
    float a = r.z + float(i - 1) * 2.0943951024;
    rim[i] = 0.7 * radius * vec2(cos(a), sin(a));
    heights[i] = waterAt(q + worldXZ * rim[i], vec3(0.0)).y;
  }
  vec2 surfaceTilt = vec2(0.0);
  for (int i = 1; i < TILE_WATER_SAMPLES; i++) {
    surfaceTilt += vec2(-rim[i].y, rim[i].x) * (heights[i] - heights[0]);
  }
  surfaceTilt /= (TILE_WATER_SAMPLES == 2 ? 0.49 : 0.735) * radius * radius;
  surfaceTilt = normalTilt(normalize(vec3(-surfaceTilt.y, 1.0, surfaceTilt.x)), 0.34906585);
  float surfaceAngle = length(surfaceTilt);
  if (surfaceAngle > 0.34906585) surfaceTilt *= 0.34906585 / surfaceAngle;
  float groundTarget = -1e20;
  vec4 ground = vec4(0.0,1.0,0.0,-1e20);
#ifdef TILE_TERRAIN_CONTACT
  {
    ground = terrainAt(q);
    groundTarget = polygonSupport(uv, q, worldXZ, s1.xy);
    if(groundTarget < -1e19) ground=vec4(0.0,1.0,0.0,-1e20);
    float gap = r1.x + s0.x - groundTarget;
    // Geometric Schmitt band: dry terrain always supports, a lifting wave must
    // lift the bottom clear of the 5 cm exit threshold.
    bool supported = ground.w > -1e19 && (disp.y <= ground.w ||
      gap <= (s1.w > 0.5 ? 0.05 : 0.02));
    s1.w = supported ? 1.0 : 0.0;
    contact = clamp(contact + (supported ? 1.0 : -1.0)*uDt/0.2, 0.0,1.0);
    vec3 n = ground.xyz;
    vec2 localNormal = transpose(worldXZ)*n.xz;
    surfaceTilt = mix(surfaceTilt,normalTilt(vec3(localNormal.x,n.y,localNormal.y),0.95993109),contact);
  }
#endif
  float displacedFraction = uDensity / max(1025.0 * uBuoyancy, 0.001);
  vec2 spring = s0.zw;
  vec2 velocity = s2.xy;
  vec2 localWaterVelocity = transpose(worldXZ) * waterVelocity.xz;
  if (abs(s3.w) > 0.01 && !polyline) {
    if (s3.z < 0.5) spring -= transpose(worldXZ) * s2.zw * s3.y;
    if (drift && s3.z < 0.5) {
      // Preserve the previous total position and include its orbital velocity.
      spring = s0.zw;
      velocity += localWaterVelocity * s3.y;
    } else if (!drift && s3.z > 0.5) {
      spring -= orbit;
      velocity -= localWaterVelocity * orbitGain;
    }
  }
  int steps = min(TILE_MAX_STEPS, max(1, int(ceil(uDt * 240.0))));
  float dt = uDt / float(steps);
  for (int step = 0; step < TILE_MAX_STEPS; step++) {
    if (step >= steps) break;
    if (displacedFraction < 1.0) {
      // Hydrostatic draft with exact critically damped relaxation, for both
      // polygons and strips. Stability at drag=0 does not depend on density.
      float wet = heights[0] + thickness * (0.5 - displacedFraction);
      float target = mix(wet, max(wet,groundTarget),contact) - r1.x;
      if (disp.y <= ground.w) target = groundTarget-r1.x;
      float frequency = 12.0 / (1.0 + 0.15 * uDrag);
      float error = s0.x - target, c = s0.y + frequency * error;
      float decay = exp(-frequency * dt);
      s0.x = target + (error + c * dt) * decay;
      s0.y = (s0.y - frequency * c * dt) * decay;
    } else {
      // Preserve sinking when buoyancy cannot support the tile's weight.
      float ay = -9.81;
      for (int i = 0; i < TILE_WATER_SAMPLES; i++) {
        vec2 lever = vec2(-rim[i].y, rim[i].x);
        float y = r1.x + s0.x + (tileTilt(s1.xy)*vec3(rim[i].x,0.0,rim[i].y)).y;
        float pointVelocity = s0.y;
        float sub = clamp((heights[i] - y) / thickness + 0.5, 0.0, 1.0);
        ay += (1.0 / float(TILE_WATER_SAMPLES)) * sub * (1025.0 * 9.81 / uDensity * uBuoyancy
          - 1.5 * uDrag * (pointVelocity - waterVelocity.y));
      }
      s0.y = clamp(s0.y + ay * dt, -10.0, 10.0);
      s0.x += s0.y * dt;
    }
    {
      float frequency = 10.0 / (1.0 + uAngularDrag);
      s1.xy = mix(s1.xy, surfaceTilt, 1.0-exp(-frequency*dt));
    }
    float limit = mix(0.34906585,0.95993109,contact);
    float tilt = length(s1.xy);
    if (tilt > limit) s1.xy *= limit/tilt;
    if (!polyline && pose.w < 0.5) {
      velocity += horizontalAcceleration(spring, velocity, r.xy - framePivot(frameId), localWaterVelocity, drift) * (1.0-contact) * dt;
      velocity *= exp(-40.0*contact*dt);
      spring += velocity * dt;
    }
  }
  if (polyline) {
    int runId = int(r1.z);
    vec4 run = texelFetch(uRun, ivec2(runId % 512, runId / 512), 0);
    spring = run.xy; velocity = run.zw;
  }
  state0 = vec4(s0.xy, spring + ((!drift || polyline) ? orbit : vec2(0.0)));
  state1 = vec4(s1.xy,contact,s1.w);
  state2 = vec4(velocity, disp.xz);
  // y remembers orbital gain; z remembers the velocity convention (mode).
  // w is per-tile history validity, also cleared by the NaN recovery path.
  state3 = vec4(disp.y, orbitGain, drift ? 1.0 : 0.0, 1.0);
  // A strip's individual frozen orbital offsets need to rejoin its shared run
  // continuously when explicitly released. Negative history.w is the remaining
  // transition time, and still denotes a valid water sample.
  if (s3.w < 0.0 && pose.w < 0.5) {
    if (polyline) state0.zw = mix(s0.zw, state0.zw, min(1.0, uDt / max(-s3.w, 0.001)));
    state3.w = s3.w + uDt >= 0.0 ? 1.0 : s3.w + uDt;
  }
  // Capture the rendered total, including orbit, without a GPU snapshot. Fade
  // only the incremental orbit for 125 ms, baking its captured contribution
  // into the new anchor. No source-contour recovery or amplitude-removal jump.
  // Keep the original velocity convention for cancellation / release to drift.
  if (pose.w > 0.5) {
    state0.zw = s0.zw;
    if (polyline || s3.z < 0.5) {
      vec2 previousOrbit = transpose(worldXZ) * s2.zw * s3.y;
      state0.zw += (orbit - previousOrbit) * clamp(2.0 - pose.w, 0.0, 1.0);
    }
    state2.xy = s2.xy*exp(-40.0*contact*uDt);
    state3.z = s3.z;
    state3.w = -0.125;
  }
#ifdef TILE_TERRAIN_CONTACT
  {
    // Re-evaluate after horizontal integration and tilt: hard floor applies even
    // during the 200 ms blend, in hold, and on the invisible deep seabed.
    vec2 finalQ = (uFieldMatrix*vec4(r.x+state0.z+pose.x,0.0,r.y+state0.w+pose.y,1.0)).xz;
    float floorY = polygonSupport(uv,finalQ,worldXZ,state1.xy)-r1.x;
    if (state0.x <= floorY) { state0.x=floorY; state0.y=max(0.0,state0.y); }
    state0.y *= exp(-40.0*contact*uDt);
  }
#endif
  if (bad(state0) || bad(state1) || bad(state2) || bad(state3)) rest();
}`;

// A run has one residual translation/velocity and a separate water-history MRT
// attachment. Members keep their orbit; strip height/tilt relax toward the surface.
const RUN_FRAG = /* glsl */`
precision highp float;
precision highp int;
${WATER_GLSL}
uniform highp sampler2D uRunRest, uRun, uRunHistory, uState1;
uniform int uRunHeight;
uniform mat4 uFieldMatrix;
uniform float uDt, uSampleDt, uDrag, uOrbit, uAnchorPeriod;
uniform int uRunCount;
uniform bool uReset;
${HORIZONTAL}
layout(location = 0) out vec4 runState;
layout(location = 1) out vec4 history;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  runState = vec4(0.0); history = vec4(0.0);
  if (uReset || uv.y * 512 + uv.x >= uRunCount) return;
  vec4 s = texelFetch(uRun, uv, 0), prev = texelFetch(uRunHistory, uv, 0);
  if (bad(s) || bad(prev)) return;
  vec4 runRest = texelFetch(uRunRest, uv, 0);
  vec2 members = texelFetch(uRunRest, uv+ivec2(0,uRunHeight),0).xy;
  float contact = 0.0;
  for(int id=int(members.x);id<int(members.y);id++) {
    contact=max(contact,texelFetch(uState1,ivec2(id%512,id/512),0).z);
  }
  vec2 r = runRest.xy;
  int frameId = int(runRest.z);
  vec4 pose = framePose(frameId);
  bool drift = frameDrift(pose);
  mat2 worldXZ = mat2(uFieldMatrix[0].xz, uFieldMatrix[2].xz);
  vec2 q = r + pose.xy + s.xy + transpose(worldXZ) * prev.xy * prev.z;
  vec2 disp = waterAt((uFieldMatrix * vec4(q.x, 0.0, q.y, 1.0)).xz, vec3(0.0)).xz;
  vec2 waterVelocity = prev.w > 0.5 ? transpose(worldXZ) * clamp((disp - prev.xy) / uSampleDt, vec2(-3.0), vec2(3.0)) : vec2(0.0);
  int steps = min(TILE_MAX_STEPS, max(1, int(ceil(uDt * 240.0))));
  float dt = uDt / float(steps);
  for (int step = 0; step < TILE_MAX_STEPS; step++) {
    if (step >= steps) break;
    s.zw += horizontalAcceleration(s.xy, s.zw, r - framePivot(frameId), waterVelocity, drift) * (1.0-contact)*dt;
    s.zw *= exp(-40.0*contact*dt);
    s.xy += s.zw * dt;
  }
  if (bad(s)) return;
  runState = s;
  if (pose.w > 0.5) runState = texelFetch(uRun, uv, 0);
  history = vec4(disp, uOrbit, 1.0);
}`;

function restTexture(data, height) {
  const texture = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

// Run-centroid pass then tile MRT; no CPU readback or per-tile work after load.
export class TileSim {
  constructor(renderer, surface, tiles, runs = [], profile = 'desktop', frames = [], terrainContact = null) {
    this.profile = TILE_PROFILES[profile];
    if (!this.profile) throw new Error(`Unknown tile profile: ${profile}`);
    this.renderer = renderer;
    // Two vectors per frame; reserve 160 vectors for water, dynamics and matrices.
    // WebGL2 guarantees 224. Large sources use two RGBA texels per frame instead.
    const gl = renderer.getContext?.();
    this.frameUniformLimit = Math.max(1, Math.floor(((gl?.getParameter?.(gl.MAX_FRAGMENT_UNIFORM_VECTORS) ?? 224) - 160) / 2));
    this.frames = frames;
    const count = Math.max(1, frames.length);
    const useTexture = count > this.frameUniformLimit;
    this.frameTexture = useTexture ? new THREE.DataTexture(new Float32Array(count * 8), 2, count, THREE.RGBAFormat, THREE.FloatType) : null;
    this.frameUniforms = useTexture ? { uFrames: { value: this.frameTexture } } : {
      uFramePose: { value: Array.from({ length: count }, (_, i) => frames[i]?.pose ?? new THREE.Vector4(0, 0, 0, 0)) },
      uFramePivot: { value: Array.from({ length: count }, (_, i) => new THREE.Vector2(frames[i]?.pivot.x ?? 0, frames[i]?.pivot.z ?? 0)) },
    };
    this.syncFrames();
    this.surface = surface;
    this.height = Math.max(1, Math.ceil(tiles.count / WIDTH));
    this.footprintVertices = (tiles.footprints ?? []).reduce((n,p) => Math.max(n,p?.length ?? 0),3);
    // Extra vertical blocks of the existing rest sampler hold lower-face hulls.
    // The first block keeps the original tile addressing in all render passes.
    const restHeight = this.height * (this.footprintVertices+2);
    const r0 = new Float32Array(WIDTH * restHeight * 4), r1 = new Float32Array(WIDTH*this.height*4);
    for (let i = 0; i < tiles.count; i++) {
      r0.set([tiles.x[i], tiles.z[i], tiles.yaw[i], tiles.radius[i]], i * 4);
      const footprint = tiles.footprints?.[i] ?? [];
      r0.set([footprint.length,tiles.surfaceOffset?.[i]??0,0,0],(WIDTH*this.height+i)*4);
      footprint.forEach((v,k) => r0.set([v.x,v.y,v.z,0], ((k+2)*WIDTH*this.height+i)*4));
      r1.set([tiles.y0[i], tiles.thickness[i], tiles.runId[i], tiles.flags[i] | ((tiles.frameIndex?.[i] ?? 0) << 2)], i * 4);
    }
    this.rest0 = restTexture(r0, restHeight);
    this.rest1 = restTexture(r1, this.height);
    this.targets = Array.from({ length: 2 }, () => new THREE.WebGLRenderTarget(WIDTH, this.height, {
      count: 4, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    }));
    this.current = 0;
    this.runCount = runs.length;
    this.runHeight = Math.max(1, Math.ceil(runs.length / WIDTH));
    const runRest = new Float32Array(WIDTH * this.runHeight * 8);
    runs.forEach((run, i) => {
      let x = 0, z = 0;
      for (const id of run.tiles) { x += tiles.x[id]; z += tiles.z[id]; }
      runRest.set([x / run.tiles.length, z / run.tiles.length, tiles.frameIndex?.[run.tiles[0]] ?? 0, 0], i * 4);
      runRest.set([run.tiles[0],run.tiles.at(-1)+1,0,0],(WIDTH*this.runHeight+i)*4);
    });
    this.runRest = restTexture(runRest, this.runHeight*2);
    this.runTargets = runs.length ? Array.from({ length: 2 }, () => new THREE.WebGLRenderTarget(WIDTH, this.runHeight, {
      count: 2, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    })) : [];
    this.runCurrent = 0;
    /** @type {Record<string, { value: any }>} the field adds its own (uTileMotionLimit) */
    this.uniforms = {
      uRest0: { value: this.rest0 }, uRest1: { value: this.rest1 },
      ...Object.fromEntries(this.target.textures.map((texture, i) => [`uState${i}`, { value: texture }])),
      uRun: { value: this.runTarget?.textures[0] ?? this.runRest },
    };
    this.quad = new FullscreenQuad(rawPass(FRAG, {
      ...surface.uniforms, ...this.uniforms, ...this.frameUniforms, ...terrainContact?.uniforms,
      uStateHeight: { value: this.height },
      uFieldMatrix: { value: new THREE.Matrix4() }, uTileCount: { value: tiles.count },
      uDt: { value: 0 }, uSampleDt: { value: 1 / 60 }, uReset: { value: false },
      uDensity: { value: 500 }, uBuoyancy: { value: 1 }, uDrag: { value: 1.6 },
      uAngularDrag: { value: 0.8 }, uOrbit: { value: 1 }, uAnchorPeriod: { value: 4 },
      uDrift: { value: false }, uWindage: { value: 0.02 }, uDriftRadius: { value: 400 },
      uWindVelocity: { value: new THREE.Vector2() },
    }));
    this.runQuad = runs.length ? new FullscreenQuad(rawPass(RUN_FRAG, {
      ...this.quad.material.uniforms,
      uRunRest: { value: this.runRest }, uRunCount: { value: runs.length }, uRunHeight: { value: this.runHeight },
      uRunHistory: { value: this.runTarget.textures[1] },
    })) : null;
    for (const quad of [this.quad, this.runQuad]) if (quad) {
      quad.material.defines = { TILE_MAX_STEPS: this.profile.maxSteps, TILE_WATER_SAMPLES: this.profile.waterSamples,
        TILE_FOOTPRINT_VERTICES: this.footprintVertices,
        ...(terrainContact ? { TILE_TERRAIN_CONTACT: 1 } : {}), TILE_FRAME_COUNT: count, ...(useTexture ? { TILE_FRAME_TEXTURE: 1 } : {}) };
    }
    this.reset();
  }

  syncFrames() {
    if (!this.frameTexture) return;
    const data = this.frameTexture.image.data;
    let changed = this.frameTexture.version === 0;
    this.frames.forEach((frame, i) => {
      const values = [frame.pose.x, frame.pose.y, frame.pose.z, frame.pose.w, frame.pivot.x, frame.pivot.z, 0, 0];
      values.forEach((value, k) => {
        const rounded = Math.fround(value);
        if (data[i * 8 + k] !== rounded) { data[i * 8 + k] = rounded; changed = true; }
      });
    });
    if (changed) this.frameTexture.needsUpdate = true;
  }

  get target() { return this.targets[this.current]; }
  get runTarget() { return this.runTargets[this.runCurrent]; }

  runPass() {
    if (!this.runQuad) return;
    const previous = this.renderer.getRenderTarget(), next = 1 - this.runCurrent;
    try { this.runQuad.render(this.renderer, this.runTargets[next]); }
    finally { this.renderer.setRenderTarget(previous); }
    this.runCurrent = next;
    this.uniforms.uRun.value = this.runTarget.textures[0];
    this.runQuad.material.uniforms.uRunHistory.value = this.runTarget.textures[1];
  }

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
    try { this.runPass(); this.runPass(); this.pass(); this.pass(); }
    finally { this.quad.material.uniforms.uReset.value = false; }
  }

  update(matrix, dt, params, timer) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const u = this.quad.material.uniforms;
    u.uFieldMatrix.value.copy(matrix);
    // Mobile deliberately advances less simulation time on long frames.
    u.uDt.value = Math.min(dt, this.profile.maxSteps / 240);
    u.uSampleDt.value = Math.max(dt, 1e-4);
    for (const name of ['density', 'buoyancy', 'drag', 'angularDrag', 'orbit', 'anchorPeriod', 'windage', 'driftRadius']) {
      u[`u${name[0].toUpperCase()}${name.slice(1)}`].value = params[name];
    }
    u.uDrift.value = params.mode === 'drift';
    const wind = this.surface?.sim?.params;
    const angle = (wind?.windDirection ?? 0) * Math.PI / 180;
    u.uWindVelocity.value.set(Math.cos(angle), Math.sin(angle)).multiplyScalar(wind?.windSpeed ?? 0);
    if (this.runQuad) { timer?.begin('tileRuns'); this.runPass(); }
    timer?.begin('tiles');
    this.pass();
  }

  dispose() {
    this.frameTexture?.dispose();
    this.rest0.dispose(); this.rest1.dispose(); this.targets.forEach((t) => t.dispose()); this.quad.material.dispose();
    this.runRest.dispose(); this.runTargets.forEach((t) => t.dispose()); this.runQuad?.material.dispose();
  }
}
