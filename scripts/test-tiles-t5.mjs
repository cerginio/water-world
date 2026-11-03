// Focused, offline T5 contracts. No browser, GPU, fixtures or benchmark.
import assert from 'node:assert/strict';
import * as T from 'three';
import { Floaters } from '../src/scene/floaters.js';
import { promotionMembers, footprintSamples, tileSnapshotPose, makePromotionDescriptor, disposePromotion } from '../src/tiles/tilePromotionGeometry.js';
import { bindTilePromotion } from '../src/tiles/TilePromotion.js';
globalThis.__TILECRAFT_ROOT__ = '';
const { TileField } = await import('../src/tiles/TileField.js');

function fixture() {
  const count = 35, t = { count };
  for (const key of ['x', 'z', 'yaw', 'radius', 'y0', 'thickness', 'runId', 'flags', 'surfaceOffset', 'g', 'f']) t[key] = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    t.x[i] = i * 2; t.yaw[i] = 0.4; t.radius[i] = 0.5; t.thickness[i] = 0.2;
    t.runId[i] = i < 32 ? -1 : 0; t.flags[i] = i < 32 ? 0 : 1;
    t.g[i] = i; t.f[i] = 1; t.surfaceOffset[i] = 0.01;
  }
  t.g[1] = 0; t.g[2] = 0; t.f[2] = 2; // same group in another frame is NOT promoted
  const matrices = new Float32Array(32 * 16);
  for (let i = 0; i < 32; i++) new T.Matrix4().compose(new T.Vector3(t.x[i], 0, 0),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.4), new T.Vector3(1, 0.2, 1)).toArray(matrices, i * 16);
  const road = new T.BoxGeometry(0.5, 0.2, 0.5), aOffset = new Float32Array(road.attributes.position.array);
  const roadColors = new Float32Array(road.attributes.position.count * 4);
  for (let v = 0; v < road.attributes.position.count; v++) roadColors.set(v % 2 ? [0.4, 0.5, 0.6, 0.8] : [0.1, 0.2, 0.3, 0.9], v * 4);
  road.setAttribute('color', new T.BufferAttribute(roadColors, 4));
  return { tiles: t, groups: 33, runs: [{ tiles: [32, 33, 34] }],
    bounds: new T.Box2(new T.Vector2(-1, -1), new T.Vector2(70, 1)),
    polygon: [{ geometry: new T.BoxGeometry(1, 1, 1), tile: Int32Array.from({ length: 32 }, (_, i) => i), count: 32,
      matrices, colors: new Float32Array(32 * 3).fill(0.5), opacity: 0.75, transparent: true }],
    polyline: [{ geometry: road, aOffset, aTile: new Float32Array(aOffset.length / 3).fill(32), opacity: 0.6, transparent: true }] };
}
const canvas = new EventTarget();
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 64, height: 64, right: 64, bottom: 64 });
const state0 = new Float32Array(512 * 4), state1 = new Float32Array(512 * 4);
state0.set([0.3, -2, 1, 2]); state1.set([0.1, -0.2]);
const renderer = { domElement: canvas, target: null, autoClear: false, color: new T.Color(0x123456), alpha: 0.4,
  getContext: () => ({ isContextLost: () => false }),
  getDrawingBufferSize: v => v.set(64, 64), getClearColor(v) { return v.copy(this.color); }, getClearAlpha() { return this.alpha; },
  setClearColor(c, a) { this.color.set(c); this.alpha = a; },
  getRenderTarget() { return this.target; }, setRenderTarget(t) { this.target = t; }, clear() {}, render() {},
  readRenderTargetPixels(target, x, y, w, h, out, face, attachment = 0) {
    if (w === 1) out.set([1, 0, 0, 255]);
    else out.set((attachment ? state1 : state0).subarray(0, out.length));
  } };
