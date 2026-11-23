import * as THREE from 'three';

// Float data as a linearly filtered texture. A FloatType texture filters only with
// OES_texture_float_linear, which many phones lack (Chrome Android: the texture is
// incomplete there and samples as 0); half-float filtering is core WebGL2.
// Half range is +-65504 with an 11-bit mantissa: step 1/32 at 32..64, 1/2 at 512..1024.
/**
 * @param {ArrayLike<number>} data
 * @param {number} width
 * @param {number} height
 * @param {THREE.PixelFormat} format
 */
export function halfTexture(data, width, height, format) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, width, height, format, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
