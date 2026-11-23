import * as THREE from 'three';

// SCENE-ENVIRONMENT E0: what one sky change costs, step by step (spec §4). Wall-clock between
// two GPU fences, so it works without EXT_disjoint_timer_query (phones) and counts the GPU work.
// The render loop must be paused by the caller. Steps:
//   lut      — the three atmosphere LUTs
//   face     — one cube face 1024², no mips (E2: the sky's cost per frame while it moves = lut + face)
//   cube     — six cube faces 1024² + mip chain
//   pmrem    — three's PMREM of the 1024² cube, forced by a tiny probe render (minus the same render
//              without it); since E2 nothing renders it — kept as the E0 reference
//   pmrem256, pmrem64, pmrem32 — the same PMREM from a smaller bake of the same sky, own generator;
//              bake256… — that bake (E2: the IBL is pmrem64 + bake64, every cycle of faces while moving)
//   shadow   — the host's sun shadow map, via a 1×1 scene render (minus the same render without it)
//   + `steps`: the host's own work on a sky change, by name (Ultra-Water: spectrum — OceanSim.updateSpectrum)
// Params are not changed, so the sky, the shadow and the host's state end exactly as they were.

/**
 * @param {{ renderer: THREE.WebGLRenderer, env: import('./index.js').Environment, scene: THREE.Scene,
 *   camera: THREE.Camera, light: THREE.DirectionalLight, fence: () => Promise<void>,
 *   steps?: Record<string, () => void>, repeats?: number }} options
 */
export async function measureEnvironment({ renderer, env, scene, camera, light, fence, steps = {}, repeats = 10 }) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 60) throw new Error('measureEnvironment: repeats 1..60');
  const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  const tiny = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const probe = new THREE.Scene();
  probe.environment = env.cube;
  probe.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshStandardMaterial({ roughness: 0.5 })));
  const probeCam = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  probeCam.position.set(0, 0, 3);

  async function time(step) {
    step();               // warm-up: shader compile, lazy allocations
    await fence();
    const t0 = performance.now();
    for (let i = 0; i < repeats; i++) step();
    await fence();
    return (performance.now() - t0) / repeats;
  }
  const into = (fn) => () => { renderer.setRenderTarget(tiny); fn(); };

  try {
    const c = env.updateSun();
    const lut = await time(() => env.bakeLuts(c));
    const oneFace = await time(() => env.bakeFace(0));
    const cube = await time(() => env.bakeCube());
    const pmremWith = await time(into(() => { env.cube.needsPMREMUpdate = true; renderer.render(probe, probeCam); }));
    const pmremBase = await time(into(() => renderer.render(probe, probeCam)));
    // PMREM from a smaller bake of the same sky, each size its own generator: three's shared one
    // reuses the cached target with the last size's meshes and shaders, so another size in between
    // makes the scene's PMREM wrong (and ~1 ms) until reload. 256² — the IBL at rest (E0); 64², 32² —
    // candidates for the IBL while the sky moves (E2 QA: the sand under shallow water jumped at rest).
    /** @type {Record<string, number>} */
    const pmremBySize = {};
    for (const size of [256, 64, 32]) {
      const small = new THREE.WebGLCubeRenderTarget(size, {
        type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      env.bakeCubeInto(small);
      const gen = new THREE.PMREMGenerator(renderer);
      let smallPmrem = null;
      // oxlint-disable-next-line eslint/no-await-in-loop
      pmremBySize[`pmrem${size}`] = await time(() => { smallPmrem = gen.fromCubemap(small.texture, smallPmrem); });
      // oxlint-disable-next-line eslint/no-await-in-loop
      pmremBySize[`bake${size}`] = await time(() => env.bakeCubeInto(small));
      smallPmrem?.dispose(); gen.dispose(); small.dispose();
    }
    const shadowWith = await time(into(() => { renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); }));
    const shadowBase = await time(into(() => renderer.render(scene, camera)));
    // draw calls of one scene render with and without the shadow pass: shows the shadow really re-rendered
    const calls = (shadow) => {
      const info = renderer.info, auto = info.autoReset;
      info.autoReset = false; info.reset();
      renderer.shadowMap.needsUpdate = shadow; renderer.setRenderTarget(tiny); renderer.render(scene, camera);
      const n = info.render.calls; info.autoReset = auto;
      return n;
    };
    const shadowCalls = calls(true) - calls(false);
    /** @type {Record<string, number>} */
    const host = {};
    // one step at a time: each is timed between its own fences
    // oxlint-disable-next-line eslint/no-await-in-loop
    for (const [name, step] of Object.entries(steps)) host[name] = await time(step);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // the host's steps sit next to the module's (m.spectrum), typed as Record<string, number>
    return Object.assign({
      lut, face: oneFace, cube,
      pmrem: Math.max(pmremWith - pmremBase, 0),
      ...pmremBySize,
      shadow: Math.max(shadowWith - shadowBase, 0),
      repeats,
      raw: { pmremWith, pmremBase, shadowWith, shadowBase, shadowCalls },
      cubeSize: env.cubeSize, shadowSize: light.shadow.mapSize.x, viewport: { width: size.x, height: size.y },
    }, host);
  } finally {
    renderer.setRenderTarget(target, face, mip);
    renderer.shadowMap.needsUpdate = true;
    tiny.dispose();
    probe.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
