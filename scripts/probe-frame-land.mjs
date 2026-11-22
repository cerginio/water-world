import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
const errors=[],report={};
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:5199/?tiles=story-8-frames-hibrid');
  await page.waitForFunction(()=>window.app?.tiles.interaction,{}, {timeout:60000});
  report.fixtures=await page.evaluate(async(skip)=>{
    const source=await(await fetch('/src/tiles/TileSim.js')).text();
    const THREE=await import(source.match(/import \* as THREE from ["']([^"']+)["']/)[1]);
    const {TileSim}=await import('/src/tiles/TileSim.js');
    const {TileFrameQuery}=await import('/src/tiles/TileFrameQuery.js');
    const {TerrainContact}=await import('/src/scene/TerrainContact.js');
    const {tileTiltMatrix}=await import('/src/tiles/tileTilt.js');
    const t=app.tiles,r=app.renderer,results=[];
    window.fd4={THREE};
    const update=t.update;t.update=()=>{};
    const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
    const deep=new THREE.DataTexture(new Float32Array([-150,1e4,0,0]),1,1,THREE.RGBAFormat,THREE.FloatType);deep.needsUpdate=true;
    const uniforms={...app.surface.uniforms,uShore:{value:deep},uShoreWave:{value:new THREE.Vector4()},
      uImpact:{value:Array.from({length:8},()=>new THREE.Vector4(0,0,1e9,0))}};
    for(const n of ['uDisp0','uDisp1','uDisp2'])uniforms[n]={value:zero};
    const read=(sim,n)=>{const a=new Float32Array(512*sim.height*4);r.readRenderTargetPixels(sim.target,0,0,512,sim.height,a,0,n);return a;};
    fd4.read=read;
    for(const profile of skip?[]:['desktop','mobile'])for(const angle of [0,10,30,45]){
      const geo=new THREE.PlaneGeometry(40,40,8,8);geo.rotateX(-Math.PI/2);
      const pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++)pos.setY(i,4+pos.getX(i)*Math.tan(angle*Math.PI/180));
      const terrain=new TerrainContact(geo,40);
      const hull=[[-.1,-.05,-.1],[.1,-.05,-.1],[.1,-.05,.1],[-.1,-.05,.1]].map(p=>new THREE.Vector3(...p));
      const tiles={count:2,x:[-.1,.1],z:[0,0],yaw:[0,0],radius:[.1,.1],y0:[0,0],thickness:[.1,.1],runId:[0,0],flags:[1,1],footprints:[hull,hull]};
      const frame={index:0,offset:new THREE.Vector3(),pose:new THREE.Vector4(),pivot:new THREE.Vector3()};
      const sim=new TileSim(r,{uniforms},tiles,[{tiles:[0,1]}],profile,[frame],terrain);
      const params={...t.params,mode:'drift',windage:.2,orbit:1};
      const matrix=new THREE.Matrix4();
      for(let i=0;i<360;i++)sim.update(matrix,1/30,params);
      const a=read(sim,0),b=read(sim,1),c=read(sim,2);
      let minClearance=Infinity;
      for(let id=0;id<2;id++)for(const v of hull){
        const p=v.clone().applyMatrix4(tileTiltMatrix(b[id*4],b[id*4+1])).add(new THREE.Vector3(tiles.x[id]+a[id*4+2],a[id*4],a[id*4+3]));
        minClearance=Math.min(minClearance,p.y-terrain.at(p.x,p.z).height);
      }
      const fake={sim,renderer:r,terrainContact:terrain,rest:{tiles},group:{matrixWorld:matrix},camera:app.camera};
      const query=new TileFrameQuery(fake,1);
      const verdict=await query.query(frame);
      results.push({kind:'polyline',profile,angle,tilt:Math.hypot(b[0],b[1])*180/Math.PI,minClearance,
        horizontalDifference:Math.hypot(a[2]-a[6],a[3]-a[7]),speed:Math.hypot(c[0],c[1]),
        flatSeam:angle===0?Math.abs(a[0]-a[4]):null,blocked:verdict[0]});
      query.dispose();sim.dispose();terrain.dispose();geo.dispose();
    }
    for(const kind of skip?[]:['steep','deep','empty','offPivot','edge','sweep']){
      const geo=new THREE.PlaneGeometry(40,40,8,8);geo.rotateX(-Math.PI/2);
      const pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++){
        const x=pos.getX(i);
        const h=kind==='empty'||kind==='sweep'?Math.max(0,1-Math.abs(x)/5)*10:
          kind==='offPivot'?3+Math.max(0,x)*2: (kind==='deep'?-150:30)+x*2;
        pos.setY(i,h);
      }
      const terrain=new TerrainContact(geo,40);
      const hull=[[-.1,-.05,-.1],[.1,-.05,-.1],[.1,-.05,.1],[-.1,-.05,.1]].map(p=>new THREE.Vector3(...p));
      const xs=kind==='empty'||kind==='offPivot'?[-8,8]:kind==='sweep'?[-8,-8]:[0,0];
      // An owner with no drawn vertices must never turn empty bounds into a rejection.
      const tiles={count:3,x:[...xs,0],z:[0,0,0],yaw:[0,0,0],radius:[.1,.1,.1],y0:[0,0,0],thickness:[.1,.1,.1],runId:[-1,-1,-1],flags:[0,0,1],footprints:[hull,hull,[]]};
      const frame={index:0,offset:new THREE.Vector3(),pose:new THREE.Vector4(),pivot:new THREE.Vector3()};
      const sim=new TileSim(r,{uniforms},tiles,[],'desktop',[frame],terrain);
      const matrix=new THREE.Matrix4(),fake={sim,renderer:r,terrainContact:terrain,rest:{tiles},group:{matrixWorld:matrix},camera:app.camera};
      const query=new TileFrameQuery(fake,1);
      const verdict=await query.query(frame,new THREE.Vector2(kind==='edge'?22:kind==='sweep'?16:0,0));
      results.push({kind,blocked:verdict[0]});
      query.dispose();sim.dispose();terrain.dispose();geo.dispose();
    }
    if(!skip){
      const frames=t.frameRegistry.entries.slice(0,2),geo=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();
      const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,20);camera.position.z=10;camera.updateMatrixWorld();
      const target=new THREE.WebGLRenderTarget(4,4),buffer=new Uint8Array(4);
      const meshes=frames.map((f,i)=>{
        const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:i?0x0000ff:0xff0000,toneMapped:false}));scene.add(m);return m;
      });
      for(const transparent of [false,true])for(const top of [1,0]){
        t.placeFrameOnTop(frames[top]);
        meshes.forEach((m,i)=>{
          const original=t.group.children.find(child=>child.userData.frameIndex===frames[i].index)??t.boundsEntries.find(e=>e.frameIndex===frames[i].index).mesh;
          m.renderOrder=original.renderOrder;
          m.material.dispose();
          m.material=new THREE.MeshBasicMaterial({color:i?0x0000ff:0xff0000,toneMapped:false,
            transparent,depthWrite:!transparent,opacity:transparent?0.7:1,
            polygonOffset:original.material.polygonOffset,polygonOffsetFactor:original.material.polygonOffsetFactor,polygonOffsetUnits:original.material.polygonOffsetUnits});
        });
        const prev=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();
        r.setClearColor(0,1);r.setRenderTarget(target);r.clear();r.render(scene,camera);r.readRenderTargetPixels(target,2,2,1,1,buffer);
        r.setRenderTarget(prev);r.setClearColor(color,alpha);
        results.push({kind:'overlap',transparent,top,pixel:Array.from(buffer),ranks:meshes.map(m=>m.renderOrder)});
      }
      meshes.forEach(m=>m.material.dispose());geo.dispose();target.dispose();
    }
    zero.dispose();deep.dispose();t.update=update;
    return results;
  },!!process.env.FD4_DOM_ONLY);
  for(const f of report.fixtures){
    if(f.kind==='polyline'){
      assert(Math.abs(f.tilt-f.angle)<.15,JSON.stringify(f));assert(f.minClearance>=-.001,JSON.stringify(f));
      assert(f.horizontalDifference<1e-7,JSON.stringify(f));assert(f.speed<.001,JSON.stringify(f));
      if(f.flatSeam!==null)assert(f.flatSeam<.0001,JSON.stringify(f));assert(f.blocked===0,JSON.stringify(f));
    }else if(f.kind==='overlap'){
      assert(f.top===0?f.pixel[0]>f.pixel[2]:f.pixel[2]>f.pixel[0],JSON.stringify(f));
      if(f.transparent)assert(f.pixel[0]>0&&f.pixel[2]>0,JSON.stringify(f));
    }else assert.equal(f.blocked,['steep','offPivot','edge','sweep'].includes(f.kind)?1:0,JSON.stringify(f));
  }
  if(!process.env.FD4_DOM_ONLY){
    report.land=await page.evaluate(async()=>{
      const {tileTiltMatrix}=await import('/src/tiles/tileTilt.js');
      const t=app.tiles,f=t.frameRegistry.entries[2],THREE=fd4.THREE;
      fd4.original={world:f.world.clone(),camera:app.camera.position.clone(),target:app.controls.target.clone()};
      t.moveFrame(f.id,260,120);
      for(let i=0;i<240;i++)t.update(1/60);
      const a=fd4.read(t.sim,0),b=fd4.read(t.sim,1),tiles=t.rest.tiles;
      let minClearance=Infinity,contact=0,maxTilt=0;
      for(let id=0;id<tiles.count;id++){
        if(tiles.frameIndex[id]!==f.index||!(tiles.flags[id]&1)||!tiles.footprints[id]?.length)continue;
        if(b[id*4+2]>.99)contact++;
        maxTilt=Math.max(maxTilt,Math.hypot(b[id*4],b[id*4+1])*180/Math.PI);
        for(const v of tiles.footprints[id]){
          const p=v.clone().applyMatrix4(tileTiltMatrix(b[id*4],b[id*4+1])).add(new THREE.Vector3(
            tiles.x[id]+a[id*4+2]+f.offset.x,tiles.y0[id]+a[id*4],tiles.z[id]+a[id*4+3]+f.offset.z)).applyMatrix4(t.group.matrixWorld);
          minClearance=Math.min(minClearance,p.y-t.terrainContact.at(p.x,p.z).height);
        }
      }
      const h=t.terrainContact.at(260,120).height;
      app.camera.position.set(260,h+100,220);app.controls.target.set(260,h,120);app.controls.update();
      return{minClearance,contact,maxTilt};
    });
    assert(report.land.minClearance>=-.001,JSON.stringify(report.land));assert(report.land.contact>0);
    report.landScreenshot=join(tmpdir(),'water-fd4-land.png');await page.screenshot({path:report.landScreenshot});
    report.returned=await page.evaluate(()=>{
      const t=app.tiles,f=t.frameRegistry.entries[2],old=fd4.original;
      t.moveFrame(f.id,old.world.x,old.world.z);
      for(let i=0;i<240;i++)t.update(1/60);
      const b=fd4.read(t.sim,1),tiles=t.rest.tiles;let contacts=0;
      for(let id=0;id<tiles.count;id++)if(tiles.frameIndex[id]===f.index&&(tiles.flags[id]&1)&&b[id*4+2]>.01)contacts++;
      app.camera.position.copy(old.camera);app.controls.target.copy(old.target);app.controls.update();
      return{contacts};
    });
    assert.equal(report.returned.contacts,0);
  }
  report.real=await page.evaluate(async()=>{
    const t=app.tiles,s=t.sim,THREE=fd4.THREE;
    const frame=t.frameRegistry.entries[2];
    const begin=performance.now();
    const warm=await t.interaction.placementQuery.query(frame);
    const warmMs=performance.now()-begin;
    t.interaction.clearSelection();
    const bounds=[frame.bounds.min.x,frame.bounds.min.y,frame.bounds.max.x,frame.bounds.max.y];
    const a=fd4.read(s,0),tiles=t.rest.tiles;
    let grab;
    for(let id=0;id<tiles.count;id+=7){
      if(tiles.frameIndex[id]!==frame.index)continue;
      const p=new THREE.Vector3(tiles.x[id]+a[id*4+2]+frame.offset.x,
        tiles.y0[id]+a[id*4]+tiles.surfaceOffset[id],tiles.z[id]+a[id*4+3]+frame.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
      const x=(p.x+1)*700,y=(1-p.y)*500;if(x<100||x>1100||y<200||y>850)continue;
      if(t.interaction.picker.pick(app.camera,x,y)?.frame===frame){grab={x,y};break;}
    }
    if(!grab)throw new Error('No exposed hybrid tile');
    fd4.frame=frame;fd4.start=frame.world.clone();
    return {count:tiles.count,footprints:tiles.footprints.filter(p=>p?.length>=3).length,maxLength:t.rest.maxPolylineLength,bounds:Array.from(bounds),grab,warm:Array.from(warm),warmMs};
  });
  await page.mouse.move(report.real.grab.x,report.real.grab.y);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>app.tiles.interaction.highlight.style.display),'none','Hover must not select');
  await page.mouse.click(report.real.grab.x,report.real.grab.y);
  await page.waitForTimeout(50);
  // Click selects the grabbed frame and draws its SVG outline from four world corners (FD4).
  const clicked=await page.evaluate(()=>({points:app.tiles.interaction.outline.getAttribute('points'),
    display:app.tiles.interaction.highlight.style.display,selected:app.tiles.interaction.selected?.index,frame:fd4.frame.index}));
  const corners=(clicked.points??'').trim().split(/\s+/).map(c=>c.split(',').map(Number));
  assert.equal(clicked.display,'block','Click must show the frame outline');
  assert.equal(clicked.selected,clicked.frame,'Click must select the grabbed frame');
  assert(corners.length===4&&corners.every(c=>c.length===2&&c.every(Number.isFinite)),`Outline needs 4 finite corners: ${clicked.points}`);
  // The next press follows a click immediately: it must start a drag, even
  // inside the browser's double-click time window.
  await page.mouse.down();
  await page.mouse.move(report.real.grab.x+100,report.real.grab.y,{steps:10});await page.waitForTimeout(2000);
  await page.mouse.up();await page.waitForTimeout(300);
  report.selection=await page.evaluate(()=>({selected:app.tiles.interaction.selected?.index,
    box:app.tiles.interaction.outline.getBoundingClientRect().toJSON(),rank:fd4.frame.rank,
    movement:fd4.frame.world.distanceTo(fd4.start),limited:app.tiles.interaction.limited,pending:app.tiles.interaction.placementQuery.pending,
    delta:app.tiles.interaction.placementQuery.uniforms.uDelta.value.toArray(),hull:app.tiles.sim.footprintVertices,
    meshes:app.tiles.group.children.filter(m=>m.renderOrder===fd4.frame.rank).length}));
  assert(report.selection.selected===2);assert(report.selection.rank>0);assert(report.selection.movement>1);
  assert(report.selection.box.width>10&&report.selection.box.height>10);
  const fixed=await page.evaluate(()=>app.tiles.interaction.outline.getAttribute('points'));
  assert.notEqual(fixed,clicked.points,'The outline must follow the dragged frame');
  await page.waitForTimeout(400);
  report.stable=await page.evaluate(()=>({points:app.tiles.interaction.outline.getAttribute('points'),fill:app.tiles.interaction.outline.getAttribute('fill'),
    wireframe:app.tiles.group.children.some(m=>m.material.wireframe),promotions:app.tiles.promotion.active.size}));
  assert.equal(report.stable.points,fixed,'Waves must not move frame corners');
  assert.equal(report.stable.fill,'none');assert.equal(report.stable.wireframe,false);assert.equal(report.stable.promotions,0);
  report.screenshot=join(tmpdir(),'water-fd4-frame.png');await page.screenshot({path:report.screenshot});
  const empty=await page.evaluate(()=>{
    const i=app.tiles.interaction;
    for(const [x,y] of [[60,900],[80,700],[1200,850],[700,900]])if(!i.picker.pick(app.camera,x,y))return{x,y};
    throw new Error('No empty pixel');
  });
  await page.mouse.click(empty.x,empty.y);await page.waitForTimeout(200);
  report.cleared=await page.evaluate(()=>({selected:app.tiles.interaction.selected,display:app.tiles.interaction.highlight.style.display}));
  assert.equal(report.cleared.selected,null);assert.equal(report.cleared.display,'none');
  await page.mouse.move(report.real.grab.x,report.real.grab.y);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>app.tiles.interaction.highlight.style.display),'none','Hover must not bring selection back');
  if(!process.env.FD4_DOM_ONLY){
    const drag=await page.evaluate(()=>{
      const t=app.tiles,THREE=fd4.THREE,terrain=t.terrainContact;
      app.camera.position.set(130,700,-130);app.controls.target.set(130,0,-130);app.controls.update();app.camera.updateMatrixWorld();
      const a=fd4.read(t.sim,0),tiles=t.rest.tiles,f=t.frameRegistry.entries[2];
      let grab;
      for(let id=0;id<tiles.count;id+=7){
        if(tiles.frameIndex[id]!==f.index)continue;
        const p=new THREE.Vector3(tiles.x[id]+a[id*4+2]+f.offset.x,tiles.y0[id]+a[id*4]+tiles.surfaceOffset[id],
          tiles.z[id]+a[id*4+3]+f.offset.z).applyMatrix4(t.group.matrixWorld).project(app.camera);
        const x=(p.x+1)*700,y=(1-p.y)*500;
        if(x>70&&x<1100&&y>150&&y<900&&t.interaction.picker.pick(app.camera,x,y)?.frame===f){grab={x,y};break;}
      }
      if(!grab)throw new Error('No tile in mountain view');
      // The shipped island may have no >55 degree dry triangles. Introduce a
      // matching visible/contact fixture, without changing product source.
      let dry=terrain.steepBounds.some(cell=>[1/3,2/3].some(frac=>{
        const p=terrain.at(cell.minX+terrain.step*frac,cell.minZ+terrain.step*frac);
        return p.height>10&&p.normal.y<Math.cos(55*Math.PI/180);
      }));
      fd4.steepFixture=!dry;
      if(!dry){
        const i=Math.floor(terrain.segments/2),j=i,k=j*terrain.width+i,h=terrain.heights[k];
        for(const [id,value] of [[k,h+15],[k+1,h],[k+terrain.width,h],[k+terrain.width+1,h]]){
          terrain.heights[id]=value;t.terrainGeometry.attributes.position.setY(id,value);
        }
        terrain.texture.needsUpdate=true;t.terrainGeometry.attributes.position.needsUpdate=true;t.terrainGeometry.computeVertexNormals();
        terrain.steepBounds.push({minX:0,maxX:terrain.step,minZ:0,maxZ:terrain.step});
      }
      for(const cell of terrain.steepBounds)for(const fraction of [1/3,2/3]){
        const x=cell.minX+terrain.step*fraction,z=cell.minZ+terrain.step*fraction;
        const ground=terrain.at(x,z);if(ground.height<10||ground.normal.y>=Math.cos(55*Math.PI/180))continue;
        const p=new THREE.Vector3(x,ground.height+.1,z).project(app.camera);
        return{...grab,toX:(p.x+1)*700,toY:(1-p.y)*500};
      }
      throw new Error('No dry steep triangle');
    });
    await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.toX,drag.toY,{steps:8});
    await page.waitForFunction(()=>app.tiles.interaction.gesture?.dragged&&app.tiles.interaction.limited&&app.tiles.interaction.marker.style.display==='block',{}, {timeout:60000});
    report.blocked=await page.evaluate(()=>({limited:app.tiles.interaction.limited,marker:app.tiles.interaction.marker.style.display,terrainFixture:fd4.steepFixture,
      world:app.tiles.interaction.gesture.frame.world.toArray(),target:app.tiles.interaction.gesture.target.toArray()}));
    report.blockedScreenshot=join(tmpdir(),'water-fd4-blocked.png');await page.screenshot({path:report.blockedScreenshot});
    await page.mouse.up();
    assert(report.blocked.limited&&report.blocked.marker==='block');
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({...report,errors,pass:true},null,2));
}finally{await browser.close();}
