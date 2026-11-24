// SCENE-ENVIRONMENT E3 demo (spec §5.4, §6 E3): the environment module with output 'ldr' on a page
// set up like three's viewer — sRGB canvas, NoToneMapping, a HemisphereLight + a DirectionalLight,
// a "frame" on MeshBasicMaterial — without the water. Not part of src/ (its own renderer and loop;
// guard OWNER-1/2 hold those to src/main.js) and not part of the build: dev stand only.
//
// URL: ?mood=v,a&day=t&bg=sky|gradient&ibl=1&ref=three
//   ref=three — three's lights today (THREE_LIGHTS, sun from (-10, 20, -8)) on #1b1d21, no environment
// Probe hook: window.envDemo (scripts/probe-scene-env-ldr.mjs).
import * as THREE from 'three';
import { createEnvironment, MOOD_MAP_V1, SUN_PATH_V1, THREE_LIGHTS, sampleMood, sunAt } from '../src/environment/index.js';

const q = new URLSearchParams(location.search);
const [v0, a0] = (q.get('mood') ?? '1,0').split(',').map(Number);
const state = { v: v0, a: a0, t: Number(q.get('day') ?? 0.5), ibl: q.get('ibl') === '1', ref: q.get('ref') === 'three' };

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;   // three's engine/renderer.js
renderer.toneMapping = THREE.NoToneMapping;
const toneMappingBefore = renderer.toneMapping;

const env = createEnvironment(renderer, { output: 'ldr', cubeSize: 256, background: q.get('bg') === 'sky' ? 'sky' : 'gradient' });
const toneMappingAfter = renderer.toneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 1.5, 4.2);
camera.lookAt(0, 0.75, 0);

const hemi = new THREE.HemisphereLight(THREE_LIGHTS.sky, THREE_LIGHTS.ground, THREE_LIGHTS.hemisphere);
const sun = new THREE.DirectionalLight(0xffffff, THREE_LIGHTS.sun);
scene.add(hemi, sun);

