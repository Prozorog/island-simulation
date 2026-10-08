import * as THREE from 'three/webgpu';
import {Fn,If,instanceIndex,uint,uvec2,vec2,vec4,float,uniform,texture,textureLoad,textureStore,min,max,mix,select,length,smoothstep} from 'three/tsl';
// Two physical densities, limited MacCormack transport, and two independently renewed material charts.
export function createFoamField(renderer,sim,{resolution=1024}={}){
 const n=resolution,dx=32/n,dt=uniform(1/60),active=uniform(0),freshLife=uniform(1.5),residualLife=uniform(30),strength=uniform(1),chartLife=uniform(2.4);
 const make=()=>{const t=new THREE.StorageTexture(n,n);t.type=THREE.HalfFloatType;t.generateMipmaps=false;return t;};
 const density=[make(),make()],predict=make(),charts=[[make(),make()],[make(),make()]];
 const at=(tex,p)=>textureLoad(tex,uvec2(p.clamp(0,n-1)));
 const sample=(tex,p)=>{const q=p.clamp(0,n-1),b=q.floor().min(n-2),f=q.sub(b);return mix(mix(at(tex,b),at(tex,b.add(vec2(1,0))),f.x),mix(at(tex,b.add(vec2(0,1))),at(tex,b.add(1)),f.x),f.y);};
 const state=(p)=>{const q=p.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),b=q.floor().min(sim.n-2),f=q.sub(b),i=uint(b.y.mul(sim.n).add(b.x)),a=j=>sim.a.element(j);return mix(mix(a(i),a(i.add(1)),f.x),mix(a(i.add(sim.n)),a(i.add(sim.n+1)),f.x),f.y);};
 const cell=p=>uint(p.y.add(16).div(sim.dx).floor().clamp(0,sim.n-1).mul(sim.n).add(p.x.add(16).div(sim.dx).floor().clamp(0,sim.n-1)));
 const velocity=p=>{const s=state(p);return s.yz.div(max(s.x,.008));};
 const world=g=>g.add(.5).mul(dx).sub(16);
 const grid=()=>vec2(instanceIndex.mod(n),instanceIndex.div(n));
 const trace=(p,sign)=>{const w=world(p),v=velocity(w),mid=w.add(v.mul(dt.mul(sign*.5))),back=p.add(velocity(mid).mul(dt.mul(sign/dx)));return select(state(world(back)).x.greaterThan(.003),back,p).clamp(0,n-1);};
 const init=[density,...charts].map((pair,j)=>Fn(()=>{const g=grid(),w=world(g);for(const t of pair)textureStore(t,uvec2(g),j===0?vec4(0):vec4(w,chartLife.mul((j-1)*.5),1)).toWriteOnly();})().compute(n*n,[64]));
 const advect=density.map(read=>Fn(()=>{const g=grid();textureStore(predict,uvec2(g),sample(read,trace(g,-1))).toWriteOnly();})().compute(n*n,[64]));
 const correct=density.map((read,k)=>Fn(()=>{
  const g=grid(),w=world(g),back=trace(g,-1).toVar(),b=back.floor(),old=at(read,g),pred=at(predict,g),reverse=sample(predict,trace(g,1));
  const lo=min(min(at(read,b),at(read,b.add(vec2(1,0)))),min(at(read,b.add(vec2(0,1))),at(read,b.add(1))));
  const hi=max(max(at(read,b),at(read,b.add(vec2(1,0)))),max(at(read,b.add(vec2(0,1))),at(read,b.add(1))));
  const transported=pred.add(old.sub(reverse).mul(.5)).clamp(lo,hi).xy.toVar(),s=state(w),i=cell(w),bed=sim.bed.element(i),v=s.yz.div(max(s.x,.008));
  const bg=vec2(sim.bed.element(cell(w.add(vec2(sim.dx,0)))).x.sub(sim.bed.element(cell(w.sub(vec2(sim.dx,0)))).x),sim.bed.element(cell(w.add(vec2(0,sim.dx)))).x.sub(sim.bed.element(cell(w.sub(vec2(0,sim.dx)))).x)).div(sim.dx*2);
  const uphill=max(v.dot(bg),0),shore=smoothstep(.005,.025,s.x).mul(float(1).sub(smoothstep(.10,.3,s.x))).mul(smoothstep(.01,.15,uphill));
  const rock=bed.z.mul(smoothstep(.02,.3,uphill)).mul(smoothstep(.004,.025,s.x));
  const delta=w.sub(sim.body.xy),rim=length(delta).sub(sim.body.w).div(.17).pow(2).negate().exp(),body=rim.mul(length(sim.bodyMotion.xy.sub(v)).smoothstep(.15,1.7)).mul(sim.bodyMotion.z);
  const source=sim.wet.element(i).y.mul(2.8).add(shore.mul(2)).add(rock.mul(3)).add(body.mul(2)).mul(strength);
  const fresh=transported.x.mul(dt.div(freshLife).negate().exp()).add(float(1).sub(transported.x).mul(float(1).sub(source.mul(dt).negate().exp()))).clamp(0,1);
  const residual=transported.y.mul(dt.div(residualLife).negate().exp()).add(float(1).sub(transported.y).mul(fresh.mul(dt).mul(.65))).clamp(0,1);
  const wet=smoothstep(.001,.008,s.x);textureStore(density[1-k],uvec2(g),vec4(fresh.mul(wet),residual.mul(wet),source.clamp(0,1),wet)).toWriteOnly();
 })().compute(n*n,[64]));
 const chartNodes=charts.map(pair=>pair.map((read,k)=>Fn(()=>{
  const g=grid(),w=world(g),back=trace(g,-1),old=sample(read,back).toVar();
  const gx=sample(read,back.add(vec2(1,0))).xy.sub(sample(read,back.sub(vec2(1,0))).xy).div(dx*2),gz=sample(read,back.add(vec2(0,1))).xy.sub(sample(read,back.sub(vec2(0,1))).xy).div(dx*2);
  const stretch=max(length(gx),length(gz)),age=old.z.add(dt).toVar(),fade=smoothstep(0,.18,age).mul(float(1).sub(smoothstep(chartLife.mul(.7),chartLife,age))),quality=float(1).sub(smoothstep(2.5,4,stretch));
  const reset=age.greaterThanEqual(chartLife).or(stretch.greaterThan(4).and(fade.mul(quality).lessThan(.02)));
  textureStore(pair[1-k],uvec2(g),select(reset,vec4(w,0,0),vec4(old.xy,age,fade.mul(quality)))).toWriteOnly();
 })().compute(n*n,[64])));
 let parity=0;
 const displayDensity=texture(density[0]),displayCharts=charts.map(pair=>texture(pair[0]));const sync=()=>{displayDensity.value=density[parity];for(let j=0;j<2;j++)displayCharts[j].value=charts[j][parity];};
 renderer.compute(init);
 return {resolution:n,freshLife,residualLife,strength,chartLife,density:uv=>displayDensity.sample(uv),charts:displayCharts.map(node=>uv=>node.sample(uv)),step(seconds){dt.value=Math.min(seconds,.033);renderer.compute([advect[parity],correct[parity],chartNodes[0][parity],chartNodes[1][parity]]);parity=1-parity;active.value=parity;sync();},reset(){renderer.compute(init);parity=0;active.value=0;sync();},dispose(){for(const t of [...density,predict,...charts.flat()])t.dispose();}};
}
