import {Fn,vec2,vec3,vec4,float,uint,min,max,mix,select} from 'three/tsl';
export function sampleState(sim,p){const q=p.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),b=q.floor().min(sim.n-2),f=q.sub(b),i=uint(b.y.mul(sim.n).add(b.x)),a=j=>sim.a.element(j);return mix(mix(a(i),a(i.add(1)),f.x),mix(a(i.add(sim.n)),a(i.add(sim.n+1)),f.x),f.y);}
// Catmull-Rom with local-range limiter: never invent a negative-depth undershoot beside a bore.
export function cubicSurface(sim,p){return Fn(()=>{
 const q=p.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),b=q.floor(),t=q.sub(b);
 const w=t=>[t.mul(-.5).add(t.pow(2)).sub(t.pow(3).mul(.5)),float(1).sub(t.pow(2).mul(2.5)).add(t.pow(3).mul(1.5)),t.mul(.5).add(t.pow(2).mul(2)).sub(t.pow(3).mul(1.5)),t.pow(2).mul(-.5).add(t.pow(3).mul(.5))];
 const d=t=>[float(-.5).add(t.mul(2)).sub(t.pow(2).mul(1.5)),t.mul(-5).add(t.pow(2).mul(4.5)),float(.5).add(t.mul(4)).sub(t.pow(2).mul(4.5)),t.negate().add(t.pow(2).mul(1.5))];
 const centerIndex=uint(b.y.clamp(0,sim.n-1).mul(sim.n).add(b.x.clamp(0,sim.n-1))),centerHeight=sim.elevation(centerIndex);
 const wx=w(t.x),wz=w(t.y),dx=d(t.x),dz=d(t.y),h=float(0).toVar(),sx=float(0).toVar(),sz=float(0).toVar(),lo=float(1e6).toVar(),hi=float(-1e6).toVar();
 for(let z=0;z<4;z++)for(let x=0;x<4;x++){const ix=b.x.add(x-1).clamp(0,sim.n-1),iz=b.y.add(z-1).clamp(0,sim.n-1),j=uint(iz.mul(sim.n).add(ix)),v=select(sim.a.element(j).x.greaterThan(.005),sim.elevation(j),centerHeight);h.addAssign(v.mul(wx[x]).mul(wz[z]));sx.addAssign(v.mul(dx[x]).mul(wz[z]));sz.addAssign(v.mul(wx[x]).mul(dz[z]));if(x>0&&x<3&&z>0&&z<3){lo.assign(min(lo,v));hi.assign(max(hi,v));}}
 return vec3(h.clamp(lo,hi),sx.div(sim.dx),sz.div(sim.dx));
})();}
