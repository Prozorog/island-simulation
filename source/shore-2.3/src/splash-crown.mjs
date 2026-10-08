import * as THREE from 'three/webgpu';
import {uniform,uv,positionLocal,normalWorld,cameraPosition,positionWorld,vec3,float,sin,pow,mix,dot,max,normalize,smoothstep} from 'three/tsl';
// A short thin sheet, not a volume-fluid solver. All slots reuse one 96-triangle mesh.
export function createSplashCrowns(scene,{aspect=1,getHeading=()=>0}={}){
 const axis=Math.sqrt(aspect);const geometry=new THREE.CylinderGeometry(1,1,1,48,1,true),slots=[];let cursor=0;
 for(let i=0;i<4;i++){
  const age=uniform(2),energy=uniform(0),radius=uniform(.3),life=uniform(.6),a=age.div(life).clamp(0,1),v=uv().y;
  const pulse=sin(a.mul(Math.PI)).mul(float(1).sub(a).pow(.45)),spread=radius.add(age.mul(energy.mul(.7).add(.35)));
  const lobe=sin(uv().x.mul(Math.PI*2*9).add(i)).mul(.16).add(1),height=energy.mul(.45).add(.07).mul(pulse).mul(v).mul(lobe);
  const radial=spread.add(v.mul(energy.mul(.09)).mul(pulse));
  const material=new THREE.MeshStandardNodeMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,roughness:.16,metalness:0,forceSinglePass:true});
  material.positionNode=vec3(positionLocal.x.mul(radial).mul(axis),height,positionLocal.z.mul(radial).div(axis));
  const rim=pow(v,5),fresnel=pow(float(1).sub(dot(normalize(normalWorld),normalize(cameraPosition.sub(positionWorld))).abs()),3);
  material.colorNode=mix(vec3(.10,.27,.30),vec3(.78,.91,.92),rim.mul(.75).add(fresnel.mul(.25)).clamp(0,1));
  material.opacityNode=smoothstep(0,.06,a).mul(float(1).sub(smoothstep(.55,1,a))).mul(fresnel.mul(.32).add(rim.mul(.3)).add(.18));
  const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=4;mesh.visible=false;mesh.frustumCulled=false;scene.add(mesh);slots.push({mesh,age,energy,radius,life,born:-100});
 }
 return{emit(event){if(!event||!(event.impact>0))return;const s=slots[cursor++%slots.length];s.born=event.time;s.age.value=0;s.energy.value=event.impact;s.radius.value=Math.max(.1,event.radius*.95);s.life.value=.36+event.impact*.25;s.mesh.position.set(event.position.x,event.position.y+.006,event.position.z);s.mesh.rotation.y=getHeading();s.mesh.visible=true;},update(time){for(const s of slots){s.age.value=time-s.born;s.mesh.visible=s.age.value>=0&&s.age.value<s.life.value;}},reset(){for(const s of slots){s.born=-100;s.mesh.visible=false;}cursor=0;},stats(){return{active:slots.filter(s=>s.mesh.visible).length,capacity:slots.length}}};
}
