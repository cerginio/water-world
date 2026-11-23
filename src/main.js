import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { OceanSim, defaultOceanParams } from './water/OceanSim.js';
import { OceanSurface } from './water/OceanSurface.js';
import { bakeShoreMap } from './water/shoreMap.js';
import { bakeWaterTextures } from './water/bakeTextures.js';
import { createEnvironment, measureEnvironment } from './environment/index.js';
import { bindSunLight } from './environment-bindings/hostBinding.js';
import { bindPanelCopy } from './ui/perfCopy.js';
import { createTerrain, heroRock } from './scene/terrain.js';
import { islandHeight } from './scene/islandHeight.js';
import { PlanarReflection } from './engine/PlanarReflection.js';
import { PostFX } from './engine/PostFX.js';
import { GpuTimer } from './engine/gpuTimer.js';
import { FullscreenQuad, rawPass } from './engine/fullscreen.js';
import { WaterQuery } from './water/WaterQuery.js';
import { UnderwaterPass } from './water/UnderwaterPass.js';
import { Spray } from './water/Spray.js';
import { MarineSnow } from './water/MarineSnow.js';
import { Floaters } from './scene/floaters.js';
import { FLOATER_KINDS } from './scene/floaterMeshes.js';
import { FloaterShadow } from './scene/floaterShadow.js';
import { WaveCaustics } from './water/Caustics.js';
import { TileField } from './tiles/TileField.js';
import { readTileUrl, writeTileUrl } from './tiles/tileUrl.js';
import { TILE_SOURCES, tilecraftAvailable } from './tiles/tilecraftLoader.js';
import { createTechPanels, isEditing } from './ui/techPanels.js';
import { CameraRig } from './scene/cameraRig.js';
import { islandRadius, islandPose, shorePose, storyPose } from './scene/stationPoses.js';
import { createFrameFocus } from './scene/frameFocus.js';
import { createStationRail } from './ui/stationRail.js';

const REFLECT_LAYER = 1;

const renderer = new THREE.WebGLRenderer({
  antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance',
});
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
// three caps texture units at the per-stage limit (16), but the water's vertex + fragment
// samplers together are 17 (16 in the fragment stage); units only need the combined limit
renderer.capabilities.maxTextures = renderer.getContext().getParameter(WebGL2RenderingContext.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
document.body.appendChild(renderer.domElement);

// one build: phones and tablets (a finger is the main pointer) start on a lighter profile,
// measured on an Adreno 732 to hold 60 fps; ?mobile / ?desktop force either
const args = new URLSearchParams(location.search);
const mobile = args.has('mobile') || (!args.has('desktop') && matchMedia('(pointer: coarse)').matches);
const quality = mobile
  ? { resolution: 0.6, msaa: 2, reflections: true, reflectionScale: 0.35, autoResolution: true }
  : { resolution: 1, msaa: 4, reflections: true, reflectionScale: 0.5 };
document.body.classList.toggle('mobile', mobile);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 80000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 6000;

// The one camera writer (SCENE-UI-SPEC U1, guard OWNER-3): shots, WASD, the ground
// clamp, station flights and the frame drag all go through it.
const rig = new CameraRig({
  camera, controls,
  ground: (x, z) => islandHeight(x, z) + 0.8,
  water: () => camWater,
});
rig.bind(renderer.domElement, isEditing);

// --- world ------------------------------------------------------------------------
const env = createEnvironment(renderer, { cubeSize: 1024 });
// the surf rock as a dome in the bake: the fronts wrap round it, break on its face and
// leave a sheltered lee
const shore = bakeShoreMap(islandHeight, 1800, 512, (x, z) => {
  const q = ((x - heroRock.x) ** 2 + (z - heroRock.z) ** 2) / (8.5 * 8.5);
  return q < 1 ? 4 * (1 - q) : -Infinity;
});
const tex = bakeWaterTextures(renderer);
const ocean = new OceanSim(renderer, defaultOceanParams());
const caustics = new WaveCaustics(renderer, ocean);
const floatShadow = new FloaterShadow();
const surface = new OceanSurface(ocean, shore, env, floatShadow.uniforms);
surface.uniforms.uFoamTex.value = tex.foam;

const scene = new THREE.Scene();
scene.environment = env.cube;
scene.add(env.background);
const terrain = createTerrain({
  env, caustics: caustics.uniforms, floatShadow: floatShadow.uniforms, water: surface.uniforms,
  absorption: surface.uniforms.uAbsorption.value, reflectionLayer: REFLECT_LAYER,
});
scene.add(terrain.group);
surface.uniforms.uRock.value.set(heroRock.x, heroRock.z, 8.5, 0);

const sunLight = new THREE.DirectionalLight(0xffffff, Math.PI);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
Object.assign(sunLight.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 5000 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight, sunLight.target);
surface.uniforms.uShadowMatrix.value = terrain.uniforms.uSunShadowMatrix.value = sunLight.shadow.matrix;
surface.uniforms.uShadowBias.value = 0.05 / (sunLight.shadow.camera.far - sunLight.shadow.camera.near);

// buoyancy: slot 0 of every water query is the camera (underwater test), then floaters
const query = new WaterQuery(renderer, surface, 512);
const floaters = new Floaters({ scene, heightAt: islandHeight, patchMaterial: terrain.patchProp });
const underwater = new UnderwaterPass(surface, camera, caustics.uniforms);
const tiles = new TileField({ scene, renderer, surface, patchMaterial: terrain.patchProp, heightAt: islandHeight, terrainGeometry: terrain.geometry, mobile, floaters, camera, rig });
let camWater = 0, wasSubmerged = false, uwComp = 1;
const look = { underwater: 0.55 };   // exposure compensation under water (auto exposure lifts it to milk otherwise)

const reflection = new PlanarReflection(REFLECT_LAYER);
surface.uniforms.uReflMatrix.value = reflection.textureMatrix;
const emptyReflection = new THREE.DataTexture(new Uint8Array(4), 1, 1);
emptyReflection.needsUpdate = true;

// water pass: draw into the same MSAA buffer, sampling the resolved opaque colour and
// depth. three keeps the MSAA colour after a resolve except on the Oculus browser,
// where it invalidates it; only there is the colour copied back first (costs ~0.5 ms
// at 3.3 MP).
const waterScene = new THREE.Scene();
const restore = new FullscreenQuad(rawPass(/* glsl */`
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`, { uTex: { value: null } }));
restore.mesh.renderOrder = -1;
if (/OculusBrowser/.test(navigator.userAgent)) waterScene.add(restore.mesh);
const spray = new Spray(surface, shore, [...terrain.shoreRocks, { x: heroRock.x, z: heroRock.z, r: 8.5 }]);
const snow = new MarineSnow(surface);
waterScene.add(surface.mesh, spray.mesh, spray.splash, spray.rockSplash, snow.mesh);

const post = new PostFX(renderer);
post.params.bloomStrength = 0.05;
post.params.bloomThreshold = 1.5;
if (mobile) post.params.bloomStrength = 0;   // its 12 passes cost a phone more than this faint glow is worth

let hdrRT = null;
function makeTargets() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  hdrRT?.dispose();
  hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, samples: quality.msaa, generateMipmaps: false,
    depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
  });
  restore.material.uniforms.uTex.value = hdrRT.texture;
  surface.uniforms.uSceneColor.value = hdrRT.texture;
  surface.uniforms.uSceneDepth.value = hdrRT.depthTexture;
  surface.uniforms.uResolution.value.copy(size);
  reflection.scale = quality.reflectionScale;
  reflection.setSize(size.x, size.y);
  post.setSize(size.x, size.y);
  underwater.setSize(size.x, size.y);
}

