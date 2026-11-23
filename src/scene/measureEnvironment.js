import * as THREE from 'three';

// SCENE-ENVIRONMENT E0: what one sky change costs, step by step (spec §4). Wall-clock between
// two GPU fences, so it works without EXT_disjoint_timer_query (phones) and counts the GPU work.
// The render loop must be paused by the caller. Steps:
//   lut      — the three atmosphere LUTs
//   cube     — six cube faces 1024² + mip chain
//   pmrem    — three's PMREM of the cube, forced by a tiny probe render (minus the same render without it)
//   pmrem256 — the same PMREM from a 256² bake of the same sky, own generator (a candidate for spec §4)
//   shadow   — the 4096² sun shadow map, via a 1×1 scene render (minus the same render without it)
//   spectrum — OceanSim.updateSpectrum()
// Params are not changed, so the sky, the shadow and the spectrum end exactly as they were.

export async function measureEnvironment({ renderer, sky, ocean, scene, camera, light, fence, repeats = 10 }) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 60) throw new Error('measureEnvironment: repeats 1..60');
  const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  const tiny = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const probe = new THREE.Scene();
  probe.environment = sky.cube;
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
    const c = sky.updateSun();
    const lut = await time(() => sky.bakeLuts(c));
    const cube = await time(() => sky.bakeCube());
    const pmremWith = await time(into(() => { sky.cube.needsPMREMUpdate = true; renderer.render(probe, probeCam); }));
    const pmremBase = await time(into(() => renderer.render(probe, probeCam)));
    // E0 candidate for spec §4: PMREM from a 256² copy of the cube (three sizes PMREM by its source).
    // Its own generator: three's shared one reuses the cached target with the last size's meshes and
    // shaders, so a 256² run in between makes the scene's 1024² PMREM wrong (and ~1 ms) until reload.
    const small = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType, generateMipmaps: true, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    sky.bakeCubeInto(small);
    const gen = new THREE.PMREMGenerator(renderer);
    let smallPmrem = null;
    const pmrem256 = await time(() => { smallPmrem = gen.fromCubemap(small.texture, smallPmrem); });
    smallPmrem?.dispose(); gen.dispose(); small.dispose();
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
    const spectrum = await time(() => ocean.updateSpectrum());
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      lut, cube,
      pmrem: Math.max(pmremWith - pmremBase, 0),
      pmrem256,
      shadow: Math.max(shadowWith - shadowBase, 0),
      spectrum, repeats,
      raw: { pmremWith, pmremBase, shadowWith, shadowBase, shadowCalls },
      cubeSize: sky.cubeSize, shadowSize: light.shadow.mapSize.x, viewport: { width: size.x, height: size.y },
    };
  } finally {
    renderer.setRenderTarget(target, face, mip);
    renderer.shadowMap.needsUpdate = true;
    sky.cube.needsPMREMUpdate = true;
    tiny.dispose();
    probe.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
