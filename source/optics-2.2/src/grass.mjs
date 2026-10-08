import * as THREE from 'three/webgpu';
import {attribute,positionLocal,uniform,vec3,vec4,transformNormalToView,wgslFn,positionWorld,float,mix,smoothstep,normalize,faceDirection,dot,max,pow,cameraPosition,Fn,vec2,cameraProjectionMatrix,cameraViewMatrix,modelViewProjection,abs,length} from 'three/tsl';
import {fbm,smooth,clamp} from './terrain.mjs';
const widthAt=t=>(.26+.74*Math.sin(Math.PI*Math.pow(t,.7)))*Math.pow(1-t,.65);
const area=n=>{let a=0;for(let i=0;i<n;i++)a+=(widthAt(i/n)+widthAt((i+1)/n))/(2*n);return a};
export function createGrass(sim,shadowMask){
 const group=new THREE.Group(),patches=Array.from({length:64},()=>[]);let seed=93457;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const fract=x=>x-Math.floor(x),randomLeaf=n=>fract(Math.sin(n*127.1+311.7)*43758.5453);
 function bedAt(x,z,k=0){const px=clamp((x+16)/32*sim.n-.5,0,sim.n-1),pz=clamp((z+16)/32*sim.n-.5,0,sim.n-1),ix=Math.floor(px),iz=Math.floor(pz),x1=Math.min(ix+1,sim.n-1),z1=Math.min(iz+1,sim.n-1),u=px-ix,v=pz-iz;const at=(a,b)=>sim.bedArray[(b*sim.n+a)*4+k];return (at(ix,iz)*(1-u)+at(x1,iz)*u)*(1-v)+(at(ix,z1)*(1-u)+at(x1,z1)*u)*v;}
 let tufts=0;
 for(let j=0;j<305;j++)for(let i=0;i<305;i++){
  const x=(i+random())/305*32-16,z=(j+random())/305*32-16,g=bedAt(x,z,1);if(g<.04)continue;
  const patch=fbm(x*.61+21,z*.61-19),cluster=fbm(x*1.8-7,z*1.8+11),density=g*(.48+.52*smooth(.30,.66,patch+.25*(cluster-.5)));if(random()>density)continue;
  const dry=fbm(x*.45,z*.45+29),h=(.18+random()*.22)*(.86+.25*cluster),id=random(),width=.007+random()*.005,azimuth=random()*6.283;
  const bucket=patches[Math.min(7,Math.floor((z+16)/4))*8+Math.min(7,Math.floor((x+16)/4))];tufts++;
  for(let leaf=0;leaf<7;leaf++){
   const s=randomLeaf(leaf+id*135.17),s2=randomLeaf(leaf+id*135.17+9.2),s3=randomLeaf(leaf+id*135.17+21.8),az=azimuth+s*Math.PI*2;
   const height=h*(leaf<3?.80+s2*.22:.95+s2*.35),bend=(leaf<3?.24+.22*s3:.50+.55*s3)*height;
   const rx=x+Math.cos(s3*6.283)*(.012+s*.060),rz=z+Math.sin(s3*6.283)*(.012+s*.060),phase=x*.73+z*.41+s*8;
   bucket.push(rx,bedAt(rx,rz)-.006,rz,height,Math.cos(az),Math.sin(az),bend,width*(.70+.5*s2),dry,s3,.24*smooth(.64,.94,s2)*(leaf>=3?1:.25),s,Math.sin(phase),Math.cos(phase),Math.sin(phase*1.73),Math.cos(phase*1.73));
  }
 }
 const clock=uniform(new THREE.Vector4(0,1,0,1)),body=uniform(new THREE.Vector3(10000,0,10000));
 const bladePosition=wgslFn(`fn shoreBlade(q:vec3<f32>,root:vec4<f32>,shape:vec4<f32>,traits:vec4<f32>,motion:vec4<f32>,wind:vec4<f32>,body:vec3<f32>)->vec3<f32>{
 let t=q.y;let side=vec2<f32>(-shape.y,shape.x);let delta=root.xz-body.xz;let d2=dot(delta,delta);var touch=vec2<f32>(0.0);if(d2<4.0){touch=delta*inverseSqrt(max(d2,.0001))*(.10*exp(-d2*3.5));}
 let sway=.008*(dot(motion.xy,wind.xy)+.18*dot(motion.zw,wind.zw));let bend=shape.xy*shape.z+vec2<f32>(sway,sway*.53)+touch;
 let center=root.xz+bend*t*t;let h=root.w*(t-.20*traits.y*t*t-traits.z*t*t*t);let sideOffset=side*q.x*shape.w*q.z;
 return vec3<f32>(center.x+sideOffset.x,root.y+h,center.y+sideOffset.y);
}`);
 const bladeNormal=wgslFn(`fn shoreBladeNormal(q:vec3<f32>,root:vec4<f32>,shape:vec4<f32>,traits:vec4<f32>,motion:vec4<f32>,wind:vec4<f32>)->vec3<f32>{let t=q.y;let side=vec3<f32>(-shape.y,0.0,shape.x);let sway=.008*(dot(motion.xy,wind.xy)+.18*dot(motion.zw,wind.zw));let tangent=vec3<f32>(2.0*t*(shape.x*shape.z+sway),root.w*(1.0-.4*traits.y*t-3.0*traits.z*t*t),2.0*t*(shape.y*shape.z+sway*.53));return normalize(cross(side,tangent)+side*q.x*.24);}`);
 const bladeCoord=attribute('position','vec3');
 const root=attribute('bladeRoot','vec4'),shape=attribute('bladeShape','vec4'),traits=attribute('bladeTraits','vec4'),motion=attribute('bladeMotion','vec4');
 const material=new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,forceSinglePass:true,shadowSide:THREE.DoubleSide});
 material.positionNode=bladePosition(bladeCoord,root,shape,traits,motion,clock,body);
 const rasterSize=uniform(new THREE.Vector2(960,640)).onRenderUpdate(({renderer})=>{const target=renderer.getRenderTarget();if(target)return rasterSize.value.set(target.width,target.height);return renderer.getDrawingBufferSize(rasterSize.value);});
 const centerP=bladePosition(vec3(0,bladeCoord.y,bladeCoord.z),root,shape,traits,motion,clock,body),sideP=vec3(shape.y.negate(),0,shape.x).mul(shape.w).mul(bladeCoord.z);
 const centerClip=cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(centerP,1))),edgeClip=cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(centerP.add(sideP),1))),direction=edgeClip.xy.div(max(edgeClip.w,.05)).sub(centerClip.xy.div(max(centerClip.w,.05))).mul(rasterSize).mul(.5);
 const halfWidth=length(direction).toVertexStage(),axis=direction.div(max(length(direction),.00001)),across=bladeCoord.x.toVertexStage();
 material.vertexNode=Fn(()=>{const clip=modelViewProjection.toVar();return clip.add(vec4(axis.mul(bladeCoord.x).div(rasterSize).mul(clip.w),0,0));})();
 const pixelDistance=abs(across).mul(halfWidth.add(.5)),coverage=halfWidth.sub(pixelDistance).add(.5).clamp(0,1).sub(halfWidth.negate().sub(pixelDistance).add(.5).clamp(0,1));
 material.normalNode=transformNormalToView(bladeNormal(bladeCoord,root,shape,traits,motion,clock)).toVertexStage();
 const tip=smoothstep(.05,.95,bladeCoord.y),dry=smoothstep(.36,.66,traits.x),rootShade=float(.60).add(smoothstep(.02,.62,bladeCoord.y).mul(.40));
 const base=mix(mix(vec3(.062,.101,.028),vec3(.158,.211,.060),tip),mix(vec3(.112,.098,.040),vec3(.236,.219,.111),tip),dry.mul(.72)).mul(traits.w.mul(.08).add(.96)).toVertexStage();
 const leafNormal=normalize(bladeNormal(bladeCoord,root,shape,traits,motion,clock).toVertexStage()).mul(faceDirection),sunDirection=vec3(-.48,.84,-.42).normalize(),nl=max(dot(leafNormal,sunDirection),0),shade=shadowMask.rgb;
 const light=vec3(.38,.44,.34).add(vec3(.98,.88,.68).mul(nl.mul(.8).add(.2)).mul(shade));
 const back=pow(max(dot(normalize(cameraPosition.sub(positionWorld)).negate(),sunDirection),0),3),transmitted=max(dot(leafNormal,sunDirection).negate(),0).mul(back.mul(.65).add(.35)).mul(float(1).sub(dry.mul(.65)));
 material.fragmentNode=vec4(base.mul(light).mul(float(.66).add(smoothstep(.02,.62,bladeCoord.y).mul(.34)).toVertexStage()).add(base.mul(vec3(.85,1.05,.35)).mul(transmitted).mul(.38).mul(shade)),coverage);

 const meshes=[];
 for(let patch=0;patch<patches.length;patch++){
  const data=patches[patch];if(!data.length)continue;const count=data.length/16,attributes=[];
  for(let a=0;a<4;a++){const array=new Float32Array(count*4);for(let i=0;i<count;i++)array.set(data.slice(i*16+a*4,i*16+a*4+4),i*4);attributes.push(new THREE.InstancedBufferAttribute(array,4));}
  const bounds=new THREE.Box3();for(let i=0;i<count;i++)bounds.expandByPoint(new THREE.Vector3(data[i*16],data[i*16+1],data[i*16+2]));bounds.expandByScalar(.7);const sphere=bounds.getBoundingSphere(new THREE.Sphere());
  const lods={};for(const segments of [1,2,3,4,6]){
   const p=[],idx=[],scale=area(6)/area(segments);for(let j=0;j<=segments;j++)for(const side of [-1,1])p.push(side,j/segments,widthAt(j/segments)*scale);
   for(let j=0;j<segments;j++){const a=j*2;idx.push(a,a+1,a+2);if(j<segments-1)idx.push(a+1,a+3,a+2);}
   const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);['bladeRoot','bladeShape','bladeTraits','bladeMotion'].forEach((key,i)=>g.setAttribute(key,attributes[i]));g.instanceCount=count;g.boundingBox=bounds;g.boundingSphere=sphere;lods[segments]=g;
  }
  const mesh=new THREE.Mesh(lods[3],material);mesh.renderOrder=1;mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(2);group.add(mesh);meshes.push({mesh,lods,sphere,segments:3,count});
 }
 return {group,tufts,blades:tufts*7,patches:meshes.length,update(time,player,camera,height){clock.value.set(Math.sin(time*1.4),Math.cos(time*1.4),Math.sin(time*3.1),Math.cos(time*3.1));body.value.copy(player);const scale=height/(2*Math.tan(camera.fov*Math.PI/360));for(const p of meshes){const d=Math.max(.15,camera.position.distanceTo(p.sphere.center)-p.sphere.radius);let next=6;for(const n of [1,2,3,4])if(scale*.14/(n*n*d)<.65){next=n;break;}if(next!==p.segments){p.mesh.geometry=p.lods[next];p.segments=next;}}},stats(){return {tufts,blades:tufts*7,draws:meshes.length,triangles:meshes.reduce((a,p)=>a+p.mesh.geometry.index.count/3*p.count,0)}}};
}
