// Ultra-Water's side of scene-environment (SCENE-ENVIRONMENT-SPEC §5.2): the module's sun lights
// the host's DirectionalLight and asks for a new shadow map. Stays in Ultra-Water; the module
// knows nothing of lights or shadows.
//
// E2 (spec §4, DECISIONS «Оточення: оновлення неба в часі»): the light follows the sun every
// frame it changes; while the sky moves the 4096² shadow map is redrawn once per `shadowEvery`
// seconds, at rest at once.

/**
 * @param {import('../environment/index.js').Environment} env
 * @param {import('three').DirectionalLight} light
 * @param {import('three').WebGLRenderer} renderer   shadowMap.autoUpdate is off: the shadow is redrawn on demand
 * @param {{ shadowEvery?: number }} [options]
 * @returns {(u: import('../environment/index.js').EnvUpdate, dt: number) => void} call with env.update(dt)'s result
 */
export function bindSunLight(env, light, renderer, { shadowEvery = 0.5 } = {}) {
  const { direction, color } = env.sun;
  let sinceShadow = 0;
  return function applySunLight({ sunChanged, moving }, dt) {
    if (!sunChanged) return;
    light.position.copy(direction).multiplyScalar(2000);
    // colour normalised to red = 1, the magnitude in the intensity (pi * color: E_sun,ground)
    light.color.setRGB(color.x, color.y, color.z).multiplyScalar(1 / Math.max(color.x, 1e-4));
    light.intensity = Math.PI * Math.max(color.x, 1e-4);
    sinceShadow += dt;
    if (moving && sinceShadow < shadowEvery) return;
    renderer.shadowMap.needsUpdate = true;
    sinceShadow = 0;
  };
}
