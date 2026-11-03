import * as THREE from 'three';
import { tileTiltMatrix } from './tileTilt.js';
import { TILE_VERTICAL_LIMIT } from './tileBounds.js';

// Group ids are scoped to their frame; ungrouped polygon tiles stay independent.
export function promotionMembers(rest, id) {
  const t = rest.tiles;
  if (!Number.isInteger(id) || id < 0 || id >= t.count) return [];
  if (t.flags[id] & 1) return [...rest.runs[t.runId[id]].tiles];
  if (t.g[id] < 0) return [id];
  return Array.from({ length: t.count }, (_, i) => i)
    .filter(i => !(t.flags[i] & 1) && t.g[i] === t.g[id]
      && (t.frameIndex ? t.frameIndex[i] === t.frameIndex[id] : t.f[i] === t.f[id]));
}

// Same rotation vector and render envelope as TileMaterial (not a new physics model).
export function tileSnapshotPose(tiles, id, state0, state1, motionLimit) {
  const k = id * 4;
  const dx = state0[k + 2], dz = state0[k + 3];
  const gain = Math.min(1, motionLimit / Math.max(Math.hypot(dx, dz), 0.00001));
  const center = new THREE.Vector3(tiles.x[id] + dx * gain,
    tiles.y0[id] + THREE.MathUtils.clamp(state0[k], -TILE_VERTICAL_LIMIT, TILE_VERTICAL_LIMIT)
      + THREE.MathUtils.lerp(tiles.surfaceOffset[id], Math.min(tiles.surfaceOffset[id], 0.001), state1[k + 2]), tiles.z[id] + dz * gain);
  const tilt = tileTiltMatrix(state1[k], state1[k + 1]);
  return { center, tilt };
}

// Farthest-point samples over the footprint (xz). Collinear samples leave a
// plate without buoyant roll stiffness: it capsizes and is launched (T5 QA).
export function footprintSamples(points, limit = 8) {
  if (!points.length) return [];
  const center = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
  const flat = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  let next = 0;
  points.forEach((p, i) => { if (flat(p, center) > flat(points[next], center)) next = i; });
  const nearest = new Float64Array(points.length).fill(Infinity), picked = [];
  while (picked.length < limit) {
    const chosen = points[next];
    if (picked.length && !(nearest[next] > 1e-12)) break;
    picked.push(chosen.clone());
    next = 0;
    for (let i = 0; i < points.length; i++) {
      nearest[i] = Math.min(nearest[i], flat(points[i], chosen));
      if (nearest[i] > nearest[next]) next = i;
    }
  }
  return picked;
}

