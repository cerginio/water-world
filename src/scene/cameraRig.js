// The camera owner (ARCHITECTURE TD2, SCENE-UI-SPEC U1). The only module that writes
// the camera pose and OrbitControls (`position`, `target`, `enabled`): shots, WASD, the
// ground clamp, the station flights and the frame drag in TileInteraction all go
// through it. Guard OWNER-3 counts camera writes anywhere else.
//
// Locks replace a saved `controls.enabled`: whoever needs the controls off takes a lock
// with a reason and releases that token. Controls are enabled exactly when no lock is
// held, so an interrupted flight and a frame drag cannot leave the camera stuck.
import * as THREE from 'three';
import { createFlight, flightDuration, smootherstep } from './cameraFlight.js';

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
    this.following = null;
    this.riding = null;
    this.keys = new Set();
    this.steering = { forward: 0, strafe: 0 };
    this.listeners = new Set();
    this._pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    this._move = new THREE.Vector3();
    this._shift = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._look = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._eyePos = new THREE.Vector3();
    this._eyeTarget = new THREE.Vector3();
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

  /** Puts the camera at a pose at once; stops a flight and a follow. */
  place(position, target) {
    this.dismount();
    this.following = null;
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
    this.dismount();
    this.following = null;
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

  /** Stops a flight or a follow where it is; the controls are the person's at once. */
  interrupt() {
    this.following = null;
    if (this.flight) this._endFlight(false);
  }

  // --- follow -----------------------------------------------------------------------

  /**
   * Keeps the orbit target on a moving point (a drifting frame, SCENE-UI-SPEC §4.3):
   * camera and target shift together by at most `speed` m/s towards `aim()`, so the view
   * neither turns nor zooms. Ends on interrupt() (the person's first touch), place() and
   * flyTo(). `aim()` may return null — nothing to follow this frame.
   * @param {() => (THREE.Vector3 | null)} aim
   * @param {{ speed?: number, onShift?: (delta: THREE.Vector3) => void }} [options]
   */
  follow(aim, { speed = 2, onShift } = {}) {
    this.following = { aim, speed, onShift };
  }

  _stepFollow(dt) {
    const f = this.following, aim = f.aim();
    if (!aim || this.locks.size) return;
    const shift = this._shift.copy(aim).sub(this.controls.target);
    const most = f.speed * dt, length = shift.length();
    if (length < 1e-6) return;
    if (length > most) shift.multiplyScalar(most / length);
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    f.onShift?.(shift);
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

  // --- eyes (story-quest Q2a) ---------------------------------------------------------

  get eyes() { return !!this.riding; }

  /** True while ride({ approach }) is still on its way into the eyes (story-quest Q2b). */
  get boarding() { return !!this.riding?.approach; }

  /**
   * The camera looks through a walker's eyes: every frame it takes `eye()` = { position,
   * target } (plain {x, y, z}) as is. The controls are off under the lock 'eyes' until
   * dismount(); place() and flyTo() dismount first. interrupt() (a touch, WASD) does not:
   * the walker's own keys move the eyes. `onEnd` runs once when the ride ends.
   *
   * `approach` (story-quest Q2b): instead of a cut, the camera goes from where it is into
   * the eyes — `true` for flightDuration(distance) seconds, or a number of seconds. The
   * position eases on smootherstep towards the live eye point and stays over the terrain
   * floor until the last 30 % (where the floor fades out, so the eyes 1.6 m over the drawn
   * mesh are reached without a jump); the view turns by a slerp of the orientation, not by
   * dragging the orbit target. `onArrive` runs once when the camera is in the eyes.
   * @param {() => ({ position: {x: number, y: number, z: number}, target: {x: number, y: number, z: number} } | null)} eye
   * @param {{ onEnd?: () => void, onArrive?: () => void, approach?: boolean | number }} [options]
   */
  ride(eye, { onEnd, onArrive, approach = false } = {}) {
    this.dismount();
    this.interrupt();
    this.keys.clear();
    this.riding = { eye, onEnd, onArrive, approach: null, token: this.lock('eyes') };
    const to = eye();
    if (approach && to) {
      const distance = this.camera.position.distanceTo(this._eyePos.set(to.position.x, to.position.y, to.position.z));
      const duration = approach === true ? flightDuration(distance) : Number(approach);
      if (duration > 0 && distance > 1e-3) {
        this.riding.approach = { elapsed: 0, duration, position: this.camera.position.clone(),
          quaternion: this.camera.quaternion.clone(), reach: this.camera.position.distanceTo(this.controls.target) };
      }
    }
    this._stepRide(0);
    if (!this.riding?.approach) this.riding?.onArrive?.();
  }

  /** Back to the free camera where the eyes were; no jump. */
  dismount() {
    const r = this.riding;
    if (!r) return;
    this.riding = null;
    this.keys.clear();
    this.holdStill();
    this.release(r.token);
    r.onEnd?.();
  }

  _stepRide(dt) {
    const r = this.riding, pose = r.eye();
    if (!pose) return;
    const a = r.approach;
    if (!a) {
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.camera.lookAt(this.controls.target);
      return;
    }
    a.elapsed += dt;
    const u = Math.min(1, a.elapsed / a.duration), s = smootherstep(u);
    const eye = this._eyePos.set(pose.position.x, pose.position.y, pose.position.z);
    const ahead = this._eyeTarget.set(pose.target.x, pose.target.y, pose.target.z);
    const p = this.camera.position.copy(a.position).lerp(eye, s);
    const floor = this.ground(p.x, p.z), hold = 1 - smootherstep((u - 0.7) / 0.3);
    if (p.y < floor) p.y += (floor - p.y) * hold;
    this._look.lookAt(eye, ahead, this.camera.up);
    this._quat.setFromRotationMatrix(this._look);
    this.camera.quaternion.copy(a.quaternion).slerp(this._quat, s);
    const reach = a.reach + (eye.distanceTo(ahead) - a.reach) * s;
    this.controls.target.set(0, 0, -reach).applyQuaternion(this.camera.quaternion).add(p);
    this.camera.updateMatrixWorld();
    if (u >= 1) {
      r.approach = null;
      this._stepRide(0);
      r.onArrive?.();
    }
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

  /**
   * An analog move of the free camera across the ground (the walker's stick out of the body,
   * story-quest Q2b): forward / strafe in -1..1, held until changed. The speed goes with the
   * square of the deflection — fine near the figure, the keys' full speed at the rim.
   */
  steer(forward = 0, strafe = 0) {
    this.steering.forward = forward;
    this.steering.strafe = strafe;
  }

  _moveKeys(dt) {
    const { forward: sf, strafe: sr } = this.steering;
    if (!this.controls.enabled || (this.keys.size === 0 && !sf && !sr)) return;
    const right = this._right.setFromMatrixColumn(this.camera.matrix, 0).setY(0).normalize();
    const forward = this._forward.set(0, 1, 0).cross(right).normalize();
    const k = this.keys;
    let f = Number(k.has('KeyW')) - Number(k.has('KeyS'));
    let r = Number(k.has('KeyD')) - Number(k.has('KeyA'));
    let speed = MOVE_SPEED;
    if (!f && !r) {
      const m = Math.min(1, Math.hypot(sf, sr));
      [f, r, speed] = [sf, sr, MOVE_SPEED * m * m];
    }
    const move = this._move.copy(forward).multiplyScalar(f).addScaledVector(right, r);
    move.normalize().multiplyScalar(speed * dt);
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
    else if (this.riding) this._stepRide(dt);
    else {
      if (this.following) this._stepFollow(dt);
      this.controls.update();
      this._moveKeys(dt);
    }
    // The eyes stand 1.6 m over the drawn mesh; the clamp's islandHeight lies up to 2.5 m
    // above that mesh on the ridges (story-quest Q2a) and would lift the eyes off the feet.
    if (!this.riding) this._clamp();
  }

  dispose() {
    this.dismount();
    this.interrupt();
    for (const off of this.listeners) off();
    this.listeners.clear();
  }
}
