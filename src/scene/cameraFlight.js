// Camera flight between two poses (SCENE-UI-SPEC §4.4). DOM-free: the camera owner
// (cameraRig.js) steps it once a frame and writes the result.
//
// A pose is { position: Vector3, target: Vector3 }. The position follows a cubic Bézier
// that rises by `liftHeight(d)` over long hops (over the island, not through it); the
// orbit target is interpolated on its own. Both run on smootherstep, so the speed is
// zero at either end.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Seconds for a hop of `d` metres: 1.2 s minimum, 5 s maximum. */
export const flightDuration = (d) => clamp(1.2 + 0.9 * Math.log2(1 + d / 50), 1.2, 5);

/** Peak rise above the straight line, metres: none up to 100 m, then a quarter of the hop up to 300. */
export const liftHeight = (d) => (d > 100 ? Math.min(0.25 * d, 300) : 0);

/** 6t⁵ − 15t⁴ + 10t³: first and second derivatives vanish at both ends. */
export const smootherstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (6 * x - 15) + 10);
};

const RAMP = 0.25;   // share of the flight over which a start/end under water rises through the surface

/**
 * @param {{ position: THREE.Vector3, target: THREE.Vector3 }} from
 * @param {{ position: THREE.Vector3, target: THREE.Vector3 }} to
 * @param {{ ground?: (x: number, z: number) => number, water?: () => number }} [bounds]
 *   `ground(x, z)` — lowest allowed camera height over the terrain (islandHeight + 0.8);
 *   `water()` — current water height at the camera; the camera stays 1 m above it.
 */
export function createFlight(from, to, { ground = () => -Infinity, water = () => -Infinity } = {}) {
  const p0 = from.position.clone(), p3 = to.position.clone();
  const t0 = from.target.clone(), t3 = to.target.clone();
  const distance = p0.distanceTo(p3);
  const duration = flightDuration(distance);
  // A cubic Bézier with both inner points raised by a peaks at 0.75·a.
  const rise = liftHeight(distance) / 0.75;
  const p1 = p0.clone().setY(p0.y + rise), p2 = p3.clone().setY(p3.y + rise);

  /** Pose at `elapsed` seconds into the flight, written into `out`. */
  function sample(elapsed, out = { position: new THREE.Vector3(), target: new THREE.Vector3() }) {
    const u = clamp(elapsed / duration, 0, 1);
    const s = smootherstep(u);
    if (u >= 1) {
      out.position.copy(p3);
      out.target.copy(t3);
      return out;
    }
    const a = 1 - s;
    out.position.set(0, 0, 0)
      .addScaledVector(p0, a * a * a).addScaledVector(p1, 3 * a * a * s)
      .addScaledVector(p2, 3 * a * s * s).addScaledVector(p3, s * s * s);
    out.target.copy(t0).lerp(t3, s);
    // Never below the terrain floor; 1 m over the water, except that a pose that starts
    // or ends under water ramps through the surface instead of jumping to it.
    // The ramps run on flight time, so the surface is crossed in the first/last quarter.
    const p = out.position, w = water() + 1;
    let surface = -Infinity;
    if (Number.isFinite(w)) {
      const fromStart = p0.y + (w - p0.y) * smootherstep(u / RAMP);
      const toEnd = p3.y + (w - p3.y) * smootherstep((1 - u) / RAMP);
      surface = Math.min(w, fromStart, toEnd);
    }
    p.y = Math.max(p.y, ground(p.x, p.z), surface);
    return out;
  }

  return { duration, distance, lift: liftHeight(distance), sample, to: { position: p3, target: t3 } };
}
