import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { OceanSim, defaultOceanParams } from './water/OceanSim.js';
import { OceanSurface } from './water/OceanSurface.js';
import { bakeShoreMap } from './water/shoreMap.js';
import { bakeWaterTextures } from './water/bakeTextures.js';
import { createEnvironment, flowDay, measureEnvironment, MOOD_MAP_V1, moodTau, QUIET, SUN_PATH_V1, sampleMood, stepToward, sunAt, worldArousal } from './environment/index.js';
import { bindSunLight } from './environment-bindings/hostBinding.js';
import { bindSea, WATER_PRESETS } from './environment-bindings/seaBinding.js';
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
import { TileMiniatures } from './tiles/TileMiniatures.js';
import { TileRaft } from './tiles/TileRaft.js';
import { TileFates } from './tiles/TileFates.js';
import { FATE, KINDS as FATE_KINDS } from './tiles/frameFate.js';
import { readTileUrl, writeTileUrl } from './tiles/tileUrl.js';
import { TILE_SOURCES, tilecraftAvailable } from './tiles/tilecraftLoader.js';
import { createStoryCatalog } from './catalog/index.js';
import { createTechPanels, isEditing } from './ui/techPanels.js';
import { CameraRig } from './scene/cameraRig.js';
import { TerrainContact } from './scene/TerrainContact.js';
import { createWalkerHost } from './walker/index.js';
import { deckAtHand, deckClear } from './walker/deck.js';
import { createWalkerStick, LABELS as STICK_LABELS } from './walker/stick.js';
import { islandRadius, islandPose, shorePose, storyPose } from './scene/stationPoses.js';
import { createFrameFocus } from './scene/frameFocus.js';
import { createStationRail, railLanguage } from './ui/stationRail.js';
import { createMoodPad } from './environment/ui/moodPad.js';

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
const SHORE_EXTENT = 1800;   // m: the shore map's square; past its edge the sea is open (STORY-QUEST §4.3)
const shore = bakeShoreMap(islandHeight, SHORE_EXTENT, 512, (x, z) => {
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
// the IBL: PMREM of a 64² bake, re-made every cycle of cube faces while the sky moves (E2); the water reads env.cube
scene.environment = env.envMap;
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
let camWater = 0, walkerWater = 0, wasSubmerged = false, uwComp = 1;
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

const applySunLight = bindSunLight(env, sunLight, renderer);
// at once: what env.set() asked for (shots, sliders, app.mood) is baked and lit before returning
function applySun() {
  applySunLight(env.update(0), 0);
}

// --- camera presets -----------------------------------------------------------------
function coast(bearingDeg) {
  const a = THREE.MathUtils.degToRad(bearingDeg);
  let r = 100;
  while (r < 800 && islandHeight(Math.cos(a) * r, Math.sin(a) * r) > 0) r += 2;
  return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
}
// The shots and the story field face the sunset azimuth (SUN_PATH_V1.setAzimuth, 205°), not
// wherever the sun is now: the time of day must not move them (MOOD-WEATHER-SPEC §2.2, §6 p.10).
// atan2(dir.z, dir.x) of the sun at that azimuth, at any elevation.
const SET_BEARING = THREE.MathUtils.degToRad(90 - SUN_PATH_V1.setAzimuth);
function setSun(elevation, azimuth) {
  env.set({ elevation, azimuth });
  fSun?.controllers.forEach((c) => c.updateDisplay());
  applySun();
}
// dev shots (Controls → camera): each also sets the sun; the station rail does not
const shotPosition = new THREE.Vector3(), shotTarget = new THREE.Vector3();
const setShot = (px, py, pz, tx, ty, tz) => rig.place(shotPosition.set(px, py, pz), shotTarget.set(tx, ty, tz));
const views = {
  'Golden hour': () => {
    setSun(3.5, 205);
    const b = SET_BEARING, c = coast(THREE.MathUtils.radToDeg(b) + 18);
    setShot(c.x + Math.cos(b) * 120, 5, c.y + Math.sin(b) * 120, c.x + Math.cos(b) * 400, 0, c.y + Math.sin(b) * 400);
  },
  'Breakers': () => {
    setSun(38, 205);
    // from 10 m over the clear outer shelf, looking down across the break line to the beach
    const b = SET_BEARING + 1.9, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b)), side = new THREE.Vector2(-out.y, out.x);
    setShot(c.x + out.x * 48 - side.x * 35, 10, c.y + out.y * 48 - side.y * 35,
      c.x + out.x * 20 - side.x * 10, 0, c.y + out.y * 20 - side.y * 10);
  },
  'Lagoon': () => {
    setSun(50, 205);
    // the wide, flat shelf on the island's south-west: 1-2 m turquoise shallows, sand bars, soft swash
    const b = SET_BEARING - 1.48, c = coast(THREE.MathUtils.radToDeg(b));
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
    const b = SET_BEARING + 0.5;
    setShot(Math.cos(b) * 1500, 9, Math.sin(b) * 1500, Math.cos(b) * 2400, 0, Math.sin(b) * 2400 + 600);
  },
  'Aerial': () => {
    setSun(30, 205);
    setShot(900, 420, 900, 0, 0, 0);
  },
  'Flotsam': () => {
    setSun(40, 205);
    const b = SET_BEARING + 1.2, c = coast(THREE.MathUtils.radToDeg(b));
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
    const a = SET_BEARING + Math.PI + 0.3;
    let r = 200;
    while (r < 1000 && islandHeight(Math.cos(a) * r, Math.sin(a) * r) > -9) r += 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    setShot(x, -3.2, z, x - Math.cos(a) * 25, -1.8, z - Math.sin(a) * 25);
    floaters.spawn(camera.position, controls.target.clone().sub(camera.position));
  },
};