// the page of a frame: white paper with black print, half and half, and a strip of greys
function pageTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 320);
  g.fillStyle = '#141414'; g.fillRect(256, 0, 256, 320);
  for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(0 0% ${(i * 100) / 7}%)`; g.fillRect(i * 64, 270, 64, 50); }
  g.font = 'bold 40px system-ui'; g.fillStyle = '#141414'; g.fillText('Кадр', 40, 80);
  g.fillStyle = '#ffffff'; g.fillText('Frame', 296, 80);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const page = pageTexture();
const plane = new THREE.PlaneGeometry(1.2, 0.75);
// the frame as three draws it: unlit
const frame = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: page }));
frame.position.set(-1.35, 1.0, 0);
// the same page lit (MeshStandard): standing, facing the camera, and lying flat
const standing = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: page, roughness: 0.9 }));
standing.position.set(0, 1.0, 0);
const lying = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: page, roughness: 0.9 }));
lying.rotation.x = -Math.PI / 2;
lying.position.set(1.35, 0.02, 0.6);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 48, 24), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.35, metalness: 0 }));
ball.position.set(1.4, 0.34, -0.7);
const chrome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 48, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 }));
chrome.position.set(-1.3, 0.28, -0.8);
scene.add(frame, standing, lying, ground, ball, chrome);

/** world points (u, v in the page: 0..1 from the top left) the probe reads */
const SAMPLES = {
  frameWhite: [frame, 0.25, 0.5], frameBlack: [frame, 0.75, 0.5],
  standingWhite: [standing, 0.25, 0.5], standingBlack: [standing, 0.75, 0.5],
  lyingWhite: [lying, 0.25, 0.5], lyingBlack: [lying, 0.75, 0.5],
};

function applyLights() {
  if (state.ref) {
    hemi.color.setHex(THREE_LIGHTS.sky); hemi.groundColor.setHex(THREE_LIGHTS.ground); hemi.intensity = THREE_LIGHTS.hemisphere;
    sun.color.setHex(0xffffff); sun.intensity = THREE_LIGHTS.sun; sun.position.set(-10, 20, -8);
    return;
  }
  const l = env.ldrLights();
  hemi.color.copy(l.hemisphere.sky); hemi.groundColor.copy(l.hemisphere.ground);
  hemi.intensity = state.ibl ? 0 : l.hemisphere.intensity;   // the IBL stands in for the hemisphere
  sun.color.copy(l.sun.color); sun.intensity = l.sun.intensity;
  sun.position.copy(env.sun.direction).multiplyScalar(20);
}
env.on('sun-changed', applyLights);

function applyScene() {
  if (state.ref) {
    scene.remove(env.background);
    scene.background = new THREE.Color('#1b1d21');
    scene.environment = null;
  } else {
    scene.background = null;
    scene.add(env.background);
    // IBL in LDR: the cube is scaled (iblExposure) to give what the hemisphere would, and replaces it
    scene.environment = state.ibl ? env.envMap : null;
  }
  applyLights();
}

/** the mood and the day at once (env.set — no τ) */
function set(v = state.v, a = state.a, t = state.t) {
  Object.assign(state, { v, a, t });
  const { sky } = sampleMood(MOOD_MAP_V1, v, a);
  const { elevation, azimuth } = sunAt(SUN_PATH_V1, t);
  env.set({ ...sky, elevation, azimuth, cloudSpeed: 0 });
  env.update(0);
  showState();
}

function render() {
  if (env.active) env.update(1 / 60);
  renderer.render(scene, camera);
}

const px = new Uint8Array(4);
const tmp = new THREE.Vector3();
/** renders a frame and reads the sample points (sRGB 0..1, the canvas bytes) */
function sample() {
  render();
  const gl = renderer.getContext();
  const out = {};
  for (const [name, [mesh, u, w]] of Object.entries(SAMPLES)) {
    mesh.updateMatrixWorld();
    tmp.set((u - 0.5) * 1.2, (0.5 - w) * 0.75, 0).applyMatrix4(mesh.matrixWorld).project(camera);
    const x = Math.round((tmp.x * 0.5 + 0.5) * gl.drawingBufferWidth);
    const y = Math.round((tmp.y * 0.5 + 0.5) * gl.drawingBufferHeight);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out[name] = [px[0] / 255, px[1] / 255, px[2] / 255];
  }
  return out;
}

// ── UI ────────────────────────────────────────────────────────────────────────────────────────
const gridEl = document.getElementById('grid');
const buttons = [];
for (const a of [1, 0, -1]) for (const v of [-1, 0, 1]) {
  const anchor = MOOD_MAP_V1.grid[a + 1][v + 1];
  const b = document.createElement('button');
  b.textContent = `${anchor.id} ${anchor.name}`;
  b.title = `v ${v}, a ${a}`;
  b.addEventListener('click', () => set(v, a));
  gridEl.append(b);
  buttons.push({ b, v, a });
}
const dayEl = /** @type {HTMLInputElement} */ (document.getElementById('day'));
dayEl.value = String(state.t);
dayEl.addEventListener('input', () => set(state.v, state.a, Number(dayEl.value)));
const iblEl = /** @type {HTMLInputElement} */ (document.getElementById('ibl'));
iblEl.checked = state.ibl;
iblEl.addEventListener('change', () => { state.ibl = iblEl.checked; applyScene(); showState(); });
const refEl = /** @type {HTMLInputElement} */ (document.getElementById('ref'));
refEl.checked = state.ref;
refEl.addEventListener('change', () => { state.ref = refEl.checked; applyScene(); showState(); });

function showState() {
  for (const { b, v, a } of buttons) b.setAttribute('aria-pressed', String(v === state.v && a === state.a));
  document.getElementById('dayOut').textContent = state.t.toFixed(2);
  const l = env.ldrLights();
  const hex = (c) => `#${c.getHexString()}`;
  document.getElementById('state').textContent = state.ref
    ? `three зараз: hemi ${THREE_LIGHTS.hemisphere}, sun ${THREE_LIGHTS.sun}`
    : `sun  ${hex(l.sun.color)} × ${l.sun.intensity.toFixed(2)}\nhemi ${hex(l.hemisphere.sky)}/${hex(l.hemisphere.ground)} × ${state.ibl ? '0 (IBL)' : l.hemisphere.intensity.toFixed(2)}\ngain ${l.gain.toFixed(2)}  exposure ${l.exposure.toFixed(3)}  ibl ${l.iblExposure.toFixed(2)}\nelev ${env.params.elevation.toFixed(1)}°  clouds ${env.params.cloudCoverage.toFixed(2)}`;
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

applyScene();
set();
renderer.setAnimationLoop(render);

window.envDemo = {
  env, set, sample, state,
  setRef(on) { state.ref = on; refEl.checked = on; applyScene(); showState(); },
  setIbl(on) { state.ibl = on; iblEl.checked = on; applyScene(); showState(); },
  toneMapping: { before: toneMappingBefore, after: toneMappingAfter, now: () => renderer.toneMapping },
  ready: true,
};
