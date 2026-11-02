import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { WATER_GLSL } from '../water/OceanSurface.js';

const WIDTH = 512;
const FRAG = /* glsl */`
precision highp float;
precision highp int;
${WATER_GLSL}
uniform sampler2D uRest0;
uniform mat4 uFieldMatrix;
uniform int uTileCount;
layout(location = 0) out vec4 state0;
layout(location = 1) out vec4 state1;
void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  if (uv.y * 512 + uv.x >= uTileCount) {
    state0 = vec4(0.0); state1 = vec4(0.0); return;
  }
  vec4 r = texelFetch(uRest0, uv, 0);
  vec2 q = (uFieldMatrix * vec4(r.x, 0.0, r.y, 1.0)).xz;
  float h = waterAt(q, vec3(0.0)).y;
  // Central differences in FIELD axes, including fieldYaw. No per-vertex water queries.
  float e = max(0.7 * r.w, 0.1);
  vec2 dx = uFieldMatrix[0].xz * e;
  vec2 dz = uFieldMatrix[2].xz * e;
  float sx = (waterAt(q + dx, vec3(0.0)).y - waterAt(q - dx, vec3(0.0)).y) / (2.0 * e);
  float sz = (waterAt(q + dz, vec3(0.0)).y - waterAt(q - dz, vec3(0.0)).y) / (2.0 * e);
  state0 = vec4(h, 0.0, 0.0, 0.0);
  float tiltZ = atan(sx);
  // Rz * Rx sends +Y to normalize(-sx, 1, -sz), including diagonal slopes.
  state1 = vec4(-atan(sz * cos(tiltZ)), tiltZ, 0.0, 0.0);
}`;

function restTexture(data, height) {
  const texture = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

// T1 kinematics. State layout matches §5.1; inertia and ping-pong arrive in T2.
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
    this.target = new THREE.WebGLRenderTarget(WIDTH, this.height, {
      count: 2, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.uniforms = {
      uRest0: { value: this.rest0 }, uRest1: { value: this.rest1 },
      uState0: { value: this.target.textures[0] }, uState1: { value: this.target.textures[1] },
    };
    this.quad = new FullscreenQuad(rawPass(FRAG, {
      ...surface.uniforms, uRest0: this.uniforms.uRest0,
      uFieldMatrix: { value: new THREE.Matrix4() }, uTileCount: { value: tiles.count },
    }));
  }

  update(matrix) {
    this.quad.material.uniforms.uFieldMatrix.value.copy(matrix);
    const previous = this.renderer.getRenderTarget();
    this.quad.render(this.renderer, this.target);
    this.renderer.setRenderTarget(previous);
  }

  dispose() {
    this.rest0.dispose(); this.rest1.dispose(); this.target.dispose(); this.quad.material.dispose();
  }
}
