import * as THREE from 'three';
import { makeFloater } from './floaterMeshes.js';

// Rigid bodies floating on the GPU ocean. Each body is split into sub-cells (the
// descriptor's sample points); every cell gets Archimedes buoyancy for its submerged
// fraction plus drag against the local water velocity, applied at the cell, so roll,
// pitch and bobbing all come out of the same forces. Water heights come from
// WaterQuery (1-3 frames late) and water velocity from their change over time.
const RHO = 1025, G = 9.81;
const SUBSTEP = 1 / 240;
const MAX_BODIES = 28;

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const _vp = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix3(), _mt = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _w = new THREE.Vector3(), _c = new THREE.Vector3(), _m4 = new THREE.Matrix4();

class Body {
  constructor(desc) {
    this.desc = desc;
    this.object = desc.object;
    this.mass = desc.density * desc.volume;
    const s = desc.size, m = this.mass;
    // solid-box inertia; good enough for every prop shape here
    this.invInertia = new THREE.Vector3(
      12 / (m * (s.y * s.y + s.z * s.z)), 12 / (m * (s.x * s.x + s.z * s.z)), 12 / (m * (s.x * s.x + s.y * s.y)));
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.radius = desc.size.length() / 2;
    this.wet = false;
    const n = desc.samples.length;
    this.cellVolume = desc.volume / n;
    this.cellMass = m / n;
    this.world = desc.samples.map(() => new THREE.Vector3());
    // per sample: water height, water velocity (x, y, z), last displacement for velocity
    this.water = new Float32Array(n * 4);
    this.lastDisp = new Float32Array(n * 3).fill(NaN);
  }

  place(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    this.water.fill(0);
    this.lastDisp.fill(NaN);
    // Held still until WaterQuery delivers this body's heights: the zero placeholder
    // can be metres off in a trough and would launch a light body (T5 QA).
    this.ready = false;
    this.updateWorld();
  }

  updateWorld() {
    for (let i = 0; i < this.world.length; i++) this.world[i].copy(this.desc.samples[i]).applyQuaternion(this.quat).add(this.pos);
  }
}

export class Floaters {
  constructor({ scene, heightAt, patchMaterial }) {
    // own (nested) scene so the floater shadow map can render just these
    this.scene = new THREE.Scene();
    scene.add(this.scene);
    this.heightAt = heightAt;
    this.patchMaterial = patchMaterial;
    this.bodies = [];
    this.layout = 0;                       // bumps whenever the sample layout changes
    this.points = new Float32Array(1024);  // xz pairs submitted to WaterQuery
    this.count = 0;
    this.params = { drag: 1.6, angularDrag: 0.8, buoyancy: 1 };
    this.time = 0;
    this.impacts = [];   // last few water entries: { x, z, t, amp, size } for ripple rings
  }

  add(kind, pos, yaw = Math.random() * Math.PI * 2) {
    return this.addDescriptor(makeFloater(kind, this.patchMaterial), pos, yaw);
  }

  // Custom tile descriptors use exactly the same dynamics, query and impacts.
  addDescriptor(desc, pos, yaw = 0, onRemove) {
    if (!desc.samples.length || (onRemove && desc.samples.length > 8)) throw new Error('Invalid tile samples');
    // Existing props have at most 16 samples: 28 * 16 + camera < 512.
    if (desc.samples.length > 16) throw new Error('Floater exceeds WaterQuery sample budget');
    if (this.bodies.length >= MAX_BODIES) {
      this.remove(this.bodies.find(b => b.onRemove) ?? this.bodies[0]);
    }
    const b = new Body(desc);
    b.onRemove = onRemove;
    b.place(pos, yaw);
    this.scene.add(b.object);
    this.bodies.push(b);
    this.layout++;
    return b;
  }

  remove(b) {
    const index = this.bodies.indexOf(b);
    if (index < 0) return;
    this.bodies.splice(index, 1);
    this.scene.remove(b.object);
    b.onRemove?.();
    this.layout++;
  }

  clear() {
    for (const b of [...this.bodies]) this.remove(b);
  }

  // a small flotsam field in front of a viewpoint
  spawn(center, forward) {
    this.clear();
    const f = _f.copy(forward).setY(0).normalize(), side = new THREE.Vector3(-f.z, 0, f.x);
    const at = (ahead, across) => new THREE.Vector3().copy(center).addScaledVector(f, ahead).addScaledVector(side, across).setY(0.2);
    this.add('boat', at(22, -4), Math.atan2(f.x, f.z) + 1.2);
    this.add('buoy', at(38, 9));
    [[12, 3], [16, -9], [27, 6], [31, -1], [19, 12]].forEach(([a, c]) => this.add('crate', at(a, c)));
    [[14, -2], [24, 14], [34, -8]].forEach(([a, c]) => this.add('barrel', at(a, c)));
  }

