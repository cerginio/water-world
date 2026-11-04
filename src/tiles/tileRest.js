import * as THREE from 'three';
import { convexFootprint } from './tileContact.js';

// Compiled Tilecraft records → rest arrays of the field (spec.md §4), taken once per load.
// After this the Tilecraft meshes are disposed; the field draws its own copies.
//
// Every tile gets a field-wide id 0..N-1 (the texel of its state in T1+). Per tile, in
// world metres relative to the model's bounds centre:
//   x, z, yaw, radius   placement in the plane
//   y0, thickness       centre height (layer elevation + group depth step) and prism height
//   runId               polyline run the tile belongs to, -1 for polygon tiles
//   flags               bit 0: polyline tile
//   g, f                Tilecraft group and frame id

const FLAG_POLYLINE = 1;

export function collectTileRest(compiled, { frame = 'all' } = {}) {
  const layers = compiled.inspected.layers;
  const space = compiled.space;
  const wanted = (r) => frame === 'all' || r.frameId === frame;
  const instanceRecords = compiled.records.filter((r) => r.kind === 'instances' && r.hasGeometry && wanted(r));
  const roadRecords = compiled.records.filter((r) => r.kind === 'road' && r.hasGeometry && wanted(r));

  const tiles = [];   // { x, z, yaw, radius, y0, thickness, runId, flags, g, f }
  const polygon = instanceRecords.map((r) => collectInstances(r, layers, tiles));
  const footprints = new Array(tiles.length);
  for (const part of polygon) {
    const pos = part.geometry.attributes.position;
    const bottom = Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)));
    const vertices = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= bottom + 1e-6) vertices.push(new THREE.Vector3().fromBufferAttribute(pos, i));
    for (let i = 0; i < part.count; i++) {
      const matrix = new THREE.Matrix4().fromArray(part.matrices, i * 16);
      matrix.setPosition(0, 0, 0);
      footprints[part.tile[i]] = convexFootprint(vertices.map(v => v.clone().applyMatrix4(matrix)));
    }
  }
  const runs = [];
  const polyline = roadRecords.map((r) => collectRoad(r, layers, space, tiles, runs));
  let maxPolylineLength = 0;
  for (const part of polyline) {
    const owners = new Map(),sourceCount=part.aTile.length/2;
    for (let v = 0; v < part.aTile.length / 2; v++) {
      const id = part.aTile[v];
      if (!owners.has(id)) owners.set(id, new Set());
      owners.get(id).add(v);
    }
    // Shared joints can put a face's vertices under different rigid owners.
    // Include the incident lower faces, so support and slope validation cover
    // their interiors as well as their corners.
    const index=part.geometry.index;
    for(let i=0;i<(index?.count??part.aTile.length);i+=3){
      const vertices=[0,1,2].map(k=>(index?index.getX(i+k):i+k)%sourceCount);
      for(const id of new Set(vertices.map(v=>part.aTile[v])))for(const v of vertices)owners.get(id).add(v);
    }
    for (const [id, members] of owners) {
      const vertices=Array.from(members,v=>{
        const owner=tiles[part.aTile[v]],tile=tiles[id];
        return new THREE.Vector3().fromArray(part.aOffset,v*3).add(new THREE.Vector3(owner.x-tile.x,owner.y0-tile.y0,owner.z-tile.z));
      });
      let hull = convexFootprint(vertices);
      // A shared road joint may give an owner only one point or one edge.
      // Those vertices still render and need support. Give their degenerate
      // footprint a 10-micrometre envelope, below the contact error budget.
      if(hull.length<3) hull=convexFootprint(hull.flatMap(p=>[
        new THREE.Vector3(p.x-1e-5,p.y,p.z-1e-5),new THREE.Vector3(p.x+1e-5,p.y,p.z-1e-5),
        new THREE.Vector3(p.x+1e-5,p.y,p.z+1e-5),new THREE.Vector3(p.x-1e-5,p.y,p.z+1e-5)]));
      footprints[id] = hull;
      for (const a of hull) for (const b of hull) maxPolylineLength = Math.max(maxPolylineLength, a.distanceTo(b));
    }
  }

  const n = tiles.length;
  const rest = {
    count: n, footprints,
    x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), radius: new Float32Array(n),
    y0: new Float32Array(n), thickness: new Float32Array(n), runId: new Int32Array(n), flags: new Uint8Array(n),
    g: new Int32Array(n), f: new Array(n),
  };
  tiles.forEach((t, i) => { for (const k of Object.keys(t)) rest[k][i] = t[k]; });

  // Buoyancy removes y0 from the simulated equilibrium. Retain the source's
  // layer/group ordering for rendering, plus a tiny order within each group:
  // overlapping polygon instances in ONE group also have coplanar top faces.
  // Keep this separate from physical draft and constant across waveScale changes.
  rest.surfaceOffset = new Float32Array(n);
  const members = new Map();
  let base = Infinity;
  for (let i = 0; i < n; i++) {
    const bottom = rest.y0[i] - rest.thickness[i] / 2;
    base = Math.min(base, bottom);
    const key = `${typeof rest.f[i]}:${rest.f[i]}:${rest.g[i]}:${bottom}`;
    const ordinal = members.get(key) ?? 0;
    members.set(key, ordinal + 1);
    rest.surfaceOffset[i] = bottom + ordinal * 0.0001;
  }
  for (let i = 0; i < n; i++) rest.surfaceOffset[i] -= base;

  const box = new THREE.Box2();
  for (let i = 0; i < n; i++) box.expandByPoint(new THREE.Vector2(rest.x[i], rest.z[i]));
  const groups = new Set(rest.g).size;
  return { tiles: rest, polygon, polyline, runs, groups, bounds: box, maxPolylineLength };
}