function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * quality.resolution);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  makeTargets();
}
window.addEventListener('resize', resize);

let sunDirty = true;
const applySunLight = bindSunLight(env, sunLight, renderer);
function applySun() {
  env.update();
  applySunLight();
  sunDirty = false;
}

// --- camera presets -----------------------------------------------------------------
function coast(bearingDeg) {
  const a = THREE.MathUtils.degToRad(bearingDeg);
  let r = 100;
  while (r < 800 && islandHeight(Math.cos(a) * r, Math.sin(a) * r) > 0) r += 2;
  return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
}
function sunBearing() { return Math.atan2(env.sun.direction.z, env.sun.direction.x); }
function setSun(elevation, azimuth) {
  Object.assign(env.params, { elevation, azimuth });
  fSun?.controllers.forEach((c) => c.updateDisplay());
  applySun();
}
// dev shots (Controls → camera): each also sets the sun; the station rail does not
const shotPosition = new THREE.Vector3(), shotTarget = new THREE.Vector3();
const setShot = (px, py, pz, tx, ty, tz) => rig.place(shotPosition.set(px, py, pz), shotTarget.set(tx, ty, tz));
const views = {
  'Golden hour': () => {
    setSun(3.5, 205);
    const b = sunBearing(), c = coast(THREE.MathUtils.radToDeg(b) + 18);
    setShot(c.x + Math.cos(b) * 120, 5, c.y + Math.sin(b) * 120, c.x + Math.cos(b) * 400, 0, c.y + Math.sin(b) * 400);
  },
  'Breakers': () => {
    setSun(38, 205);
    // from 10 m over the clear outer shelf, looking down across the break line to the beach
    const b = sunBearing() + 1.9, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b)), side = new THREE.Vector2(-out.y, out.x);
    setShot(c.x + out.x * 48 - side.x * 35, 10, c.y + out.y * 48 - side.y * 35,
      c.x + out.x * 20 - side.x * 10, 0, c.y + out.y * 20 - side.y * 10);
  },
  'Lagoon': () => {
    setSun(50, 205);
    // the wide, flat shelf on the island's south-west: 1-2 m turquoise shallows, sand bars, soft swash
    const b = sunBearing() - 1.48, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b)), side = new THREE.Vector2(-out.y, out.x);
    setShot(c.x - out.x * 2 + side.x * 25, 16, c.y - out.y * 2 + side.y * 25,
      c.x + out.x * 34 - side.x * 10, 0, c.y + out.y * 34 - side.y * 10);
  },
  'Surf rock': () => {
    setSun(40, 205);
    // the big rock in the surf, from a little above and up the beach side
    const out = new THREE.Vector2(heroRock.x, heroRock.z).normalize(), side = new THREE.Vector2(-out.y, out.x);
    setShot(heroRock.x - out.x * 28 + side.x * 22, 14, heroRock.z - out.y * 28 + side.y * 22, heroRock.x, 0, heroRock.z);
  },
  'Open ocean': () => {
    setSun(14, 205);
    const b = sunBearing() + 0.5;
    setShot(Math.cos(b) * 1500, 9, Math.sin(b) * 1500, Math.cos(b) * 2400, 0, Math.sin(b) * 2400 + 600);
  },
  'Aerial': () => {
    setSun(30, 205);
    setShot(900, 420, 900, 0, 0, 0);
  },
  'Flotsam': () => {
    setSun(40, 205);
    const b = sunBearing() + 1.2, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b)), side = new THREE.Vector2(-out.y, out.x);
    setShot(c.x + out.x * 75 + side.x * 10, 9, c.y + out.y * 75 + side.y * 10,
      c.x + out.x * 53.5 - side.x * 8, 0, c.y + out.y * 53.5 - side.y * 8);
    floaters.spawn(camera.position, controls.target.clone().sub(camera.position));
  },
  'Tiles': () => {
    setSun(40, 205);
    // margin 1.4: the perf panel and the GUI cover the sides
    const pose = storyPose({ center: placeTiles(), extent: tiles.extent, yawDeg: tiles.params.fieldYaw,
      fov: camera.fov, aspect: camera.aspect, margin: 1.4 });
    rig.place(pose.position, pose.target);
  },
  'Underwater': () => {
    setSun(48, 205);
    // on the lee of the island, looking back up the reef slope into the sun (shafts)
    const a = sunBearing() + Math.PI + 0.3;
    let r = 200;
    while (r < 1000 && islandHeight(Math.cos(a) * r, Math.sin(a) * r) > -9) r += 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    setShot(x, -3.2, z, x - Math.cos(a) * 25, -1.8, z - Math.sin(a) * 25);
    floaters.spawn(camera.position, controls.target.clone().sub(camera.position));
  },
};

