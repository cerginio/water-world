// Ultra-Water's side of the mood `sea` channels (MOOD-WEATHER-SPEC §5): OceanSim, the water
// surface uniforms, the spray, the underwater pass and the terrain fog. The environment module
// only knows the channel names; what they move is here.

// Water colour presets (linear RGB). The look comes from the per-channel absorption
// (1/m: the channel absorbed least is the colour you see through shallow water), the
// in-scatter colour (deep water, underside, underwater fog), the tint of thin foam and
// the underwater scattering (turbidity). 'clear' is the default look.
export const WATER_PRESETS = {
  clear: { absorption: [0.40, 0.062, 0.032], scatter: [0.0, 0.05, 0.08], foam: [0.62, 0.78, 0.82], turbidity: 0.03 },
  tropical: { absorption: [0.36, 0.045, 0.06], scatter: [0.0, 0.085, 0.085], foam: [0.66, 0.86, 0.84], turbidity: 0.02 },
  'toxic green': { absorption: [0.45, 0.1, 1.1], scatter: [0.05, 0.1, 0.004], foam: [0.74, 0.84, 0.42], turbidity: 0.08 },
  purple: { absorption: [0.22, 0.85, 0.1], scatter: [0.05, 0.0, 0.09], foam: [0.8, 0.66, 0.88], turbidity: 0.04 },
  'rust orange': { absorption: [0.1, 0.34, 1.2], scatter: [0.11, 0.035, 0.004], foam: [0.9, 0.72, 0.55], turbidity: 0.1 },
  'murky brown': { absorption: [0.55, 0.62, 0.9], scatter: [0.045, 0.045, 0.022], foam: [0.78, 0.74, 0.6], turbidity: 0.25 },
};

/**
 * Presets mixed by weight, every channel linear (the presets are linear RGB, spec §3.3).
 * @param {Record<string, number>} weights preset name → weight; unknown names are skipped
 */
export function mixWater(weights) {
  const out = { absorption: [0, 0, 0], scatter: [0, 0, 0], foam: [0, 0, 0], turbidity: 0 };
  let sum = 0;
  for (const [name, wt] of Object.entries(weights)) {
    const p = WATER_PRESETS[name];
    if (!p || !(wt > 0)) continue;
    sum += wt;
    for (let i = 0; i < 3; i++) {
      out.absorption[i] += p.absorption[i] * wt;
      out.scatter[i] += p.scatter[i] * wt;
      out.foam[i] += p.foam[i] * wt;
    }
    out.turbidity += p.turbidity * wt;
  }
  if (!(sum > 0)) return mixWater({ clear: 1 });
  for (const k of /** @type {const} */ (['absorption', 'scatter', 'foam'])) out[k] = out[k].map((x) => x / sum);
  out.turbidity /= sum;
  return out;
}

/**
 * The sea as the host's own channels: absolute values, so a transition can start from whatever is
 * on screen (a Controls edit included) and blend linearly to a mood (spec §4.4).
 * @typedef {{ windSpeed: number, waveScale: number, swellScale: number, choppiness: number,
 *   shore: number, spray: number, terrainFog: number, waterFog: number,
 *   absorption: number[], clarity: number, scatter: number[], foam: number[], turbidity: number }} SeaChannels
 *   absorption — before clarity (the Controls' base); the surface gets absorption ÷ clarity
 */

const WAVE_KEYS = /** @type {const} */ (['windSpeed', 'waveScale', 'swellScale']);

/**
 * @param {{ ocean: { params: Record<string, number>, dirty: boolean }, surface: { uniforms: Record<string, { value: any }> },
 *   spray: { params: { amount: number } }, underwater: { params: { scattering: number } },
 *   terrain: { uniforms: Record<string, { value: any }> }, clarity: () => number }} host
 *   clarity — the clarity the surface absorption is divided by now (the Controls' value)
 */
export function bindSea({ ocean, surface, spray, underwater, terrain, clarity }) {
  const su = surface.uniforms;
  // the × channels multiply the defaults the host started with
  const base = {
    shore: su.uShoreWave.value.x,
    spray: spray.params.amount,
    terrainFog: terrain.uniforms.uFogDensity.value,
    waterFog: su.uOptics.value.w,
  };
  const op = ocean.params;
  return {
    /** @param {import('../environment/mood.js').MoodSea} sea @returns {SeaChannels} */
    channels(sea) {
      const water = mixWater(sea.water);
      return {
        windSpeed: sea.windSpeed, waveScale: sea.waveScale, swellScale: sea.swellScale, choppiness: sea.choppiness,
        shore: base.shore * sea.shore, spray: base.spray * sea.spray,
        terrainFog: base.terrainFog * sea.fog, waterFog: base.waterFog * sea.fog,
        absorption: water.absorption, clarity: sea.clarity, scatter: water.scatter, foam: water.foam,
        turbidity: water.turbidity,
      };
    },
    /** @returns {SeaChannels} what the host shows now */
    read() {
      const c = clarity();
      return {
        windSpeed: op.windSpeed, waveScale: op.waveScale, swellScale: op.swellScale, choppiness: op.choppiness,
        shore: su.uShoreWave.value.x, spray: spray.params.amount,
        terrainFog: terrain.uniforms.uFogDensity.value, waterFog: su.uOptics.value.w,
        absorption: su.uAbsorption.value.toArray().map((x) => x * c), clarity: c,
        scatter: su.uScatterColor.value.toArray(), foam: su.uFoamTint.value.toArray(),
        turbidity: underwater.params.scattering,
      };
    },
    /** @param {SeaChannels} ch — the spectrum is re-made (ocean.dirty) only when the waves changed */
    write(ch) {
      if (WAVE_KEYS.some((k) => op[k] !== ch[k])) ocean.dirty = true;
      for (const k of WAVE_KEYS) op[k] = ch[k];
      op.choppiness = ch.choppiness;
      su.uShoreWave.value.x = ch.shore;
      spray.params.amount = ch.spray;
      terrain.uniforms.uFogDensity.value = ch.terrainFog;
      su.uOptics.value.w = ch.waterFog;
      su.uAbsorption.value.fromArray(ch.absorption).multiplyScalar(1 / ch.clarity);
      su.uScatterColor.value.fromArray(ch.scatter);
      su.uFoamTint.value.fromArray(ch.foam);
      underwater.params.scattering = ch.turbidity;
    },
  };
}
