// Ultra-Water's side of scene-environment (SCENE-ENVIRONMENT-SPEC §5.2): the module's sun lights
// the host's DirectionalLight and asks for a new shadow map. Stays in Ultra-Water; the module
// knows nothing of lights or shadows.

/**
 * @param {import('../environment/index.js').Environment} env
 * @param {import('three').DirectionalLight} light
 * @param {import('three').WebGLRenderer} renderer   shadowMap.autoUpdate is off: the shadow is redrawn on demand
 * @returns {() => void} call after env.update()
 */
export function bindSunLight(env, light, renderer) {
  const { direction, color } = env.sun;
  return function applySunLight() {
    light.position.copy(direction).multiplyScalar(2000);
    // colour normalised to red = 1, the magnitude in the intensity (pi * color: E_sun,ground)
    light.color.setRGB(color.x, color.y, color.z).multiplyScalar(1 / Math.max(color.x, 1e-4));
    light.intensity = Math.PI * Math.max(color.x, 1e-4);
    renderer.shadowMap.needsUpdate = true;
  };
}
