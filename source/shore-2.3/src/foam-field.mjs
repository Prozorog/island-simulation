import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,uint,uvec2,vec2,vec4,float,uniform,texture,textureLoad,textureStore,min,max,mix,select,length,smoothstep} from 'three/tsl';
// Density stays full resolution. Flow/emission and material charts use the physical grid;
// subcell foam detail remains in the filtered high-resolution cellular texture.
export function createFoamField(renderer,sim,{resolution=1024}={}){
 const n=resolution,cn=sim.n,dx=32/n,cdx=32/cn,dt=uniform(1/30),freshLife=uniform(1.5),residualLife=uniform(30),residualCoverage=uniform(.45),strength=uniform(1),chartLife=uniform(2.4);
 const landing=uniform(new THREE.Vector4(1000,1000,.3,0));let landingTime=-100;
 const make=size=>{const t=new THREE.StorageTexture(size,size);t.type=THREE.HalfFloatType;t.generateMipmaps=false;return t;};
 const density=[make(n),make(n)],predict=make(n),flowMap=make(cn),charts=[[make(cn),make(cn)],[make(cn),make(cn)]];
 const flow=texture(flowMap),sampleFlow=p=>flow.sample(p.add(16).div(32).clamp(.5/cn,1-.5/cn)).level(0);
 const at=(tex,p,size=n)=>textureLoad(tex,uvec2(p.clamp(0,size-1)));
 const sample=(tex,p,size=n)=>texture(tex).sample(p.add(.5).div(size).clamp(.5/size,1-.5/size)).level(0);
 const grid=size=>vec2(instanceIndex.mod(size),instanceIndex.div(size)),world=(g,size=n)=>g.add(.5).mul(32/size).sub(16);
 const flowNode=Fn(()=>{
  const i=instanceIndex,g=grid(cn),p=world(g,cn),x=g.x,z=g.y,idx=(xx,zz)=>uint(zz.clamp(0,cn-1).mul(cn).add(xx.clamp(0,cn-1)));
  const s=sim.a.element(i).toVar(),bed=sim.bed.element(i),v=s.yz.div(max(s.x,.008)).toVar();
  const bg=vec2(sim.bed.element(idx(x.add(1),z)).x.sub(sim.bed.element(idx(x.sub(1),z)).x),sim.bed.element(idx(x,z.add(1))).x.sub(sim.bed.element(idx(x,z.sub(1))).x)).div(sim.dx*2);
  const uphill=max(v.dot(bg),0),shore=smoothstep(.005,.025,s.x).mul(float(1).sub(smoothstep(.10,.3,s.x))).mul(smoothstep(.01,.15,uphill));
  const rock=bed.z.mul(smoothstep(.02,.3,uphill)).mul(smoothstep(.004,.025,s.x));
  const rim=length(p.sub(sim.body.xy)).sub(sim.body.w).div(.17).pow(2).negate().exp(),body=rim.mul(length(sim.bodyMotion.xy.sub(v)).smoothstep(.15,1.7)).mul(sim.bodyMotion.z);
  const impact=length(p.sub(landing.xy)).sub(landing.z.mul(1.15)).div(.13).pow(2).negate().exp().mul(landing.w).mul(smoothstep(.004,.04,s.x));
  const source=sim.wet.element(i).y.mul(2.8).add(shore.mul(2)).add(rock.mul(3)).add(body.mul(2)).add(impact).mul(strength);
  textureStore(flowMap,uvec2(g),vec4(v,source,s.x)).toWriteOnly();
 })().compute(cn*cn,[64]);
 const trace=(g,size,sign)=>{const w=world(g,size),f=sampleFlow(w).toVar(),mid=w.add(f.xy.mul(dt.mul(sign*.5))),back=w.add(sampleFlow(mid).xy.mul(dt.mul(sign)));return select(sampleFlow(back).w.greaterThan(.003),back,w).add(16).mul(size/32).sub(.5).clamp(0,size-1);};
 const init=[density,...charts].map((pair,j)=>{const size=j?cn:n;return Fn(()=>{const g=grid(size),w=world(g,size);for(const t of pair)textureStore(t,uvec2(g),j===0?vec4(0):vec4(w,chartLife.mul((j-1)*.5),1)).toWriteOnly();})().compute(size*size,[64]);});
 const advect=density.map(read=>Fn(()=>{const g=grid(n);textureStore(predict,uvec2(g),sample(read,trace(g,n,-1))).toWriteOnly();})().compute(n*n,[64]));
 const correct=density.map((read,k)=>Fn(()=>{
  const g=grid(n),w=world(g),back=trace(g,n,-1).toVar(),b=back.floor(),old=at(read,g),pred=at(predict,g),reverse=sample(predict,trace(g,n,1));
  const donors=[at(read,b),at(read,b.add(vec2(1,0))),at(read,b.add(vec2(0,1))),at(read,b.add(1))];
  const lo=min(min(donors[0],donors[1]),min(donors[2],donors[3])),hi=max(max(donors[0],donors[1]),max(donors[2],donors[3]));
  const moved=pred.add(old.sub(reverse).mul(.5)).clamp(lo,hi).xy.toVar(),f=sampleFlow(w).toVar();
  const fresh=moved.x.mul(dt.div(freshLife).negate().exp()).add(float(1).sub(moved.x).mul(float(1).sub(f.z.mul(dt).negate().exp()))).clamp(0,1);
  const residual=moved.y.mul(dt.div(residualLife).negate().exp()).add(max(residualCoverage.sub(moved.y),0).mul(fresh.mul(dt).mul(.4))).clamp(0,residualCoverage),wet=smoothstep(.001,.008,f.w);
  textureStore(density[1-k],uvec2(g),vec4(fresh.mul(wet),residual.mul(wet),f.z.clamp(0,1),wet)).toWriteOnly();
 })().compute(n*n,[64]));
 const chartNodes=charts.map(pair=>pair.map((read,k)=>Fn(()=>{
  const g=grid(cn),w=world(g,cn),back=trace(g,cn,-1).toVar(),old=sample(read,back,cn).toVar();
  const gx=sample(read,back.add(vec2(1,0)),cn).xy.sub(sample(read,back.sub(vec2(1,0)),cn).xy).div(cdx*2),gz=sample(read,back.add(vec2(0,1)),cn).xy.sub(sample(read,back.sub(vec2(0,1)),cn).xy).div(cdx*2);
  const stretch=max(length(gx),length(gz)),age=old.z.add(dt).toVar(),fade=smoothstep(0,.18,age).mul(float(1).sub(smoothstep(chartLife.mul(.7),chartLife,age))),quality=float(1).sub(smoothstep(2.5,4,stretch));
  const reset=age.greaterThanEqual(chartLife).or(stretch.greaterThan(4).and(fade.mul(quality).lessThan(.02)));
  textureStore(pair[1-k],uvec2(g),select(reset,vec4(w,0,0),vec4(old.xy,age,fade.mul(quality)))).toWriteOnly();
 })().compute(cn*cn,[64])));
 let parity=0,accumulated=0;const displayDensity=texture(density[0]),displayCharts=charts.map(pair=>texture(pair[0]));
 const sync=()=>{displayDensity.value=density[parity];for(let j=0;j<2;j++)displayCharts[j].value=charts[j][parity];};renderer.compute(init);
 return {resolution:n,chartResolution:cn,freshLife,residualLife,residualCoverage,strength,chartLife,density:uv=>displayDensity.sample(uv),charts:displayCharts.map(node=>uv=>node.sample(uv)),
 impact(event){landingTime=sim.time.value;landing.value.set(event.position.x,event.position.z,event.radius,event.impact*12);},
 step(seconds){accumulated+=seconds;if(accumulated<1/30-1e-6)return;dt.value=Math.min(accumulated,.067);accumulated=0;if(sim.time.value-landingTime>.28)landing.value.w=0;renderer.compute([flowNode,advect[parity],correct[parity],chartNodes[0][parity],chartNodes[1][parity]]);parity=1-parity;sync();},
 reset(){renderer.compute(init);parity=0;accumulated=0;landingTime=-100;landing.value.w=0;sync();},dispose(){for(const t of [...density,predict,flowMap,...charts.flat()])t.dispose();}};
}