// InstancedMesh record: one tile per instance; the prototype geometry is kept as built
function collectInstances(record, layers, tiles) {
  const mesh = record.mesh, layer = layers[record.layerIndex].layer;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const e = new THREE.Euler();
  const ids = new Int32Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    e.setFromQuaternion(q, 'YXZ');
    const tile = layer.tiles[mesh.userData.instanceSources[i].tileIndex];
    ids[i] = tiles.length;
    tiles.push({ x: p.x, z: p.z, yaw: e.y, radius: s.x / 2, y0: p.y, thickness: s.y, runId: -1, flags: 0, g: tile.g ?? -1, f: record.frameId ?? null });
  }
  const material = mesh.material;
  return {
    layerIndex: record.layerIndex, frameId: record.frameId, count: mesh.count, tile: ids,
    geometry: mesh.geometry.clone(),
    matrices: mesh.instanceMatrix.array.slice(),
    colors: mesh.instanceColor ? mesh.instanceColor.array.slice() : null,
    roughness: material.roughness, opacity: material.opacity, transparent: material.transparent,
  };
}

// LCR prism record: geometry as built, plus the owner tile of every vertex (П2: the LCR
// writer stores `p.tileIndex`, an index into layer.tiles) and its offset from that owner
function collectRoad(record, layers, space, tiles, runs) {
  const mesh = record.mesh, geometry = mesh.geometry, layer = layers[record.layerIndex].layer;
  const sourceCount = geometry.userData.sourceVertexCount;
  const owners = geometry.userData.sourceOwners;
  const pos = geometry.getAttribute('position').array;
  const baseY = mesh.position.y;
  const thickness = pos[sourceCount * 3 + 1] - pos[1];

  const idOf = new Map();   // layer tile index → field tile id
  const vertexTile = new Int32Array(sourceCount).fill(-1);
  const stats = { vertices: sourceCount, ownerless: 0, foreign: 0, nearestOwners: 0, seamOwners: 0, maxOffset: 0 };
  for (const range of record.runRanges) {
    const runId = runs.length;
    const members = range.sourceRef.tileIndices;
    runs.push({ layerIndex: record.layerIndex, groupId: range.sourceRef.groupId, frameId: range.sourceRef.frameId, tiles: [] });
    const runY = baseY + pos[range.firstVertex * 3 + 1] + thickness / 2;
    for (const ti of members) {
      if (idOf.has(ti)) continue;
      const tile = layer.tiles[ti];
      idOf.set(ti, tiles.length);
      runs[runId].tiles.push(tiles.length);
      tiles.push({
        x: (tile.x - space.origin.x) * space.unit, z: (tile.y - space.origin.y) * space.unit, yaw: 0,
        // half of the stroke width at this tile, the same formula as Tilecraft's roadWidth
        radius: 0.25 * (tile.s ?? 1) * (layer.gridSize ?? 1) * (layer.scale ?? 1) * space.unit,
        y0: runY, thickness, runId, flags: FLAG_POLYLINE, g: tile.g ?? -1, f: record.frameId ?? null,
      });
    }
    // LCR's source owner identifies the generating segment, which can be metres
    // away from a tessellated joint. Use the nearest member for deformation even
    // when the source owner is valid, so tiny joint edges don't span distant bodies.
    const memberSet = new Set(members);
    for (let v = range.firstVertex; v < range.firstVertex + range.vertexCount; v++) {
      const o = owners ? owners[v] : -1;
      vertexTile[v] = nearest(pos[v * 3], pos[v * 3 + 2], runs[runId].tiles, tiles);
      if (o < 0) stats.ownerless++;
      else if (!memberSet.has(o)) stats.foreign++;
      else if (vertexTile[v] !== idOf.get(o)) stats.nearestOwners++;
    }
  }

  // vertices outside every run: nearest tile of the whole record
  const all = [...idOf.values()];
  for (let v = 0; v < sourceCount; v++) {
    if (vertexTile[v] >= 0) continue;
    stats.ownerless++;
    vertexTile[v] = nearest(pos[v * 3], pos[v * 3 + 2], all, tiles);
  }

  // LCR duplicates joint vertices (faces/caps) with different sourceOwners.
  // Independent rigid owner transforms would tear those coincident vertices apart.
  // Give each rest joint ONE owner, within its run only; top and bottom still share it.
  const joints = new Map();
  for (let v = 0; v < sourceCount; v++) {
    const id = vertexTile[v];
    const key = `${tiles[id].runId}:${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    const owner = joints.get(key);
    if (owner === undefined) joints.set(key, id);
    else if (owner !== id) { vertexTile[v] = owner; stats.seamOwners++; }
  }

  // per-vertex attributes for T1: owner tile id and rest offset from it (top vertex i+sourceCount
  // shares the owner of i)
  const count = sourceCount * 2;
  const aTile = new Float32Array(count), aOffset = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const id = vertexTile[v % sourceCount], t = tiles[id];
    aTile[v] = id;
    const dx = pos[v * 3] - t.x, dy = baseY + pos[v * 3 + 1] - t.y0, dz = pos[v * 3 + 2] - t.z;
    aOffset[v * 3] = dx; aOffset[v * 3 + 1] = dy; aOffset[v * 3 + 2] = dz;
    stats.maxOffset = Math.max(stats.maxOffset, Math.hypot(dx, dz));   // metres; tapered tails have near-zero radius
  }

  const material = mesh.material;
  return {
    layerIndex: record.layerIndex, frameId: record.frameId,
    geometry: geometry.clone(), baseY, aTile, aOffset, stats,
    opacity: material.opacity,
    transparent: material.transparent, roughness: material.roughness ?? 0.9,
  };
}

function nearest(x, z, ids, tiles) {
  let best = ids[0], bd = Infinity;
  for (const id of ids) {
    const t = tiles[id], d = (t.x - x) ** 2 + (t.z - z) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