// tiles go on open water off the Flotsam coast (spec.md §6.5): from that shot's target
// outwards until the bed under the whole field is deep enough. The bearing is the fixed
// SET_BEARING, so the time of day before or after loading doesn't move the field.
let tilesAnchor = null;
function storyAnchor() {
  if (!tilesAnchor) {
    const b = SET_BEARING + 1.2, c = coast(THREE.MathUtils.radToDeg(b));
    const out = new THREE.Vector2(Math.cos(b), Math.sin(b));
    tilesAnchor = { coast: c, start: c.clone().addScaledVector(out, 45), out };
  }
  return tilesAnchor;
}
function placeTiles() {
  const anchor = storyAnchor();
  return tiles.place(anchor.start, anchor.out);
}

// --- walker (story-quest Q2a, Q2b) ----------------------------------------------------
// Feet on the mesh as drawn (TerrainContact, as the tiles touch it), not on islandHeight.
// The walker appears on the beach of the story coast, facing the field. The start (Q2b,
// STORY-QUEST-SPEC §2 п.2): the camera flies up to the island overview, holds it a moment
// and goes down into the eyes; V (or the GUI button, or the touch button) is out of the body
// and back into the same eyes, smoothly.
// Built on first use: ~11 ms on a desktop (Q2a), a scene without the walker never pays it.
let groundContact = null;
const walkGround = (x, z) => (groundContact ??= new TerrainContact(terrain.geometry, terrain.geometry.parameters.width)).at(x, z);
let walkerHost = null, walkerLoading = null, walkerStick = null;
const OVERVIEW_HOLD = 1200;   // ms on the island overview before the descent
function walkerSpawn() {
  const { coast: c } = storyAnchor(), out = storyAnchor().out;
  const inward = new THREE.Vector2(-c.x, -c.y).normalize();
  const p = c.clone();
  for (let i = 0; i < 400 && (walkGround(p.x, p.y)?.height ?? -1) < 1; i++) p.addScaledVector(inward, 0.5);
  return { x: p.x, z: p.y, yaw: Math.atan2(out.x, out.y) };
}
async function walkerReady() {
  walkerLoading ??= createWalkerHost({ scene, rig, ground: walkGround, canvas: renderer.domElement, isEditing,
    decks: () => raft?.decks() ?? [],
    pull: { active: () => !!raft?.kite.up, course: (dir) => raft?.course(dir) }, water: () => walkerWater });
  walkerHost = await walkerLoading;
  if (walkerHost.mode === 'off') {
    const spawn = walkerSpawn();
    walkerHost.place(spawn.x, spawn.z, spawn.yaw);
  }
  // touch controls on phones (?stick forces them, ?stick=0 drops them)
  const stickArg = args.get('stick');
  if (!walkerStick && (args.has('stick') ? stickArg !== '0' : mobile)) {
    walkerStick = createWalkerStick({ host: walkerHost, onToggle: () => walk().catch((e) => console.error('[walker]', e)),
      action: { hint: () => miniHint() ?? kiteHint(), run: () => miniAction() ?? kiteAction() },
      flight: { hint: flyHint, run: flyAction },
      fates: { hints: fateHints, run: runFate },
      labels: (navigator.language ?? '').toLowerCase().startsWith('uk') ? STICK_LABELS.uk : STICK_LABELS.en });
    document.body.classList.add('walker-controls');
  }
  return walkerHost;
}
/** Out of the body and back (V, the GUI, the touch button). */
async function walk() {
  const host = await walkerReady();
  host.toggleEyes();
  return host;
}
/**
 * The start: island overview → down into the eyes. Resolves once the descent has begun; the
 * host is 'boarding', then 'eyes'. A touch during the overview flight cuts it short, the
 * descent still follows; already in the eyes — nothing to do.
 */