  // sample points for this frame's water query
  collectPoints(extra) {
    let k = 0;
    for (const e of extra) { this.points[k++] = e.x; this.points[k++] = e.z; }
    for (const b of this.bodies) for (const p of b.world) { this.points[k++] = p.x; this.points[k++] = p.z; }
    this.count = k / 2;
    return this.points;
  }

  // consume a WaterQuery result (offset = number of non-body points submitted first)
  ingest(query, offset) {
    if (query.resultTag !== this.layout || query.resultTime === this.lastResultTime) return;
    const dtR = this.lastResultTime === undefined ? 0 : query.resultTime - this.lastResultTime;
    this.lastResultTime = query.resultTime;
    const r = query.result;
    let k = offset;
    for (const b of this.bodies) {
      for (let i = 0; i < b.world.length; i++, k++) {
        if (k >= query.resultCount) return;
        const h = r[k * 4], dx = r[k * 4 + 1], dz = r[k * 4 + 2];
        const w = b.water, ld = b.lastDisp;
        w[i * 4] = h;
        if (dtR > 1e-4 && !Number.isNaN(ld[i * 3])) {
          // water velocity from the change in displacement at a fixed point. At steep
          // fronts that overstates particle speed (the front sweeps past), so clamp to
          // roughly the largest orbital speeds these waves have
          const c = (v, m) => Math.max(-m, Math.min(m, v));
          w[i * 4 + 1] = c((dx - ld[i * 3]) / dtR, 3);
          w[i * 4 + 2] = c((h - ld[i * 3 + 1]) / dtR, 0.8);
          w[i * 4 + 3] = c((dz - ld[i * 3 + 2]) / dtR, 3);
        }
        ld[i * 3] = dx; ld[i * 3 + 1] = h; ld[i * 3 + 2] = dz;
      }
      b.ready = true;
    }
  }