// tiles go on open water off the Flotsam coast (spec.md §6.5): from that shot's target
// outwards until the bed under the whole field is deep enough. The bearing is taken once,
// so moving the sun later doesn't move the field.
let tilesAnchor = null;
function storyAnchor() {
  if (!tilesAnchor) {
    const b = sunBearing() + 1.2, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b));
    tilesAnchor = { coast: c, start: c.clone().addScaledVector(out, 45), out };
  }
  return tilesAnchor;
}
function placeTiles() {
  const anchor = storyAnchor();
  return tiles.place(anchor.start, anchor.out);
}

// --- station rail (SCENE-UI-SPEC §4) -------------------------------------------------
// Stations never call setSun: the sun and the weather are not the camera's business.
const radius = islandRadius(islandHeight);
function storyField() {
  // the field as placed on load; tiles.place() itself would cancel a drag
  if (!tiles.loaded) return null;
  return { center: tiles.center.clone(), extent: tiles.extent };
}
const stationPoses = {
  island: () => islandPose({ radius, field: storyField(), fov: camera.fov, aspect: camera.aspect }),
  shore: () => {
    const anchor = storyAnchor(), field = storyField();
    // without a story the beach still faces where the field would float
    const facing = field?.center ?? new THREE.Vector3(anchor.start.x, 0, anchor.start.y).addScaledVector(new THREE.Vector3(anchor.out.x, 0, anchor.out.y), 40);
    return shorePose({ heightAt: islandHeight, coast: anchor.coast, out: anchor.out, look: facing });
  },
  story: () => {
    const field = storyField();
    return field && storyPose({ center: field.center, extent: field.extent, yawDeg: tiles.params.fieldYaw,
      fov: camera.fov, aspect: camera.aspect });
  },
};
const storyFrames = createFrameFocus({ tiles, camera });
const stations = createStationRail({
  rig,
  poseOf: (id) => stationPoses[id]?.() ?? null,
  frames: storyFrames,
  isActive: (id) => (id === 'story' ? tiles.loaded : id === 'frame' ? storyFrames.count() > 0 : true),
});

let fSun = null;
// --- GUI -----------------------------------------------------------------------
const gui = new GUI({ title: 'Edge of the Elements' });
if (mobile) gui.close();   // on phones the open panel covers most of the screen
// hidden until F2 / F3, ?controls / ?fps / ?debug or the three-finger strip (SCENE-UI-SPEC §3)
const techPanels = createTechPanels({ gui, perf: document.getElementById('perf'), args });
const ui = { view: 'Lagoon', exposure: 1 };
const viewController = gui.add(ui, 'view', Object.keys(views)).name('camera').onChange((v) => views[v]());

fSun = gui.addFolder('Sun & sky');
fSun.add(env.params, 'elevation', -2, 70, 0.1).onChange(() => (sunDirty = true));
fSun.add(env.params, 'azimuth', 0, 360, 0.5).onChange(() => (sunDirty = true));
fSun.add(env.params, 'sunIntensity', 0, 20, 0.1).onChange(() => (sunDirty = true));
fSun.add(env.params, 'cloudCoverage', 0, 1, 0.01).onChange(() => (sunDirty = true));
fSun.add(env.params, 'turbidity', 1, 10, 0.1).onChange(() => (sunDirty = true));

const op = ocean.params, dirty = () => (ocean.dirty = true);
const fWave = gui.addFolder('Waves');
fWave.add(op, 'windSpeed', 1, 25, 0.1).onChange(dirty);
fWave.add(op, 'windDirection', -180, 180, 1).onChange(dirty);
fWave.add(op, 'fetchKm', 5, 1000, 1).onChange(dirty);
fWave.add(op, 'waveScale', 0, 3, 0.01).onChange(dirty);
fWave.add(op, 'spreadBlend', 0, 1, 0.01).onChange(dirty);
fWave.add(op, 'swellScale', 0, 3, 0.01).onChange(dirty);
fWave.add(op, 'swellDirection', -180, 180, 1).onChange(dirty);
fWave.add(op, 'choppiness', 0, 2, 0.01);
fWave.add(op, 'timeScale', 0, 3, 0.01);

