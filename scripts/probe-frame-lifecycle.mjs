// FD5: real hybrid rendering, bounded interaction timings and readback retirement.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
const errors = [], report = {};
const stats = values => {
  const v = values.slice().sort((a,b) => a-b);
  return { n:v.length, p50:v[Math.floor(v.length*.5)], p95:v[Math.min(v.length-1,Math.floor(v.length*.95))] };
};
try {
  for (const mobile of [false,true]) {
    const context = await browser.newContext(mobile
      ? { viewport:{width:480,height:850}, deviceScaleFactor:2, isMobile:true, hasTouch:true,
        userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' }
      : { viewport:{width:1400,height:1000} });
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://localhost:5199/?tiles=story-8-frames-hibrid');
    await page.waitForFunction(()=>window.app?.tiles.interaction,{}, {timeout:60000});
    await page.evaluate(async()=>{
      const source=await(await fetch('/src/tiles/TileSim.js')).text();
      const T=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
      const t=app.tiles,r=app.renderer;
      window.fd5={T,read(target){const a=new Float32Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,a);return a;},
        find(){
          const a=this.read(t.sim.target),rect=r.domElement.getBoundingClientRect();
          // Project state without warming the picker: the first query below is cold.
          for(let id=0;id<t.rest.tiles.count;id+=19){
            const k=id*4,f=t.frameRegistry.entries[t.rest.tiles.frameIndex[id]];
            const p=new T.Vector3(t.rest.tiles.x[id]+a[k+2]+f.offset.x,t.rest.tiles.y0[id]+a[k]+t.rest.tiles.surfaceOffset[id],
              t.rest.tiles.z[id]+a[k+3]+f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
            const x=(p.x+1)*rect.width/2,y=(1-p.y)*rect.height/2;
            if(x>30&&x<rect.width*.72&&y>140&&y<rect.height-90)return{x,y};
          }
          throw Error('No projected tile');
        }};
      fd5.cpu=[];
      const update=t.interaction.update;
      t.interaction.update=function(dt){const active=this.gesture?.dragged||this.settling,start=performance.now();
        const result=update.call(this,dt);if(active)fd5.cpu.push(performance.now()-start);return result;};
    });
    let point = await page.evaluate(()=>fd5.find());
    const result = await page.evaluate(async at=>{
      const t=app.tiles,r=app.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const cold=t.interaction.picker.pick(app.camera,at.x,at.y),coldMs=t.interaction.picker.lastMs;
      if(!cold)throw Error('Cold query missed projected tile');
      const warm=[];
      for(let i=0;i<40;i++){
        await new Promise(requestAnimationFrame);
        t.interaction.picker.pick(app.camera,at.x,at.y);warm.push(t.interaction.picker.lastMs);
      }
      const samplers=material=>{
        const p=r.properties.get(material).currentProgram.program;
        return Array.from({length:gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(p,i))
          .filter(u=>[gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW].includes(u.type)).reduce((n,u)=>n+u.size,0);
      };
      return {profile:t.profile,count:t.rest.tiles.count,coldMs,warm,samplers:samplers(t.sim.quad.material),
        runSamplers:samplers(t.sim.runQuad.material),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',
        viewport:{cssWidth:innerWidth,cssHeight:innerHeight,dpr:devicePixelRatio,width:r.domElement.width,height:r.domElement.height},
        quality:{...app.quality}};
    },point);
    result.warm=stats(result.warm);
    assert.equal(result.profile,mobile?'mobile':'desktop');assert.equal(result.count,46861);
    assert(result.samplers<=16&&result.runSamplers<=16);
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await page.mouse.move(point.x+16,point.y+4);await page.waitForTimeout(200);
    for(let i=0;i<40;i++){
      await page.mouse.move(point.x+16+i,point.y+4+i*.2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();await page.waitForTimeout(200);
    result.cpu=stats(await page.evaluate(()=>fd5.cpu));assert(result.cpu.n>=30);
    // GPU time of the ENTIRE tile+run simulation is a conservative upper bound
    // for added contact/pose. One sample per visible frame; no benchmark batch.
    result.gpuSimulation=await page.evaluate(async()=>{
      fd5.timeGPU=async()=>{
      const t=app.tiles,r=app.renderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if(!ext)return{available:false};
      const queries=[];
      for(let i=0;i<40;i++){
        await new Promise(requestAnimationFrame);
        const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
        t.sim.update(t.group.matrixWorld,1/60,t.params);gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(q);
      }
      const deadline=performance.now()+10000;
      while(!gl.getQueryParameter(queries.at(-1),gl.QUERY_RESULT_AVAILABLE)){
        if(performance.now()>deadline)throw Error('GPU timing timeout');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT),samples=queries.map(q=>{const v=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);return v;});
      // Some ANGLE drivers return an unsigned negative duration despite a clear
      // disjoint flag. Such a series cannot attest a hardware budget.
      if(disjoint||samples.some(v=>!Number.isFinite(v)||v<0||v>1000))return{available:false,reason:'invalid/disjoint GPU timer series',samples};
      return{available:true,disjoint,samples};
      };
      return fd5.timeGPU();
    });
    if(result.gpuSimulation.available){assert.equal(result.gpuSimulation.disjoint,false);result.gpuSimulation={available:true,...stats(result.gpuSimulation.samples)};}
    result.budgets={warmPick:result.warm.p95<=(mobile?20:8),cpu:result.cpu.p95<=.5,
      gpuUpperBound:result.gpuSimulation.available?result.gpuSimulation.p95<=1:null};
    result.fallbackSamplers=await page.evaluate(async()=>{
      const {TileSim}=await import('/src/tiles/TileSim.js'),t=app.tiles,r=app.renderer,gl=r.getContext();
      const frames=Array.from({length:t.sim.frameUniformLimit+1},(_,i)=>t.frameRegistry.entries[i]??{
        pivot:new fd5.T.Vector3(),pose:new fd5.T.Vector4()});
      const sim=new TileSim(r,app.surface,t.rest.tiles,t.rest.runs,t.profile,frames,t.terrainContact);
      try{
        sim.update(t.group.matrixWorld,1/60,t.params);
        const count=m=>{const p=r.properties.get(m).currentProgram.program;
          return Array.from({length:gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(p,i))
            .filter(u=>[gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW].includes(u.type)).reduce((n,u)=>n+u.size,0);};
        return{frames:frames.length,texture:!!sim.frameTexture,tile:count(sim.quad.material),run:count(sim.runQuad.material)};
      }finally{sim.dispose();}
    });
    assert(result.fallbackSamplers.texture);assert(result.fallbackSamplers.tile<=16);assert(result.fallbackSamplers.run<=16);
    await page.evaluate(()=>app.tiles.moveFrame(app.tiles.frames[2],260,120));
    await page.waitForTimeout(600);
    result.landGpuSimulation=await page.evaluate(()=>fd5.timeGPU());
    if(result.landGpuSimulation.available)result.landGpuSimulation={available:true,...stats(result.landGpuSimulation.samples)};
    console.log(JSON.stringify({profile:result.profile,timings:result}));
    if(!mobile){
      result.render=await page.evaluate(async()=>{
        const {T}=fd5,t=app.tiles,r=app.renderer;
        const {PlanarReflection}=await import('/src/engine/PlanarReflection.js');
        const {FullscreenQuad,rawPass}=await import('/src/engine/fullscreen.js');
        const f=t.frameRegistry.entries[2];t.moveFrame(f.id,260,120);
        app.views['Golden hour']();
        // Wait for normal frames, keeping interaction and water time intact.
        for(let i=0;i<20;i++)await new Promise(requestAnimationFrame);
        const h=t.terrainContact.at(260,120).height;
        app.camera.position.set(260,h+90,210);app.controls.target.set(260,h,120);app.controls.update();
        app.camera.updateMatrixWorld();
        t.interaction.selected=f;
        const target=new T.WebGLRenderTarget(256,256,{depthTexture:new T.DepthTexture(256,256)});
        const maskTarget=new T.WebGLRenderTarget(256,256);
        const mask=new FullscreenQuad(rawPass('precision highp float;uniform sampler2D uDepth;in vec2 vUv;out vec4 result;void main(){result=vec4(vec3(texture(uDepth,vUv).r<0.999999?1.:0.),1.);}',{uDepth:{value:target.depthTexture}}));
        const cam=new T.OrthographicCamera(-50,50,50,-50,.1,500);cam.position.set(260,h+150,120);cam.up.set(0,0,-1);cam.lookAt(260,h,120);cam.updateMatrixWorld();
        function root(shadow){
          t.group.updateWorldMatrix(true,true);t.syncShadow();t.shadowGroup.updateWorldMatrix(true,true);
          const scene=new T.Scene();scene.add(new T.AmbientLight(0xffffff,2));
          for(const e of t.boundsEntries.filter(entry=>entry.frameIndex===f.index)){
            const source=shadow?e.proxy:e.mesh,copy=source.clone(false);
            copy.matrixAutoUpdate=false;copy.matrix.copy(source.matrixWorld);copy.layers.enable(1);scene.add(copy);
          }
          return scene;
        }
        function silhouette(scene,camera){
          r.setRenderTarget(target);r.setClearColor(0,0);r.clear();r.render(scene,camera);mask.render(r,maskTarget);
          const a=new Uint8Array(256*256*4);r.readRenderTargetPixels(maskTarget,0,0,256,256,a);
          let n=0,x=0,y=0;for(let i=0;i<256*256;i++)if(a[i*4]){n++;x+=i%256;y+=Math.floor(i/256);}
          return{n,x:x/n,y:y/n};
        }
        const prev=r.getRenderTarget(),auto=r.autoClear;r.autoClear=false;
        try{
          const main=silhouette(root(false),cam),shadow=silhouette(root(true),cam);
          const sunDepth=silhouette(root(true),app.floatShadow.camera);
          const reflection=new PlanarReflection();reflection.scale=1;reflection.setSize(256,256);
          reflection.render(r,root(false),app.camera);
          const copy=new FullscreenQuad(rawPass('precision highp float;uniform sampler2D uTex;in vec2 vUv;out vec4 result;void main(){result=vec4(vec3(texture(uTex,vUv).a>0.?1.:0.),1.);}',{uTex:{value:reflection.target.texture}}));
          copy.render(r,maskTarget);
          const pixels=new Uint8Array(256*256*4);r.readRenderTargetPixels(maskTarget,0,0,256,256,pixels);
          const reflectionPixels=pixels.filter((v,i)=>i%4===0&&v>0).length;
          copy.material.dispose();
          const reflected=silhouette(root(false),reflection.camera),reflectedShadow=silhouette(root(true),reflection.camera);
          t.moveFrame(f.id,270,120);
          const moved=silhouette(root(false),cam),movedShadow=silhouette(root(true),cam);
          reflection.target.dispose();
          return{main,shadow,sunDepth,reflectionPixels,reflected,reflectedShadow,moved,movedShadow,
            bounds:t.boundsEntries.filter(e=>e.frameIndex===f.index).every(e=>e.mesh.frustumCulled&&e.mesh.position.equals(e.proxy.position))};
        }finally{r.autoClear=auto;r.setRenderTarget(prev);target.dispose();maskTarget.dispose();mask.material.dispose();}
      });
      console.log(JSON.stringify({render:result.render}));
      const v=result.render;assert(v.main.n>20&&v.reflected.n>20&&v.sunDepth.n>0);assert(v.bounds);
      assert.equal(v.reflectionPixels,v.reflected.n,'Actual reflection colour and deformed depth must agree');
      for(const [a,b] of [[v.main,v.shadow],[v.moved,v.movedShadow]]){
        assert(Math.abs(a.n-b.n)<=2&&Math.hypot(a.x-b.x,a.y-b.y)<.1,JSON.stringify(v));
      }
      assert(v.moved.x-v.main.x>20,JSON.stringify(v));
      result.screenshot=join(tmpdir(),'water-fd5-land.png');await page.screenshot({path:result.screenshot});
      await page.evaluate(()=>app.views.Tiles());await page.waitForTimeout(300);
    }
    // Real submitted PBOs, with source change before any Promise can settle.
    point=await page.evaluate(()=>fd5.find());
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await page.mouse.move(point.x+25,point.y+5);await page.waitForTimeout(150);
    result.retirement=await page.evaluate(async()=>{
      const t=app.tiles,i=t.interaction,f=t.frameRegistry.entries[0],p=fd5.find();
      if(!i.gesture?.dragged)throw Error('Source change must interrupt an active drag');
      const pending=[i.picker.hover(app.camera,p.x,p.y),i.placementQuery.query(f),i.occupancyQuery.query(f)];
      i.cursor.sample(new fd5.T.Vector3(f.world.x,0,f.world.z));
      const waterPending=i.cursor.query.inFlight;
      await t.load('none');await Promise.allSettled(pending);
      const deadline=performance.now()+10000;
      while(i.cursor.query.inFlight&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
      return{waterPending,picker:i.picker.released,placement:i.placementQuery.released,occupancy:i.occupancyQuery.released,
        water:i.cursor.query.released,abort:i.abort.signal.aborted,empty:!t.sim&&!t.terrainContact&&!t.interaction&&!t.lifecycle&&!t.group.children.length,
        overlays:document.querySelectorAll('[data-tile-frame-selection]').length,controls:app.controls.enabled};
    });
    console.log(JSON.stringify({retirement:result.retirement}));
    for(const key of ['picker','placement','occupancy','water','abort','empty','controls'])assert.equal(result.retirement[key],true,key);
    assert.equal(result.retirement.overlays,0);assert(result.retirement.waterPending>0);
    await page.mouse.up();
    if(!mobile){
      result.noneBenchmark=await page.evaluate(()=>runBenchmark(8,{shot:'Golden hour',warmup:2}));
      assert.equal(result.noneBenchmark.tiles.count,0);
      assert(!Object.keys(result.noneBenchmark.passes).some(k=>k.startsWith('tile')));
    }
    // Actual loss/restoration (not a synthetic context event).
    await page.evaluate(async()=>{await app.tiles.load('story-8-frames-hibrid');app.views.Tiles();});
    point=await page.evaluate(()=>fd5.find());
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+25,point.y+5);await page.waitForTimeout(150);
    result.lost=await page.evaluate(async()=>{
      const t=app.tiles,i=t.interaction;
      if(!i.gesture?.dragged)throw Error('Context loss must interrupt an active drag');
      fd5.old=i;fd5.before=i.gesture.world.toArray();fd5.id=i.gesture.frame.id;
      const p=fd5.find(),pending=Promise.allSettled([i.picker.hover(app.camera,p.x,p.y),
        i.placementQuery.query(i.gesture.frame),i.occupancyQuery.query(i.gesture.frame)]);
      i.cursor.sample(new fd5.T.Vector3(i.gesture.frame.world.x,0,i.gesture.frame.world.z));
      fd5.loss=app.renderer.getContext().getExtension('WEBGL_lose_context');fd5.loss.loseContext();
      await new Promise(resolve=>setTimeout(resolve,100));await Promise.allSettled([pending]);
      return{abort:i.abort.signal.aborted,gesture:!!i.gesture,capture:i.canvas.hasPointerCapture(1),controls:app.controls.enabled,
        empty:!t.sim&&!t.interaction&&!t.terrainContact,picker:i.picker.released,
        placement:i.placementQuery.released,occupancy:i.occupancyQuery.released,water:i.cursor.query.released};
    });
    console.log(JSON.stringify({lost:result.lost}));
    assert.deepEqual(result.lost,{abort:true,gesture:false,capture:false,controls:true,empty:true,picker:true,
      placement:true,occupancy:true,water:true});
    await page.mouse.up();await page.evaluate(()=>fd5.loss.restoreContext());
    await page.waitForFunction(()=>app.tiles.interaction&&app.tiles.interaction!==fd5.old,{}, {timeout:60000});
    await page.waitForTimeout(300);
    result.restored=await page.evaluate(()=>{
      const rt=app.ocean.h0RT,a=new Float32Array(32*32*4);
      app.renderer.readRenderTargetPixels(rt,rt.width/2-16,rt.width/2-16,32,32,a);
      return{world:app.tiles.frameRegistry.get(fd5.id).world.toArray(),before:fd5.before,count:app.tiles.rest.tiles.count,
        spectrum:a.some(v=>Math.abs(v)>1e-10)};
    });
    assert.deepEqual(result.restored.world,result.restored.before);assert.equal(result.restored.count,46861);
    assert(result.restored.spectrum,'Ocean spectrum must be regenerated after context restore');
    point=await page.evaluate(()=>fd5.find());
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+25,point.y+5);await page.waitForTimeout(150);
    result.bfcache=await page.evaluate(()=>{
      const t=app.tiles,i=t.interaction,g=i.gesture;
      if(!g?.dragged)throw Error('BFCache suspension must interrupt an active drag');
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
      return{alive:t.interaction===i&&!!t.sim,aborted:i.abort.signal.aborted,
        gesture:!!i.gesture,restored:g.frame.world.equals(g.world),controls:app.controls.enabled};
    });
    assert.deepEqual(result.bfcache,{alive:true,aborted:false,gesture:false,restored:true,controls:true});
    await page.mouse.up();
    point=await page.evaluate(()=>fd5.find());
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+25,point.y+5);await page.waitForTimeout(150);
    result.pagehide=await page.evaluate(async()=>{
      const t=app.tiles,i=t.interaction,p=fd5.find();
      if(!i.gesture?.dragged)throw Error('Pagehide must interrupt an active drag');
      const pending=i.picker.hover(app.camera,p.x,p.y).catch(()=>null);
      window.dispatchEvent(new PageTransitionEvent('pagehide'));await pending;
      return{aborted:i.abort.signal.aborted,empty:!t.interaction&&!t.sim&&!t.lifecycle,
        capture:i.canvas.hasPointerCapture(1),controls:app.controls.enabled,picker:i.picker.released,
        overlays:document.querySelectorAll('[data-tile-frame-selection]').length};
    });
    assert.deepEqual(result.pagehide,{aborted:true,empty:true,capture:false,controls:true,picker:true,overlays:0});
    await page.mouse.up();
    report[mobile?'mobileProfile':'desktop']=result;
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,...report,errors},null,2));
}finally{await browser.close();}
