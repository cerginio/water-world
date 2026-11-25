import * as THREE from 'three';

// The C-kite of the raft and the board (story-quest Q5a, docs/story-quest/c-kite-redesign.md):
// a four-line C-shaped wing with an inflatable leading edge, three struts and a control bar.
// Built once; pose() moves it every frame AFTER the walker has stepped (TileRaft.pose), so
// the bar takes the walker's feet of this frame. Only buffers and transforms change per frame.
//
// The wing's local frame (the sketch's P(u, v)): x — the span, y — away from the bar (the
// lines run down -y), z — the chord, the leading edge at v = 0 towards -z. u ∈ [-1, 1] across
// the span, v ∈ [0, 1] from the leading edge to the trailing edge.

const UP = new THREE.Vector3(0, 1, 0);

export const C_KITE = Object.freeze({
  arc: 145,          // ° of the C
  radius: 2.8,       // m: the arc's radius → ~7 m of flat span
  chord: 2.75,       // m at the centre; mean ~2.3 m → flat span : mean chord ≈ 3 : 1
  taper: 0.45,       // the chord at the tips is (1 − taper) of the centre's
  sweep: 1.5,        // m the tips are swept back: the trailing edge too reads as an arch, not a bowl
  camber: 0.3,       // m of profile depth along the chord (sin(πv))
  billow: 0.22,      // m the canopy bulges between the struts at full wind
  windFull: 20,      // m/s of wind that gives the full billow
  struts: [-0.63, 0, 0.63],
  seams: [-0.82, -0.32, 0.32, 0.82],
  leRadius: 0.17,    // m: the inflatable leading edge
  strutRadius: 0.07,
  segments: [48, 16], // the canopy: across the span × along the chord
  tilt: -0.3,        // rad: the base pitch about the span — the tips down the lines, the C in view of the bar
  sway: 1.4,         // m side to side…
  swayPeriod: 7.5,   // …over this many seconds
  roll: 0.1,         // rad with the sway
  pitch: 0.04,       // rad of slow pitch
  bob: 0.35,         // m up and down
  bar: 0.55,         // m: the control bar, across the line of pull
  barRadius: 0.016,
  node: 0.07,        // m: the central node of the power lines, ahead of the bar's middle
});

const DEG = Math.PI / 180;

/** The wing's surface at (u, v), billowed by `w` ∈ [0, 1], into `out` (local metres). */
export function wingPoint(u, v, w = 0, out = new THREE.Vector3()) {
  const s = C_KITE;
  const a = u * s.arc * DEG / 2;
  const chord = s.chord * (1 - s.taper * u * u);
  const r = s.radius + s.camber * Math.sin(v * Math.PI) + s.billow * w * billowAt(u) * Math.sin(v * Math.PI);
  return out.set(r * Math.sin(a), r * Math.cos(a) - 0.55 * s.radius, (v - 0.42) * chord + s.sweep * u * u);
}

// 0 on the struts and at the tips, 1 halfway between: the canopy bulges between the battens,
// the frame (leading edge, struts, trailing edge) stays where it is
function billowAt(u) {
  const stops = [-1, ...C_KITE.struts, 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (u <= stops[i + 1]) return Math.sin(Math.PI * (u - stops[i]) / (stops[i + 1] - stops[i])) ** 2;
  }
  return 0;
}

function tube(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, radius, 8, false), material);
  mesh.layers.enable(1);
  return mesh;
}

/**
 * Build the kite into `group` (a THREE.Group already in the scene).
 * @returns {{ pose: (dt: number, at: { kite: THREE.Vector3, bar: THREE.Vector3, along: THREE.Vector3, wind: number }) => void,
 *   anchors: () => { wing: THREE.Vector3[], bar: THREE.Vector3[] }, dispose: () => void, wing: THREE.Group }}
 */
