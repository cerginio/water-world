// Mood weather and the time of day as pure data (MOOD-WEATHER-SPEC §2.2, §3, §5).
// No three, no DOM, no Ultra-Water: the host binds the `sea` channels itself
// (src/environment-bindings/seaBinding.js) and writes `sky` + `sun` through env.set().
//
// Words and names are locale keys; the strings live in the widget's locales (ui/moodPad.js).

/**
 * @typedef {{ sunIntensity: number, cloudCoverage: number, turbidity: number, cloudSpeed: number }} MoodSky
 * @typedef {{ windSpeed: number, waveScale: number, swellScale: number, choppiness: number,
 *   shore: number, spray: number, water: Record<string, number>, clarity: number, fog: number }} MoodSea
 *   shore, spray, fog: multipliers of the host's defaults; water: preset name → weight (sums to 1)
 * @typedef {{ keyValue: number, contrast: number, saturation: number }} MoodGrade
 * @typedef {{ id: string, name: string, words: string[], sky: MoodSky, sea: MoodSea, grade: MoodGrade }} MoodAnchor
 */

/** @returns {MoodAnchor} */
const anchor = (id, name, words, [sunIntensity, cloudCoverage, turbidity, cloudSpeed],
  [windSpeed, waveScale, swellScale, choppiness, shore, spray, water, clarity, fog], [keyValue, contrast, saturation]) => ({
  id, name, words,
  sky: { sunIntensity, cloudCoverage, turbidity, cloudSpeed },
  sea: { windSpeed, waveScale, swellScale, choppiness, shore, spray, water, clarity, fog },
  grade: { keyValue, contrast, saturation },
});

const CLEAR = { clear: 1 }, TROPICAL = { tropical: 1 }, MURKY_HALF = { clear: 0.5, 'murky brown': 0.5 };

// spec §3.2, column by column
const A1 = anchor('A1', 'storm', ['tension', 'too-much'],
  [7, 0.95, 5, 4], [22, 0.45, 1.2, 1.5, 1.6, 2.5, MURKY_HALF, 0.5, 6], [0.12, 1.2, 0.8]);
const A2 = anchor('A2', 'torn-clouds', ['excitement', 'focus'],
  [9, 0.45, 2, 3], [15, 0.3, 0.9, 1.15, 1.3, 1.6, CLEAR, 1, 1.5], [0.18, 1.15, 1.25]);
const A3 = anchor('A3', 'breeze', ['joy', 'energy'],
  [10, 0.2, 1.5, 2], [10, 0.18, 0.7, 0.9, 1.0, 1.0, TROPICAL, 1.3, 0.8], [0.22, 1.12, 1.4]);
const A4 = anchor('A4', 'overcast', ['sadness', 'heaviness'],
  [8, 0.88, 4, 1], [6, 0.1, 0.5, 0.7, 0.8, 0.6, CLEAR, 0.6, 3], [0.14, 1.0, 0.8]);
const A5 = anchor('A5', 'sun-through-clouds', ['balance', 'ordinary'],
  [9, 0.38, 2, 1], [7, 0.12, 0.6, 0.8, 0.9, 0.8, CLEAR, 1, 1], [0.18, 1.1, 1.25]);
const A6 = anchor('A6', 'warm-sun', ['contentment', 'gratitude'],
  [9.5, 0.15, 1.8, 0.8], [5, 0.1, 0.6, 0.7, 0.8, 0.6, CLEAR, 1.1, 0.9], [0.2, 1.12, 1.35]);
const A7 = anchor('A7', 'fog', ['muted', 'distant'],
  [8, 0.6, 8, 0.3], [2, 0.05, 0.35, 0.5, 0.5, 0.3, CLEAR, 0.7, 8], [0.15, 0.92, 0.7]);
const A8 = anchor('A8', 'quiet-cloudy', ['tiredness', 'pensiveness'],
  [8.5, 0.55, 2.5, 0.5], [2.5, 0.06, 0.4, 0.5, 0.5, 0.3, CLEAR, 0.9, 1.5], [0.16, 1.02, 1.0]);
const A9 = anchor('A9', 'calm', ['calm', 'peace'],
  [9, 0.12, 1.6, 0.2], [1.5, 0.04, 0.3, 0.4, 0.4, 0.2, TROPICAL, 1.5, 0.8], [0.2, 1.08, 1.3]);

export const MOOD_MAP_V1 = Object.freeze({
  version: 'mood@1',
  /** row = a (−1, 0, +1), column = v (−1, 0, +1) */
  grid: [[A7, A8, A9], [A4, A5, A6], [A1, A2, A3]],
});

/** @typedef {{ version: string, grid: MoodAnchor[][] }} MoodMap */

const clamp1 = (x) => Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0));

/** numbers lerp; objects (the water weights, the channel groups) blend key by key */
function mix(a, b, f) {
  if (typeof a === 'number') return a + (b - a) * f;
  const out = {};
  // a key missing on one side only happens in the water weights: weight 0
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = mix(a[k] ?? 0, b[k] ?? 0, f);
  return out;
}

const pick = (/** @type {MoodAnchor} */ m) => ({ sky: m.sky, sea: m.sea, grade: m.grade });

/**
 * Bilinear inside the 3×3 cell (spec §3.3). Words and name: the nearest anchor.
 * @param {MoodMap} map
 * @param {number} v valence −1 (cloudy) … +1 (clear)
 * @param {number} a arousal −1 (quiet) … +1 (wind)
 * @returns {{ sky: MoodSky, sea: MoodSea, grade: MoodGrade, anchor: string, name: string, words: string[] }}
 */
