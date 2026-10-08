import * as THREE from 'three/webgpu';
import {Fn,positionLocal,uint,vec2,vec3,vec4,float,min,max,abs,normalize,refract,dFdx,dFdy,smoothstep} from 'three/tsl';
import {sampleBedInfo} from './water-rays.mjs';
export function createWaterCaustics(renderer,sim){
 const size=512,segments=256,target=new THREE.RenderTarget(size,size,{type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});target.texture.name='Shared-surface caustic irradiance';
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-16,16,16,-16,.1,60);camera.position.set(0,30,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
 const geometry=new THREE.PlaneGeometry(32-sim.dx,32-sim.dx,segments,segments);geometry.rotateX(-Math.PI/2);
 const material=new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide,transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,toneMapped:false});
 const grid=positionLocal.xz.add(16).div(sim.dx).sub(.5).round().clamp(0,sim.n-1),x=uint(grid.x),z=uint(grid.y),i=z.mul(sim.n).add(x),il=z.mul(sim.n).add(max(x,1).sub(1)),ir=z.mul(sim.n).add(min(x.add(1),sim.n-1)),id=max(z,1).sub(1).mul(sim.n).add(x),iu=min(z.add(1),sim.n-1).mul(sim.n).add(x);
 const h=sim.elevation(i),normal=normalize(vec3(sim.elevation(il).sub(sim.elevation(ir)).div(sim.dx*2),1,sim.elevation(id).sub(sim.elevation(iu)).div(sim.dx*2))),light=vec3(-.48,.84,-.42).normalize(),ray=refract(light.negate(),normal,float(1/1.333));
 const source=vec3(positionLocal.x,h,positionLocal.z),depth=max(h.sub(sim.bed.element(i).x),0),first=source.add(ray.mul(depth.div(max(ray.y.negate(),.25)))),receiverDepth=max(h.sub(sampleBedInfo(sim,first.xz).data.x),0),hit=source.add(ray.mul(receiverDepth.div(max(ray.y.negate(),.25))));
 material.positionNode=vec3(hit.x,0,hit.z);
 const from=source.xz.toVertexStage(),to=hit.xz.toVertexStage(),dx0=dFdx(from),dy0=dFdy(from),dx1=dFdx(to),dy1=dFdy(to),sourceArea=abs(dx0.x.mul(dy0.y).sub(dx0.y.mul(dy0.x))),receiverArea=abs(dx1.x.mul(dy1.y).sub(dx1.y.mul(dy1.x)));
 const intensity=sourceArea.div(max(receiverArea,.000001)).mul(normal.dot(light).max(0).div(normal.y.max(.2)).div(light.y)).clamp(.12,3.5);
 material.colorNode=vec3(intensity);material.opacityNode=smoothstep(.004,.025,depth.toVertexStage());
 const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);const savedColor=new THREE.Color();let lastTime=-1;
 return {texture:target.texture,stats:{resolution:size,triangles:segments*segments*2,bytes:size*size*8},update(){if(lastTime===sim.time.value)return;lastTime=sim.time.value;const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();renderer.getClearColor(savedColor);renderer.setRenderTarget(target);renderer.setClearColor(0x000000,0);renderer.render(scene,camera);renderer.setRenderTarget(previous);renderer.setClearColor(savedColor,alpha);},dispose(){geometry.dispose();material.dispose();target.dispose();}};
}
