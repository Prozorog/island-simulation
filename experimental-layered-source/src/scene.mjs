import * as THREE from 'three/webgpu';
import {Fn,attribute,positionLocal,positionWorld,vertexIndex,uniform,select,vec2,vec3,vec4,uint,int,max,min,transformNormalToView,wgslFn,smoothstep,mix,float,shadow,pass,renderOutput,normalWorld,normalize,texture} from 'three/tsl';
import {terrain,shoreline} from './terrain.mjs';
import {surfaceRipples} from './surface-ripples.mjs';
import {createLayeredCompute as createWaterCompute} from './layered-compute.mjs';
import {createSurfaceTexture} from './lookup-textures.mjs';
import {createSkyEnvironment} from './sky.mjs';
import {createWaterMaterial} from './water-material.mjs';
import {createGrass} from './grass.mjs';
import {createSandTracks} from './sand-tracks.mjs';
import {createSpray} from './spray.mjs';
import {fxaa} from 'three/addons/tsl/display/FXAANode.js';
export async function createShoreScene(renderer,{resolution=256}={}){
 const scene=new THREE.Scene();scene.environment=createSkyEnvironment();scene.environmentIntensity=.55;scene.background=new THREE.Color(0x343b46);
 const camera=new THREE.PerspectiveCamera(42,1,.06,180);camera.position.set(-29,29,34);camera.lookAt(0,.6,0);
 const sun=new THREE.DirectionalLight(0xfff2d7,3.0);sun.position.set(-18,32,-16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:1,far:80});sun.shadow.normalBias=.018;sun.shadow.bias=-.0002;sun.shadow.camera.layers.set(1);sun.shadow.camera.updateProjectionMatrix();scene.add(sun);scene.add(sun.target);
 const bakedSun=sun.clone();bakedSun.intensity=0;bakedSun.shadow=sun.shadow.clone();bakedSun.shadow.camera.layers.set(2);bakedSun.shadow.autoUpdate=false;bakedSun.shadow.needsUpdate=true;scene.add(bakedSun);bakedSun.shadow.camera.updateProjectionMatrix();
 sun.shadow.mapSize.set(512,512);Object.assign(sun.shadow.camera,{left:-4,right:4,top:4,bottom:-4});sun.shadow.camera.updateProjectionMatrix();
 const shadowMask=shadow(sun).mul(shadow(bakedSun));sun.shadow.shadowNode=shadowMask;
 scene.add(new THREE.HemisphereLight(0xd5e5f1,0x756641,1.0));
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 const sim=await createWaterCompute(renderer,{resolution});
 const terrainGeom=new THREE.PlaneGeometry(32-sim.dx,32-sim.dx,sim.n-1,sim.n-1);terrainGeom.rotateX(-Math.PI/2);const pos=terrainGeom.attributes.position,biome=new Float32Array(pos.count*4);
 for(let i=0;i<pos.count;i++){const b=sim.bedArray.subarray(i*4,i*4+4),x=i%sim.n,z=Math.floor(i/sim.n);if(x===0||x===sim.n-1)pos.setX(i,x===0?-16:16);if(z===0||z===sim.n-1)pos.setZ(i,z===0?-16:16);pos.setY(i,b[0]);biome.set(b,i*4);}pos.needsUpdate=true;terrainGeom.setAttribute('biome',new THREE.BufferAttribute(biome,4));terrainGeom.setAttribute('groundRefined',new THREE.BufferAttribute(new Float32Array(pos.count),1));terrainGeom.computeVertexNormals();
 const surfaceColor=wgslFn(`fn shoreSurface(p:vec3<f32>,b:vec4<f32>,detail:vec4<f32>,wet:f32)->vec3<f32>{
 let ripples=sin(p.x*28.0+p.z*4.2+sin(p.z*1.5)*2.0)*0.5+0.5;
 let strata=sin((p.y+p.x*.23-p.z*.14)*34.0+sin(p.x*9.0)*.45)*.5+.5;
 let grain=sin(p.x*3.7+sin(p.z*2.8))*sin(p.z*4.1-p.x*.3)*.5+.5;
 var sand=mix(vec3<f32>(.57,.48,.34),vec3<f32>(.76,.70,.57),ripples*.065+.71);sand*=mix(1.0,.66,wet);
 let layer=(p.y+p.x*.28-p.z*.17)*16.0+4.5*detail.r+2.0*detail.g;let seam=pow(.5+.5*sin(layer+1.0),16.0);let fracture=pow(1.0-abs(sin(layer*.43+detail.g*3.0)),22.0)*(.3+.7*detail.b);
 var rock=mix(vec3<f32>(.10,.045,.018),vec3<f32>(.315,.175,.075),smoothstep(.17,.80,detail.r));rock*=.76+.42*detail.b;rock+=vec3<f32>(.017,.0125,.0065)*sin(layer)*(.3+.7*detail.b);rock*=1.0-.40*fracture-.12*seam;

 let turf=mix(vec3<f32>(.09,.11,.033),vec3<f32>(.19,.20,.07),grain);
 return mix(mix(sand,turf,b.y),rock,b.z);
}`);
 const tracks=createSandTracks(renderer,sim),groundDetailScale=uniform(1),surfaceTex=texture(createSurfaceTexture());
 const surfaceWeights=normalWorld.abs().pow(4),sw=surfaceWeights.div(surfaceWeights.x.add(surfaceWeights.y).add(surfaceWeights.z));
 const surfaceDetail=surfaceTex.sample(positionWorld.zy.mul(.125)).mul(sw.x).add(surfaceTex.sample(positionWorld.xz.mul(.125)).mul(sw.y)).add(surfaceTex.sample(positionWorld.xy.mul(.125)).mul(sw.z));
 const wetness=Fn(()=>{const grid=positionLocal.xz.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),base=grid.floor().min(sim.n-2),f=grid.sub(base);const at=(x,z)=>sim.wet.element(uint(base.y.add(z).mul(sim.n).add(base.x.add(x))));return mix(mix(at(0,0),at(1,0),f.x),mix(at(0,1),at(1,1),f.x),f.y);})().toVertexStage();
 const groundMat=new THREE.MeshStandardNodeMaterial({roughness:.86});groundMat.colorNode=surfaceColor(positionWorld,attribute('biome','vec4'),surfaceDetail,wetness).mul(float(1).sub(tracks.node.mul(.18).mul(float(1).sub(attribute('biome','vec4').y)).mul(float(1).sub(attribute('biome','vec4').z))));
 groundMat.roughnessNode=mix(float(.86),float(.30),wetness.mul(float(1).sub(attribute('biome','vec4').y)));
 const detailHeight=wgslFn(`fn shoreDetailHeight(p:vec3<f32>,b:vec4<f32>,detail:vec4<f32>)->f32{
 let phase=p.x*21.0+3.1*sin(p.x*.8+sin(p.z*.7))+1.7*sin(p.z*2.4+p.x*.9)+1.1*sin(p.z*1.7);
 let ripple=sin(phase)*.0035*(.65+.35*sin(p.z*1.6+p.x*.4)) * mix(.48,1.0,smoothstep(-.03,.23,b.x))*exp(-max(fwidth(phase)-.7,0.0)*2.0);
 let broad=sin(p.x*8.1+p.z*3.4+sin(p.z*5.1))*sin(p.z*9.7-p.x*1.1)*.024;
 let layer=(p.y+p.x*.28-p.z*.17)*16.0+4.5*detail.r+2.0*detail.g;let strata=sin(layer)*(.3+.7*detail.b)*.010;
 let fracture=-.014*pow(1.0-abs(sin(layer*.43+detail.g*3.0)),22.0)*(.3+.7*detail.b);
 return mix(ripple*(1.0-b.y),strata+fracture+.024*detail.r+.004*detail.b,b.z);
}`);
 const perturb=wgslFn(`fn shoreDetailNormal(p:vec3<f32>,n:vec3<f32>,h:f32)->vec3<f32>{
 let sx=dpdx(p);let sy=dpdy(p);let r1=cross(sy,n);let r2=cross(n,sx);let det=dot(sx,r1);
 let gradient=sign(det)*(dpdx(h)*r1+dpdy(h)*r2);return normalize(abs(det)*n-gradient);
}`);
 groundMat.normalNode=transformNormalToView(normalize(mix(normalWorld.add(tracks.gradient).normalize(),perturb(positionWorld,normalWorld.add(tracks.gradient).normalize(),detailHeight(positionWorld,attribute('biome','vec4'),surfaceDetail)),groundDetailScale)));
 groundMat.positionNode=positionLocal.add(vec3(0,tracks.height.mul(tracks.refined),0));groundMat.maskNode=tracks.mask;
 const ground=new THREE.Mesh(terrainGeom,groundMat);ground.receiveShadow=true;ground.castShadow=true;ground.layers.enable(2);scene.add(ground);tracks.attachGround(ground);scene.add(tracks.group);
 const edgePositions=[],edgeIndices=[];
 for(let side=0;side<4;side++)for(let j=0;j<=128;j++){const t=j/128,x=side<2?(side===0?-16:16):t*32-16,z=side<2?t*32-16:(side===2?-16:16),i=edgePositions.length/3;edgePositions.push(x,terrain(x,z)[0],z,x,-3.5,z);if(j<128)edgeIndices.push(i,i+1,i+2,i+2,i+1,i+3);}
 const edgeGeom=new THREE.BufferGeometry();edgeGeom.setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3));edgeGeom.setIndex(edgeIndices);edgeGeom.computeVertexNormals();scene.add(new THREE.Mesh(edgeGeom,new THREE.MeshStandardNodeMaterial({color:0x392817,roughness:1,side:THREE.DoubleSide})));
 const {material:waterMat,mirror,active,foamAmount,detailScale}=createWaterMaterial(sim,sun,shadowMask);
 const waterGeom=new THREE.PlaneGeometry(32-sim.dx,32-sim.dx,sim.n-1,sim.n-1);waterGeom.rotateX(-Math.PI/2);
 const wp=waterGeom.attributes.position;for(let i=0;i<wp.count;i++){const x=i%sim.n,z=Math.floor(i/sim.n);if(x===0||x===sim.n-1)wp.setX(i,x===0?-16:16);if(z===0||z===sim.n-1)wp.setZ(i,z===0?-16:16);}wp.needsUpdate=true;
 const wallPos=[],wallCell=[],wallIndex=[];for(let side=0;side<4;side++)for(let j=0;j<sim.n;j++){const v=j*32/(sim.n-1)-16,x=side<2?(side===0?-16:16):v,z=side<2?v:(side===2?-16:16),ix=side<2?(side===0?0:sim.n-1):j,iz=side<2?j:(side===2?0:sim.n-1),cell=iz*sim.n+ix,k=wallPos.length/3;wallPos.push(x,0,z,x,1,z);wallCell.push(cell,cell);if(j<sim.n-1)wallIndex.push(k,k+1,k+2,k+2,k+1,k+3);}
 const wallGeometry=new THREE.BufferGeometry();wallGeometry.setAttribute('position',new THREE.Float32BufferAttribute(wallPos,3));wallGeometry.setAttribute('cell',new THREE.Uint32BufferAttribute(wallCell,1));wallGeometry.setIndex(wallIndex);
 const wallId=uint(attribute('cell','uint')),wallState=select(active.equal(0),sim.a.element(wallId),sim.b.element(wallId)),wallBed=sim.bed.element(wallId).x,wallDepth=wallState.x.toVertexStage(),wallY=positionLocal.y.toVertexStage();
 const wallMaterial=new THREE.MeshBasicNodeMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:true});wallMaterial.positionNode=vec3(positionLocal.x,mix(wallBed,sim.elevation(wallId),positionLocal.y),positionLocal.z);wallMaterial.colorNode=mix(vec3(.025,.085,.105),vec3(.16,.36,.43),wallY);wallMaterial.opacityNode=smoothstep(.003,.03,wallDepth).mul(.93);wallMaterial.alphaTest=.001;
 const waterWall=new THREE.Mesh(wallGeometry,wallMaterial);waterWall.frustumCulled=false;waterWall.renderOrder=3;scene.add(waterWall);
 const water=new THREE.Mesh(waterGeom,waterMat);water.renderOrder=2;water.receiveShadow=true;water.frustumCulled=false;if(mirror)water.add(mirror.target);scene.add(water);
 const player=new THREE.Mesh(new THREE.CapsuleGeometry(.32,1.06,6,18),new THREE.MeshStandardNodeMaterial({color:0xfaa344,roughness:.36}));player.position.set(shoreline(-2)+1.8,terrain(shoreline(-2)+1.8,-2)[0]+.85,-2);player.castShadow=true;player.layers.set(1);camera.layers.enable(1);scene.add(player);
 const spray=createSpray(scene);
 const grass=createGrass(sim,shadowMask);scene.add(grass.group);grass.update(0,player.position,camera,640);
 const orbit={yaw:-.70,pitch:.62,radius:43,target:new THREE.Vector3(0,.6,0),follow:false};
 function updateCamera(){if(orbit.follow)orbit.target.copy(player.position).y-=.1;const horizontal=Math.cos(orbit.pitch)*orbit.radius;camera.position.set(orbit.target.x+Math.sin(orbit.yaw)*horizontal,orbit.target.y+Math.sin(orbit.pitch)*orbit.radius,orbit.target.z+Math.cos(orbit.yaw)*horizontal);camera.lookAt(orbit.target);}
 function setView(name){if(name==='shore'){player.position.set(-3.9,terrain(-3.9,-10.3)[0]+.85,-10.3);Object.assign(orbit,{yaw:-2.13,pitch:.40,radius:8.7,follow:true});}else if(name==='water'){player.position.set(-10.4,-.32,-4);Object.assign(orbit,{yaw:-2.18,pitch:.43,radius:8.4,follow:true});}else if(name==='grass'){const x=shoreline(-2)+7.4;player.position.set(x,terrain(x,-2)[0]+.85,-2);Object.assign(orbit,{yaw:-1.9,pitch:.35,radius:7.2,follow:true});}else{const x=shoreline(-2)+1.8;player.position.set(x,terrain(x,-2)[0]+.85,-2);Object.assign(orbit,{yaw:-.70,pitch:.62,radius:43,follow:false});orbit.target.set(0,.6,0);}updateCamera();}
 setView('wide');
 const scenePass=pass(scene,camera),pipeline=new THREE.RenderPipeline(renderer);pipeline.outputColorTransform=false;const display=renderOutput(scenePass.getTextureNode(),THREE.ACESFilmicToneMapping,THREE.SRGBColorSpace),luma=display.rgb.dot(vec3(.2126,.7152,.0722));pipeline.outputNode=fxaa(vec4(mix(vec3(luma),display.rgb,1.04).clamp(0,1),display.a));
 return {scene,camera,sim,player,water,grass,spray,onLanding(event){sim.impact(event);spray.emit(event);},orbit,foamAmount,tracks,detailScale,groundDetailScale,render(){spray.update(sim.time.value);pipeline.render()},updateCamera,setView,syncCamera(height=640){sun.target.position.copy(player.position);sun.position.copy(player.position).addScaledVector(new THREE.Vector3(-.48,.84,-.42).normalize(),40);grass.update(sim.time.value,player.position,camera,height)},step(dt){sim.step(dt);active.value=sim.parity}};
}
