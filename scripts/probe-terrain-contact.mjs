// Real WebGL: independent height pass, footprint peak, dry slope, sinking bed,
// frame-texture fallback, all polygon tiles, terrain cursor and source lifecycle.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
const errors=[],report={};
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.goto(`${process.env.TILES_URL ?? 'http://localhost:5199/'}?tiles=story-8-frames-polygon`);
  await page.waitForFunction(()=>window.app?.tiles.sim,{}, {timeout:60000});
  report.contact=await page.evaluate(async()=>{
    const source=await(await fetch('/src/tiles/TileSim.js')).text();
    const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const {TileSim}=await import('/src/tiles/TileSim.js');
    const {TerrainContact,TERRAIN_CONTACT_GLSL}=await import('/src/scene/TerrainContact.js');
    const {tileTiltMatrix}=await import('/src/tiles/tileTilt.js');
    const {FullscreenQuad,rawPass}=await import('/src/engine/fullscreen.js');
    const t=app.tiles,r=app.renderer,tc=t.terrainContact;
    const update=t.update;t.update=()=>{};
    const points=new Float32Array(512*4);
    for(let i=0;i<512;i++) points.set([Math.sin(i*2.399+.3)*1199,Math.cos(i*1.773+.7)*1199,0,0],i*4);
    const input=new THREE.DataTexture(points,512,1,THREE.RGBAFormat,THREE.FloatType);input.needsUpdate=true;
    const target=new THREE.WebGLRenderTarget(512,1,{type:THREE.FloatType,depthBuffer:false});
    const quad=new FullscreenQuad(rawPass(`precision highp float; precision highp int; ${TERRAIN_CONTACT_GLSL}
      uniform sampler2D uPoints; out vec4 result; void main(){ result=terrainAt(texelFetch(uPoints,ivec2(gl_FragCoord.xy),0).xy); }`,
      {...tc.uniforms,uPoints:{value:input}}));
    const previous=r.getRenderTarget();quad.render(r,target);r.setRenderTarget(previous);
    const sampled=new Float32Array(512*4);r.readRenderTargetPixels(target,0,0,512,1,sampled);
    let heightError=0,normalError=0;
    for(let i=0;i<512;i++) {
      const p=tc.at(points[i*4],points[i*4+1]);
      heightError=Math.max(heightError,Math.abs(p.height-sampled[i*4+3]));
      normalError=Math.max(normalError,p.normal.distanceTo(new THREE.Vector3().fromArray(sampled,i*4)));
    }
    quad.material.dispose();target.dispose();input.dispose();
    const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
    const deep=new THREE.DataTexture(new Float32Array([-60,1e4,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);deep.needsUpdate=true;
    const uniforms={...app.surface.uniforms,uShore:{value:deep},uShoreWave:{value:new THREE.Vector4()},
      uImpact:{value:Array.from({length:8},()=>new THREE.Vector4(0,0,1e9,0))}};
    for(const name of ['uDisp0','uDisp1','uDisp2']) uniforms[name]={value:zero};
    const read=(sim,n)=>{const a=new Float32Array(512*sim.height*4);r.readRenderTargetPixels(sim.target,0,0,512,sim.height,a,0,n);return a;};
    const linkedSamplers=sim=>{
      const gl=r.getContext(),program=r.properties.get(sim.quad.material).currentProgram.program;
      return Array.from({length:gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(program,i))
        .filter(u=>[gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW].includes(u.type)).reduce((n,u)=>n+u.size,0);
    };
    const fixtures=[];
    for(const kind of ['peak','slope','bed','outside','lift']) for(const profile of ['desktop','mobile']) {
      const geo=new THREE.PlaneGeometry(100,100,16,16);geo.rotateX(-Math.PI/2);
      const p=geo.attributes.position;
      for(let i=0;i<p.count;i++) p.setY(i,kind==='slope'?10+p.getX(i)*Math.tan(Math.PI/6):kind==='bed'?-42:
        kind==='lift'?-0.11:kind==='peak'?(Math.abs(p.getX(i))<1 && Math.abs(p.getZ(i))<1?5:1):1);
      const terrain=new TerrainContact(geo,100);
      const width=kind==='peak'?12:0.4;
      const footprint=[[-width,-0.1,-width],[width,-0.1,-width],[width,-0.1,width],[-width,-0.1,width]].map(v=>new THREE.Vector3(...v));
      const tiles={count:1,x:[kind==='outside'?70:0],z:[0],yaw:[0],radius:[width],y0:[0],thickness:[0.2],runId:[-1],flags:[0],footprints:[footprint]};
      const frames=Array.from({length:profile==='mobile'?t.sim.frameUniformLimit+1:1},()=>({pose:new THREE.Vector4(),pivot:new THREE.Vector3()}));
      const sim=new TileSim(r,{uniforms,sim:{params:{windSpeed:15}}},tiles,[],profile,frames,terrain);
      const params={...t.params,mode:'drift',orbit:1,buoyancy:kind==='bed'?0.3:1,windage:0.2};
      const matrix=new THREE.Matrix4().makeRotationY(0.63);
      // A tiny first step sees an interior peak that all four footprint corners miss.
      let seed;
      if(kind==='bed') {
        const data=new Float32Array(512*4);data.set([-41.5,-3,0,0]);
        seed=new THREE.DataTexture(data,512,1,THREE.RGBAFormat,THREE.FloatType);seed.needsUpdate=true;
        sim.uniforms.uState0.value=seed;
      }
      sim.update(matrix,1e-7,params);seed?.dispose();
      const first=read(sim,0)[0];
      let minClearance=Infinity;
      for(let step=0;step<(kind==='bed'?480:240);step++) {
        sim.update(matrix,1/30,params);
        if(step%20!==0) continue;
        const a=read(sim,0),b=read(sim,1),rotation=tileTiltMatrix(b[0],b[1]);
        for(let i=0;i<=20;i++) for(let j=0;j<=20;j++) {
          const v=new THREE.Vector3(width*(i/10-1),-0.1,width*(j/10-1)).applyMatrix4(rotation);
          v.add(new THREE.Vector3(tiles.x[0]+a[2],a[0],a[3])).applyMatrix4(matrix);
          const ground=terrain.at(v.x,v.z);
          if(ground) minClearance=Math.min(minClearance,v.y-ground.height);
        }
      }
      const a=read(sim,0),b=read(sim,1),c=read(sim,2);
      const result={kind,profile,first,y:a[0],tilt:Math.hypot(b[0],b[1])*180/Math.PI,blend:b[2],
        speed:Math.hypot(c[0],c[1]),minClearance:Number.isFinite(minClearance)?minClearance:null,samplers:linkedSamplers(sim),texture:!!sim.frameTexture};
      if(kind==='lift') {
        zero.image.data[1]=0.1;zero.needsUpdate=true;
        for(let i=0;i<200;i++) sim.update(matrix,1/30,params);
        result.liftBlend=read(sim,1)[2];result.liftY=read(sim,0)[0];
        zero.image.data[1]=0;zero.needsUpdate=true;
      }
      fixtures.push(result);sim.dispose();terrain.dispose();geo.dispose();
    }
    zero.dispose();deep.dispose();
    // Real source: every polygon gets terrain contact, including inherited frames.
    let minClearance=Infinity,maxTilt=0,contactTiles=0,wetTiles=0;
    const frame=t.frameRegistry.entries[2];t.moveFrame(frame.id,260,120);
    for(let i=0;i<180;i++) update.call(t,1/60);
    const a=read(t.sim,0),b=read(t.sim,1),rest=t.rest.tiles;
    for(let id=0;id<rest.count;id++) {
      if(rest.flags[id]&1)continue;
      if(b[id*4+2]>.99)contactTiles++;else wetTiles++;
      maxTilt=Math.max(maxTilt,Math.hypot(b[id*4],b[id*4+1])*180/Math.PI);
      const f=t.frameRegistry.entries[rest.frameIndex[id]],rotation=tileTiltMatrix(b[id*4],b[id*4+1]);
      for(const v0 of rest.footprints[id]) {
        const v=v0.clone().applyMatrix4(rotation).add(new THREE.Vector3(rest.x[id]+a[id*4+2]+f.offset.x,
          rest.y0[id]+a[id*4],rest.z[id]+a[id*4+3]+f.offset.z)).applyMatrix4(t.group.matrixWorld);
        const ground=tc.at(v.x,v.z);if(ground)minClearance=Math.min(minClearance,v.y-ground.height);
      }
    }
    const land=tc.at(260,120);
    app.camera.position.set(260,land.height+100,220);app.controls.target.set(260,land.height,120);
    app.controls.update();app.camera.updateMatrixWorld();
    const cursor=t.interaction.cursor;cursor.height=0;cursor.groundOffset=0.02;
    const point=cursor.point(700,500);
    const cursorError=point?Math.abs(point.y-tc.at(point.x,point.z).height-0.02):null;
    t.update=update;
    return {heightError,normalError,fixtures,real:{count:rest.count,minClearance,maxTilt,contactTiles,wetTiles,samplers:linkedSamplers(t.sim),cursorError}};
  });
  assert(report.contact.heightError<0.001);assert(report.contact.normalError<0.0001);
  for(const f of report.contact.fixtures) {
    assert(f.samplers<=16,JSON.stringify(f));
    if(f.kind!=='outside')assert(f.minClearance>=-0.001,JSON.stringify(f));
    if(f.kind==='peak')assert(Math.abs(f.first-5.105)<0.001,JSON.stringify(f));
    if(f.kind==='slope') {assert(Math.abs(f.tilt-30)<0.15,JSON.stringify(f));assert(f.speed<0.001,JSON.stringify(f));}
    if(f.kind==='bed')assert(Math.abs(f.y+41.895)<0.005,JSON.stringify(f));
    if(f.kind==='outside')assert(f.blend===0 && f.y<0.1,JSON.stringify(f));
    if(f.kind==='lift')assert(f.liftBlend===0 && f.liftY>0.25,JSON.stringify(f));
  }
  assert(report.contact.real.minClearance>=-0.001);assert(report.contact.real.contactTiles>0);
  assert(report.contact.real.wetTiles>0);assert(report.contact.real.cursorError<0.001);
  const grab=await page.evaluate(async()=>{
    const source=await(await fetch('/src/tiles/TileSim.js')).text();
    const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const {tileTiltMatrix}=await import('/src/tiles/tileTilt.js');
    const t=app.tiles,s=t.sim,a=new Float32Array(512*s.height*4),b=new Float32Array(a.length);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,a,0,0);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,b,0,1);
    const f=t.frameRegistry.entries[2],tiles=t.rest.tiles;
    for(let id=0;id<tiles.count;id+=7) {
      if(tiles.frameIndex[id]!==f.index)continue;
      const top=new THREE.Vector3(0,tiles.thickness[id]/2,0).applyMatrix4(tileTiltMatrix(b[id*4],b[id*4+1]));
      const p=top.add(new THREE.Vector3(tiles.x[id]+a[id*4+2]+f.offset.x,tiles.y0[id]+a[id*4]+Math.min(tiles.surfaceOffset[id],0.001),tiles.z[id]+a[id*4+3]+f.offset.z)).applyMatrix4(t.group.matrixWorld);
      const screen=p.clone().project(app.camera),x=(screen.x+1)*700,y=(1-screen.y)*500;
      if(x<50||x>1200||y<100||y>900)continue;
      const hit=t.interaction.picker.pick(app.camera,x,y);if(hit?.frame!==f)continue;
      const target=p.clone();target.x+=12;target.y+=t.terrainContact.at(target.x,target.z).height-t.terrainContact.at(p.x,p.z).height;
      const end=target.project(app.camera);
      window.fd3Grab={id,world:f.world.clone(),camera:app.camera.position.clone(),x:(end.x+1)*700,y:(1-end.y)*500};
      return {x,y,endX:fd3Grab.x,endY:fd3Grab.y};
    }
    throw new Error('No exposed land tile found');
  });
  await page.mouse.move(grab.x,grab.y);await page.mouse.down();
  await page.mouse.move(grab.endX,grab.endY,{steps:15});await page.waitForTimeout(900);
  await page.mouse.up();await page.waitForTimeout(300);
  report.drag=await page.evaluate(async()=>{
    const source=await(await fetch('/src/tiles/TileSim.js')).text();
    const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const {tileTiltMatrix}=await import('/src/tiles/tileTilt.js');
    const t=app.tiles,s=t.sim,id=fd3Grab.id,k=id*4,tiles=t.rest.tiles,f=t.frameRegistry.entries[2];
    const a=new Float32Array(512*s.height*4),b=new Float32Array(a.length);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,a,0,0);
    app.renderer.readRenderTargetPixels(s.target,0,0,512,s.height,b,0,1);
    const p=new THREE.Vector3(0,tiles.thickness[id]/2,0).applyMatrix4(tileTiltMatrix(b[k],b[k+1]));
    p.add(new THREE.Vector3(tiles.x[id]+a[k+2]+f.offset.x,tiles.y0[id]+a[k]+Math.min(tiles.surfaceOffset[id],0.001),tiles.z[id]+a[k+3]+f.offset.z)).applyMatrix4(t.group.matrixWorld).project(app.camera);
    return {movement:f.world.distanceTo(fd3Grab.world),cameraMovement:app.camera.position.distanceTo(fd3Grab.camera),
      grabError:Math.hypot((p.x+1)*700-fd3Grab.x,(1-p.y)*500-fd3Grab.y),state:t.interaction.state};
  });
  assert(report.drag.movement>5,JSON.stringify(report.drag));assert(report.drag.cameraMovement<1e-8);assert(report.drag.grabError<=5,JSON.stringify(report.drag));
  await page.screenshot({path:join(tmpdir(),'frame-drag-fd3.png')});
  report.shore=await page.evaluate(()=>{
    const t=app.tiles,f=t.frameRegistry.entries[2],update=t.update;t.update=()=>{};
    t.moveFrame(f.id,330,120);for(let i=0;i<180;i++)update.call(t,1/60);
    const a=new Float32Array(512*t.sim.height*4);app.renderer.readRenderTargetPixels(t.sim.target,0,0,512,t.sim.height,a,0,1);
    let wet=0,contact=0;
    for(let id=0;id<t.rest.tiles.count;id++)if(t.rest.tiles.frameIndex[id]===f.index){if(a[id*4+2]>.99)contact++;if(a[id*4+2]<.01)wet++;}
    const h=t.terrainContact.at(330,120).height;
    app.camera.position.set(330,h+60,180);app.controls.target.set(330,h,120);app.controls.update();
    t.update=update;return {wet,contact};
  });
  assert(report.shore.wet>0 && report.shore.contact>0,JSON.stringify(report.shore));
  await page.waitForTimeout(300);await page.screenshot({path:join(tmpdir(),'frame-drag-fd3-shore.png')});
  await page.getByLabel('source',{exact:true}).selectOption({label:'none'});
  await page.waitForFunction(()=>!app.tiles.loaded);
  report.none=await page.evaluate(()=>({contact:!!app.tiles.terrainContact,sim:!!app.tiles.sim,interaction:!!app.tiles.interaction}));
  assert.deepEqual(report.none,{contact:false,sim:false,interaction:false});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,...report,errors},null,2));
} catch (error) { console.error(JSON.stringify({ ...report,errors },null,2));throw error; }
finally {await browser.close();}
