import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,instancedArray,uniform,uint,int,vec2,vec3,vec4,float,wgslFn,max,min,mix,select} from 'three/tsl';
import {terrain} from './terrain.mjs';
import {breakingSignal} from './breaking-signal.mjs';
import {surfaceRippleMotion} from './surface-ripples.mjs';
import {bakeObstacleFlow} from './obstacle-flow.mjs';
// Primary swell is evaluated from baked travel phase; local state is residual elevation and face flux only.
export async function createLayeredCompute(renderer,{resolution=256,quiet=false,edgeAbsorption=true,batchCompute=true,obstacleFlow=true}={}){
 await renderer.init();const n=resolution,count=n*n,dx=32/n,bedArray=new Float32Array(count*4),phaseArray=new Float32Array(count*4),initial=new Float32Array(count*8);
 const smooth=(a,b,x)=>{const q=Math.max(0,Math.min(1,(x-a)/(b-a)));return q*q*(3-2*q)};
 for(let z=0;z<n;z++){let travel=0,shoreReached=false;for(let x=0;x<n;x++){const i=z*n+x,p=[(x+.5)*dx-16,(z+.5)*dx-16],b=terrain(...p);bedArray.set(b,i*4);if(b[3]>=0)shoreReached=true;if(!shoreReached)travel+=dx/Math.sqrt(9.81*Math.max(-b[3],.35));phaseArray.set([travel*1.309-p[1]*.065,travel*1.698+p[1]*.11,1-smooth(.18,.65,b[3]),Math.max(-b[3],.2)],i*4);initial.set([p[0],p[1],0,0],(count+i)*4);}}

 const obstacleBake=obstacleFlow?bakeObstacleFlow({n,dx,bedArray,tolerance:1e-5}):null;
 if(obstacleBake&&!obstacleBake.diagnostics.converged)throw Error('Obstacle flow bake did not converge');
 const bareBed=bedArray.slice();for(let i=0;i<count;i++)bareBed[i*4]=bareBed[i*4+3];const bareBake=obstacleFlow?bakeObstacleFlow({n,dx,bedArray:bareBed,tolerance:1e-5}):null;if(bareBake&&!bareBake.diagnostics.converged)throw Error('Reference shoreline bake did not converge');
 if(obstacleBake)obstacleBake.diagnostics.referenceShoreline=bareBake.diagnostics;
 const coordinateData=new Float32Array(count*4),originalPhase=phaseArray.slice();
 const samplePhase=(x,z,c)=>{const gx=Math.max(0,Math.min(n-1,(x+16)/dx-.5)),gz=Math.max(0,Math.min(n-1,(z+16)/dx-.5)),ix=Math.min(n-2,Math.floor(gx)),iz=Math.min(n-2,Math.floor(gz)),fx=gx-ix,fz=gz-iz,at=(a,b)=>originalPhase[((iz+b)*n+ix+a)*4+c];return (at(0,0)*(1-fx)+at(1,0)*fx)*(1-fz)+(at(0,1)*(1-fx)+at(1,1)*fx)*fz;};
 for(let i=0;i<count;i++){const x=i%n,z=Math.floor(i/n),wx=(x+.5)*dx-16,wz=(z+.5)*dx-16,cx=obstacleBake?wx+obstacleBake.coordinates[i*2]-bareBake.coordinates[i*2]:wx,cz=obstacleBake?wz+obstacleBake.coordinates[i*2+1]-bareBake.coordinates[i*2+1]:wz;coordinateData.set([cx,cz,obstacleBake?(obstacleBake.faceDepths[i*2]>0?1:0):1,obstacleBake?(obstacleBake.faceDepths[i*2+1]>0?1:0):1],i*4);phaseArray[i*4]=samplePhase(cx,cz,0);phaseArray[i*4+1]=samplePhase(cx,cz,1);}
 const flowCoordinates=instancedArray(coordinateData,'vec4');
 const localA=instancedArray(initial.slice(),'vec4'),localB=instancedArray(initial.slice(),'vec4'),surface=instancedArray(new Float32Array(count*8),'vec4'),bed=instancedArray(bedArray,'vec4'),phase=instancedArray(phaseArray,'vec4'),wave=instancedArray(new Float32Array(count*4),'vec4'),wet=instancedArray(new Float32Array(count*2),'vec2'),surfaceVelocity=instancedArray(new Float32Array(count),'float');
 const time=uniform(0),forcing=uniform(quiet?0:1),body=uniform(new THREE.Vector4(1000,1000,0,.32)),bodyMotion=uniform(new THREE.Vector4()),landing=uniform(new THREE.Vector4(1000,1000,0,.32)),dt=uniform(.004),impulse=uniform(0),absorb=uniform(edgeAbsorption?1:0);
 const swell=wgslFn(`fn layeredSwell(p:vec2<f32>,ph:vec4<f32>,t:f32,on:f32,ground:f32)->vec4<f32>{
 let a=(.28+.035*sin(p.y*.24+t*.11))*ph.z*on;let b=.085*ph.z*on;
 let f=ph.x-1.309*t+.28*sin(p.y*.32+t*.08);let g=ph.y-1.698*t+.16*sin(p.y*.49-t*.06);
 let eta=a*sin(f)+b*sin(g);let potential=-9.81*(a*cos(f)/1.309+b*cos(g)/1.698);
 let adot=.035*.11*cos(p.y*.24+t*.11)*ph.z*on;let fdot=-1.309+.28*.08*cos(p.y*.32+t*.08);let gdot=-1.698-.16*.06*cos(p.y*.49-t*.06);let etaDot=adot*sin(f)+a*cos(f)*fdot+b*cos(g)*gdot;let ripple=shoreRippleMotion(p,t,max(eta-ground,0.0),etaDot)*on;return vec4<f32>(eta+ripple.x,potential,0.0,etaDot+ripple.y);}`, [surfaceRippleMotion]);
 const waveNode=Fn(()=>{const i=instanceIndex,x=uint(i.mod(n)),z=uint(i.div(n)),ir=z.mul(n).add(min(x.add(1),n-1)),iu=min(z.add(1),n-1).mul(n).add(x),c=flowCoordinates.element(i);const evaluate=j=>swell(flowCoordinates.element(j).xy,phase.element(j),time,forcing,bed.element(j).x);const w=evaluate(i).toVar(),e=evaluate(ir),u=evaluate(iu);wave.element(i).assign(vec4(w.x,e.y.sub(w.y).div(dx).mul(c.z).mul(select(min(w.x.sub(bed.element(i).x),e.x.sub(bed.element(ir).x)).greaterThan(.006),float(1),float(0))),u.y.sub(w.y).div(dx).mul(c.w).mul(select(min(w.x.sub(bed.element(i).x),u.x.sub(bed.element(iu).x)).greaterThan(.006),float(1),float(0))),w.w));})().compute(count,[64]);
 const face=wgslFn(`fn localFace(s:vec4<f32>,r:vec4<f32>,w:vec4<f32>,wr:vec4<f32>,b:f32,br:f32,p:vec2<f32>,axis:u32,dt:f32,dx:f32,body:vec4<f32>,motion:vec4<f32>,landing:vec4<f32>,impact:f32,absorb:f32)->f32{
 let h=max(w.x-b,0.0);let hr=max(wr.x-br,0.0);let depth=min(h,hr);if(depth<.006){return 0.0;}
 let old=select(s.y,s.z,axis==1u);let edge=smoothstep(12.0,15.8,max(abs(p.x),abs(p.y)));let damp=.25+edge*5.0*absorb+.06/max(depth,.06);
 var q=(old-dt*9.81*min(depth,4.0)*(r.x-s.x)/dx)*exp(-dt*damp);
 let delta=p-body.xy;let core=exp(-dot(delta,delta)/(body.w*body.w*.85));let orbital=select(w.y,w.z,axis==1u);let targetFlow=select(motion.x,motion.y,axis==1u)-orbital;
 q=mix(q,targetFlow*depth,1.0-exp(-dt*7.0*core*clamp(motion.z,0.0,1.0)));
 let d=p-landing.xy;let radius=max(landing.w,.12);let rlen=max(length(d),.001);let ring=exp(-dot(d,d)/(4.0*radius*radius));
 q+=depth*impact*.62*ring*select(d.x,d.y,axis==1u)/rlen;
 return q;}`);
 function kernel(read,write,impactNode=impulse,updateFresh=false){return Fn(()=>{
  const i=instanceIndex,x=int(i.mod(n)),z=int(i.div(n)),at=(xx,zz)=>uint(zz.clamp(0,n-1).mul(n).add(xx.clamp(0,n-1))),il=at(x.sub(1),z),ir=at(x.add(1),z),id=at(x,z.sub(1)),iu=at(x,z.add(1));
  const s=read.element(i).toVar(),w=wave.element(i).toVar(),bc=bed.element(i).x.toVar(),p=vec2(x,z).add(.5).mul(dx).sub(16).toVar();
  const flux=(a,b,pos,axis)=>face(read.element(a),read.element(b),wave.element(a),wave.element(b),bed.element(a).x,bed.element(b).x,pos,uint(axis),dt,float(dx),body,bodyMotion,landing,impactNode,absorb);
  const qr=select(x.lessThan(n-1),flux(i,ir,p.add(vec2(dx*.5,0)),0),float(0)).toVar(),ql=select(x.greaterThan(0),flux(il,i,p.sub(vec2(dx*.5,0)),0),float(0)).toVar(),qu=select(z.lessThan(n-1),flux(i,iu,p.add(vec2(0,dx*.5)),1),float(0)).toVar(),qd=select(z.greaterThan(0),flux(id,i,p.sub(vec2(0,dx*.5)),1),float(0)).toVar();
  const raw=s.x.sub(qr.sub(ql).add(qu.sub(qd)).mul(dt.div(dx))).toVar(),baseDepth=max(w.x.sub(bc),0).toVar(),coast=baseDepth.div(.04).clamp(0,1),edge=max(p.x.abs(),p.y.abs()).sub(12).div(3.8).clamp(0,1);
  const residual=raw.mul(dt.mul(float(.06).add(edge.mul(edge).mul(3).mul(absorb)).add(float(1).sub(coast).mul(8))).negate().exp()).toVar();
  const h=max(w.x.add(residual).sub(bc),0).toVar(),orbital=vec2(w.y.add(wave.element(il).y),w.z.add(wave.element(id).z)).mul(.5),flow=orbital.add(vec2(qr.add(ql),qu.add(qd)).mul(.5).div(max(baseDepth,.05))).clamp(-4,4).toVar();
  const back=vec2(x,z).sub(flow.mul(dt.div(dx))).clamp(0,n-1).toVar(),ib=back.floor().min(n-2).toVar(),f=back.sub(ib).toVar(),hist=(xx,zz)=>read.element(uint(ib.y.add(zz).mul(n).add(ib.x.add(xx))).add(count)),old=mix(mix(hist(0,0),hist(1,0),f.x),mix(hist(0,1),hist(1,1),f.x),f.y).toVar(),coverage=(xx,zz)=>read.element(uint(ib.y.add(zz).mul(n).add(ib.x.add(xx)))).w;
  const cov=mix(mix(coverage(0,0),coverage(1,0),f.x),mix(coverage(0,1),coverage(1,1),f.x),f.y).toVar(),slope=vec2(wave.element(ir).x.sub(wave.element(il).x),wave.element(iu).x.sub(wave.element(id).x)).div(dx*2),bedSlope=vec2(bed.element(ir).x.sub(bed.element(il).x),bed.element(iu).x.sub(bed.element(id).x)).div(dx*2);
  const shoreSource=h.smoothstep(.015,.05).mul(float(1).sub(h.smoothstep(.12,.42))).mul(max(flow.dot(bedSlope),0).smoothstep(.015,.20));
  const incident=vec2(w.x.mul(float(9.81).div(max(phase.element(i).w,.35)).sqrt()),0);
  const rockSource=bed.element(i).z.mul(h.smoothstep(.006,.04)).mul(float(1).sub(h.smoothstep(.08,.32))).mul(max(incident.dot(bedSlope),0).smoothstep(.05,.4));
  const breaker=slope.length().smoothstep(.12,.27).mul(float(1).sub(h.smoothstep(.25,.85))).mul(max(w.x,0).smoothstep(.01,.16));
  const d=p.sub(landing.xy),impactFoam=d.length().sub(landing.w.mul(1.6)).div(.35).pow(2).negate().exp().mul(impactNode).mul(.8);
  const wake=p.sub(body.xy).length().sub(body.w).div(.16).pow(2).negate().exp().mul(bodyMotion.xy.sub(flow).length().smoothstep(.2,1.5)).mul(bodyMotion.z).mul(2);
  const source=shoreSource.mul(2).add(rockSource.mul(3)).add(breaker.mul(2)).add(wake).toVar(),decayed=cov.mul(dt.mul(-.5).exp()).toVar(),foam=decayed.add(float(1).sub(decayed).mul(float(1).sub(source.mul(dt).negate().exp()))).add(impactFoam).clamp(0,1).mul(select(h.greaterThan(.004),float(1),dt.mul(-4).exp())).toVar();
  const born=max(foam.sub(decayed),0).div(max(foam,.001)).clamp(0,1).toVar(),history=select(foam.greaterThan(.006),vec4(mix(old.xy,p,born),old.z.add(dt).mul(float(1).sub(born)).min(20),foam),vec4(p,0,0)).toVar();
  // Fresh aeration is reconstructed per fragment, separate from persistent foam coverage.
  const prim=j=>{const st=read.element(j),wa=wave.element(j),depth=max(wa.x.add(st.x).sub(bed.element(j).x),0);return vec3(wa.x.add(st.x),wa.yz.add(st.yz.div(max(depth,.05))));};
  const fresh=updateFresh?breakingSignal(prim(i),prim(il),prim(ir),prim(id),prim(iu),vec4(...[il,ir,id,iu].map(j=>max(wave.element(j).x.add(read.element(j).x).sub(bed.element(j).x),0))),h,float(dx)):wet.element(i).y;
  surfaceVelocity.element(i).assign(w.w.add(residual.sub(s.x).div(dt)));write.element(i).assign(vec4(residual,qr,qu,foam));write.element(i.add(count)).assign(history);surface.element(i).assign(vec4(h,flow.mul(h),foam));surface.element(i.add(count)).assign(vec4(history.xyz,w.x.add(residual)));wet.element(i).assign(vec2(max(wet.element(i).x.mul(dt.div(-19).exp()),h.smoothstep(.002,.018)),fresh));
 })().compute(count,[64]);}
 const nodes=[kernel(localA,localB,float(0)),kernel(localB,localA,float(0))],impactNodes=[kernel(localA,localB),kernel(localB,localA)],freshNodes=[kernel(localA,localB,float(0),true),kernel(localB,localA,float(0),true)],freshImpactNodes=[kernel(localA,localB,impulse,true),kernel(localB,localA,impulse,true)];console.log("layered: compiling swell");await renderer.compileComputeAsync(waveNode);console.log("layered: compiling residual");await renderer.compileComputeAsync([...nodes,...impactNodes,...freshNodes,...freshImpactNodes]);console.log("layered: compiled");const dispatches=[[waveNode,nodes[0]],[waveNode,nodes[1]]];let parity=0,clock=0,pendingImpact=0;const maxStep=Math.min(.006,.4*dx/Math.sqrt(2*9.81*4));
 const samplePoint=uniform(new THREE.Vector2()),sampleOut=instancedArray(new Float32Array(8),'vec4'),sampleParity=uniform(0);const sampleNode=Fn(()=>{
  const grid=samplePoint.add(16).div(dx).sub(.5).clamp(0,n-1),base=grid.floor().min(n-2),f=grid.sub(base),i=uint(base.y.mul(n).add(base.x));
  const at=j=>{const v=surface.element(j);return vec4(surface.element(j.add(count)).w,bed.element(j).x,v.yz.div(max(v.x,.005)));};
  const interpolate=(a,b,c,d)=>select(f.x.add(f.y).lessThanEqual(1),a.mul(float(1).sub(f.x).sub(f.y)).add(b.mul(f.x)).add(c.mul(f.y)),d.mul(f.x.add(f.y).sub(1)).add(c.mul(float(1).sub(f.x))).add(b.mul(float(1).sub(f.y))));
  const sampled=interpolate(at(i),at(i.add(1)),at(i.add(n)),at(i.add(n+1))).toVar();const cell=samplePoint.add(16).div(dx).clamp(0,n-.00001),cx=cell.x.floor(),cz=cell.y.floor(),fraction=cell.fract(),ci=uint(cz.mul(n).add(cx)),cl=uint(cz.mul(n).add(max(cx.sub(1),0))),cd=uint(max(cz.sub(1),0).mul(n).add(cx));
  const local=j=>select(sampleParity.equal(0),localA.element(j),localB.element(j));
  const faceSpeed=(j,k,axis)=>{const h=max(min(surface.element(j.add(count)).w.sub(bed.element(j).x),surface.element(k.add(count)).w.sub(bed.element(k).x)),0);return select(h.greaterThan(.006),(axis===0?wave.element(j).y:wave.element(j).z).add((axis===0?local(j).y:local(j).z).div(max(h,.05))),float(0));};
  const cr=uint(cz.mul(n).add(min(cx.add(1),n-1))),cu=uint(min(cz.add(1),n-1).mul(n).add(cx)),velocity=vec2(mix(faceSpeed(cl,ci,0),faceSpeed(ci,cr,0),fraction.x),mix(faceSpeed(cd,ci,1),faceSpeed(ci,cu,1),fraction.y)).clamp(-4,4);
  sampleOut.element(uint(0)).assign(vec4(sampled.x,max(sampled.x.sub(sampled.y),0),velocity));
  sampleOut.element(uint(1)).assign(vec4(interpolate(surfaceVelocity.element(i),surfaceVelocity.element(i.add(1)),surfaceVelocity.element(i.add(n)),surfaceVelocity.element(i.add(n+1))),0,0,0));
 })().compute(1);
 const foam={element:i=>surface.element(i.add(count))};
 const api={n,count,dx,obstacleBake:obstacleBake?.diagnostics,bedArray,bed,wet,elevation:i=>surface.element(i.add(count)).w,a:surface,b:surface,foamA:foam,foamB:foam,time,forcing,body,bodyMotion,maxStep,get parity(){return 0},get localParity(){return parity},floorAt(x,z){const ix=Math.max(0,Math.min(n-1,Math.floor((x+16)/dx))),iz=Math.max(0,Math.min(n-1,Math.floor((z+16)/dx)));return bedArray[(iz*n+ix)*4]},impact(event){landing.value.set(event.position.x,event.position.z,0,event.radius);pendingImpact=Math.min(2,event.relativeSpeed*.65);},step(seconds){let left=Math.min(seconds,20);while(left>1e-7){const chunk=Math.min(left,1/60),steps=Math.ceil(chunk/maxStep),d=chunk/steps;clock+=chunk;time.value=clock;dt.value=d;impulse.value=pendingImpact;const list=[waveNode];for(let j=0;j<steps;j++){list.push(j===steps-1?(j===0&&pendingImpact>0?freshImpactNodes[parity]:freshNodes[parity]):(j===0&&pendingImpact>0?impactNodes[parity]:nodes[parity]));parity=1-parity;}pendingImpact=0;if(batchCompute)renderer.compute(list);else for(const node of list)renderer.compute(node);left-=chunk;}impulse.value=0;},reset(){localA.value.array.set(initial);localB.value.array.set(initial);localA.value.needsUpdate=true;localB.value.needsUpdate=true;wet.value.array.fill(0);wet.value.needsUpdate=true;clock=0;parity=0;time.value=0;pendingImpact=0;api.step(maxStep);},async read(){return new Float32Array(await renderer.getArrayBufferAsync(surface.value)).slice(0,count*4)},async readLocal(){return new Float32Array(await renderer.getArrayBufferAsync((parity?localB:localA).value)).slice(0,count*4)},async readFoam(){return new Float32Array(await renderer.getArrayBufferAsync(surface.value)).slice(count*4)},async readWave(){return new Float32Array(await renderer.getArrayBufferAsync(wave.value));},async sample(x,z){sampleParity.value=parity;samplePoint.value.set(x,z);renderer.compute(sampleNode);return new Float32Array(await renderer.getArrayBufferAsync(sampleOut.value));}};api.reset();return api;
}
