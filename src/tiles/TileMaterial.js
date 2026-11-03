import * as THREE from 'three';
import { TILE_VERTICAL_LIMIT } from './tileBounds.js';

const PARS = /* glsl */`
uniform sampler2D uRest0, uRest1, uState0, uState1;
uniform int uTileBase;
uniform float uTileMotionLimit;
attribute float aSurfaceOffset;
#ifndef USE_INSTANCING
attribute float aTile;
attribute vec3 aOffset;
#endif
mat3 tileTilt(vec2 a) {
  float cx = cos(a.x), sx = sin(a.x), cz = cos(a.y), sz = sin(a.y);
  return mat3(cz, sz, 0.0, -sz*cx, cz*cx, sx, sz*sx, -cz*sx, cx);
}
`;
const INIT = /* glsl */`
#ifdef USE_INSTANCING
  int tileId = uTileBase + gl_InstanceID;
#else
  int tileId = int(aTile);
#endif
  ivec2 tileUV = ivec2(tileId % 512, tileId / 512);
  vec4 tileRest = texelFetch(uRest0, tileUV, 0);
  vec4 tileRest1 = texelFetch(uRest1, tileUV, 0);
  vec4 tileState = texelFetch(uState0, tileUV, 0);
  tileState.x = clamp(tileState.x, -${TILE_VERTICAL_LIMIT.toFixed(1)}, ${TILE_VERTICAL_LIMIT.toFixed(1)});
  tileState.zw *= min(1.0, uTileMotionLimit / max(length(tileState.zw), 0.00001));
  mat3 tileRotation = tileTilt(texelFetch(uState1, tileUV, 0).xy);
#ifdef USE_INSTANCING
  mat4 tileMatrix = mat4(tileRotation) * instanceMatrix;
  tileMatrix[3] = vec4(tileRest.x + tileState.z, tileRest1.x + tileState.x + aSurfaceOffset, tileRest.y + tileState.w, 1.0);
#endif
`;

// Chain the terrain patch, including its world-position varyings. Keep three's
// inverse-scale normal handling for instanced prototypes with nonuniform scale.
export function patchTileMaterial(material, uniforms, tileBase = 0) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, { uTileMotionLimit: { value: 1e20 } }, uniforms, { uTileBase: { value: tileBase } });
    let vertex = shader.vertexShader;
    for (const chunk of ['defaultnormal_vertex', 'project_vertex', 'worldpos_vertex']) {
      vertex = vertex.replace(`#include <${chunk}>`, THREE.ShaderChunk[chunk]);
    }
    // Also replace terrain.patchProp's instance transforms, before inserting INIT.
    vertex = vertex.replaceAll('instanceMatrix', 'tileMatrix');
    vertex = vertex.replace('vWNrm = normalize(mat3(modelMatrix) * wn);',
      'vWNrm = normalize(transpose(mat3(viewMatrix)) * transformedNormal);');
    vertex = vertex.replace('#include <common>', '#include <common>\n' + PARS)
      .replace('void main() {', 'void main() {\n' + INIT)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
#ifndef USE_INSTANCING
  objectNormal = tileRotation * objectNormal;
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifndef USE_INSTANCING
  transformed = vec3(tileRest.x + tileState.z, tileRest1.x + tileState.x, tileRest.y + tileState.w) + tileRotation * aOffset;
  transformed.y += aSurfaceOffset;
#endif`);
    // Render-only bit: hidden promotions keep their GPU simulation alive.
    vertex = vertex.replace('#include <clipping_planes_vertex>', `
      if ((int(tileRest1.w) & 2) != 0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      #include <clipping_planes_vertex>`);
    shader.vertexShader = vertex;
  };
  material.customProgramCacheKey = () => `${previousKey}-tile-state-v4`;
}
