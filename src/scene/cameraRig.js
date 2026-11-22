// The camera owner (ARCHITECTURE TD2, SCENE-UI-SPEC U1). The only module that writes
// the camera pose and OrbitControls (`position`, `target`, `enabled`): shots, WASD, the
// ground clamp, the station flights and the frame drag in TileInteraction all go
// through it. Guard OWNER-3 counts camera writes anywhere else.
//
// Locks replace a saved `controls.enabled`: whoever needs the controls off takes a lock
// with a reason and releases that token. Controls are enabled exactly when no lock is
// held, so an interrupted flight and a frame drag cannot leave the camera stuck.
import * as THREE from 'three';
import { createFlight } from './cameraFlight.js';

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const MOVE_SPEED = 100;   // world units per second

export class CameraRig {
  /**
   * @param {{ camera: THREE.PerspectiveCamera, controls: any,
   *   ground: (x: number, z: number) => number, water?: () => number }} options
   *   `ground(x, z)` — lowest camera height there (islandHeight + 0.8).
   */
  constructor({ camera, controls, ground, water = () => -Infinity }) {
    this.camera = camera;
    this.controls = controls;
    this.ground = ground;
    this.water = water;
    this.locks = new Set();
    this.flight = null;
    this.keys = new Set();
    this.listeners = new Set();
    this._pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    this._move = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  // --- locks ------------------------------------------------------------------------

  /** Turns the controls off until the returned token is released. */
  lock(reason) {
    const token = { reason };
    this.locks.add(token);
    this._sync();
    return token;
  }

  release(token) {
    if (!token || !this.locks.delete(token)) return;
    this._sync();
  }

  /** Reasons of the locks now held, e.g. ['flight'] or ['frame-drag']. */
  get reasons() { return [...this.locks].map((t) => t.reason); }

  _sync() { this.controls.enabled = this.locks.size === 0; }

  // --- poses ------------------------------------------------------------------------

  /** Current pose (copies). */
  pose() {
    return { position: this.camera.position.clone(), target: this.controls.target.clone() };
  }

  /** Puts the camera at a pose at once; stops a flight. */
  place(position, target) {
    this._endFlight();
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.holdStill();
    this.controls.update();
  }

  /**
   * Drains OrbitControls' private damping without moving the view, so leftover momentum
   * does not carry on after a jump, a flight or a grabbed frame.
   */
  holdStill() {
    const c = this.controls, cam = this.camera;
    const position = cam.position.clone(), rotation = cam.quaternion.clone(), target = c.target.clone();
    const damping = c.enableDamping;
    c.enableDamping = false;
    c.update();
    cam.position.copy(position);
    cam.quaternion.copy(rotation);
    c.target.copy(target);
    cam.updateMatrixWorld();
    c.enableDamping = damping;
  }

  // --- flight -----------------------------------------------------------------------

  get flying() { return !!this.flight; }

  /**
   * Flies from the current pose to `to`. A new flight during a flight starts from where
   * the camera is now, so there is no jump. Resolves `true` on arrival, `false` when
   * interrupted or replaced.
   * @param {{ position: THREE.Vector3, target: THREE.Vector3 }} to
   * @param {{ onProgress?: (share: number) => void }} [options]
   */
  flyTo(to, { onProgress } = {}) {
    const previous = this.flight;
    const flight = createFlight(this.pose(), to, { ground: this.ground, water: this.water });
    flight.elapsed = 0;
    flight.onProgress = onProgress;
    flight.done = new Promise((resolve) => { flight.resolve = resolve; });
    if (previous) {
      // Hand the lock over: the controls must not flicker on between two flights.
      flight.token = previous.token;
      previous.token = null;
      this.flight = null;
      previous.resolve(false);
    } else {
      this.holdStill();
      flight.token = this.lock('flight');
    }
    this.flight = flight;
    return flight.done;
  }

  /** Stops a flight where it is; the controls are the person's at once. */
  interrupt() {
    if (this.flight) this._endFlight(false);
  }

  _endFlight(arrived = false) {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    this.controls.update();   // target and orientation agree before handing over
    this.holdStill();
    this.release(f.token);
    f.resolve(arrived);
  }

  _stepFlight(dt) {
    const f = this.flight;
    f.elapsed += dt;
    f.sample(f.elapsed, this._pose);
    this.camera.position.copy(this._pose.position);
    this.controls.target.copy(this._pose.target);
    this.camera.lookAt(this._pose.target);
    f.onProgress?.(Math.min(1, f.elapsed / f.duration));
    if (f.elapsed >= f.duration) this._endFlight(true);
  }

  // --- free camera ------------------------------------------------------------------

  /**
   * WASD across the ground relative to the view, the orbit target in step; pointerdown
   * on the canvas, the wheel and WASD stop a flight.
   * @param {HTMLElement} canvas
   * @param {(target: EventTarget | null) => boolean} isEditing
   */
  bind(canvas, isEditing) {
    const on = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.listeners.add(() => target.removeEventListener(type, fn, options));
    };
    // Window capture runs before the canvas' own listeners (TileInteraction stops
    // propagation on a frame), so the flight ends before a drag takes its lock.
    on(window, 'pointerdown', (e) => { if (e.target === canvas) this.interrupt(); }, true);
    on(canvas, 'wheel', () => this.interrupt(), { capture: true, passive: true });
    on(window, 'keydown', (e) => {
      if (!MOVE_KEYS.includes(e.code) || e.ctrlKey || e.metaKey || e.altKey || isEditing(e.target)) return;
      this.interrupt();
      this.keys.add(e.code);
      e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(document, 'visibilitychange', () => this.keys.clear());
    on(document, 'focusin', (e) => { if (isEditing(e.target)) this.keys.clear(); });
  }

  _moveKeys(dt) {
    if (!this.controls.enabled || this.keys.size === 0) return;
    const right = this._right.setFromMatrixColumn(this.camera.matrix, 0).setY(0).normalize();
    const forward = this._forward.set(0, 1, 0).cross(right).normalize();
    const k = this.keys;
    const f = Number(k.has('KeyW')) - Number(k.has('KeyS'));
    const r = Number(k.has('KeyD')) - Number(k.has('KeyA'));
    const move = this._move.copy(forward).multiplyScalar(f).addScaledVector(right, r);
    move.normalize().multiplyScalar(MOVE_SPEED * dt);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  /** Free to dive; just stay out of the ground. */
  _clamp() {
    const p = this.camera.position, floor = this.ground(p.x, p.z);
    if (p.y < floor) p.y = floor;
  }

  /** Once a frame, before rendering. */
  update(dt) {
    if (this.flight) this._stepFlight(dt);
    else {
      this.controls.update();
      this._moveKeys(dt);
    }
    this._clamp();
  }

  dispose() {
    this.interrupt();
    for (const off of this.listeners) off();
    this.listeners.clear();
  }
}
