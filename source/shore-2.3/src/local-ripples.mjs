import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,instancedArray,uniform,uint,int,vec2,vec4,float,max,min,select,smoothstep,length} from 'three/tsl';
export function createLocalRipples(renderer,sim,{resolution=512}={}){
 const n=resolution,extent=8,dx=extent/n,a=instancedArray(new Float32Array(n*n*4),'vec4'),b=instancedArray(new Float32Array(n*n*4),'vec4');
 const center=uniform(new THREE.Vector2()),shift=uniform(new THREE.Vector2()),dt=uniform(.003),active=uniform(0),strength=uniform(.035),damping=uniform(1.8),immersionRate=uniform(0);let parity=0,lastImmersion=0;
 const kernel=(read,write)=>Fn(()=>{
  const g=vec2(instanceIndex.mod(n),instanceIndex.div(n)),q=g.add(shift),inside=q.x.greaterThanEqual(2).and(q.y.greaterThanEqual(2)).and(q.x.lessThan(n-2)).and(q.y.lessThan(n-2));
  const at=(x,y)=>read.element(uint(q.y.add(y).clamp(0,n-1).mul(n).add(q.x.add(x).clamp(0,n-1))));
  const s=at(0,0).toVar(),lap=at(1,0).x.add(at(-1,0).x).add(at(0,1).x).add(at(0,-1).x).sub(s.x.mul(4)).div(dx*dx);
  const biharm=at(2,0).x.add(at(-2,0).x).add(at(0,2).x).add(at(0,-2).x).add(at(1,1).x.add(at(-1,1).x).add(at(1,-1).x).add(at(-1,-1).x).mul(2)).sub(at(1,0).x.add(at(-1,0).x).add(at(0,1).x).add(at(0,-1).x).mul(8)).add(s.x.mul(20)).div(dx**4);
  const p=g.add(.5).mul(dx).sub(4).add(center),delta=p.sub(sim.body.xy),r=length(delta),radius=sim.body.w.max(.1),gauss=delta.dot(delta).div(radius.pow(2)).negate().exp();
  const dipole=sim.bodyMotion.xy.dot(delta).div(radius.pow(2)).mul(gauss).mul(sim.bodyMotion.z),entry=r.sub(radius).div(.12).pow(2).negate().exp().mul(immersionRate);
  const edge=smoothstep(3.1,3.95,max(p.x.sub(center.x).abs(),p.y.sub(center.y).abs())),v=s.y.add(lap.mul(2.5).sub(biharm.mul(.000025)).add(dipole.mul(2).add(entry).mul(strength)).mul(dt)).mul(dt.mul(damping.add(edge.mul(25))).negate().exp());
  const h=s.x.add(v.mul(dt)).clamp(-.075,.075).mul(float(1).sub(edge.mul(.04)));
  write.element(instanceIndex).assign(select(inside,vec4(h,v,0,0),vec4(0)));
 })().compute(n*n,[64]);
 const clear=Fn(()=>{a.element(instanceIndex).assign(vec4(0));b.element(instanceIndex).assign(vec4(0));})().compute(n*n,[64]);
 const nodes=[kernel(a,b),kernel(b,a)],value=i=>select(active.equal(0),a.element(i),b.element(i));
 return{strength,damping,center,resolution:n,async read(){return new Float32Array(await renderer.getArrayBufferAsync((parity?b:a).value));},normal(p){return Fn(()=>{const q=p.sub(center).add(4).div(dx).sub(.5),g=q.floor().clamp(1,n-2),i=uint(g.y.mul(n).add(g.x)),fade=float(1).sub(smoothstep(3,3.9,max(p.x.sub(center.x).abs(),p.y.sub(center.y).abs())));return vec2(value(i.add(1)).x.sub(value(i.sub(1)).x),value(i.add(n)).x.sub(value(i.sub(n)).x)).div(dx*2).mul(fade);})();},step(seconds){const next=new THREE.Vector2(Math.round(sim.body.value.x/(dx*8))*dx*8,Math.round(sim.body.value.y/(dx*8))*dx*8);shift.value.copy(next).sub(center.value).multiplyScalar(1/dx);center.value.copy(next);immersionRate.value=Math.max(-3,Math.min(3,(sim.bodyMotion.value.z-lastImmersion)/Math.max(seconds,.001)));lastImmersion=sim.bodyMotion.value.z;let left=Math.min(seconds,.05);while(left>1e-7){dt.value=Math.min(.003,left);renderer.compute(nodes[parity]);parity=1-parity;left-=dt.value;shift.value.set(0,0);}active.value=parity;},reset(){for(const s of [a,b]){s.value.array.fill(0);s.value.needsUpdate=true;}parity=0;active.value=0;lastImmersion=0;renderer.compute(clear);}};
}