const su = surface.uniforms;
const shoreUi = { amplitude: su.uShoreWave.value.x, wavelength: su.uShoreWave.value.y, speed: su.uShoreWave.value.z, steepness: su.uShoreWave.value.w };
const setShore = () => su.uShoreWave.value.set(shoreUi.amplitude, shoreUi.wavelength, shoreUi.speed, shoreUi.steepness);
const fShore = gui.addFolder('Shore waves');
fShore.add(shoreUi, 'amplitude', 0, 1.5, 0.01).onChange(setShore);
fShore.add(shoreUi, 'wavelength', 8, 60, 0.5).onChange(setShore);
fShore.add(shoreUi, 'speed', 0.3, 2, 0.01).onChange(setShore);
fShore.add(shoreUi, 'steepness', 0, 1.5, 0.01).onChange(setShore);
fShore.add(spray.params, 'amount', 0, 3, 0.01).name('spray');
fShore.add(spray.params, 'size', 0.2, 3, 0.01).name('spray size');

// Water colour presets (linear RGB). The look comes from the per-channel absorption
// (1/m: the channel absorbed least is the colour you see through shallow water), the
// in-scatter colour (deep water, underside, underwater fog), the tint of thin foam and
// the underwater scattering (turbidity). 'clear' is the default look.
const WATER_PRESETS = {
  clear: { absorption: [0.40, 0.062, 0.032], scatter: [0.0, 0.05, 0.08], foam: [0.62, 0.78, 0.82], turbidity: 0.03 },
  tropical: { absorption: [0.36, 0.045, 0.06], scatter: [0.0, 0.085, 0.085], foam: [0.66, 0.86, 0.84], turbidity: 0.02 },
  'toxic green': { absorption: [0.45, 0.1, 1.1], scatter: [0.05, 0.1, 0.004], foam: [0.74, 0.84, 0.42], turbidity: 0.08 },
  purple: { absorption: [0.22, 0.85, 0.1], scatter: [0.05, 0.0, 0.09], foam: [0.8, 0.66, 0.88], turbidity: 0.04 },
  'rust orange': { absorption: [0.1, 0.34, 1.2], scatter: [0.11, 0.035, 0.004], foam: [0.9, 0.72, 0.55], turbidity: 0.1 },
  'murky brown': { absorption: [0.55, 0.62, 0.9], scatter: [0.045, 0.045, 0.022], foam: [0.78, 0.74, 0.6], turbidity: 0.25 },
};

const fWater = gui.addFolder('Water');
const w = {
  preset: 'clear',
  roughness: su.uOptics.value.x, refraction: su.uOptics.value.y, reflectionDistort: su.uOptics.value.z,
  sssPeak: su.uSSS.value.x, sssView: su.uSSS.value.y,
  foamBias: su.uFoam.value.x, foamScale: su.uFoam.value.y, shoreFoamBand: su.uFoam.value.z,
  foamRecovery: op.foamRecovery, caustics: terrain.uniforms.uCausticStrength.value,
  scatter: '#' + su.uScatterColor.value.getHexString(),
  clarity: 1,
};
const absorptionBase = su.uAbsorption.value.clone();
const setWater = () => {
  su.uOptics.value.x = w.roughness; su.uOptics.value.y = w.refraction; su.uOptics.value.z = w.reflectionDistort;
  su.uSSS.value.x = w.sssPeak; su.uSSS.value.y = w.sssView;
  su.uFoam.value.x = w.foamBias; su.uFoam.value.y = w.foamScale; su.uFoam.value.z = w.shoreFoamBand;
  op.foamRecovery = w.foamRecovery;
  terrain.uniforms.uCausticStrength.value = w.caustics;
  su.uScatterColor.value.set(w.scatter);
  su.uAbsorption.value.copy(absorptionBase).multiplyScalar(1 / w.clarity);
};
const applyPreset = () => {
  const p = WATER_PRESETS[w.preset];
  absorptionBase.fromArray(p.absorption);
  w.scatter = '#' + new THREE.Color().fromArray(p.scatter).getHexString();
  su.uFoamTint.value.fromArray(p.foam);
  underwater.params.scattering = p.turbidity;
  setWater();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
};
fWater.add(w, 'preset', Object.keys(WATER_PRESETS)).name('colour preset').onChange(applyPreset);
fWater.add(w, 'clarity', 0.2, 4, 0.01).onChange(setWater);
fWater.addColor(w, 'scatter').onChange(setWater);
fWater.add(w, 'roughness', 0.005, 0.2, 0.001).onChange(setWater);
fWater.add(w, 'refraction', 0, 0.2, 0.001).onChange(setWater);
fWater.add(w, 'reflectionDistort', 0, 0.2, 0.001).onChange(setWater);
fWater.add(w, 'sssPeak', 0, 6, 0.01).onChange(setWater);
fWater.add(w, 'sssView', 0, 0.5, 0.001).onChange(setWater);
fWater.add(w, 'foamBias', -0.5, 1.5, 0.01).onChange(setWater);
fWater.add(w, 'foamScale', 0, 6, 0.01).onChange(setWater);
fWater.add(w, 'foamRecovery', 0.05, 3, 0.01).onChange(setWater);
fWater.add(w, 'shoreFoamBand', 0, 2, 0.01).onChange(setWater);
fWater.add(w, 'caustics', 0, 2, 0.01).onChange(setWater);
fWater.add(su.uGlint, 'value', 0, 1, 0.01).name('glitter');

