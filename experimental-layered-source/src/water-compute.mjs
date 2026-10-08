import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,instancedArray,uniform,uint,int,max,min,vec2,wgslFn,vec4,float,smoothstep,select,length,mix} from 'three/tsl';
import {terrain} from './terrain.mjs';
import {breakingSignal} from './breaking-signal.mjs';
import {wavePackets,packetKx,sampleSeed,incomingWaves} from './incoming-waves.mjs';
export async function createWaterCompute(renderer,{resolution=256,quiet=false,diagnostics=false,batchSubsteps=true}={}){
 await renderer.init();
 const n=resolution,count=n*n,dx=32/n,bedArray=new Float32Array(count*4),initial=new Float32Array(count*4);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const p=[(x+.5)*dx-16,(z+.5)*dx-16];bedArray.set(terrain(...p),(z*n+x)*4);}
 for(let z=0;z<n;z++){const phases=wavePackets.map(()=>0),worldZ=(z+.5)*dx-16;for(let x=0;x<n;x++){
  const i=(z*n+x)*4,bedHeight=bedArray[i],bareDepth=Math.max(-bedArray[i+3],.25),depth=Math.max(-bedHeight,0),atCenter=[];
  for(let j=0;j<wavePackets.length;j++){const increment=dx*packetKx(wavePackets[j],bareDepth);atCenter.push(phases[j]+increment*.5);phases[j]+=increment;}
  const wave=quiet?[0,0,0]:sampleSeed(atCenter,worldZ,depth),h=Math.max(wave[0]-bedHeight,0),speed=h>.003?Math.hypot(wave[1],wave[2])/h:0,scale=Math.min(1,3.5/Math.max(speed,.001));
  initial[i]=h;initial[i+1]=h>.003?wave[1]*scale:0;initial[i+2]=h>.003?wave[2]*scale:0;
 }}
 const bed=instancedArray(bedArray,'vec4');
 const foamInitial=new Float32Array(count*4);for(let i=0;i<count;i++){foamInitial[i*4]=(i%n+.5)*dx-16;foamInitial[i*4+1]=(Math.floor(i/n)+.5)*dx-16;}
 // Pack render-only history after conservative state to retain the original three vertex storage bindings.
 const packedInitial=new Float32Array(count*8);packedInitial.set(initial);packedInitial.set(foamInitial,count*4);
 const a=instancedArray(packedInitial.slice(),'vec4'),b=instancedArray(packedInitial.slice(),'vec4');
 const historyOf=node=>({element:index=>node.element(index.add(count))});const foamA=historyOf(a),foamB=historyOf(b);
 const initialWet=Float32Array.from({length:count},(_,i)=>initial[i*4]>.004?1:0),wet=instancedArray(initialWet,'float');
 const audit=diagnostics?instancedArray(new Float32Array(count*4),'vec4'):null;
 const maxStep=Math.min(.004,.5*dx/(7+2*Math.sqrt(9.81*8)));
 const time=uniform(0),forcing=uniform(quiet?0:1),body=uniform(new THREE.Vector4(1000,1000,0,.32)),bodyMotion=uniform(new THREE.Vector4(0,0,0,0));
 const flux=wgslFn(`fn shoreFlux(l:vec3<f32>,r:vec3<f32>,bl:f32,br:f32,axis:u32,side:u32)->vec3<f32>{
 let vl=l.yz*min(1.0,3.5/max(length(l.yz),.0001));let vr=r.yz*min(1.0,3.5/max(length(r.yz),.0001));let bm=max(bl,br);
 let hl=max(l.x-bm,0.0);let hr=max(r.x-bm,0.0);let ul=select(vl.x,vl.y,axis==1u);let ur=select(vr.x,vr.y,axis==1u);
 var fl=vec3<f32>(hl*ul,hl*ul*vl);var fr=vec3<f32>(hr*ur,hr*ur*vr);
 if(axis==0u){fl.y+=4.905*hl*hl;fr.y+=4.905*hr*hr;}else{fl.z+=4.905*hl*hl;fr.z+=4.905*hr*hr;}
 let speed=max(abs(ul)+sqrt(9.81*hl),abs(ur)+sqrt(9.81*hr));
 var f=(fl+fr)*0.5-speed*0.5*(vec3<f32>(hr,hr*vr)-vec3<f32>(hl,hl*vl));
 let original=select(max(l.x-bl,0.0),max(r.x-br,0.0),side==1u);let clipped=select(hl,hr,side==1u);let correction=4.905*(original*original-clipped*clipped);
 if(axis==0u){f.y+=correction;}else{f.z+=correction;}return f;
}`);
 const finish=wgslFn(`fn shoreUpdate(s:vec4<f32>,change:vec3<f32>,ground:f32,p:vec2<f32>,dt:f32,t:f32,body:vec4<f32>,motion:vec4<f32>,crest:f32,forcing:f32)->vec4<f32>{
 var u=s.xyz+change;u.x=max(u.x,0.0);if(u.x<0.003){return vec4<f32>(u.x,0.0,0.0,s.w*exp(-dt*2.0));}
 let speed=length(u.yz)/max(u.x,0.005);u=vec3<f32>(u.x,u.yz*min(1.0,3.5/max(speed,0.0001))*exp(-dt*(0.018+0.06/max(u.x,0.05))));
 if(forcing>.5 && p.x < -14.7){let depth=max(-ground,.25);let wave=shoreIncoming(p,t,depth);let desired=max(depth+wave.x,0.0);let gain=10.0*(1.0-smoothstep(-15.5,-14.7,p.x));let relax=1.0-exp(-dt*gain);u=mix(u,vec3<f32>(desired,wave.yz),relax);}

 let delta=p-body.xy;let r=length(delta);let radius=max(body.w,.1);let contact=exp(-dot(delta,delta)/(radius*radius*.70));let immersion=clamp(motion.z,0.0,1.0);
 let relative=motion.xy-u.yz/u.x;let drag=1.0-exp(-6.0*dt*immersion*contact);u=vec3<f32>(u.x,mix(u.yz,motion.xy*u.x,drag));
 let push=exp(-pow((r-radius)/.17,2.0))*clamp(body.z+motion.w,0.0,2.0);u=vec3<f32>(u.x,u.yz+delta/max(r,.001)*push*dt*.13);
 let finalSpeed=length(u.yz)/u.x;u=vec3<f32>(u.x,u.yz*min(1.0,3.5/max(finalSpeed,.0001)));
 let wake=min(max(length(relative)-.12,0.0),3.5)*contact*immersion*.8;
 let residual=s.w*exp(-dt*.55);let source=crest*3.8+push*.3+wake;
 let foam=clamp(residual+(1.0-residual)*(1.0-exp(-dt*source)),0.0,1.0);return vec4<f32>(u,foam);
}`, [incomingWaves]);
 const primitive=wgslFn(`fn shorePrimitive(s:vec4<f32>,b:f32)->vec3<f32>{var v=vec2<f32>(0.0);if(s.x>.004){v=s.yz/s.x;v*=min(1.0,3.5/max(length(v),.0001));}return vec3<f32>(b+s.x,v);}`);
 const minmod=wgslFn(`fn shoreMinmod(a:vec3<f32>,b:vec3<f32>,h:f32)->vec3<f32>{let v=sign(a)*min(abs(a),abs(b))*select(vec3<f32>(0.0),vec3<f32>(1.0),a*b>vec3<f32>(0.0));return vec3<f32>(clamp(v.x,-2.0*h,2.0*h),v.yz);}`);
 function kernel(read,write,foamRead,foamWrite,dt,time){return Fn(()=>{
  const i=instanceIndex,x=int(i.mod(n)),z=int(i.div(n));
  const il=uint(z.mul(n).add(max(x.sub(1),0))),ir=uint(z.mul(n).add(min(x.add(1),n-1)));
  const id=uint(max(z.sub(1),0).mul(n).add(x)),iu=uint(min(z.add(1),n-1).mul(n).add(x));
  const s=read.element(i),l=read.element(il),r=read.element(ir),d=read.element(id),u=read.element(iu),bc=bed.element(i).x;
  const ill=uint(z.mul(n).add(max(x.sub(2),0))),irr=uint(z.mul(n).add(min(x.add(2),n-1))),idd=uint(max(z.sub(2),0).mul(n).add(x)),iuu=uint(min(z.add(2),n-1).mul(n).add(x));
  const pc=primitive(s,bc).toVar(),pl=primitive(l,bed.element(il).x).toVar(),pr=primitive(r,bed.element(ir).x).toVar(),pd=primitive(d,bed.element(id).x).toVar(),pu=primitive(u,bed.element(iu).x).toVar();
  const cx=minmod(pc.sub(pl),pr.sub(pc),s.x).mul(.5),cz=minmod(pc.sub(pd),pu.sub(pc),s.x).mul(.5);
  const ls=minmod(pl.sub(primitive(read.element(ill),bed.element(ill).x)),pc.sub(pl),l.x).mul(.5),rs=minmod(pr.sub(pc),primitive(read.element(irr),bed.element(irr).x).sub(pr),r.x).mul(.5);
  const ds=minmod(pd.sub(primitive(read.element(idd),bed.element(idd).x)),pc.sub(pd),d.x).mul(.5),us=minmod(pu.sub(pc),primitive(read.element(iuu),bed.element(iuu).x).sub(pu),u.x).mul(.5);
  const fxr=flux(pc.add(cx),pr.sub(rs),bc,bed.element(ir).x,uint(0),uint(0)),fxl=flux(pl.add(ls),pc.sub(cx),bed.element(il).x,bc,uint(0),uint(1));
  const fzu=flux(pc.add(cz),pu.sub(us),bc,bed.element(iu).x,uint(1),uint(0)),fzd=flux(pd.add(ds),pc.sub(cz),bed.element(id).x,bc,uint(1),uint(1));
  const change=fxl.sub(fxr).add(fzd.sub(fzu)).mul(dt.div(dx));
  const velocity=s.yz.div(max(s.x,.005));
  if(audit){const old=audit.element(i),raw=s.x.add(change.x);audit.element(i).assign(vec4(min(old.x,raw),old.y.add(max(raw.negate(),0).mul(dx*dx)),max(old.z,s.x),max(old.w,length(velocity))));}
  const transported=s.w.sub(dt.div(dx).mul(max(velocity.x,0).mul(s.w.sub(l.w)).add(min(velocity.x,0).mul(r.w.sub(s.w))).add(max(velocity.y,0).mul(s.w.sub(d.w))).add(min(velocity.y,0).mul(u.w.sub(s.w)))));
  const crest=breakingSignal(pc,pl,pr,pd,pu,vec4(l.x,r.x,d.x,u.x),s.x,float(dx));
  const next=finish(vec4(s.xyz,transported.max(0)),change,bc,vec2(x,z).add(.5).mul(dx).sub(16),dt,time,body,bodyMotion,crest,forcing).toVar();
  const back=vec2(x,z).sub(velocity.mul(dt.div(dx))).clamp(0,n-1),base=back.floor().min(n-2),fraction=back.sub(base);
  const foamAt=(ox,oz)=>foamRead.element(uint(base.y.add(oz).mul(n).add(base.x.add(ox))));
  const history=mix(mix(foamAt(0,0),foamAt(1,0),fraction.x),mix(foamAt(0,1),foamAt(1,1),fraction.x),fraction.y);
  const born=next.w.sub(transported.max(0).mul(dt.mul(-.55).exp())).max(0).div(next.w.max(.001)).clamp(0,1);
  const world=vec2(x,z).add(.5).mul(dx).sub(16),alive=next.w.greaterThan(.006).and(next.x.greaterThan(.008));
  foamWrite.element(i).assign(select(alive,vec4(mix(history.xy,world,born),history.z.add(dt).mul(float(1).sub(born)).min(20),next.w),vec4(world,0,0)));
  write.element(i).assign(next);wet.element(i).assign(max(wet.element(i).mul(dt.div(-19).exp()),smoothstep(.002,.018,next.x)));
 })().compute(count,[64]);}
 const slots=Array.from({length:16},(_,i)=>{const dt=uniform(maxStep),time=uniform(0);return {dt,time,node:kernel(i%2?b:a,i%2?a:b,i%2?foamB:foamA,i%2?foamA:foamB,dt,time)};}),dispatches=[];let parity=0,clock=0;
 await renderer.compileComputeAsync(slots.map(slot=>slot.node));
 function floorAt(x,z){const px=Math.max(0,Math.min(n-1,(x+16)/dx-.5)),pz=Math.max(0,Math.min(n-1,(z+16)/dx-.5)),ix=Math.min(n-2,Math.floor(px)),iz=Math.min(n-2,Math.floor(pz)),u=px-ix,v=pz-iz,at=(a,b)=>bedArray[(b*n+a)*4];return u+v<=1?at(ix,iz)*(1-u-v)+at(ix+1,iz)*u+at(ix,iz+1)*v:at(ix+1,iz+1)*(u+v-1)+at(ix+1,iz)*(1-v)+at(ix,iz+1)*(1-u);}
 const samplePoint=uniform(new THREE.Vector2()),sampleOutput=instancedArray(new Float32Array(4),'vec4');
 const makeSample=read=>Fn(()=>{const x=uint(samplePoint.x.add(16).div(dx).floor().clamp(0,n-1)),z=uint(samplePoint.y.add(16).div(dx).floor().clamp(0,n-1)),i=z.mul(n).add(x),s=read.element(i);sampleOutput.element(uint(0)).assign(vec4(s.x.add(bed.element(i).x),s.x,s.yz.div(max(s.x,.005))));})().compute(1);
 const sampleA=makeSample(a),sampleB=makeSample(b);
 return {n,dx,count,maxStep,forcing,async readAudit(){return audit?new Float32Array(await renderer.getArrayBufferAsync(audit.value)):null;},reset(){wet.value.array.set(initialWet);wet.value.needsUpdate=true;a.value.array.set(packedInitial);b.value.array.set(packedInitial);a.value.needsUpdate=true;b.value.needsUpdate=true;parity=0;clock=0;time.value=0;},async sample(x,z){samplePoint.value.set(x,z);renderer.compute(parity?sampleB:sampleA);return new Float32Array(await renderer.getArrayBufferAsync(sampleOutput.value));},bedArray,bed,wet,a,b,foamA,foamB,async readFoam(){return new Float32Array(await renderer.getArrayBufferAsync((parity?b:a).value)).slice(count*4);},body,bodyMotion,floorAt,time,get parity(){return parity},get current(){return parity?b:a},step(seconds){let left=seconds;if(!batchSubsteps){while(left>1e-7){const slot=slots[parity];slot.dt.value=Math.min(maxStep,left);slot.time.value=clock;time.value=clock;renderer.compute(slot.node);parity=1-parity;clock+=slot.dt.value;left-=slot.dt.value;}return;}while(left>1e-7){dispatches.length=0;for(let j=0,start=parity;j<slots.length;j++){if(left<=1e-7)break;const slot=slots[(start+j)%slots.length];slot.dt.value=Math.min(maxStep,left);slot.time.value=clock;dispatches.push(slot.node);parity=1-parity;time.value=clock;clock+=slot.dt.value;left-=slot.dt.value;}renderer.compute(dispatches);}},async read(){return new Float32Array(await renderer.getArrayBufferAsync((parity?b:a).value)).slice(0,count*4);}};
}