async function startWalk({ overview = true } = {}) {
  const host = await walkerReady();
  if (host.mode === 'eyes' || host.mode === 'boarding') return host;
  if (overview) {
    if (await rig.flyTo(stationPoses.island())) await new Promise((r) => setTimeout(r, OVERVIEW_HOLD));
    if (host.mode === 'eyes' || host.mode === 'boarding') return host;
  }
  host.enterEyes({ approach: overview ? 4 : true });
  return host;
}
// --- miniatures (story-quest Q3) -------------------------------------------------------
// With ?minis a loaded story lies on the island as miniatures around the walker's spawn
// (seed = the story id); G takes the nearest one within reach or puts the carried one down —
// under the sea it unfolds into the frame on the water (TileMiniatures.js).
let minis = null;
/** The loaded story's frames → miniatures (again, all of them); null without a story. */
function layoutMinis() {
  if (!tiles.loaded) { minis?.clear(); return null; }
  minis ??= new TileMiniatures(tiles, { ground: walkGround, scene, freeAt: (x, z, r) => deckClear(raft?.decks() ?? [], x, z, r) });
  const spawn = walkerSpawn();
  minis.layout(String(tiles.source), { x: spawn.x, z: spawn.z });
  return minis;
}
/** G and the touch button: take the nearest miniature or put the carried one down. */
function miniAction() {
  if (!minis?.active || walkerHost?.mode !== 'eyes') return null;
  const s = walkerHost.state;
  if (minis.carried) return minis.put(s);
  const near = minis.nearest(s.x, s.z);
  return near ? (minis.take(near.frameId, s) && 'carried') : null;
}
/** What the button would do now: 'take', 'put' or null. */
function miniHint() {
  if (!minis?.active || walkerHost?.mode !== 'eyes') return null;
  const s = walkerHost.state;
  return minis.carried ? 'put' : minis.nearest(s.x, s.z) ? 'take' : null;
}
// --- raft and kite (story-quest Q4) --------------------------------------------------
// Every frame drawn on the water is a deck: a step onto it boards it. On a deck K (or the
// touch button) puts the kite up: the walk input is then its course and it pulls the raft
// there; K again lets go and the raft drifts (TileRaft.js). Past the edge of the shore map
// the walker on the raft is in the open sea (the 'sea' event).
let raft = null;
function raftUpdate(dt) {
  if (!raft && tiles.loaded) raft = new TileRaft(tiles, { ground: walkGround, scene, seaEdge: SHORE_EXTENT / 2 });
  raft?.update(dt, walkerHost && walkerHost.mode !== 'off' ? walkerHost.state : null);
}
/** K and the touch button: the kite up or let go, on a deck in the eyes; in the air, K lands. */
function kiteAction() {
  if (walkerHost?.state.flight) return flyAction() && 'unkite';
  if (!raft?.boarded || walkerHost?.mode !== 'eyes') return null;
  return raft.toggleKite() ? 'kite' : 'unkite';
}
/** What the button would do now for the kite: 'kite' (up), 'unkite' (let go) or null. */
function kiteHint() {
  if (walkerHost?.state.flight) return null;   // the flight button lands
  if (!raft?.boarded || walkerHost?.mode !== 'eyes') return null;
  return raft.kite.up ? 'unkite' : 'kite';
}
// Q4b (STORY-QUEST-SPEC §2 п.6, §4.2 v1.5): on a raft with the kite up, Space (or the touch
// button «Take off») lifts the walker on the board; in the air Space lands — on a deck under
// it, or by itself over wadeable ground.
// Q5b (§2 п.6 «Плавання й пірнання»): over deep water Space (K, «Into the water») lets the kite
// go and the walker is in the water; on a deck with the kite down Space jumps off the rim
// ahead into it; in the water Space dives 3 m deeper, or under the water goes to the surface.
/** Space and the touch button: 'fly', 'ground', 'deck', 'water', 'dive', 'rise' or null. */
function flyAction() {
  if (!walkerHost || walkerHost.mode !== 'eyes') return null;
  const w = walkerHost.walker;
  if (w.state.swim) return w.under ? (w.rise() && 'rise') : (w.dive() && 'dive');
  if (!raft) return null;
  if (w.state.flight) return w.land();
  if (!raft.boarded) return null;
  if (!raft.kite.up) return w.jumpIn();
  return w.takeOff(raft.velocity()) ? 'fly' : null;
}
/** What the flight button would do now: 'fly', 'land', 'water', 'dive', 'rise' or null. */
function flyHint() {
  if (!walkerHost || walkerHost.mode !== 'eyes') return null;
  const w = walkerHost.walker;
  if (w.state.swim) return w.under ? 'rise' : 'dive';
  if (!raft) return null;
  if (w.state.flight) return w.landing() === 'water' ? 'water' : 'land';
  if (!raft.boarded) return null;
  return raft.kite.up ? 'fly' : 'water';
}
// --- the frame's fates (story-quest Q5) -------------------------------------------------
// STORY-QUEST-SPEC §2 п.6, Edge §4.4: on a raft, from the air over a frame, or from a deck next
// to another frame — let it go (Z), sink it (X), let it come apart (C). On the raft itself the
// fate throws off the raft's weight: the kite lifts the walker on the board first (Q4b). The
// way back of the latest fate (H: call / raise / gather) and «Leave it so» (L) — from
// anywhere the walker is: in the air, on another frame, on the shore.
let fates = null;
function fatesUpdate(dt) {
  if (!fates && tiles.loaded) fates = new TileFates(tiles);
  fates?.update(dt);
}
/** The frame a fate would go to now: { id, own } or null (deck.js deckAtHand). */
function fateTarget() {
  if (!fates || !raft || walkerHost?.mode !== 'eyes') return null;
  const s = walkerHost.state;
  return deckAtHand(raft.decks(), { deckId: raft.deckId, flying: !!s.flight, x: s.x, z: s.z }, FATE.near);
}
/** Z / X / C and the touch buttons: 'release', 'sink' or 'break' for the frame at hand. */
function fateAction(kind) {
  const target = fateTarget();
  if (!target) return null;
  if (target.own) {
    raft.setKite(true);
    if (!walkerHost.walker.takeOff(raft.velocity())) return null;
  }
  return fates.give(target.id, kind) ? kind : null;
}
/** H: the way back of the latest fate; L: «Leave it so». 'call' | 'raise' | 'gather' | 'keep' | null. */
function undoFate() {
  if (!fates || !walkerHost || walkerHost.mode === 'off') return null;
  const hint = fates.undoHint();
  return hint && fates.undo() ? hint : null;
}
function keepFate() {
  if (!fates || !walkerHost || walkerHost.mode === 'off') return null;
  return fates.keep() ? 'keep' : null;
}
/** The fate buttons now: the fates for the frame at hand (lighter ones first, Edge §4.4), then the way back and «keep». */
function fateHints() {
  if (!fates || !walkerHost || walkerHost.mode === 'off') return [];
  /** @type {string[]} */
  const names = fateTarget() ? [...FATE_KINDS] : [];
  const back = fates.undoHint();
  if (back) names.push(back, 'keep');
  return names;
}
function runFate(name) {
  const kind = FATE_KINDS.find((k) => k === name);
  if (kind) return fateAction(kind);
  return name === 'keep' ? keepFate() : undoFate();
}
const FATE_KEYS = { KeyZ: () => fateAction('release'), KeyX: () => fateAction('sink'), KeyC: () => fateAction('break'),
  KeyH: undoFate, KeyL: keepFate };
