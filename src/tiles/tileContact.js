// Max of a piecewise planar heightfield minus the tile's lower plane. Candidates
// are footprint corners, crossed grid edges (including diagonals), and inner nodes.
export const TILE_CONTACT_GLSL = /* glsl */`
uniform int uStateHeight;
vec3 footprint[TILE_FOOTPRINT_VERTICES];
int footprintCount;
vec3 supportNormal;
vec3 supportOrigin;
float supportHeight;
float cross2(vec2 a, vec2 b) { return a.x*b.y-a.y*b.x; }
void supportCandidate(vec2 p) {
  vec4 ground = terrainAt(p);
  float bottom = supportOrigin.y - dot(supportNormal.xz, p-supportOrigin.xz) / max(supportNormal.y, 0.01);
  supportHeight = max(supportHeight, ground.w - bottom + 0.005);
}
bool inFootprint(vec2 p) {
  for (int i=0; i<TILE_FOOTPRINT_VERTICES; i++) {
    if (i>=footprintCount) break;
    vec2 a=footprint[i].xz, b=footprint[(i+1)%footprintCount].xz;
    if (cross2(b-a,p-a)<-1e-5) return false;
  }
  return true;
}
float polygonSupport(ivec2 uv, vec2 center, mat2 worldXZ, vec2 tilt) {
  footprintCount = int(texelFetch(uRest0, uv+ivec2(0,uStateHeight),0).x);
  if (footprintCount < 3) return -1e20;
  mat3 rotation = tileTilt(tilt);
  vec3 n = rotation * vec3(0.0,1.0,0.0);
  supportNormal = vec3(worldXZ*n.xz, n.y).xzy;
  vec2 lo=vec2(1e20), hi=vec2(-1e20);
  for (int i=0; i<TILE_FOOTPRINT_VERTICES; i++) {
    if (i>=footprintCount) break;
    vec3 v=rotation*texelFetch(uRest0,uv+ivec2(0,(i+2)*uStateHeight),0).xyz;
    footprint[i]=vec3(center+worldXZ*v.xz,v.y).xzy;
    lo=min(lo,footprint[i].xz); hi=max(hi,footprint[i].xz);
  }
  supportOrigin=footprint[0];
  supportHeight=-1e20;
  float stepSize=uTerrainSize/float(textureSize(uTerrainContact,0).x-1);
  float halfSize=uTerrainSize*0.5;
  for (int i=0; i<TILE_FOOTPRINT_VERTICES; i++) {
    if (i>=footprintCount) break;
    vec2 a=footprint[i].xz,b=footprint[(i+1)%footprintCount].xz;
    supportCandidate(a);
    for(int axis=0;axis<3;axis++) {
      float av=axis==0?a.x:(axis==1?a.y:a.x+a.y);
      float bv=axis==0?b.x:(axis==1?b.y:b.x+b.y);
      float origin=axis==2 ? -uTerrainSize : -halfSize;
      if(abs(bv-av)<1e-8) continue;
      int first=int(ceil((min(av,bv)-origin)/stepSize));
      int last=int(floor((max(av,bv)-origin)/stepSize));
      for(int k=first;k<=last;k++) {
        float t=(origin+float(k)*stepSize-av)/(bv-av);
        supportCandidate(mix(a,b,clamp(t,0.0,1.0)));
      }
    }
  }
  ivec2 first=ivec2(ceil((lo+halfSize)/stepSize));
  ivec2 last=ivec2(floor((hi+halfSize)/stepSize));
  int segments=textureSize(uTerrainContact,0).x-1;
  first=max(first,ivec2(0)); last=min(last,ivec2(segments));
  for(int j=first.y;j<=last.y;j++) for(int i=first.x;i<=last.x;i++) {
    vec2 p=vec2(i,j)*stepSize-halfSize;
    if(inFootprint(p)) supportCandidate(p);
  }
  return supportHeight;
}
`;

export function convexFootprint(points) {
  const sorted = [...new Map(points.map(p => [`${p.x},${p.z}`,p])).values()]
    .sort((a,b) => a.x-b.x || a.z-b.z);
  if(sorted.length<=2)return sorted;
  const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  const lower=[],upper=[];
  for(const p of sorted) { while(lower.length>1 && cross(lower.at(-2),lower.at(-1),p)<=1e-12) lower.pop(); lower.push(p); }
  for(const p of sorted.toReversed()) { while(upper.length>1 && cross(upper.at(-2),upper.at(-1),p)<=1e-12) upper.pop(); upper.push(p); }
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
