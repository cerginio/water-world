import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTerrain } from '../src/scene/terrainGeometry.js';
import { TerrainContact } from '../src/scene/TerrainContact.js';
import { tileTiltMatrix } from '../src/tiles/tileTilt.js';

const { geometry, heightMap } = buildTerrain();
const contact = new TerrainContact(geometry,2400);
const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
mesh.updateMatrixWorld();
let maxHeightError=0, maxRayError=0, checked=0;
// Independent oracle: real rendered triangle intersections, not an interpolation copy.
for(let k=0;k<70;k++) {
  const x=Math.sin((k+0.37)*2.399)*600,z=Math.cos((k+0.19)*1.873)*600;
  const ray=new THREE.Raycaster(new THREE.Vector3(x,200,z),new THREE.Vector3(0,-1,0));
  const actual=ray.intersectObject(mesh)[0];
  if (!actual) continue; // renderer intentionally removes deep triangles
  const h=contact.at(x,z);
  maxHeightError=Math.max(maxHeightError,Math.abs(h.height-actual.point.y));
  assert(h.normal.dot(actual.face.normal)>1-1e-9);
  const oblique=new THREE.Ray(actual.point.clone().add(new THREE.Vector3(17,70,23)),new THREE.Vector3(-17,-70,-23).normalize());
  const first=new THREE.Raycaster(oblique.origin,oblique.direction).intersectObject(mesh)[0];
  maxRayError=Math.max(maxRayError,contact.raycast(oblique).distanceTo(first.point));
  checked++;
}
assert(checked>40); assert(maxHeightError<1e-5); assert(maxRayError<1e-5);
assert.equal(contact.at(1200.1,0),null);
assert.equal(contact.raycast(new THREE.Ray(new THREE.Vector3(1300,100,0),new THREE.Vector3(0,-1,0))),null);
assert(contact.at(1100,1100).height < -34);
assert(contact.raycast(new THREE.Ray(new THREE.Vector3(1100,100,1100),new THREE.Vector3(0,-1,0))).y < -34);
for (const angle of [0,20,30,55]) {
  const n=new THREE.Vector3(0,1,0).applyMatrix4(tileTiltMatrix(angle*Math.PI/180,0));
  assert(Math.abs(n.angleTo(new THREE.Vector3(0,1,0))-angle*Math.PI/180)<1e-7);
}
assert.equal(contact.texture.minFilter,THREE.NearestFilter);
console.log(JSON.stringify({pass:true,checked,maxHeightError,maxRayError,vertices:contact.heights.length}));
contact.dispose(); geometry.dispose(); heightMap.dispose(); mesh.material.dispose();