  step(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP)), h = dt / steps;
    for (let s = 0; s < steps; s++) for (const b of this.bodies) this.integrate(b, h);
    for (const b of this.bodies) {
      b.object.position.copy(b.pos);
      b.object.quaternion.copy(b.quat);
    }
  }

  // Thin, light tile plates. The per-cell Archimedes spring in integrate() has no added
  // mass or hydrodynamic damping: for a 0.1 m plate at 100 kg/m³ it rings at ~9 Hz
  // nearly undamped, so the plate leaps and flutters on every wave (T5 owner QA).
  // As in the GPU tile field: critically damped relaxation of height and tilt to the
  // hydrostatic pose on the local water plane; the current carries it horizontally.
  follow(b, h) {
    const P = this.params, w = b.water, n = b.world.length;
    b.updateWorld();
    // Airborne (no cell touches water): plain free fall; entry makes the usual impact.
    let wet = false;
    for (let i = 0; i < n && !wet; i++) wet = w[i * 4] - b.world[i].y > -0.5 * b.desc.cellHeight;
    if (!wet) {
      b.vel.y -= G * h;
      b.pos.addScaledVector(b.vel, h);
      b.wet = false;
      return;
    }
    this.impact(b);
    let mx = 0, mz = 0, mh = 0, vx = 0, vz = 0, ly = 0;
    for (let i = 0; i < n; i++) {
      mx += b.world[i].x - b.pos.x; mz += b.world[i].z - b.pos.z; mh += w[i * 4];
      vx += w[i * 4 + 1]; vz += w[i * 4 + 3]; ly += b.desc.samples[i].y;
    }
    mx /= n; mz /= n; mh /= n;
    // least-squares water plane through the samples (ridge keeps collinear sets sane)
    let cxx = 0, cxz = 0, czz = 0, cxh = 0, czh = 0;
    for (let i = 0; i < n; i++) {
      const dx = b.world[i].x - b.pos.x - mx, dz = b.world[i].z - b.pos.z - mz, dh = w[i * 4] - mh;
      cxx += dx * dx; cxz += dx * dz; czz += dz * dz; cxh += dx * dh; czh += dz * dh;
    }
    const ridge = 1e-6 + 1e-3 * (cxx + czz);
    const xx = cxx + ridge, zz = czz + ridge, det = xx * zz - cxz * cxz;
    const a = (cxh * zz - czh * cxz) / det, c = (czh * xx - cxh * cxz) / det;
    const waterY = mh - a * mx - c * mz;

    // height: cell centres at the hydrostatic draft, exact critically damped step
    const draft = b.desc.cellHeight * (0.5 - b.desc.density / (RHO * P.buoyancy));
    const target = waterY + draft - ly / n;
    const f = 12 / (1 + 0.15 * P.drag), error = b.pos.y - target, k = b.vel.y + f * error, decay = Math.exp(-f * h);
    b.pos.y = target + (error + k * h) * decay;
    b.vel.y = (b.vel.y - f * k * h) * decay;

    // tilt: towards the water-plane normal (clamped to 20°, as the field), yaw just decays
    const normal = _w.set(-a, 1, -c).normalize();
    if (normal.y < Math.cos(0.34906585)) {
      const s = Math.sin(0.34906585) / Math.hypot(normal.x, normal.z);
      normal.set(normal.x * s, Math.cos(0.34906585), normal.z * s);
    }
    const up = _v.set(0, 1, 0).applyQuaternion(b.quat);
    const tiltError = _c.copy(up).cross(normal);
    const yawRate = b.angVel.dot(up);
    const tiltRate = _r.copy(b.angVel).addScaledVector(up, -yawRate);
    const fa = 10 / (1 + P.angularDrag);
    b.angVel.addScaledVector(tiltError, fa * fa * h).addScaledVector(tiltRate, -2 * fa * h)
      .addScaledVector(up, yawRate * (Math.exp(-P.angularDrag * h) - 1));
    const rate = b.angVel.length();
    if (rate > 1e-6) {
      _q.setFromAxisAngle(_f.copy(b.angVel).divideScalar(rate), rate * h);
      b.quat.premultiply(_q).normalize();
    }

    // horizontal: drag towards the water velocity, like the field's drift
    b.vel.x += P.drag * (vx / n - b.vel.x) * h;
    b.vel.z += P.drag * (vz / n - b.vel.z) * h;
    b.pos.x += b.vel.x * h;
    b.pos.z += b.vel.z * h;

    // beach / seabed: never below the ground, with friction
    let pen = 0;
    for (const p of b.world) pen = Math.max(pen, this.heightAt(p.x, p.z) - p.y);
    if (pen > 0) {
      b.pos.y += pen;
      b.vel.y = Math.max(b.vel.y, 0);
      b.vel.x *= Math.exp(-6 * h); b.vel.z *= Math.exp(-6 * h);
    }
    b.wet = true;
  }

  // hitting the water fast: ripple rings (and a splash) sized by the body and speed
  impact(b) {
    if (b.wet || b.vel.y >= -1.5) return;
    const s = b.desc.size;
    this.impacts.push({ x: b.pos.x, z: b.pos.z, t: this.time, amp: Math.min(0.35, 0.03 * -b.vel.y * Math.min(s.x, s.z)), size: Math.max(s.x, s.z) * 0.5 });
    if (this.impacts.length > 8) this.impacts.shift();
  }

  integrate(b, h) {
    if (!b.ready) return;
    const P = this.params;
    if (b.desc.follow && b.desc.density < RHO * P.buoyancy) { this.follow(b, h); return; }
    const force = _f.set(0, -b.mass * G, 0), torque = _t.set(0, 0, 0);
    const cell = b.desc.cellHeight;
    let wet = false;
    b.updateWorld();
    for (let i = 0; i < b.world.length; i++) {
      const p = b.world[i], w = b.water;
      _r.subVectors(p, b.pos);
      _vp.copy(b.angVel).cross(_r).add(b.vel);                 // velocity of this cell
      const sub = THREE.MathUtils.clamp((w[i * 4] - p.y) / cell + 0.5, 0, 1);
      if (sub > 0) {
        wet = true;
        _v.set(0, RHO * G * b.cellVolume * sub * P.buoyancy, 0);
        // drag against the moving water (gives orbital bobbing and surf push)
        const k = P.drag * b.cellMass * sub;
        _v.x -= (_vp.x - w[i * 4 + 1]) * k;
        _v.y -= (_vp.y - w[i * 4 + 2]) * k * 1.5;
        _v.z -= (_vp.z - w[i * 4 + 3]) * k;
        force.add(_v);
        torque.add(_c.copy(_r).cross(_v));
      }
      // beach / seabed contact: stiff spring + friction
      const ground = this.heightAt(p.x, p.z);
      const pen = ground - p.y;
      if (pen > 0) {
        const kN = b.cellMass * 900;
        _v.set(-_vp.x * b.cellMass * 6, pen * kN - _vp.y * b.cellMass * 40, -_vp.z * b.cellMass * 6);
        force.add(_v);
        torque.add(_c.copy(_r).cross(_v));
      }
    }
    if (wet) this.impact(b);
    b.wet = wet;
    b.vel.addScaledVector(force, h / b.mass);
    b.pos.addScaledVector(b.vel, h);

    // world inverse inertia = R diag(I^-1) R^T
    _m.setFromMatrix4(_m4.makeRotationFromQuaternion(b.quat));
    _mt.copy(_m).transpose();
    _w.copy(torque).applyMatrix3(_mt).multiply(b.invInertia).applyMatrix3(_m);
    b.angVel.addScaledVector(_w, h);
    b.angVel.multiplyScalar(Math.exp(-P.angularDrag * h));
    const a = b.angVel.length();
    if (a > 1e-6) {
      _q.setFromAxisAngle(_v.copy(b.angVel).divideScalar(a), a * h);
      b.quat.premultiply(_q).normalize();
    }
  }
}