addEventListener('keydown', (e) => {
  const run = FATE_KEYS[e.code];
  if (!run || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
  if (run()) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
  if (flyAction()) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyK' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
  if (kiteAction()) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
  if (miniAction()) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
  walk().catch((err) => console.error('[walker]', err));
});

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
// a frame still a miniature (on the shore, in the hands, unfolding) is drawn there, not on
// the field: «Мить» flies to the miniature (story-quest Q5 review)
const storyFrames = createFrameFocus({ tiles, camera, locate: (entry) => {
  const item = minis?.active ? minis.get(entry.id) : null;
  return item && item.state !== 'water' ? new THREE.Box3().setFromObject(item.root) : null;
} });
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
gui.add({ walk: () => walk().catch((e) => console.error('[walker]', e)) }, 'walk').name('walk · eyes (V)');
gui.add({ miniAction }, 'miniAction').name('take · put (G)');
gui.add({ kiteAction }, 'kiteAction').name('kite · let go (K)');
gui.add({ flyAction }, 'flyAction').name('take off · land (Space)');
gui.add({ release: () => fateAction('release') }, 'release').name('let it go (Z)');
gui.add({ sink: () => fateAction('sink') }, 'sink').name('sink it (X)');
gui.add({ break: () => fateAction('break') }, 'break').name('let it come apart (C)');
gui.add({ undoFate }, 'undoFate').name('call · raise · gather (H)');
gui.add({ keepFate }, 'keepFate').name('leave it so (L)');

fSun = gui.addFolder('Sun & sky');
// the sliders read env.params and write through env.set() (guard OWNER-4: one sun writer)
const sunUi = Object.defineProperties({}, Object.fromEntries(['elevation', 'azimuth', 'sunIntensity', 'cloudCoverage', 'cloudSpeed', 'turbidity']
  .map((k) => [k, { get: () => env.params[k], set: (x) => env.set({ [k]: x }) }])));
fSun.add(sunUi, 'elevation', -2, 70, 0.1);
fSun.add(sunUi, 'azimuth', 0, 360, 0.5);
fSun.add(sunUi, 'sunIntensity', 0, 20, 0.1);
fSun.add(sunUi, 'cloudCoverage', 0, 1, 0.01);
fSun.add(sunUi, 'cloudSpeed', 0, 5, 0.05);
fSun.add(sunUi, 'turbidity', 1, 10, 0.1);

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

// Water colour presets: WATER_PRESETS in environment-bindings/seaBinding.js
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

// Tilecraft models on the water (spec.md §8); ?tiles=<fixture> picks one, bare ?tiles the hibrid;
// ?story=<folder>/<slug> takes a story from the R2 catalog (STORY-QUEST-SPEC §4.1) the same way
// dev only: Tilecraft's fixtures/catalog/ when R2 is unreachable (STORY-QUEST-SPEC §5). Written
// as import.meta.env.DEV verbatim: Vite substitutes only this exact text, and the build drops the branch
const catalog = createStoryCatalog({ localBase: import.meta.env.DEV ? new URL(`${import.meta.env.BASE_URL}tilecraft/catalog/`, location.origin).href : null });
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
  tilesUi.source = source instanceof File ? 'file…' : typeof source === 'object' ? 'story' : source;
  sourceController.updateDisplay();
  await tiles.load(source);
  frameController = frameController.options(['all', ...tiles.frames]).onChange(rebuildTiles);
  frameController.updateDisplay();
  if (tiles.loaded) placeTiles();
  if (args.has('minis')) layoutMinis();
  saveTilesUrl();
}
async function rebuildTiles() {
  await tiles.rebuild();
  if (tiles.loaded) placeTiles();
  saveTilesUrl();
}
fileInput.onchange = () => fileInput.files[0] && loadTiles(fileInput.files[0]);
const sourceController = fTiles.add(tilesUi, 'source', ['none', ...TILE_SOURCES, 'file…', 'story']).onChange((v) => {
  if (v === 'story') return;   // informational: a catalog story is chosen by ?story=, not here
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
fTiles.add({ get story() {
  const { story, state, error } = catalog;
  return story || error ? `${story?.id ?? '—'} · ${state}${error ? ` · ${error.code}` : ''}` : '—';
} }, 'story').disable().listen();
if (!args.has('tiles') && !args.has('story')) fTiles.close();
// a catalog story: fetched by the catalog, then the same path as a fixture. A failure is
// the catalog's { code, message }; the scene stays as it was
async function loadStory(id) {
  try {
    await loadTiles(await catalog.load(id));
  } catch (e) {
    if (e.name === 'AbortError') return;
    tiles.status = `error: ${catalog.error?.message ?? e.message}`;
    console.error('[catalog]', e);
  }
}
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

// --- mood weather (MOOD-WEATHER-SPEC §4) ----------------------------------------------
// moodState is where the widget points: the pebble and the sun on the arc move at once. The world
// follows (spec §4.4, M2): the weather sky through env.setState with τ 6; the time of day, the sea
// and the grade through stepToward in renderFrame — the day τ 6 (the sun walks the arc, not the
// short way between two azimuths), the sea τ 10 (a new spectrum every frame while the waves
// change), the grade τ 6. A move starts from what is on screen, so leaving «custom» is smooth too.
// app.mood.set(v, a, t) is at once (sky re-baked); app.mood.to(v, a, t) and the widget are smooth.
// Until the first set the world is the Controls' own (custom); a hand change in the mood's
// Controls folders makes it custom again (spec §4.5): the move stops where it is.
// M3b (spec §4.3, §4.6): «Quiet down» — A9 with the weather's τ 8, the day stays; the day's flow
// walks moodState.t dawn → sunset in 20 min on the frame clock and switches itself off there;
// prefers-reduced-motion caps the world's arousal at 0.3 (the pebble may sit higher), τ ×1.5.
const sea = bindSea({ ocean, surface, spray, underwater, terrain, clarity: () => w.clarity });
const moodState = { t: 0.1, v: 1, a: -1, flow: false, custom: true };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** the move in progress: `now` is on screen, `to` is where it goes; null at rest */
let moodMove = null, moodMirrorAt = 0;
// the sky follows the walked day this closely (one cube face a frame, E2), not at once
const SUN_FOLLOW_TAU = 0.1;
const clampTo = (x, lo, hi, name) => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`app.mood.set: ${name} must be a number`);
  return Math.min(hi, Math.max(lo, x));
};
const gradeNow = () => ({ keyValue: post.params.keyValue, contrast: post.params.contrast, saturation: post.params.saturation });
/** the day that is on screen: the walked one, else moodState's (custom: wherever it was left) */
let dayShown = moodState.t;
/** the Controls mirror the world (their next change would otherwise write stale values back) */
function mirrorMood(display) {
  shoreUi.amplitude = su.uShoreWave.value.x;
  const ch = moodMove?.now.sea ?? sea.read();
  absorptionBase.fromArray(ch.absorption);
  w.clarity = ch.clarity;
  w.scatter = '#' + new THREE.Color().fromArray(ch.scatter).getHexString();
  if (display) gui.controllersRecursive().forEach((c) => c.updateDisplay());
}
/** the sun stands on the arc at day t (else a shot or a slider put it elsewhere) */
const sunOnPath = (t) => {
  const sun = sunAt(SUN_PATH_V1, t);
  return Math.abs(env.target.elevation - sun.elevation) < 0.01 && Math.abs(env.target.azimuth - sun.azimuth) < 0.01;
};
/** moodState → targets; `smooth` false puts the world there at once; `quiet` — «Quiet down»'s τ */
function applyMood({ smooth, quiet = false }) {
  const reduced = reducedMotion.matches;
  const m = sampleMood(MOOD_MAP_V1, moodState.v, worldArousal(moodState.a, reduced));
  const tau = moodTau({ quiet, reduced });
  const sky = { sunIntensity: m.sky.sunIntensity, cloudCoverage: m.sky.cloudCoverage, turbidity: m.sky.turbidity, cloudSpeed: m.sky.cloudSpeed };
  const sun = sunAt(SUN_PATH_V1, moodState.t);
  moodState.custom = false;
  if (!smooth) {
    env.set({ ...sky, elevation: sun.elevation, azimuth: sun.azimuth });
    moodMove = { now: { day: { t: moodState.t }, sea: sea.read(), grade: gradeNow() }, sunDirect: false, to: null };
  } else if (!moodMove) {
    // from what is on screen; a sun off the arc goes straight to its target (the sky's own τ)
    const direct = !sunOnPath(dayShown);
    moodMove = { now: { day: { t: direct ? moodState.t : dayShown }, sea: sea.read(), grade: gradeNow() }, sunDirect: direct, to: null };
  }
  moodMove.to = { day: { t: moodState.t }, sea: sea.channels(m.sea), grade: { ...m.grade } };
  moodMove.tau = tau;
  if (smooth) env.setState(moodMove.sunDirect ? { ...sky, elevation: sun.elevation, azimuth: sun.azimuth } : sky, { tau: tau.sky });
  else { stepMood(0, true); applySun(); }
  moodGap0 = moodGap();
}
// the ring round the widget's button (spec §4.1): how far each group is from its target, as a
// share of where the last change of the target left it; the slowest group sets the progress
const absd = (p, q) => Math.abs(p - q);
function moodGap() {
  const e = env.params, g = env.target;
  const gap = { sky: absd(e.cloudCoverage, g.cloudCoverage) + absd(e.sunIntensity, g.sunIntensity) / 10
    + absd(e.turbidity, g.turbidity) / 8 + (absd(e.elevation, g.elevation) + absd(e.azimuth, g.azimuth)) / 180, day: 0, sea: 0, grade: 0 };
  if (moodMove?.to) {
    const { now, to } = moodMove;
    // the flowing day is always a step behind its target: that is the flow, not a move to show
    gap.day = moodState.flow ? 0 : absd(now.day.t, to.day.t);
    gap.sea = absd(now.sea.windSpeed, to.sea.windSpeed) / 22 + absd(now.sea.waveScale, to.sea.waveScale) / 0.45;
    gap.grade = absd(now.grade.keyValue, to.grade.keyValue) / 0.1 + absd(now.grade.saturation, to.grade.saturation);
  }
  return gap;
}
let moodGap0 = null;
function moodProgress() {
  if (!moodGap0 || moodState.custom || !(moodMove || env.dirty)) { moodGap0 = null; return 1; }
  const gap = moodGap();
  let left = 0;
  for (const k of Object.keys(gap)) if (moodGap0[k] > 1e-4) left = Math.max(left, Math.min(1, gap[k] / moodGap0[k]));
  return 1 - left;
}
/** one frame of the move: day → sun, sea channels, grade; at once when `snap` */
function stepMood(dt, snap = false) {
  const { now, to, tau } = moodMove;
  const day = stepToward(now.day, to.day, dt, snap ? 0 : tau.day);
  const waves = stepToward(now.sea, to.sea, dt, snap ? 0 : tau.sea);
  const grade = stepToward(now.grade, to.grade, dt, snap ? 0 : tau.grade);
  dayShown = now.day.t;
  if (!snap && !moodMove.sunDirect) {
    const sun = sunAt(SUN_PATH_V1, dayShown);
    if (sun.elevation !== env.target.elevation || sun.azimuth !== env.target.azimuth)
      env.setState({ elevation: sun.elevation, azimuth: sun.azimuth }, { tau: SUN_FOLLOW_TAU });
  }
  sea.write(now.sea);
  Object.assign(post.params, now.grade);
  const moving = day || waves || grade;
  if (!moving) moodMove = null;
  // the slider handles move four times a second, and once more when the world arrives
  moodMirrorAt += dt;
  const display = !moving || moodMirrorAt >= 0.25;
  if (display) moodMirrorAt = 0;
  mirrorMood(display);
}
/** a hand change in the Controls: the move stops where it is, the sky too, and the day's flow */
function freezeMood() {
  moodMove = null;
  moodState.flow = false;
  env.setState({ ...env.params });
}
/** the day's flow, one frame (spec §4.3): the target walks, the world follows it with the day's τ */
let flowSyncAt = 0;
function stepFlow(dt) {
  const { t, done } = flowDay(SUN_PATH_V1, moodState.t, dt * moodApi.flowScale);
  moodState.t = t;
  if (done) moodState.flow = false;
  if (moodMove?.to) moodMove.to.day.t = t;
  else applyMood({ smooth: true });
  // the sun on the arc and the thumbnail: four times a second is smooth enough for 20 minutes
  flowSyncAt += dt;
  if (done || flowSyncAt >= 0.25) { flowSyncAt = 0; moodPad.sync(); }
}
const moodApi = {
  /** at once. @param {number} v valence −1…1 @param {number} a arousal −1…1 @param {number} [t] day 0…1 */
  set(v, a, t = moodState.t) { return moodApi.go(v, a, t, false); },
  /** smoothly, like the widget (spec §4.4) */
  to(v, a, t = moodState.t) { return moodApi.go(v, a, t, true); },
  go(v, a, t, smooth, quiet = false) {
    moodState.v = clampTo(v, -1, 1, 'v');
    moodState.a = clampTo(a, -1, 1, 'a');
    moodState.t = clampTo(t, 0, 1, 't');
    applyMood({ smooth, quiet });
    moodPad.sync();
    return moodApi.state();
  },
  /** «Quiet down» (spec §4.2, §4.4): to A9 with the weather's τ 8; the time of day stays */
  quiet() { return moodApi.go(QUIET.v, QUIET.a, moodState.t, true, true); },
  /** the day's flow on or off (spec §4.3); on, it starts from where the sun is */
  flow(on) {
    moodState.flow = Boolean(on) && moodState.t < 1;
    if (moodState.flow && moodState.custom) applyMood({ smooth: true });
    moodPad.sync();
    return moodApi.state();
  },
  /** QA only: the day's flow runs this many times faster (1 — 20 minutes dawn to sunset) */
  flowScale: 1,
  state() {
    const reduced = reducedMotion.matches;
    const m = sampleMood(MOOD_MAP_V1, moodState.v, moodState.a);
    // moving: the world is still on its way (the sea, the grade, the day or the sky)
    // reduced: prefers-reduced-motion — the world's arousal stops at 0.3 (`worldA`)
    return { ...moodState, map: MOOD_MAP_V1.version, anchor: m.anchor, words: m.words,
      moving: moodMove !== null || env.dirty, day: dayShown, progress: moodProgress(),
      reduced, worldA: worldArousal(moodState.a, reduced) };
  },
};
const moodPad = createMoodPad({
  get: () => moodState,
  // the widget is smooth while the finger moves and on release alike; `final` re-syncs the pad
  input: ({ t, v, a }, final) => {
    if (final) { moodApi.to(v, a, t); return; }
    const wasCustom = moodState.custom;
    Object.assign(moodState, { t, v, a });
    applyMood({ smooth: true });
    if (wasCustom) moodPad.sync();
  },
  quiet: () => moodApi.quiet(),
  flow: (on) => moodApi.flow(on),
  language: railLanguage([...navigator.languages, navigator.language]),
});
// the folders the mood writes, and the dev shots (they set the sun): a hand change there is «custom»
const moodFolders = new Set([fSun, fWave, fShore, fWater, fPost]);
gui.onChange(({ controller }) => {
  if (moodState.custom || !(moodFolders.has(controller.parent) || controller === viewController)) return;
  moodState.custom = true;
  freezeMood();
  moodPad.sync();
});
// the system setting can change while the page is open: the world follows the new cap smoothly
reducedMotion.addEventListener('change', () => { if (!moodState.custom) applyMood({ smooth: true }); });

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
  env.restoreContext();
  floatShadow.ready = false;
  tex.foam.dispose();
  tex.foam = bakeWaterTextures(renderer).foam;
  surface.uniforms.uFoamTex.value = tex.foam;
});