export function createCKite(group) {
  const s = C_KITE;
  const [nu, nv] = s.segments;
  const wing = new THREE.Group();
  wing.name = 'kite-wing';

  // the canopy: one indexed sheet, both sides drawn; pushed back a hair so the seams win
  const canopy = new THREE.BufferGeometry();
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  canopy.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const index = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  canopy.setIndex(index);
  const cloth = new THREE.MeshStandardMaterial({ color: 0xc0643f, roughness: 0.72, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const sail = new THREE.Mesh(canopy, cloth);
  sail.name = 'kite-canopy';
  sail.layers.enable(1);
  sail.frustumCulled = false;

  // the seams, faint, along the chord; and the thin trailing edge
  const seamGeo = new THREE.BufferGeometry();
  const seamPos = new Float32Array(s.seams.length * nv * 2 * 3);
  seamGeo.setAttribute('position', new THREE.BufferAttribute(seamPos, 3));
  const seams = new THREE.LineSegments(seamGeo, new THREE.LineBasicMaterial({ color: 0x8e4c35, transparent: true, opacity: 0.45 }));
  seams.frustumCulled = false;

  const frame = new THREE.MeshStandardMaterial({ color: 0x4a332a, roughness: 0.55 });
  const p = new THREE.Vector3();
  const along = (n, f) => Array.from({ length: n + 1 }, (_, k) => f(k / n));
  const leading = tube(along(40, (t) => wingPoint(-1 + 2 * t, 0)), s.leRadius, frame);
  const struts = s.struts.map((u) => tube(along(12, (t) => wingPoint(u, t)), s.strutRadius, frame));
  const trailing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(along(48, (t) => wingPoint(-1 + 2 * t, 1))),
    new THREE.LineBasicMaterial({ color: 0x7d4532 }));
  wing.add(sail, seams, leading, ...struts, trailing);
  group.add(wing);

  // the four lines (world): the power lines from the leading-edge tips to the node, the
  // steering lines from the trailing-edge tips to the ends of the bar on their own side
  const lineGeo = (n) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  };
  const power = new THREE.LineSegments(lineGeo(4), new THREE.LineBasicMaterial({ color: 0x5d6b78 }));
  const steer = new THREE.LineSegments(lineGeo(4), new THREE.LineBasicMaterial({ color: 0x6e5a48 }));
  power.frustumCulled = steer.frustumCulled = false;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(s.barRadius, s.barRadius, s.bar, 10),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5 }));
  bar.name = 'kite-bar';
  const node = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6 }));
  node.name = 'kite-node';
  group.add(power, steer, bar, node);

  let time = 0, billow = -1;
  const tips = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ends = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  function shape(w) {
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      wingPoint(-1 + 2 * i / nu, j / nv, w, p);
      pos.set([p.x, p.y, p.z], (i * (nv + 1) + j) * 3);
    }
    canopy.attributes.position.needsUpdate = true;
    canopy.computeVertexNormals();
    let k = 0;
    for (const u of s.seams) for (let j = 0; j < nv; j++) {
      wingPoint(u, j / nv, w, p); seamPos.set([p.x, p.y, p.z], k); k += 3;
      wingPoint(u, (j + 1) / nv, w, p); seamPos.set([p.x, p.y, p.z], k); k += 3;
    }
    seamGeo.attributes.position.needsUpdate = true;
  }

  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3(), m = new THREE.Matrix4();
  const lean = new THREE.Quaternion(), q = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);

  return {
    wing,
    /**
     * at.kite — where the kite flies (world); at.bar — the bar's centre (world); at.along — the
     * horizontal unit direction of pull; at.wind — the wind, m/s.
     */
    pose(dt, at) {
      time += Math.max(0, dt);
      // the canopy: rebuilt only when the billow has moved by a visible amount
      const w = Math.min(1, Math.max(0, at.wind / s.windFull)) * (1 + 0.08 * Math.sin(time * 2.3));
      if (Math.abs(w - billow) > 0.01) { billow = w; shape(w); }
      // across the pull: horizontal, so the bar stays level and the sway cannot shake it
      x.crossVectors(UP, at.along).normalize();
      const ph = time * 2 * Math.PI / s.swayPeriod;
      const kite = at.kite.clone().addScaledVector(x, s.sway * Math.sin(ph)).addScaledVector(UP, s.bob * Math.sin(ph * 2 + 0.7));
      // the wing's y from the bar to the kite, its leading edge up and into the wind
      y.subVectors(kite, at.bar).normalize();
      const xs = x.clone().addScaledVector(y, -x.dot(y)).normalize();
      z.crossVectors(xs, y);
      m.makeBasis(xs, y, z);
      wing.position.copy(kite);
      wing.quaternion.setFromRotationMatrix(m);
      // the base tilt and slow pitch about the span, the roll with the sway about the chord
      lean.setFromAxisAngle(AX, s.tilt + s.pitch * Math.sin(ph * 1.3 + 1.1));
      q.setFromAxisAngle(AZ, -s.roll * Math.cos(ph));
      wing.quaternion.multiply(lean).multiply(q);
      wing.updateMatrixWorld(true);
      // the bar across the pull, its ends on the kite's sides, the node just ahead of its middle
      ends[0].copy(at.bar).addScaledVector(x, -s.bar / 2);
      ends[1].copy(at.bar).addScaledVector(x, s.bar / 2);
      ends[2].copy(at.bar).addScaledVector(at.along, s.node);
      bar.position.copy(at.bar);
      bar.quaternion.setFromUnitVectors(UP, x);
      node.position.copy(ends[2]);
      // the wing's corners as the canopy has them now, to world
      wingPoint(-1, 0, 0, tips[0]).applyMatrix4(wing.matrixWorld);
      wingPoint(1, 0, 0, tips[1]).applyMatrix4(wing.matrixWorld);
      wingPoint(-1, 1, 0, tips[2]).applyMatrix4(wing.matrixWorld);
      wingPoint(1, 1, 0, tips[3]).applyMatrix4(wing.matrixWorld);
      const pp = power.geometry.attributes.position, sp = steer.geometry.attributes.position;
      [tips[0], ends[2], tips[1], ends[2]].forEach((v, i) => pp.setXYZ(i, v.x, v.y, v.z));
      [tips[2], ends[0], tips[3], ends[1]].forEach((v, i) => sp.setXYZ(i, v.x, v.y, v.z));
      pp.needsUpdate = sp.needsUpdate = true;
    },
    /** For tests and probes: the line ends on the wing [LE−, LE+, TE−, TE+] and at the bar [−, +, node]. */
    anchors: () => ({ wing: tips.map((v) => v.clone()), bar: ends.map((v) => v.clone()) }),
    dispose() {
      group.remove(wing, power, steer, bar, node);
      for (const o of [sail, seams, leading, ...struts, trailing, power, steer, bar, node]) {
        o.geometry.dispose();
        /** @type {any} */ (o.material).dispose();
      }
    },
  };
}