export function sampleMood(map, v, a) {
  const x = clamp1(v) + 1, y = clamp1(a) + 1;            // 0 … 2
  const c = Math.min(Math.floor(x), 1), r = Math.min(Math.floor(y), 1);
  const fx = x - c, fy = y - r, g = map.grid;
  const lo = mix(pick(g[r][c]), pick(g[r][c + 1]), fx);
  const hi = mix(pick(g[r + 1][c]), pick(g[r + 1][c + 1]), fx);
  const near = g[Math.round(y)][Math.round(x)];
  return { .../** @type {{ sky: MoodSky, sea: MoodSea, grade: MoodGrade }} */ (mix(lo, hi, fy)),
    anchor: near.id, name: near.name, words: near.words };
}

export const SUN_PATH_V1 = Object.freeze({ minElevation: -2, maxElevation: 60, setAzimuth: 205, sweep: 180, flowMinutes: 20 });

/**
 * The sun over the day, t ∈ [0, 1] from sunrise to sunset (spec §2.2). Colour comes from the
 * atmosphere; `tint` is the artistic fallback channel (spec §2.2), neutral until calibrated.
 * @param {typeof SUN_PATH_V1} path
 * @param {number} t
 */
export function sunAt(path, t) {
  const d = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return {
    elevation: path.minElevation + (path.maxElevation - path.minElevation) * Math.sin(Math.PI * d),
    azimuth: path.setAzimuth - path.sweep * (1 - d),
    tint: [1, 1, 1],
  };
}

// ── transitions (spec §4.4) ──────────────────────────────────────────────────────────────
// The pebble and the sun on the arc move at once; the world follows them exponentially.

/** τ in seconds per group: the time of day, the light and the sky; the sea (wind, waves, surf) */
export const MOOD_TAU = Object.freeze({ day: 6, sky: 6, grade: 6, sea: 10 });

/** a value within this share of its target (at least of 1) counts as arrived and snaps */
const ARRIVED = 1e-4;

/**
 * One step of x += (target − x)·(1 − e^(−dt/τ)) over numbers, arrays and plain objects, in place:
 * monotonic per value, 95 % after 3τ. τ 0 snaps. A key missing in `current` takes the target.
 * @template T
 * @param {T} current  written in place
 * @param {T} target
 * @param {number} dt seconds
 * @param {number} tau seconds
 * @returns {boolean} some value is still on its way
 */
export function stepToward(current, target, dt, tau) {
  const k = tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1;
  let moving = false;
  const walk = (cur, tgt) => {
    for (const key of Object.keys(tgt)) {
      const t = tgt[key];
      if (typeof t === 'number') {
        const x = typeof cur[key] === 'number' ? cur[key] : t;
        const next = x + (t - x) * k;
        if (Math.abs(t - next) <= ARRIVED * Math.max(1, Math.abs(t))) cur[key] = t;
        else { cur[key] = next; moving = true; }
      } else if (t && typeof t === 'object') {
        if (!cur[key] || typeof cur[key] !== 'object') cur[key] = Array.isArray(t) ? [] : {};
        walk(cur[key], t);
      }
    }
  };
  walk(current, target);
  return moving;
}

// ── behaviour and safety (spec §4.3, §4.6) ───────────────────────────────────────────────

/** «Quiet down» (spec §4.2, §4.4): the weather goes to A9 (clear, quiet) with this τ; the day stays */
export const QUIET = Object.freeze({ v: 1, a: -1, tau: 8 });

/** prefers-reduced-motion (spec §4.6; owner 2026-11-24): the world's arousal stops here, τ is longer */
export const REDUCED_MOTION = Object.freeze({ maxArousal: 0.3, tauScale: 1.5 });

/**
 * τ per group for a move: the usual ones (MOOD_TAU), the weather slower for «Quiet down»,
 * everything ×1.5 under reduced motion.
 * @param {{ quiet?: boolean, reduced?: boolean }} [options]
 * @returns {{ day: number, sky: number, grade: number, sea: number }}
 */
export function moodTau({ quiet = false, reduced = false } = {}) {
  const k = reduced ? REDUCED_MOTION.tauScale : 1;
  const w = (/** @type {number} */ tau) => (quiet ? QUIET.tau : tau) * k;
  return { day: MOOD_TAU.day * k, sky: w(MOOD_TAU.sky), grade: w(MOOD_TAU.grade), sea: w(MOOD_TAU.sea) };
}

/** the arousal the world gets: the pebble's, capped under reduced motion (the pebble may sit higher) */
export function worldArousal(/** @type {number} */ a, /** @type {boolean} */ reduced) {
  return reduced ? Math.min(a, REDUCED_MOTION.maxArousal) : a;
}

/**
 * The day's flow (spec §4.3): the sun walks from dawn to sunset in `path.flowMinutes` and stops
 * there. @param {typeof SUN_PATH_V1} path @param {number} t @param {number} dt seconds
 * @returns {{ t: number, done: boolean }} done — sunset reached: the flow switches itself off
 */
export function flowDay(path, t, dt) {
  const next = Math.min(1, Math.max(0, t) + Math.max(0, dt) / (path.flowMinutes * 60));
  return { t: next, done: next >= 1 };
}