const scene = new T.Scene(), camera = new T.PerspectiveCamera();
const floaters = new Floaters({ scene, heightAt: () => -100, patchMaterial() {} });
const field = new TileField({ scene, renderer, surface: { uniforms: {} }, patchMaterial() {}, heightAt: () => -100, floaters, camera });
assert.equal(field.unbindPromotion, undefined);
field.rest = fixture(); field.build(field.rest);
field.group.position.set(10, 0, -5); field.group.rotation.y = 0.7;
const rest = field.rest;
assert.deepEqual(promotionMembers(rest, 0), [0, 1]);
assert.deepEqual(promotionMembers(rest, 2), [2]);
assert.deepEqual(promotionMembers(rest, 34), [32, 33, 34]);
assert.deepEqual(promotionMembers(rest, -1), []);
// Footprint samples span both plan axes (collinear ones capsized plates, T5 QA).
const plate = [];
for (let x = 0; x <= 10; x++) for (let z = 0; z <= 2; z++) plate.push(new T.Vector3(x, 0.5, z));
const spread = footprintSamples(plate);
assert.equal(spread.length, 8);
assert(spread.some(p => p.z === 0) && spread.some(p => p.z === 2));
assert(spread.some(p => p.x === 0) && spread.some(p => p.x === 10));
assert(spread.every(p => p.y === 0.5));
assert.equal(footprintSamples(plate, 3).length, 3);
assert.equal(footprintSamples(Array.from({ length: 20 }, () => new T.Vector3())).length, 1);
assert.deepEqual(footprintSamples([]), []);
const singleton = new T.Vector3(2, 3, 4);
const singleSample = footprintSamples([singleton]);
assert.deepEqual(singleSample, [singleton]); assert.notEqual(singleSample[0], singleton);
const desc = makePromotionDescriptor(field, [0, 1], state0, state1);
assert(Math.abs(desc.volume - Math.PI * 0.25 * 0.2 * 2) < 1e-8);
assert.equal(desc.samples.length, 8); assert.equal(desc.density, 500);
// Centre of buoyancy (equal cells) sits under the body origin.
const sampleMean = desc.samples.reduce((m, p) => m.add(p), new T.Vector3()).divideScalar(8);
assert(Math.abs(sampleMean.x) < 1e-9 && Math.abs(sampleMean.z) < 1e-9);
const lopsided = makePromotionDescriptor(field, [0, 1, 4], state0, state1);
const lopsidedMean = lopsided.samples.reduce((m, p) => m.add(p), new T.Vector3()).divideScalar(lopsided.samples.length);
assert(Math.abs(lopsidedMean.x) < 1e-9 && Math.abs(lopsidedMean.z) < 1e-9);
// Origin = volume-weighted tile centre (equal volumes here), not the bounds centre.
const com = [0, 1, 4].reduce((m, id) => m.add(tileSnapshotPose(rest.tiles, id, state0, state1,
  field.sim.uniforms.uTileMotionLimit.value).center), new T.Vector3()).divideScalar(3);
assert(com.applyMatrix4(field.group.matrixWorld).distanceTo(lopsided.positionWorld) < 1e-6);
disposePromotion(lopsided);
const sampleZ = desc.samples.map(p => p.clone().applyAxisAngle(new T.Vector3(0, 1, 0), desc.yaw));
assert(new Set(desc.samples.map(p => p.z.toFixed(3))).size > 1 || sampleZ.length === 1);
assert.equal(desc.object.children[0].material.opacity, 0.75);
// Polygon prototypes: instance colour only, prototype vertex colours ignored as before.
assert.equal(desc.object.children[0].geometry.attributes.color.itemSize, 3);
assert.equal(desc.object.children[0].geometry.attributes.color.getX(0), 0.5);
// Independent first vertex oracle: scale/yaw -> Rx -> Rz -> translation -> field yaw.
const source = new T.Vector3().fromBufferAttribute(rest.polygon[0].geometry.attributes.position,
  rest.polygon[0].geometry.index.getX(0));
source.applyMatrix4(new T.Matrix4().fromArray(rest.polygon[0].matrices));
source.applyAxisAngle(new T.Vector3(1, 0, 0), state1[0]);
source.applyAxisAngle(new T.Vector3(0, 0, 1), state1[1]);
source.add(new T.Vector3(1, 0.31, 2)).applyMatrix4(field.group.matrixWorld);
const baked = new T.Vector3().fromBufferAttribute(desc.object.children[0].geometry.attributes.position, 0)
  .applyAxisAngle(new T.Vector3(0, 1, 0), desc.yaw).add(desc.positionWorld);