function renderFrame(dt) {
  if (gl.isContextLost()) return;
  elapsed += dt;
  timer.beginFrame();
  // the mood's move first: its day lands in the sky update below (spec §4.4); the flowing day
  // moves the target before it (spec §4.3)
  if (moodState.flow && !moodState.custom) stepFlow(dt);
  if (moodMove) stepMood(dt);
  moodPad.progress(moodProgress());
  // inside the timer's frame, so a sky change shows as its own `sky` line (E0); while the sky
  // moves (env.setState with τ) one cube face a frame, the IBL and a full shadow at rest (E2);
  // drifting clouds tick it every frame and re-bake the cube now and then (E2b)
  if (env.active) { timer.begin('sky'); applySunLight(env.update(dt), dt); }

  // latest water heights (1-3 frames old) drive the camera test and the floaters
  // slot 1: the water at the walker (story-quest Q5b: at the surface the eyes ride it)
  if (query.resultCount > 0) camWater = query.result[0];
  if (query.resultCount > 1) walkerWater = query.result[4];
  floaters.ingest(query, 2);
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
  const pts = floaters.collectPoints([camera.position, walkerHost && walkerHost.mode !== 'off' ? walkerHost.state : camera.position]);
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
/** @param {number} [frames] @param {{ shot?: string, warmup?: number }} [options] */
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
    fatesUpdate(dt);
    raftUpdate(dt);
    walkerHost?.update(dt, i * dt * 1000);
    raft?.pose(dt, walkerHost?.mode === 'off' ? null : walkerHost?.state);
    minis?.update(dt, walkerHost?.mode === 'off' ? null : walkerHost?.state);
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
  camera, controls, scene, env, post, surface, ocean, terrain, timer, views, quality, renderer, floaters, query, underwater, spray, snow, caustics, floatShadow, tiles, catalog, loadStory,
  walk, startWalk, get walker() { return walkerHost; }, get walkerStick() { return walkerStick; }, ground: walkGround,
  get minis() { return minis; }, layoutMinis, miniAction, miniHint,
  get raft() { return raft; }, kiteAction, kiteHint, flyAction, flyHint,
  get fates() { return fates; }, fateAction, fateTarget, fateHints, undoFate, keepFate,
  camWater: () => camWater, markSun: () => env.set({}), mood: moodApi, techPanels, measureEnvironment: measureSky,
  rig, stations: { go: stations.go, nextFrame: stations.nextFrame, prevFrame: stations.prevFrame,
    get current() { return stations.current; }, get last() { return stations.last; }, get focus() { return stations.focus; } },
};