const fFloat = gui.addFolder('Floaters & underwater');
const ahead = (d) => {
  const f = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  return camera.position.clone().addScaledVector(f, d);
};
const floatUi = {
  spawn: () => floaters.spawn(camera.position, camera.getWorldDirection(new THREE.Vector3())),
  drop: () => floaters.add(FLOATER_KINDS[Math.floor(Math.random() * FLOATER_KINDS.length)], ahead(14).setY(Math.max(camWater, 0) + 4)),
  clear: () => floaters.clear(),
};
fFloat.add(floatUi, 'spawn').name('spawn flotsam ahead');
fFloat.add(floatUi, 'drop').name('drop random prop');
fFloat.add(floatUi, 'clear');
fFloat.add(floaters.params, 'drag', 0, 6, 0.01);
fFloat.add(floaters.params, 'angularDrag', 0, 4, 0.01);
fFloat.add(floaters.params, 'buoyancy', 0, 2, 0.01);
fFloat.add(underwater.params, 'scattering', 0, 0.5, 0.001);
fFloat.add(underwater.params, 'shafts', 0, 4, 0.01);
fFloat.add(underwater.params, 'shaftRange', 5, 120, 1);
fFloat.add(underwater.params, 'meniscus', 0, 1, 0.01);
fFloat.add(look, 'underwater', 0.2, 2, 0.01).name('underwater exposure');

// Tilecraft models on the water (spec.md §8); ?tiles=<fixture> picks one, bare ?tiles the hibrid
const fTiles = gui.addFolder('Tiles');
readTileUrl(args, tiles.params);
let tilesUrlSource = args.has('tiles') ? args.get('tiles') || TILE_SOURCES[0] : 'none';
const saveTilesUrl = () => writeTileUrl(tilesUrlSource, tiles.params);
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
const tilesUi = {
  source: args.has('tiles') ? args.get('tiles') || TILE_SOURCES[0] : 'none',
  get status() { return tiles.status; },
};
let frameController = null;
async function loadTiles(source) {
  tilesUrlSource = source;
  tilesUi.source = source instanceof File ? 'file…' : source;
  sourceController.updateDisplay();
  await tiles.load(source);
  frameController = frameController.options(['all', ...tiles.frames]).onChange(rebuildTiles);
  frameController.updateDisplay();
  if (tiles.loaded) placeTiles();
  saveTilesUrl();
}
async function rebuildTiles() {
  await tiles.rebuild();
  if (tiles.loaded) placeTiles();
  saveTilesUrl();
}
fileInput.onchange = () => fileInput.files[0] && loadTiles(fileInput.files[0]);
const sourceController = fTiles.add(tilesUi, 'source', ['none', ...TILE_SOURCES, 'file…']).onChange((v) => {
  if (v === 'file…') fileInput.click();
  else loadTiles(v);
});
if (!tilecraftAvailable) sourceController.disable();
frameController = fTiles.add(tiles.params, 'frame', [...new Set(['all', tiles.params.frame])]).onChange(rebuildTiles);
fTiles.add(tiles.params, 'mode', ['anchored', 'drift']).onChange((mode) => tiles.setMode(mode));
fTiles.add(tiles.params, 'metersPerSourceUnit', 0.01, 0.5, 0.005).onFinishChange(rebuildTiles);
fTiles.add(tiles.params, 'fieldYaw', -180, 180, 1).onChange(() => tiles.loaded && placeTiles());
fTiles.add(tiles.params, 'density', 100, 1000, 10);
fTiles.add(tiles.params, 'buoyancy', 0, 3, 0.05);
fTiles.add(tiles.params, 'drag', 0, 10, 0.1);
fTiles.add(tiles.params, 'angularDrag', 0, 5, 0.1);
fTiles.add(tiles.params, 'orbit', 0, 1, 0.01);
fTiles.add(tiles.params, 'anchorPeriod', 0.5, 20, 0.1);
fTiles.add(tiles.params, 'windage', 0, 0.1, 0.001);
fTiles.add(tiles.params, 'driftRadius', 50, 1000, 10);
fTiles.onFinishChange(saveTilesUrl);
fTiles.add({ reset: () => tiles.reset() }, 'reset');
fTiles.add({ get selectedFrame() {
  const f = tiles.interaction?.selected;
  return f ? `${String(f.id)} · ${f.mode}` : '—';
} }, 'selectedFrame').disable().listen();
fTiles.add({ releaseToDrift: () => {
  const f = tiles.interaction?.selected;
  if (f) { tiles.interaction.cancel(); tiles.releaseFrame(f.id); }
} }, 'releaseToDrift').name('Відпустити у дрейф');
fTiles.add(tilesUi, 'status').disable().listen();
if (!args.has('tiles')) fTiles.close();
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && tilecraftAvailable) loadTiles(file);
});