assert(source.distanceTo(baked) < 1e-6);
disposePromotion(desc);
const beforeRest = Array.from(field.sim.rest0.image.data), beforeState = Array.from(state0);
const originalTarget = field.sim.target, cameraProjection = camera.projectionMatrix.clone();
assert.equal(field.promotion.pick(camera, 10, 10), 0);
assert(camera.projectionMatrix.equals(cameraProjection));
assert.equal(renderer.autoClear, false); assert.equal(renderer.alpha, 0.4);
assert.equal(renderer.color.getHex(), 0x123456);
const b = field.promotion.promote(0);
assert(b); assert.equal(floaters.bodies.length, 1);
assert.equal(field.sim.rest1.image.data[3], 2); assert.equal(field.sim.rest1.image.data[7], 2);
assert.equal(field.sim.rest1.image.data[11], 0); assert.equal(field.promotion.promote(1), null);
assert.deepEqual(Array.from(field.sim.rest0.image.data), beforeRest);
assert.deepEqual(Array.from(state0), beforeState); assert.equal(field.sim.target, originalTarget);
// Force a real Body water entry: same integrator must create ripple/splash impact.
// Until WaterQuery answers, the zero placeholder must not move the body.
const held = b.pos.clone(); floaters.integrate(b, 1 / 240); assert(b.pos.equals(held));
b.ready = true;
b.pos.y = 0; b.vel.y = -3; b.wet = false; b.water.fill(0); floaters.integrate(b, 1 / 240);
assert.equal(floaters.impacts.length, 1);
const roadBody = field.promotion.promote(34);
assert(roadBody); assert.equal(roadBody.desc.samples.length, 4); // box: 4 distinct plan corners
// LCR road colours are RGBA: copied per vertex through the attribute, alpha kept.
const roadColor = roadBody.object.children[0].geometry.attributes.color;
assert.equal(roadColor.itemSize, 4);
for (let j = 0; j < roadColor.count; j++) {
  const odd = rest.polyline[0].geometry.index.getX(j) % 2;
  assert.deepEqual([roadColor.getX(j), roadColor.getY(j), roadColor.getZ(j), roadColor.getW(j)].map(v => +v.toFixed(3)),
    odd ? [0.4, 0.5, 0.6, 0.8] : [0.1, 0.2, 0.3, 0.9]);
}
assert.equal(field.sim.rest1.image.data[32 * 4 + 3], 3);
assert.equal(roadBody.object.children[0].material.opacity, 0.6);
assert(roadBody.object.children.every(m => m.layers.isEnabled(1)));
for (let id = 3; id <= 29; id++) field.promotion.promote(id);
assert.equal(floaters.bodies.length, 28);
assert.equal(field.sim.rest1.image.data[3], 0); // 29th body returns oldest promotion
assert.equal(field.sim.rest1.image.data[32 * 4 + 3], 3); // not the newer road
assert.equal(field.promotion.active.has(b), false);
floaters.collectPoints([new T.Vector3()]); assert(floaters.count <= 512);
// Ordinary props also evict oldest PROMOTION, not an unrelated newer one.
floaters.add('crate', new T.Vector3());
assert.equal(field.sim.rest1.image.data[32 * 4 + 3], 1);
assert.equal(field.promotion.active.has(roadBody), false);
// Shader contract applies hidden bit to main/depth/pick, without affecting sim flags.
for (const mesh of [...field.group.children, ...field.shadowGroup.children, ...field.promotion.pickGroup.children]) {
  const shader = { uniforms: {}, vertexShader: T.ShaderLib[mesh.material.isMeshBasicMaterial ? 'basic' : 'standard'].vertexShader };
  mesh.material.onBeforeCompile(shader, renderer);
  assert(shader.vertexShader.includes('(int(tileRest1.w) & 2) != 0'));
  assert.equal(shader.uniforms.uState0, field.sim.uniforms.uState0);
}
const render = renderer.render; renderer.target = { saved: true };
renderer.render = () => { throw new Error('injected pick error'); };
assert.throws(() => field.promotion.pick(camera, 5, 5), /injected/);
assert.equal(renderer.target.saved, true); assert.equal(renderer.color.getHex(), 0x123456);
renderer.render = render;
field.reset(); assert.equal(field.promotion.active.size, 0);
assert.equal(floaters.bodies.length, 1); // original props survive tiles reset
assert.equal(field.promotion.target, null);
// Tile plates follow the water plane (critically damped), not the ballistic cell spring:
// a tilted, low plate on flat water levels out and rises to its draft without overshoot.
{
  const fl = new Floaters({ scene: new T.Scene(), heightAt: () => -100, patchMaterial() {} });
  const plateDesc = { object: new T.Group(), volume: 0.1, size: new T.Vector3(2, 0.1, 2), density: 100, follow: true, cellHeight: 0.1,
    samples: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => new T.Vector3(x, 0, z)) };
  const plate = fl.addDescriptor(plateDesc, new T.Vector3(0, -0.3, 0), 0, () => {});
  plate.quat.setFromAxisAngle(new T.Vector3(1, 0, 0), 0.5);
  plate.ready = true;
  const draft = 0.1 * (0.5 - 100 / 1025);
  let peak = -Infinity, rate = 0;
  for (let s = 0; s < 240 * 5; s++) {
    fl.integrate(plate, 1 / 240);
    peak = Math.max(peak, plate.pos.y); rate = Math.max(rate, plate.angVel.length());
  }
  assert(Math.abs(plate.pos.y - draft) < 1e-3, `plate settles at its draft: ${plate.pos.y}`);
  assert(peak < draft + 0.02, `no leap above the draft: ${peak}`);
  assert(new T.Vector3(0, 1, 0).applyQuaternion(plate.quat).y > Math.cos(0.01));
  assert(rate < 3, `levels without flutter: ${rate} rad/s`);
  // A sloped water plane: the plate tilts to it (<=20 deg clamp), not further.
  plate.water.set([0.2, 0, 0, 0, 0.2, 0, 0, 0, -0.2, 0, 0, 0, -0.2, 0, 0, 0]);
  for (let s = 0; s < 240 * 5; s++) fl.integrate(plate, 1 / 240);
  const tilt = Math.acos(new T.Vector3(0, 1, 0).applyQuaternion(plate.quat).y);
  assert(Math.abs(tilt - Math.atan(0.2)) < 0.01, `tilts to the water slope: ${tilt}`);
  // Dropped from above: free fall, then the usual entry impact, then it follows.
  plate.water.fill(0); plate.pos.set(0, 3, 0); plate.vel.set(0, 0, 0); plate.wet = true;
  const before = fl.impacts.length;
  for (let s = 0; s < 240 * 3; s++) fl.integrate(plate, 1 / 240);
  assert.equal(fl.impacts.length, before + 1);
  assert(Math.abs(plate.pos.y - draft) < 0.01);
  // Heavier than water: no follower, the ordinary integrator lets it sink.
  const sinker = fl.addDescriptor({ ...plateDesc, object: new T.Group(), density: 1100 }, new T.Vector3(10, 0, 0), 0, () => {});
  sinker.ready = true;
  for (let s = 0; s < 240 * 3; s++) fl.integrate(sinker, 1 / 240);
  assert(sinker.pos.y < -0.3);
}
// Events are passive until double click, respect FD2 consumption and reject drags.
field.unbindPromotion();
let picks = 0, promotions = 0;
const fake = { loaded: true, promotion: { pick() { picks++; return 0; }, promote() { promotions++; return {}; } } };
const unbind = bindTilePromotion(canvas, fake, camera);
function event(type, properties = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ button: 0, clientX: 10, clientY: 10, timeStamp: 1000, ...properties })) Object.defineProperty(e, key, { value });
  canvas.dispatchEvent(e); return e;
}
event('click'); event('pointerdown'); event('pointerup'); assert.equal(picks, 0);
assert(event('dblclick').defaultPrevented); assert.equal(promotions, 1);
const consumed = new Event('dblclick', { cancelable: true }); consumed.preventDefault(); canvas.dispatchEvent(consumed);
assert.equal(picks, 1);
event('pointerdown'); event('pointermove', { clientX: 30 }); event('pointerup'); event('dblclick', { timeStamp: 1200 }); assert.equal(picks, 1);
event('dblclick', { timeStamp: 2000 }); assert.equal(picks, 2);
unbind(); event('dblclick', { timeStamp: 3000 }); assert.equal(picks, 2);
field.clear(); assert.equal(field.sim, null); assert.equal(field.promotion.pickGroup.children.length, 0);
assert.equal(field.unbindPromotion, null); floaters.clear();
console.log('PASS T5 offline: scoped polygon/run groups, <=8 footprint samples centred on mass, RGBA road colours, water-gated spawn, water-plane follower (no leap/flutter, sinks if heavy), snapshot geometry/normals/colors, real Body impacts, 28-body FIFO return, flags/rest/state preservation, ID-pass shader + error restoration, dblclick/drag arbitration, reset/unload');