// Bake ONLY the promoted group, once on a gesture, using the current GPU pose.
// Plain copied meshes thereafter travel through the existing Floaters pipeline.
export function makePromotionDescriptor(field, ids, state0, state1) {
  const rest = field.rest, t = rest.tiles, selected = new Set(ids);
  const poses = new Map(ids.map(id => [id, tileSnapshotPose(t, id, state0, state1,
    field.sim.uniforms.uTileMotionLimit.value)]));
  for (const [id, pose] of poses) {
    const frame = field.frameRegistry?.entries[t.frameIndex?.[id]];
    if (frame) pose.center.add(frame.offset);
  }
  const object = new THREE.Group();
  object.name = 'promoted-tile-group';
  const bounds = new THREE.Box3();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const footprint = [];
  const addGeometry = (part, positions, normals, colors, colorSize) => {
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, colorSize));
    const mesh = new THREE.Mesh(geometry, field.material(part, true));
    // Polygon prototypes keep their original front-side culling.
    if (part.tile) mesh.material.side = THREE.FrontSide;
    mesh.layers.enable(1);
    object.add(mesh);
  };
  for (const part of [...rest.polygon, ...rest.polyline]) {
    const geometry = part.geometry, position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const positions = [], normals = [], colors = [];
    // Polygon prototypes were drawn with instance colours only (vertexColors off).
    // Road colours are LCR RGBA: read through the attribute, never as packed RGB.
    const colorSize = part.tile ? 3 : (color?.itemSize === 4 ? 4 : 3);
    const appendColor = (v, instanceColor) => {
      if (part.tile) { for (let c = 0; c < 3; c++) colors.push(instanceColor?.[c] ?? 1); return; }
      colors.push(color ? color.getX(v) : 1, color ? color.getY(v) : 1, color ? color.getZ(v) : 1);
      if (colorSize === 4) colors.push(color.getW(v));
    };
    const append = (v, matrix, normalMatrix, instanceColor, height) => {
      p.fromBufferAttribute(position, v).applyMatrix4(matrix);
      n.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize();
      positions.push(p.x, p.y, p.z); bounds.expandByPoint(p);
      footprint.push(new THREE.Vector3(p.x, height, p.z));
      normals.push(n.x, n.y, n.z);
      appendColor(v, instanceColor);
    };
    if (part.tile) {
      for (let instance = 0; instance < part.count; instance++) {
        const id = part.tile[instance];
        if (!selected.has(id)) continue;
        const pose = poses.get(id);
        const matrix = pose.tilt.clone().multiply(new THREE.Matrix4().fromArray(part.matrices, instance * 16));
        matrix.setPosition(pose.center);
        const nm = new THREE.Matrix3().getNormalMatrix(matrix);
        const rgb = part.colors?.subarray(instance * 3, instance * 3 + 3);
        for (let j = 0; j < count; j++) append(index ? index.getX(j) : j, matrix, nm, rgb, pose.center.y);
      }
    } else {
      for (let j = 0; j < count; j += 3) {
        const vertices = [0, 1, 2].map(c => index ? index.getX(j + c) : j + c);
        if (!vertices.every(v => selected.has(part.aTile[v]))) continue;
        for (const v of vertices) {
          const pose = poses.get(part.aTile[v]);
          p.fromArray(part.aOffset, v * 3).applyMatrix4(pose.tilt).add(pose.center);
          n.fromBufferAttribute(normal, v).transformDirection(pose.tilt);
          positions.push(p.x, p.y, p.z); bounds.expandByPoint(p);
          footprint.push(new THREE.Vector3(p.x, pose.center.y, p.z));
          normals.push(n.x, n.y, n.z);
          appendColor(v);
        }
      }
    }
    addGeometry(part, positions, normals, colors, colorSize);
  }
  if (bounds.isEmpty()) throw new Error('Tile group has no geometry');
  // Body origin = volume-weighted centre of the tiles (where Floaters applies
  // gravity), not the bounds centre: a lopsided group would otherwise carry a
  // constant gravity/buoyancy torque and capsize.
  let volume = 0, weightedHeight = 0;
  const center = new THREE.Vector3();
  for (const id of ids) {
    const v = Math.PI * t.radius[id] ** 2 * t.thickness[id];
    volume += v; weightedHeight += v * t.thickness[id];
    center.addScaledVector(poses.get(id).center, v);
  }
  if (!(volume > 0)) { disposePromotion({ object }); throw new Error('Tile group has zero volume'); }
  center.divideScalar(volume);
  for (const mesh of object.children) {
    mesh.geometry.translate(-center.x, -center.y, -center.z);
    mesh.geometry.computeBoundingSphere();
  }
  const size = bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.001, 0.001, 0.001));
  // Equal-volume cells: their centroid is the centre of buoyancy. Put it under
  // the centre of mass so flat water gives no capsizing torque.
  const samples = footprintSamples(footprint).map(p => p.sub(center));
  const drift = samples.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(samples.length);
  for (const sample of samples) { sample.x -= drift.x; sample.z -= drift.z; }
  field.group.updateWorldMatrix(true, false);
  const positionWorld = center.clone().applyMatrix4(field.group.matrixWorld);
  return { object, volume, size, samples, density: field.params.density, follow: true,
    cellHeight: Math.max(weightedHeight / volume, 0.001), positionWorld,
    yaw: field.group.rotation.y };
}

export function disposePromotion(desc) {
  for (const mesh of desc.object.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
}