const fPost = gui.addFolder('Post');
fPost.add(ui, 'exposure', 0.25, 4, 0.01).name('exposure comp');
fPost.add(post.params, 'autoExposure');
fPost.add(post.params, 'keyValue', 0.05, 0.6, 0.01);
fPost.add(post.params, 'bloomStrength', 0, 0.5, 0.001);
fPost.add(post.params, 'bloomThreshold', 0, 10, 0.01);
fPost.add(post.params, 'contrast', 0.7, 1.6, 0.01);
fPost.add(post.params, 'saturation', 0, 2, 0.01);

const fQ = gui.addFolder('Quality');
const resController = fQ.add(quality, 'resolution', 0.25, 1, 0.05).onFinishChange(resize);
if (mobile) fQ.add(quality, 'autoResolution').name('auto resolution');
fQ.add(quality, 'msaa', [2, 4, 8]).onChange(makeTargets);   // water samples the resolve, so MSAA is required
fQ.add(quality, 'reflections');
fQ.add(quality, 'reflectionScale', 0.25, 1, 0.05).onFinishChange(makeTargets);
[fWave, fShore, fWater, fFloat, fPost].forEach((f) => f.close());

// --- frame ---------------------------------------------------------------------
const gl = renderer.getContext();
const timer = new GpuTimer(gl);
let elapsed = 0;
renderer.domElement.addEventListener('webglcontextlost', () => timer.reset());
renderer.domElement.addEventListener('webglcontextrestored', () => {
  renderer.capabilities.maxTextures = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  timer.reset();
  // Render targets survive as JS objects, but their GPU contents do not.
  ocean.dirty = true;
  sunDirty = true;
  floatShadow.ready = false;
  tex.foam.dispose();
  tex.foam = bakeWaterTextures(renderer).foam;
  surface.uniforms.uFoamTex.value = tex.foam;
});

function renderFrame(dt) {
  if (gl.isContextLost()) return;
  elapsed += dt;
  timer.beginFrame();
  // inside the timer's frame, so a sky change shows as its own `sky` line (E0)
  if (sunDirty) { timer.begin('sky'); applySun(); }

  // latest water heights (1-3 frames old) drive the camera test and the floaters
  if (query.resultCount > 0) camWater = query.result[0];
  floaters.ingest(query, 1);
  floaters.step(dt);

  // water entries -> ripple rings + splash (ages on the floaters' clock)
  for (let i = 0; i < 8; i++) {
    const e = floaters.impacts[i], age = e ? floaters.time - e.t : 1e9;
    su.uImpact.value[i].set(e?.x ?? 0, e?.z ?? 0, age, age < 30 ? e.amp : 0);
    su.uImpactSize.value[i] = e?.size ?? 1;
  }

  ocean.update(dt, timer);
  timer.begin('caustics');
  caustics.update(env.sun.direction);
  surface.update(camera, elapsed % 3600);
  if (tiles.loaded) {
    tiles.update(dt, timer);
  }
  timer.begin('floatShadow');
  floatShadow.update(renderer, floaters.scene, floaters.bodies, env.sun.direction, tiles);
  spray.update();
  timer.begin('query');
  const pts = floaters.collectPoints([camera.position]);
  query.submit(pts, floaters.count, floaters.layout, elapsed);

  const camY = camera.position.y;
  const submerged = camY < camWater - 0.3, nearSurface = camY < camWater + 1.2;
  su.uCamSide.value = camY > camWater + 0.5 ? -1 : camY < camWater - 0.5 ? 1 : 0;
  snow.update(camera, hdrRT.height, nearSurface);
  uwComp += ((submerged ? look.underwater : 1) - uwComp) * Math.min(1, dt * 3);
  post.params.exposure = ui.exposure * uwComp;
  // water on the lens for a few seconds after surfacing
  post.params.droplets = wasSubmerged && !submerged ? 1 : submerged ? 0 : Math.max(0, post.params.droplets - dt / 5);
  wasSubmerged = submerged;

  timer.begin('reflection');
  if (quality.reflections && !submerged) {
    reflection.render(renderer, scene, camera);
    su.uReflection.value = reflection.target.texture;
  } else su.uReflection.value = emptyReflection;

  timer.begin('opaque');
  renderer.setRenderTarget(hdrRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);

  timer.begin('water');
  su.uShadowMap.value = sunLight.shadow.map.depthTexture;
  hdrRT.resolveDepthBuffer = nearSurface;   // only the underwater pass needs depth with water
  renderer.render(waterScene, camera);
  hdrRT.resolveDepthBuffer = true;

  let frame = hdrRT.texture;
  if (nearSurface) {
    timer.begin('underwater');
    frame = underwater.render(renderer, hdrRT, camY < camWater - 0.8);
  }

  timer.begin('post');
  post.render(frame, dt);
  timer.endFrame();
}

// Chrome/ANGLE's readPixels and finish don't wait for the GPU, so sync on a fence.
async function gpuFence() {
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  const deadline = performance.now() + 10000;
  try {
    let status;
    while ((status = gl.clientWaitSync(s, 0, 0)) === gl.TIMEOUT_EXPIRED) {
      if (performance.now() > deadline || gl.isContextLost()) throw new Error('GPU fence timeout/context lost');
      // Опитування GPU fence послідовне за природою: наступна спроба лише після паузи.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await new Promise((r) => setTimeout(r, 1));
    }
    if (status === gl.WAIT_FAILED) throw new Error('GPU fence failed');
  } finally { gl.deleteSync(s); }
}

