import * as THREE from 'three';
import { FullscreenQuad, rawPass } from '../engine/fullscreen.js';
import { TILE_TILT_GLSL } from './tileTilt.js';
import { TERRAIN_CONTACT_GLSL } from '../scene/TerrainContact.js';
import { TILE_CONTACT_GLSL } from './tileContact.js';
import { TILE_VERTICAL_LIMIT } from './tileBounds.js';

// Reduce current GPU geometry to four bounds or one placement verdict. Only the
// final 1x1 pixel is read asynchronously; no snapshot of the frame reaches CPU.
const FRAG = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D uRest0,uRest1,uState0,uState1;
uniform int uTileCount,uFrame,uMode;
uniform mat4 uWorld,uViewProjection;
uniform vec2 uOffset,uDelta;
uniform float uWaterHeight;
uniform float uTileMotionLimit;
${TILE_TILT_GLSL}
${TERRAIN_CONTACT_GLSL}
${TILE_CONTACT_GLSL}
out vec4 result;
vec2 clipped[TILE_FOOTPRINT_VERTICES+8];
vec2 scratch[TILE_FOOTPRINT_VERTICES+8];
int clipLine(vec2 p,vec2 q,int count){
  int next=0;
  for(int i=0;i<TILE_FOOTPRINT_VERTICES+8;i++){
    if(i>=count)break;
    vec2 x=clipped[i],y=clipped[(i+1)%count];
    float dx=cross2(q-p,x-p),dy=cross2(q-p,y-p);
    if(dx>=0.0)scratch[next++]=x;
    if((dx<0.0)!=(dy<0.0))scratch[next++]=mix(x,y,dx/(dx-dy));
  }
  for(int i=0;i<TILE_FOOTPRINT_VERTICES+8;i++){if(i>=next)break;clipped[i]=scratch[i];}
  return next;
}
// Clip the occupied convex footprint against each REAL terrain triangle. A
// steep triangle touching only the empty frame rectangle never rejects a drag.
bool steepTriangle(vec2 a,vec2 b,vec2 c,float water,float bottom) {
  vec4 ground=terrainAt((a+b+c)/3.0);
  if(ground.y>=0.573576436) return false;
  int count=3;
  clipped[0]=a;clipped[1]=b;clipped[2]=c;
  // Minkowski sum with the translation segment: original edge half-planes,
  // moved outwards where needed, plus the two sides parallel to the motion.
  // This checks the whole swept occupied region, even for a large pointer jump.
  for(int edge=0;edge<TILE_FOOTPRINT_VERTICES;edge++) {
    if(edge>=footprintCount)break;
    if(count<3)return false;
    vec2 p=footprint[edge].xz,q=footprint[(edge+1)%footprintCount].xz;
    if(cross2(q-p,-uDelta)<0.0){p-=uDelta;q-=uDelta;}
    count=clipLine(p,q,count);
  }
  if(length(uDelta)>1e-7){
    vec2 dir=normalize(uDelta),perp=vec2(-dir.y,dir.x);
    float lo=1e20,hi=-1e20;
    for(int i=0;i<TILE_FOOTPRINT_VERTICES;i++){
      if(i>=footprintCount)break;float d=dot(perp,footprint[i].xz);lo=min(lo,d);hi=max(hi,d);
    }
    if(count<3)return false;count=clipLine(perp*lo,perp*lo+dir,count);
    if(count<3)return false;count=clipLine(perp*hi,perp*hi-dir,count);
  }
  if(count<3)return false;
  float area=0.0;
  for(int i=1;i<TILE_FOOTPRINT_VERTICES+7;i++){if(i+1>=count)break;area+=abs(cross2(clipped[i]-clipped[0],clipped[i+1]-clipped[0]));}
  if(area<1e-10)return false;
  // Height inside this triangle is affine, so its maximum is at a clipped
  // vertex. Deep bed below a floating tile does not count as contact.
  for(int i=0;i<TILE_FOOTPRINT_VERTICES+8;i++) {
    if(i>=count)break;
    float h=ground.w-dot(ground.xz,clipped[i]-(a+b+c)/3.0)/ground.y;
    if(h>=min(water,bottom)-0.05)return true;
  }
  return false;
}
void main(){
  result=vec4(-1e20);
  ivec2 uv=ivec2(gl_FragCoord.xy);
  int id=uv.y*512+uv.x;
  if(id>=uTileCount)return;
  vec4 r=texelFetch(uRest0,uv,0),r1=texelFetch(uRest1,uv,0);
  if((int(r1.w)>>2)!=uFrame || (int(r1.w)&2)!=0)return;
  vec4 s=texelFetch(uState0,uv,0),s1=texelFetch(uState1,uv,0);
  s.x=clamp(s.x,-${TILE_VERTICAL_LIMIT.toFixed(1)},${TILE_VERTICAL_LIMIT.toFixed(1)});
  s.zw*=min(1.0,uTileMotionLimit/max(length(s.zw),0.00001));
  mat3 rotation=tileTilt(s1.xy);
  vec4 metadata=texelFetch(uRest0,uv+ivec2(0,uStateHeight),0);
  footprintCount=int(metadata.x);
  if(footprintCount<3)return;
  vec2 lo=vec2(1e20),hi=vec2(-1e20);
  float bottom=1e20;
  for(int i=0;i<TILE_FOOTPRINT_VERTICES;i++){
    if(i>=footprintCount)break;
    vec3 v=texelFetch(uRest0,uv+ivec2(0,(i+2)*uStateHeight),0).xyz;
    vec3 p=(uWorld*vec4(vec3(r.x+s.z+uOffset.x,r1.x+s.x,r.y+s.w+uOffset.y)+rotation*v,1.0)).xyz;
    p.xz+=uDelta;
    footprint[i]=p;lo=min(lo,p.xz);hi=max(hi,p.xz);bottom=min(bottom,p.y);
    if(uMode==2)result=max(result,vec4(-p.xz,p.xz));
    if(uMode==0){
      for(int top=0;top<2;top++){
        vec3 w=p+mat3(uWorld)*rotation*vec3(0.0,float(top)*r1.y,0.0);
        w.y+=mix(metadata.y,min(metadata.y,0.001),s1.z);
        vec4 clip=uViewProjection*vec4(w,1.0);
        if(clip.w>0.0){vec2 ndc=clip.xy/clip.w;result=max(result,vec4(-ndc,ndc));}
      }
    }
  }
  if(uMode!=1)return;
  result=vec4(0.0);
  if(any(greaterThan(abs(lo),vec2(uTerrainSize*.5)))||any(greaterThan(abs(hi),vec2(uTerrainSize*.5)))){result.x=1.0;return;}
  lo=min(lo,lo-uDelta);hi=max(hi,hi-uDelta);
  float stepSize=uTerrainSize/float(textureSize(uTerrainContact,0).x-1),halfSize=uTerrainSize*.5;
  ivec2 first=ivec2(floor((lo+halfSize)/stepSize)),last=ivec2(floor((hi+halfSize)/stepSize));
  int segments=textureSize(uTerrainContact,0).x-1;
  first=clamp(first,ivec2(0),ivec2(segments-1));last=clamp(last,ivec2(0),ivec2(segments-1));
  for(int j=first.y;j<=last.y;j++)for(int i=first.x;i<=last.x;i++){
    vec2 a=vec2(i,j)*stepSize-halfSize,b=a+vec2(stepSize,0.0),c=a+vec2(0.0,stepSize),d=a+stepSize;
    if(steepTriangle(a,b,c,uWaterHeight,bottom)||steepTriangle(b,d,c,uWaterHeight,bottom)){result.x=1.0;return;}
  }
}`;

const REDUCE = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D uInput;
out vec4 result;
void main(){
  result=vec4(-1e20);ivec2 size=textureSize(uInput,0),origin=ivec2(gl_FragCoord.xy)*4;
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    ivec2 p=origin+ivec2(x,y);if(all(lessThan(p,size)))result=max(result,texelFetch(uInput,p,0));
  }
}`;

