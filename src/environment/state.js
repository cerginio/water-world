// The sky state with τ-smoothing (SCENE-ENVIRONMENT-SPEC §4, §5.3; E2). Pure numbers, no three:
// `current` is what the sky is baked from, `target` is where it is going. Each key approaches its
// target exponentially with its own τ (seconds): x += (target − x)·(1 − e^(−dt/τ)), so a move is
// monotonic and 95 % done after 3τ. τ = 0 snaps. Azimuth takes the short way round and stays in
// [0, 360). Within EPS of the target a key snaps onto it and stops moving.

/** @typedef {'elevation' | 'azimuth' | 'turbidity' | 'rayleigh' | 'cloudCoverage' | 'sunIntensity' | 'cloudSpeed'} SkyKey */

/** @type {Readonly<Record<SkyKey, number>>} the distance at which a key counts as arrived */
export const SKY_EPS = Object.freeze({
  elevation: 0.01, azimuth: 0.01, turbidity: 1e-3, rayleigh: 1e-3, cloudCoverage: 1e-4, sunIntensity: 1e-3,
  cloudSpeed: 1e-3,
});

const wrap360 = (x) => ((x % 360) + 360) % 360;
/** the signed short way from a to b in degrees, −180…180 */
const azimuthDelta = (a, b) => wrap360(b - a + 180) - 180;

/**
 * @template {Record<SkyKey, number>} P
 * @param {P} current  written in place (the environment's params object)
 */
export function createSkyState(current) {
  const keys = /** @type {SkyKey[]} */ (Object.keys(SKY_EPS));
  /** @type {Record<SkyKey, number>} */
  const target = /** @type {any} */ ({});
  /** @type {Record<SkyKey, number>} */
  const tau = /** @type {any} */ ({});
  /** @type {Set<SkyKey>} */
  const moving = new Set();
  for (const k of keys) { target[k] = current[k]; tau[k] = 0; }
  const delta = (k) => (k === 'azimuth' ? azimuthDelta(current[k], target[k]) : target[k] - current[k]);

  return {
    target: /** @type {Readonly<Record<SkyKey, number>>} */ (target),
    /** keys still on their way */
    get moving() { return moving.size > 0; },
    /**
     * New targets; unknown keys and non-finite values are ignored.
     * @param {Partial<Record<SkyKey, number>>} next
     * @param {number} t  τ in seconds; 0 puts the key there at once
     * @returns {boolean} some key snapped (τ 0 and a different value): the caller re-bakes now
     */
    setTarget(next, t) {
      let snapped = false;
      for (const k of keys) {
        const x = next[k];
        if (x === undefined || !Number.isFinite(x)) continue;
        target[k] = k === 'azimuth' ? wrap360(x) : x;
        tau[k] = Math.max(0, t);
        if (tau[k] === 0) {
          if (current[k] !== target[k]) snapped = true;
          current[k] = target[k];
          moving.delete(k);
        } else if (Math.abs(delta(k)) > SKY_EPS[k]) moving.add(k);
        else { current[k] = target[k]; moving.delete(k); }
      }
      return snapped;
    },
    /**
     * Advances the moving keys by dt seconds.
     * @returns {boolean} some key changed
     */
    step(dt) {
      if (!(dt > 0) || moving.size === 0) return false;
      for (const k of moving) {
        const d = delta(k);
        if (Math.abs(d) <= SKY_EPS[k]) { current[k] = target[k]; moving.delete(k); continue; }
        const x = current[k] + d * (1 - Math.exp(-dt / tau[k]));
        current[k] = k === 'azimuth' ? wrap360(x) : x;
        if (Math.abs(delta(k)) <= SKY_EPS[k]) { current[k] = target[k]; moving.delete(k); }
      }
      return true;
    },
  };
}