// frames back-to-back (render loop paused), timed to GPU completion; also returns the
// per-pass GPU times measured at full clocks
let benchmarking = false;
async function runBenchmark(frames = 300, { shot, warmup = 20 } = {}) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 300 || !Number.isInteger(warmup) || warmup < 0 || warmup > 20) throw new Error('Benchmark limits: frames 1..300, warmup 0..20');
  if (shot && !Object.hasOwn(views, shot)) throw new Error(`Unknown shot: ${shot}`);
  if (benchmarking) return null;
  if (shot === 'Tiles' && !tiles.loaded) throw new Error('Load tiles before the Tiles benchmark');
  if (shot) { ui.view = shot; views[shot](); viewController.updateDisplay(); }
  benchmarking = true;
  try {
  timer.drain();
  for (let i = 0; i < warmup; i++) renderFrame(1 / 200);
  await gpuFence();
  timer.drain();
  timer.keep = true;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) renderFrame(1 / 200);
  await gpuFence();
  const ms = (performance.now() - t0) / frames;
  const passes = timer.drain();
  timer.keep = false;
  benchmarking = false;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const gpu = Object.values(passes).reduce((a, b) => a + b, 0);
  bench = `benchmark ${ms.toFixed(2)} ms/frame = ${(1000 / ms).toFixed(0)} fps${timer.available ? ` (GPU ${gpu.toFixed(2)} ms)` : ''}`
    + Object.entries(passes).map(([k, v]) => `
  ${k.padEnd(12)} ${v.toFixed(3)} ms`).join('');
  console.log(`${size.x}×${size.y} ${bench}`);
  return { ms, gpu: timer.available ? gpu : null, passes, frames, warmup, shot: ui.view,
    viewport: { width: size.x, height: size.y }, quality: { ...quality },
    tiles: { source: tiles.source, count: tiles.rest?.tiles.count ?? 0, runs: tiles.sim?.runCount ?? 0,
      profile: tiles.profile, limits: tiles.sim?.profile ?? null, cpuSubmitMs: tiles.cpuMs,
      compileMs: tiles.compiled?.compileMs ?? null } };
  } finally { timer.keep = false; benchmarking = false; }
}
window.runBenchmark = runBenchmark;

