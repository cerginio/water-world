import * as THREE from 'three';
import { OBSERVER_ALTITUDE, atmosphereCoefficients, transmittance } from './atmosphere.js';

// The sun from the sky params, CPU only. direction: unit vector toward the sun. color: sun radiance
// factor at sea level = sunIntensity x transmittance (the same integral as the LUT), faded out as
// the disc sinks below the horizon; the host lights with pi * color (E_sun,ground / pi).

/**
 * Writes `direction` and `color` in place (consumers hold the objects) and returns the
 * atmosphere coefficients the LUTs are baked with.
 * @param {{ elevation: number, azimuth: number, turbidity: number, rayleigh: number, sunIntensity: number }} p
 * @param {THREE.Vector3} direction
 * @param {THREE.Vector3} color
 */
export function updateSun(p, direction, color) {
  const phi = THREE.MathUtils.degToRad(90 - p.elevation);
  const theta = THREE.MathUtils.degToRad(p.azimuth);
  direction.setFromSphericalCoords(1, phi, theta);

  const c = atmosphereCoefficients(p);
  const T = transmittance(c, OBSERVER_ALTITUDE, Math.max(direction.y, 0));
  const fade = THREE.MathUtils.smoothstep(p.elevation, -2, 2);
  color.set(T[0], T[1], T[2]).multiplyScalar(p.sunIntensity * fade);
  return c;
}
