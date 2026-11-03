// Focused CPU-only T4 contract checks. No browser, GPU or Tilecraft imports.
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.__TILECRAFT_ROOT__ = ''; // Vite define, no external source loaded in this test
const { TileField } = await import('../src/tiles/TileField.js');
import { TILE_PROFILES } from '../src/tiles/TileSim.js';
import { tileBounds, tileMotionLimit, TILE_VERTICAL_LIMIT } from '../src/tiles/tileBounds.js';
import { FloaterShadow } from '../src/scene/floaterShadow.js';
import { TILE_SHADOW_MARGIN } from '../src/tiles/tileBounds.js';

function rendererStub() {
  return { target: null, calls: [], getRenderTarget() { return this.target; },
    setRenderTarget(t) { this.target = t; }, clear() {},
    render(root, camera) { this.calls.push({ root, camera, override: root.overrideMaterial }); } };
}
function fixture() {
  const g = new THREE.BoxGeometry(1, 1, 1), road = new THREE.BoxGeometry(1, 0.2, 1);
  const aOffset = new Float32Array(road.attributes.position.array);
  return {
    tiles: { count: 2, x: [0, 2], z: [0, 0], yaw: [0, 0], radius: [0.5, 0.5], y0: [0, 0], thickness: [1, 0.2], runId: [-1, 0], flags: [0, 1], surfaceOffset: [0.01, 0.02] },
    runs: [{ tiles: [1] }], bounds: new THREE.Box2(new THREE.Vector2(-1, -1), new THREE.Vector2(3, 1)),
    polygon: [{ geometry: g, transparent: false, tile: [0], count: 1, matrices: new Float32Array(new THREE.Matrix4().elements), frameId: 1 }],
    polyline: [{ geometry: road, baseY: 2, transparent: false, aOffset, aTile: new Float32Array(aOffset.length / 3).fill(1), frameId: 1 }],
  };
}
for (const mobile of [false, true]) {
  const renderer = rendererStub(), field = new TileField({ scene: new THREE.Scene(), renderer, surface: { uniforms: {} }, patchMaterial() {}, heightAt: () => -10, mobile });
  assert.equal(field.sim, undefined);
  assert.equal(field.castsShadow, false);
  const rest = fixture(); field.rest = rest; field.build(rest);
  const meshes = field.group.children;
  assert.equal(meshes.length, 2);
  assert.equal(field.shadowGroup.children.length, mobile ? 0 : 2);
  assert.equal(field.castsShadow, !mobile);
  assert.equal(field.boundsEntries[1].restSphere.center.y, 2);
  assert.equal(field.sim.profile, TILE_PROFILES[mobile ? 'mobile' : 'desktop']);
  for (const quad of [field.sim.quad, field.sim.runQuad]) {
    assert.equal(quad.material.defines.TILE_MAX_STEPS, mobile ? 2 : 8);
    assert.equal(quad.material.defines.TILE_WATER_SAMPLES, mobile ? 2 : 4);
  }
  const versions = meshes.map(m => [m.geometry.attributes.position.version, m.instanceMatrix?.version]);
  const labels = [];
  field.update(1, { begin: label => labels.push(label) });
  assert.deepEqual(labels, ['tileRuns', 'tiles']);
  assert.equal(field.sim.quad.material.uniforms.uDt.value, (mobile ? 2 : 8) / 240);
  for (const mesh of [...meshes, ...field.shadowGroup.children]) {
    assert(mesh.layers.isEnabled(1)); assert(mesh.frustumCulled);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[mesh.material.isMeshBasicMaterial ? 'basic' : 'standard'].vertexShader };
    mesh.material.onBeforeCompile(shader, renderer);
    assert.equal(shader.uniforms.uState0, field.sim.uniforms.uState0);
    assert.equal(shader.uniforms.uTileMotionLimit, field.sim.uniforms.uTileMotionLimit);
    assert(shader.vertexShader.includes(`tileState.x = clamp(tileState.x, -${TILE_VERTICAL_LIMIT.toFixed(1)}, ${TILE_VERTICAL_LIMIT.toFixed(1)})`));
    assert(shader.vertexShader.includes('mat4 tileMatrix = mat4(tileRotation) * instanceMatrix'));
    assert(shader.vertexShader.includes('transformed.y += surfaceOffset'));
  }
  field.params.driftRadius = 1000; field.update(1 / 60);
  assert.equal(field.sim.uniforms.uTileMotionLimit.value, 8);
  field.setMode('drift'); field.update(1 / 60); field.setMode('anchored'); field.update(1 / 60);
  assert.equal(field.sim.uniforms.uTileMotionLimit.value, 1064);
  assert.deepEqual(meshes.map(m => [m.geometry.attributes.position.version, m.instanceMatrix?.version]), versions);
  field.group.position.set(100, 4, -200); field.group.rotation.y = 0.7;
  // Shadow fit = field at rest + fixed margin, never the culling envelope (1 m texels).
  const body = field.syncShadow();
  assert(body.radius < 40, `shadow radius ${body.radius}`);
  assert(body.radius >= TILE_SHADOW_MARGIN + 1);
  assert(body.pos.distanceTo(field.group.position) < 5);
  field.params.driftRadius = 50; field.update(1 / 60);
  assert.equal(field.syncShadow().radius, body.radius);
  field.params.driftRadius = 1000; field.update(1 / 60);
  for (let i = 0; i < field.shadowGroup.children.length; i++) {
    const proxy = field.shadowGroup.children[i];
    assert.equal(proxy.geometry, meshes[i].geometry);
    assert(proxy.matrixWorld.equals(meshes[i].matrixWorld) || proxy.matrix.equals(meshes[i].matrix));
  }
  const shadow = new FloaterShadow(16), root = new THREE.Scene();
  const original = new THREE.MeshBasicMaterial(); root.overrideMaterial = original;
  const saved = {}; renderer.target = saved; renderer.calls = [];
  shadow.update(renderer, root, [], new THREE.Vector3(0.4, 0.8, 0.4).normalize(), field);
  assert.equal(renderer.target, saved); assert.equal(root.overrideMaterial, original);
  assert.equal(renderer.calls.length, mobile ? 0 : 2);
  if (!mobile) {
    assert.equal(renderer.calls[1].root, field.shadowScene);
    assert.equal(renderer.calls[1].override, null);
    renderer.render = () => { throw new Error('injected'); };
    assert.throws(() => shadow.update(renderer, root, [], new THREE.Vector3(0, 1, 0), field), /injected/);
    assert.equal(renderer.target, saved); assert.equal(root.overrideMaterial, original);
  }
  shadow.target.dispose(); shadow.material.dispose(); original.dispose();
  renderer.render = () => {};
  field.reset(); assert.equal(field.sim.uniforms.uTileMotionLimit.value, 8);
  field.clear(); assert.equal(field.group.children.length, 0); assert.equal(field.shadowGroup.children.length, 0);
  assert.equal(field.sim, null); assert.equal(field.castsShadow, false);
}
// Independently sample worst-case displacement + arbitrary owner-relative rotation.
const restSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10);
const limit = tileMotionLimit(400), offset = 3, bias = 0.2;
const bounds = tileBounds(restSphere, limit, offset, bias);
for (let i = 0; i < 128; i++) {
  const angle = i * 2.399963229728653;
  const p = new THREE.Vector3(10, 0, 0).add(new THREE.Vector3(Math.cos(angle) * limit, TILE_VERTICAL_LIMIT * (i % 2 ? 1 : -1), Math.sin(angle) * limit));
  p.add(new THREE.Vector3(2 * offset, bias, 0));
  assert(bounds.containsPoint(p));
}
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000); camera.updateMatrixWorld();
const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
assert(frustum.intersectsSphere(bounds.clone().translate(new THREE.Vector3(0, 0, -600))));
assert(!frustum.intersectsSphere(bounds.clone().translate(new THREE.Vector3(5000, 0, -600))));
console.log('PASS T4 offline: desktop/mobile, 2 mesh kinds, shared depth deformation, bounds (128 extremes), frustum, timer labels, no buffer rewrites, unload, shadow error restoration');
