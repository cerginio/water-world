import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { bakeShoreMap } from '../src/water/shoreMap.js';
import { buildTerrain } from '../src/scene/terrainGeometry.js';
import { islandHeight } from '../src/scene/islandHeight.js';
import { halfTexture } from '../src/engine/halfTexture.js';

// scene-ui U4: FloatType + LinearFilter samples as 0 without OES_texture_float_linear
// (owner's phone, Chrome Android) — the shore map read depth 0 in an 1800 m square.
// Linearly filtered data goes in as half float, which WebGL2 filters in core.

const shore = bakeShoreMap(islandHeight, 1800, 128);
const textures = {
  'shore (bed, sdf, ∇sdf)': [shore.texture, shore.data],
  'travel (tau, dir, shoal)': [shore.travel, shore.travelData],
  surf: [shore.surf, null],
  'terrain heightMap': [buildTerrain(8, 32).heightMap, null],
};

describe('shore textures are half float, linearly filtered', () => {
  for (const [name, [tex]] of Object.entries(textures)) {
    test(name, () => {
      expect(tex.type).toBe(THREE.HalfFloatType);
      expect(tex.image.data).toBeInstanceOf(Uint16Array);
      expect(tex.minFilter).toBe(THREE.LinearFilter);
      expect(tex.magFilter).toBe(THREE.LinearFilter);
      expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    });
  }
});

describe('half float keeps the baked values', () => {
  const decode = (tex) => Array.from(tex.image.data, THREE.DataUtils.fromHalfFloat);
  for (const [name, [tex, src]] of Object.entries(textures)) {
    if (!src) continue;
    test(name, () => {
      const got = decode(tex);
      let worst = 0;
      for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(got[i] - src[i]) / Math.max(1, Math.abs(src[i])));
      expect(worst).toBeLessThanOrEqual(2 ** -10); // one half-float ulp
    });
  }
  test('shore depth is not 0 offshore of the coast', () => {
    const got = decode(shore.texture);
    let wet = 0, deep = 0;
    for (let k = 0; k < shore.size * shore.size; k++) {
      if (shore.data[k * 4] < -5) { wet++; if (got[k * 4] < -4.9) deep++; }
    }
    expect(wet).toBeGreaterThan(1000);
    expect(deep).toBe(wet);
  });
  test('halfTexture: channels and size', () => {
    const t = halfTexture(new Float32Array([0, 1.5, -60, 1e4]), 2, 2, THREE.RedFormat);
    expect([t.image.width, t.image.height, t.format]).toEqual([2, 2, THREE.RedFormat]);
    expect(Array.from(t.image.data, THREE.DataUtils.fromHalfFloat)).toEqual([0, 1.5, -60, 10000]);
  });
});