// SCENE-ENVIRONMENT E0: cost of one sky change by step, render loop paused like the benchmark
/** @param {{ repeats?: number }} [options] */
async function measureSky({ repeats } = {}) {
  if (benchmarking) return null;
  benchmarking = true;
  try {
    await gpuFence();
    return await measureEnvironment({ renderer, env, scene, camera, light: sunLight, fence: gpuFence,
      steps: { spectrum: () => ocean.updateSpectrum() }, repeats });
  } finally { benchmarking = false; }
}
// SCENE-ENVIRONMENT E1: with ?still the loop never starts and app.still() renders `frames` frames
// at a fixed dt from load (waiting for the GPU and the water readback after each), so two builds
// give the same pixels. Returns the last frame as RGBA bytes (base64), read before it is shown.
const stillMode = args.has('still');
/** @param {{ shot?: string, frames?: number, dt?: number }} [options] */
async function still({ shot, frames = 60, dt = 1 / 60 } = {}) {
  if (!stillMode) throw new Error('app.still needs ?still');
  if (!Number.isInteger(frames) || frames < 1 || frames > 600) throw new Error('app.still: frames 1..600');
  if (shot && !Object.hasOwn(views, shot)) throw new Error(`Unknown shot: ${shot}`);
  if (shot) { ui.view = shot; views[shot](); viewController.updateDisplay(); }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const px = new Uint8Array(size.x * size.y * 4);
  for (let i = 0; i < frames; i++) {
    rig.update(dt);
    renderFrame(dt);
    if (i === frames - 1) {
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    // the readback of the water heights lands before the next frame, every time
    // oxlint-disable-next-line eslint/no-await-in-loop
    await gpuFence();
    // oxlint-disable-next-line eslint/no-await-in-loop
    await new Promise((r) => setTimeout(r, 10));
  }
  let bin = '';
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  return { width: size.x, height: size.y, rgba: btoa(bin), shot: ui.view };
}
window.app = {
  still,
  camera, controls, env, post, surface, ocean, terrain, timer, views, quality, renderer, floaters, query, underwater, spray, snow, caustics, floatShadow, tiles,
  camWater: () => camWater, markSun: () => (sunDirty = true), techPanels, measureEnvironment: measureSky,
  rig, stations: { go: stations.go, nextFrame: stations.nextFrame, prevFrame: stations.prevFrame,
    get current() { return stations.current; }, get last() { return stations.last; }, get focus() { return stations.focus; } },
};

// --- HUD + loop ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), graph = $('pGraph').getContext('2d'), uncapButton = $('pUncap'), fpsHistory = [];
let bench = '', frames = 0, lastHud = performance.now(), last = performance.now(), uncapped = false;
$('pGpu').textContent = (() => {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
  return raw.split(', ')[1]?.replace(/ \(0x.*$/, '') || raw;   // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x2504) ...)"
})();
bindPanelCopy($('perf'));   // double tap copies the panel text (phones can't select it)
// E0: the owner's phone has no devtools — the button prints the step table into the HUD
$('pSky').onclick = async () => {
  bench = 'measuring sky…';
  const m = await measureSky();
  if (!m) return;
  bench = `sky change (ms, ${m.repeats}×): lut ${m.lut.toFixed(2)}  cube ${m.cube.toFixed(2)}  pmrem ${m.pmrem.toFixed(2)}  pmrem256 ${m.pmrem256.toFixed(2)}`
    + `
  shadow ${m.shadow.toFixed(2)}  spectrum ${m.spectrum.toFixed(2)}  (${m.viewport.width}×${m.viewport.height})`;
  console.log(bench);
};
uncapButton.onclick = () => {
  uncapped = !uncapped;
  uncapButton.textContent = uncapped ? 'Cap to display' : 'Uncap FPS';
  uncapButton.classList.toggle('on', uncapped);
  fpsHistory.length = 0;
};
function updateHud(now) {
  const fps = (frames * 1000) / (now - lastHud);
  frames = 0;
  lastHud = now;
  fpsHistory.push(fps);
  if (fpsHistory.length > 40) fpsHistory.shift();
  if (!techPanels.fps) return;   // a hidden panel gets no DOM writes; timers and the benchmark run on
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  $('pSpec').textContent = `${size.x}×${size.y} · ${quality.msaa}× MSAA · ${mobile ? 'mobile' : 'desktop'} profile`;
  $('pFps').textContent = fps.toFixed(0);
  $('pMode').textContent = uncapped ? 'UNCAPPED' : 'VSYNC';
  $('pMs').textContent = `${(1000 / fps).toFixed(2)} ms/frame`;
  const { width: cw, height: ch } = graph.canvas, lo = Math.min(...fpsHistory) * 0.9, hi = Math.max(...fpsHistory) * 1.05;
  graph.clearRect(0, 0, cw, ch);
  graph.beginPath();
  fpsHistory.forEach((v, i) => graph.lineTo((cw * i) / Math.max(1, fpsHistory.length - 1), ch - (ch * (v - lo)) / (hi - lo || 1)));
  graph.strokeStyle = '#2cc9ff';
  graph.lineWidth = 3;
  graph.stroke();
  let text = '';
  if (tiles.loaded) text += `Tiles CPU submit ${tiles.cpuMs.toFixed(3)} ms\n`;
  if (timer.available && timer.total > 0) {
    // at vsync the GPU downclocks, so these read high; uncapped or the benchmark measure at full clocks
    text += `GPU timers ${timer.total.toFixed(2)} ms${uncapped ? '' : ' (vsync-idle clocks)'}`;
    for (const [k, v] of Object.entries(timer.ms)) text += `\n  ${k.padEnd(10)} ${v.toFixed(3)} ms`;
  }
  if (bench) text += `${text ? '\n' : ''}${bench}`;
  hud.textContent = text;
}

// mobile: hold 60 fps by stepping resolution down from the profile's, judged over 2 s
// windows (a frame over 20 ms is a missed vsync), and back up once frames are clean again.
// Still missing at the floor, render every other vsync for a steady 30.
const auto = { n: -240, missed: 0, clean: 0, top: quality.resolution, cap30: false, odd: false };   // skip startup
function autoResolution(ms) {
  if (ms > 250) return;   // tab switch or benchmark, not load
  if (++auto.n <= 0) return;
  if (ms > (auto.cap30 ? 40 : 20)) auto.missed++;
  if (auto.n < 120 || auto.cap30) return;
  const r = quality.resolution, miss = auto.missed / auto.n;
  auto.n = auto.missed = 0;
  if (miss > 0.04) {
    auto.clean = 0;
    if (r > 0.5) setResolution(r - 0.05);
    else if (miss > 0.25) auto.cap30 = true;
  } else if (miss <= 0.01 && ++auto.clean >= 3 && r < auto.top) {
    auto.clean = 0;
    setResolution(r + 0.05);
  }
}
function setResolution(r) {
  quality.resolution = Math.round(r * 20) / 20;
  resController.updateDisplay();
  resize();
  auto.n = -60;   // the resize hitches; let it settle
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  rig.update(dt);
  stations.update();
  renderFrame(dt);
  frames++;
  if (now - lastHud > 500) updateHud(now);
}

function loop(now) {
  if (uncapped) { spin(); return; }
  if (auto.cap30 && (auto.odd = !auto.odd)) { requestAnimationFrame(loop); return; }
  if (benchmarking) last = now;
  else {
    if (quality.autoResolution) autoResolution(now - last);
    tick(now);
  }
  requestAnimationFrame(loop);
}

// uncapped: frames back-to-back off the display's clock (it still shows the latest one at
// each refresh), at most three in flight so the counter reads frames the GPU finished
const fences = [], chan = new MessageChannel();
chan.port1.onmessage = spin;
function spin() {
  if (!uncapped || document.hidden || gl.isContextLost()) {   // back to rAF until rendering can resume
    fences.splice(0).forEach((s) => gl.deleteSync(s));
    requestAnimationFrame(loop);
    return;
  }
  while (fences.length && gl.clientWaitSync(fences[0], 0, 0) !== gl.TIMEOUT_EXPIRED) gl.deleteSync(fences.shift());
  if (fences.length < 3 && !benchmarking) {
    tick(performance.now());
    fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
    gl.flush();
  }
  chan.port2.postMessage(0);
}

resize();
applySun();
views[ui.view]();
// a link with ?tiles opens on the field once it has loaded and been placed
if (tilesUi.source !== 'none') loadTiles(tilesUi.source).then(() => tiles.loaded && viewController.setValue('Tiles'));
if (!stillMode) requestAnimationFrame(loop);