// --- HUD + loop ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hud = $('hud'), graph = /** @type {HTMLCanvasElement} */ ($('pGraph')).getContext('2d'), uncapButton = $('pUncap'), fpsHistory = [];
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
  bench = `sky change (ms, ${m.repeats}×): lut ${m.lut.toFixed(2)}  face ${m.face.toFixed(2)}  cube ${m.cube.toFixed(2)}  pmrem ${m.pmrem.toFixed(2)}  pmrem256 ${m.pmrem256.toFixed(2)}  pmrem64 ${m.pmrem64.toFixed(2)}`
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
  fatesUpdate(dt);
  raftUpdate(dt);
  walkerHost?.update(dt, now);
  raft?.pose(dt, walkerHost && walkerHost.mode !== 'off' ? walkerHost.state : null);
  minis?.update(dt, walkerHost?.mode === 'off' ? null : walkerHost?.state);
  walkerStick?.update();
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
// a link with ?story or ?tiles opens on the field once it has loaded and been placed (?story wins);
// with ?walk it opens instead on the overview and goes down into the walker's eyes once the
// field is there (Q2b: loading the story used to throw the camera out of the eyes)
const walking = args.has('walk');
const showField = () => { if (tiles.loaded && !walking) viewController.setValue('Tiles'); };
const opening = args.has('story') ? loadStory(args.get('story')).then(showField)
  : tilesUi.source !== 'none' ? loadTiles(tilesUi.source).then(showField) : Promise.resolve();
if (walking) opening.then(() => startWalk()).catch((e) => console.error('[walker]', e));
if (!stillMode) requestAnimationFrame(loop);
