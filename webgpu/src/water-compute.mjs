import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,instancedArray,uniform,uint,int,max,min,vec2,wgslFn,vec4,float,smoothstep,select,length} from 'three/tsl';
import {terrain} from './terrain.mjs';
import {breakingSignal} from './breaking-signal.mjs';
export async function createWaterCompute(renderer,{resolution=256,quiet=false,diagnostics=false,batchSubsteps=true}={}){
 await renderer.init();
 const n=resolution,count=n*n,dx=32/n,bedArray=new Float32Array(count*4),initial=new Float32Array(count*4);
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const p=[(x+.5)*dx-16,(z+.5)*dx-16];bedArray.set(terrain(...p),(z*n+x)*4);}
 for(let z=0;z<n;z++){let travel=0;const worldZ=(z+.5)*dx-16;for(let x=0;x<n;x++){
  const i=(z*n+x)*4,bedHeight=bedArray[i],depth=Math.max(-bedHeight,.35);travel+=dx/Math.sqrt(9.81*depth);
  const e1=quiet?0:.30*Math.sin(-travel*1.745+worldZ*.16+.35),e2=quiet?0:.095*Math.sin(-travel*1.257+worldZ*.09-.9),e3=quiet?0:.04*Math.sin(-travel*2.327+worldZ*.22+1.7),eta=e1+e2+e3;
  initial[i]=Math.max(eta-bedHeight,0);const velocity=Math.max(-3.5,Math.min(3.5,eta*Math.sqrt(9.81/depth)));initial[i+1]=initial[i]*velocity;initial[i+2]=initial[i]*(-9.81*(e1*.16/1.745+e2*.09/1.257+e3*.22/2.327));
 }}
 const a=instancedArray(initial,'vec4'),b=instancedArray(new Float32Array(initial),'vec4'),bed=instancedArray(bedArray,'vec4');
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
 if(forcing>.5 && p.x < -14.7){let e1=.30*sin(t*1.745+p.y*.16+.35);let e2=.095*sin(t*1.257+p.y*.09-.9);let e3=.04*sin(t*2.327+p.y*.22+1.7);let wave=e1+e2+e3;let depth=max(-ground,0.15);let desired=max(depth+wave,0.0);let relax=1.0-exp(-dt*3.0);u.x=mix(u.x,desired,relax);u.y=mix(u.y,desired*wave*sqrt(9.81/depth),relax);u.z=mix(u.z,desired*(-9.81*(e1*.16/1.745+e2*.09/1.257+e3*.22/2.327)),relax);}
 let delta=p-body.xy;let r=length(delta);let radius=max(body.w,.1);let contact=exp(-dot(delta,delta)/(radius*radius*.70));let immersion=clamp(motion.z,0.0,1.0);
 let relative=motion.xy-u.yz/u.x;let drag=1.0-exp(-6.0*dt*immersion*contact);u=vec3<f32>(u.x,mix(u.yz,motion.xy*u.x,drag));
 let push=exp(-pow((r-radius)/.17,2.0))*clamp(body.z+motion.w,0.0,2.0);u=vec3<f32>(u.x,u.yz+delta/max(r,.001)*push*dt*.13);
 let finalSpeed=length(u.yz)/u.x;u=vec3<f32>(u.x,u.yz*min(1.0,3.5/max(finalSpeed,.0001)));
 let wake=min(max(length(relative)-.12,0.0),3.5)*contact*immersion*.8;
 let residual=s.w*exp(-dt*.55);let source=crest*3.8+push*.3+wake;
 let foam=clamp(residual+(1.0-residual)*(1.0-exp(-dt*source)),0.0,1.0);return vec4<f32>(u,foam);
}`);
 const primitive=wgslFn(`fn shorePrimitive(s:vec4<f32>,b:f32)->vec3<f32>{var v=vec2<f32>(0.0);if(s.x>.004){v=s.yz/s.x;v*=min(1.0,3.5/max(length(v),.0001));}return vec3<f32>(b+s.x,v);}`);
 const minmod=wgslFn(`fn shoreMinmod(a:vec3<f32>,b:vec3<f32>,h:f32)->vec3<f32>{let v=sign(a)*min(abs(a),abs(b))*select(vec3<f32>(0.0),vec3<f32>(1.0),a*b>vec3<f32>(0.0));return vec3<f32>(clamp(v.x,-2.0*h,2.0*h),v.yz);}`);
 function kernel(read,write,dt,time){return Fn(()=>{
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
  write.element(i).assign(next);wet.element(i).assign(max(wet.element(i).mul(dt.div(-19).exp()),smoothstep(.002,.018,next.x)));
 })().compute(count,[64]);}
 const slots=Array.from({length:16},(_,i)=>{const dt=uniform(maxStep),time=uniform(0);return {dt,time,node:kernel(i%2?b:a,i%2?a:b,dt,time)};}),dispatches=[];let parity=0,clock=0;
 await renderer.compileComputeAsync(slots.map(slot=>slot.node));
 function floorAt(x,z){const px=Math.max(0,Math.min(n-1,(x+16)/dx-.5)),pz=Math.max(0,Math.min(n-1,(z+16)/dx-.5)),ix=Math.min(n-2,Math.floor(px)),iz=Math.min(n-2,Math.floor(pz)),u=px-ix,v=pz-iz,at=(a,b)=>bedArray[(b*n+a)*4];return u+v<=1?at(ix,iz)*(1-u-v)+at(ix+1,iz)*u+at(ix,iz+1)*v:at(ix+1,iz+1)*(u+v-1)+at(ix+1,iz)*(1-v)+at(ix,iz+1)*(1-u);}
 const samplePoint=uniform(new THREE.Vector2()),sampleOutput=instancedArray(new Float32Array(4),'vec4');
 const makeSample=read=>Fn(()=>{const x=uint(samplePoint.x.add(16).div(dx).floor().clamp(0,n-1)),z=uint(samplePoint.y.add(16).div(dx).floor().clamp(0,n-1)),i=z.mul(n).add(x),s=read.element(i);sampleOutput.element(uint(0)).assign(vec4(s.x.add(bed.element(i).x),s.x,s.yz.div(max(s.x,.005))));})().compute(1);
 const sampleA=makeSample(a),sampleB=makeSample(b);
 return {n,dx,count,maxStep,forcing,async readAudit(){return audit?new Float32Array(await renderer.getArrayBufferAsync(audit.value)):null;},reset(){wet.value.array.set(initialWet);wet.value.needsUpdate=true;a.value.array.set(initial);b.value.array.set(initial);a.value.needsUpdate=true;b.value.needsUpdate=true;parity=0;clock=0;time.value=0;},async sample(x,z){samplePoint.value.set(x,z);renderer.compute(parity?sampleB:sampleA);return new Float32Array(await renderer.getArrayBufferAsync(sampleOutput.value));},bedArray,bed,wet,a,b,body,bodyMotion,floorAt,time,get parity(){return parity},get current(){return parity?b:a},step(seconds){let left=seconds;if(!batchSubsteps){while(left>1e-7){const slot=slots[parity];slot.dt.value=Math.min(maxStep,left);slot.time.value=clock;time.value=clock;renderer.compute(slot.node);parity=1-parity;clock+=slot.dt.value;left-=slot.dt.value;}return;}while(left>1e-7){dispatches.length=0;for(let j=0,start=parity;j<slots.length;j++){if(left<=1e-7)break;const slot=slots[(start+j)%slots.length];slot.dt.value=Math.min(maxStep,left);slot.time.value=clock;dispatches.push(slot.node);parity=1-parity;time.value=clock;clock+=slot.dt.value;left-=slot.dt.value;}renderer.compute(dispatches);}},async read(){return new Float32Array(await renderer.getArrayBufferAsync((parity?b:a).value));}};
}