export class TileFrameQuery {
  constructor(field, mode) {
    this.field=field;this.mode=mode;
    const sim=field.sim;
    this.uniforms={uTileMotionLimit:{value:1e20},...sim.uniforms,...field.terrainContact.uniforms,
      uFrame:{value:0},uMode:{value:mode},uWorld:{value:new THREE.Matrix4()},
      uViewProjection:{value:new THREE.Matrix4()},uOffset:{value:new THREE.Vector2()},
      uDelta:{value:new THREE.Vector2()},uWaterHeight:{value:0},uTileCount:{value:field.rest.tiles.count},uStateHeight:{value:sim.height}};
    this.quad=new FullscreenQuad(rawPass(FRAG,this.uniforms,{defines:{TILE_FOOTPRINT_VERTICES:sim.footprintVertices}}));
    this.reduce=new FullscreenQuad(rawPass(REDUCE,{uInput:{value:null}}));
    // Pay the one-off shader compile during load, before a pointer gesture.
    field.renderer.compile(this.quad.mesh,field.camera);
    field.renderer.compile(this.reduce.mesh,field.camera);
    this.targets=[];
    let width=512,height=sim.height;
    for(;;){
      this.targets.push(new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
      if(width===1&&height===1)break;
      width=Math.ceil(width/4);height=Math.ceil(height/4);
    }
  }

  async query(frame,delta=new THREE.Vector2(),waterHeight=0){
    if(this.pending||this.disposed)return null;
    this.pending=true;
    const r=this.field.renderer,previous=r.getRenderTarget();
    try{
      const u=this.uniforms;
      u.uFrame.value=frame.index;u.uOffset.value.set(frame.offset.x,frame.offset.z);
      u.uDelta.value.copy(delta);u.uWaterHeight.value=waterHeight;
      u.uWorld.value.copy(this.field.group.matrixWorld);
      const camera=this.field.camera;camera.updateWorldMatrix(true,false);
      u.uViewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      try{
        this.quad.render(r,this.targets[0]);
        for(let i=1;i<this.targets.length;i++){
          this.reduce.material.uniforms.uInput.value=this.targets[i-1].texture;
          this.reduce.render(r,this.targets[i]);
        }
      }finally{r.setRenderTarget(previous);}
      const data=new Float32Array(4);
      await r.readRenderTargetPixelsAsync(this.targets.at(-1),0,0,1,1,data);
      return this.disposed?null:data;
    }finally{
      this.pending=false;
      if(this.disposed)this.release();
    }
  }

  release(){if(this.released)return;this.released=true;this.targets.forEach(t=>t.dispose());this.quad.material.dispose();this.reduce.material.dispose();}
  dispose(){this.disposed=true;if(!this.pending)this.release();}
}
