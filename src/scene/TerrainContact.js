import * as THREE from 'three';

// PlaneGeometry's diagonal connects (x+1,z) to (x,z+1), including the culled bed.
export const TERRAIN_CONTACT_GLSL = /* glsl */`
uniform highp sampler2D uTerrainContact;
uniform float uTerrainSize;
vec4 terrainAt(vec2 p) {
  ivec2 dims = textureSize(uTerrainContact, 0);
  if (any(greaterThan(abs(p), vec2(uTerrainSize * 0.5)))) return vec4(0.0, 1.0, 0.0, -1e20);
  float stepSize = uTerrainSize / float(dims.x - 1);
  vec2 grid = (p + uTerrainSize * 0.5) / stepSize;
  ivec2 cell = clamp(ivec2(floor(grid)), ivec2(0), dims - 2);
  vec2 f = grid - vec2(cell);
  float a = texelFetch(uTerrainContact, cell, 0).r;
  float b = texelFetch(uTerrainContact, cell + ivec2(1,0), 0).r;
  float c = texelFetch(uTerrainContact, cell + ivec2(0,1), 0).r;
  float d = texelFetch(uTerrainContact, cell + ivec2(1,1), 0).r;
  vec2 slope = f.x + f.y <= 1.0 ? vec2(b-a, c-a) : vec2(d-c, d-b);
  float h = f.x + f.y <= 1.0 ? a + dot(f, slope) : d + dot(f-1.0, slope);
  return vec4(normalize(vec3(-slope.x / stepSize, 1.0, -slope.y / stepSize)), h);
}
`;

export class TerrainContact {
  constructor(geometry, size) {
    this.size = size;
    this.segments = geometry.parameters.widthSegments;
    this.width = this.segments + 1;
    this.step = size / this.segments;
    this.heights = Float32Array.from(geometry.attributes.position.array.filter((_, i) => i % 3 === 1));
    this.texture = new THREE.DataTexture(this.heights, this.width, this.width, THREE.RedFormat, THREE.FloatType);
    this.texture.internalFormat = 'R32F';
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.uniforms = { uTerrainContact: { value: this.texture }, uTerrainSize: { value: size } };
    this.steepBounds = [];
    const h=this.heights,w=this.width,step=this.step,half=size/2;
    for(let j=0;j<this.segments;j++)for(let i=0;i<this.segments;i++){
      const k=j*w+i,a=h[k],b=h[k+1],c=h[k+w],d=h[k+w+1];
      if(Math.max(Math.hypot(b-a,c-a),Math.hypot(d-c,d-b))/step<=Math.tan(55*Math.PI/180))continue;
      this.steepBounds.push({minX:i*step-half,maxX:(i+1)*step-half,
        minZ:j*step-half,maxZ:(j+1)*step-half});
    }
  }

  at(x, z) {
    if (Math.max(Math.abs(x), Math.abs(z)) > this.size / 2) return null;
    const gx = (x + this.size / 2) / this.step, gz = (z + this.size / 2) / this.step;
    const i = Math.min(this.segments - 1, Math.max(0, Math.floor(gx)));
    const j = Math.min(this.segments - 1, Math.max(0, Math.floor(gz)));
    const u = gx - i, v = gz - j, k = j * this.width + i, h = this.heights;
    const a = h[k], b = h[k+1], c = h[k+this.width], d = h[k+this.width+1];
    const sx = u + v <= 1 ? b-a : d-c, sz = u + v <= 1 ? c-a : d-b;
    return { height: u + v <= 1 ? a + u*sx + v*sz : d + (u-1)*sx + (v-1)*sz,
      normal: new THREE.Vector3(-sx / this.step, 1, -sz / this.step).normalize() };
  }

  // Traverse crossed grid cells in ray order, then intersect both actual triangles.
  // Offset moves the support surface to the captured tile's visible height.
  raycast(ray, offset = 0, maxDistance = 6000) {
    const half = this.size / 2, o = ray.origin, d = ray.direction;
    let enter = 0, exit = maxDistance;
    for (const axis of ['x', 'z']) {
      if (Math.abs(d[axis]) < 1e-12) { if (Math.abs(o[axis]) > half) return null; }
      else {
        const a = (-half-o[axis])/d[axis], b = (half-o[axis])/d[axis];
        enter = Math.max(enter, Math.min(a,b)); exit = Math.min(exit, Math.max(a,b));
      }
    }
    if (enter > exit) return null;
    const p = ray.at(enter + 1e-7, new THREE.Vector3());
    let i = Math.min(this.segments-1, Math.max(0, Math.floor((p.x+half)/this.step)));
    let j = Math.min(this.segments-1, Math.max(0, Math.floor((p.z+half)/this.step)));
    const sx = Math.sign(d.x), sz = Math.sign(d.z);
    let tx = sx ? (-half+(i+(sx>0 ? 1:0))*this.step-o.x)/d.x : Infinity;
    let tz = sz ? (-half+(j+(sz>0 ? 1:0))*this.step-o.z)/d.z : Infinity;
    const dx = sx ? this.step/Math.abs(d.x) : Infinity, dz = sz ? this.step/Math.abs(d.z) : Infinity;
    const vertex = (x,z) => new THREE.Vector3(-half+x*this.step, this.heights[z*this.width+x]+offset, -half+z*this.step);
    while (i>=0 && j>=0 && i<this.segments && j<this.segments) {
      const a=vertex(i,j), b=vertex(i+1,j), c=vertex(i,j+1), e=vertex(i+1,j+1);
      let best = null;
      for (const tri of [[a,c,b],[b,c,e]]) {
        const hit = ray.intersectTriangle(...tri, false, new THREE.Vector3());
        if (hit && hit.distanceTo(o) <= exit && (!best || hit.distanceToSquared(o)<best.distanceToSquared(o))) best=hit;
      }
      if (best) return best;
      const next = Math.min(tx,tz);
      if (next > exit || !Number.isFinite(next)) break;
      if (tx <= next) { i+=sx; tx+=dx; }
      if (tz <= next) { j+=sz; tz+=dz; }
    }
    return null;
  }

  dispose() { this.texture.dispose(); }
}
