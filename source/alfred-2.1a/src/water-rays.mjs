import {Fn,If,bool,float,uint,vec2,vec3,vec4,select,min,max,abs,clamp,cameraProjectionMatrix,cameraViewMatrix,cameraProjectionMatrixInverse,cameraNear,cameraFar,viewportDepthTexture,viewportSharedTexture,perspectiveDepthToViewZ,getViewPosition,length} from 'three/tsl';
export const waterDepthBuffer=viewportDepthTexture();
export const waterSceneBuffer=viewportSharedTexture();
export const projectWaterRay=point=>{const clip=cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(point,1)));return vec2(clip.x.div(clip.w).mul(.5).add(.5),float(.5).sub(clip.y.div(clip.w).mul(.5)));};
const insideUV=uv=>uv.x.greaterThan(.002).and(uv.x.lessThan(.998)).and(uv.y.greaterThan(.002)).and(uv.y.lessThan(.998));
export function bedRayHit(sim,origin,ray,depth){
 const bedAt=p=>Fn(()=>{const grid=p.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),base=grid.floor().min(sim.n-2),f=grid.sub(base),i=uint(base.y.mul(sim.n).add(base.x));const a=sim.bed.element(i).x,b=sim.bed.element(i.add(1)).x,c=sim.bed.element(i.add(sim.n)).x,d=sim.bed.element(i.add(sim.n+1)).x;return select(f.x.add(f.y).lessThanEqual(1),a.mul(float(1).sub(f.x).sub(f.y)).add(b.mul(f.x)).add(c.mul(f.y)),d.mul(f.x.add(f.y).sub(1)).add(c.mul(float(1).sub(f.x))).add(b.mul(float(1).sub(f.y))));})();
 return Fn(()=>{const near=float(0).toVar(),far=depth.div(max(ray.y.negate(),.22)).mul(2).add(.5).min(12).toVar(),gn=depth.add(.002).toVar(),end=origin.add(ray.mul(far)),gf=end.y.sub(bedAt(end.xz)).toVar();const bracketed=gf.lessThanEqual(0).toVar();
 for(let i=0;i<4;i++){const t=near.add(far.sub(near).mul(gn.div(max(gn.sub(gf),.0001)).clamp(.05,.95))).toVar(),p=origin.add(ray.mul(t)),g=p.y.sub(bedAt(p.xz)).toVar();If(g.greaterThan(0),()=>{near.assign(t);gn.assign(g);}).Else(()=>{far.assign(t);gf.assign(g);});}
 const distance=select(abs(gn).lessThan(abs(gf)),near,far),hit=origin.add(ray.mul(distance)),valid=bracketed.and(hit.x.abs().lessThan(15.95)).and(hit.z.abs().lessThan(15.95));return vec2(distance,select(valid,float(1),float(0)));
 })();
}
// Bounded screen-space intersection against the actual opaque scene, including arbitrary mascot geometry.
export function screenRayHit(origin,ray,limit){return Fn(()=>{
 const near=float(0).toVar(),far=limit.toVar(),found=bool(false).toVar();
 for(let i=0;i<5;i++){const distance=limit.mul(((i+1)/5)**1.35);If(found.not(),()=>{const point=origin.add(ray.mul(distance)),uv=projectWaterRay(point).toVar(),view=cameraViewMatrix.mul(vec4(point,1)),depth=waterDepthBuffer.sample(uv.clamp(.001,.999)),z=perspectiveDepthToViewZ(depth,cameraNear,cameraFar);If(insideUV(uv).and(depth.lessThan(.9999)).and(view.z.lessThanEqual(z)),()=>{far.assign(distance);found.assign(true);}).Else(()=>{near.assign(distance);});});}
 for(let i=0;i<3;i++){If(found,()=>{const middle=near.add(far).mul(.5),point=origin.add(ray.mul(middle)),uv=projectWaterRay(point),view=cameraViewMatrix.mul(vec4(point,1)),depth=waterDepthBuffer.sample(uv.clamp(.001,.999)),z=perspectiveDepthToViewZ(depth,cameraNear,cameraFar);If(view.z.greaterThan(z),()=>{near.assign(middle);}).Else(()=>{far.assign(middle);});});}
 const hitPoint=origin.add(ray.mul(far)),uv=projectWaterRay(hitPoint).toVar(),depth=waterDepthBuffer.sample(uv.clamp(.001,.999)),opaque=getViewPosition(uv,depth,cameraProjectionMatrixInverse),expected=cameraViewMatrix.mul(vec4(hitPoint,1)).xyz,error=length(opaque.sub(expected));const confidence=select(found.and(insideUV(uv)),float(1).sub(error.smoothstep(.035,far.mul(.025).add(.16))),float(0));return vec4(uv,far,confidence);
 })();}
export function sampleBedInfo(sim,p){
 const grid=p.add(16).div(sim.dx).sub(.5).clamp(0,sim.n-1),base=grid.floor().min(sim.n-2),f=grid.sub(base),i=uint(base.y.mul(sim.n).add(base.x));
 const a=sim.bed.element(i),b=sim.bed.element(i.add(1)),c=sim.bed.element(i.add(sim.n)),d=sim.bed.element(i.add(sim.n+1)),lower=f.x.add(f.y).lessThanEqual(1);
 const data=select(lower,a.mul(float(1).sub(f.x).sub(f.y)).add(b.mul(f.x)).add(c.mul(f.y)),d.mul(f.x.add(f.y).sub(1)).add(c.mul(float(1).sub(f.x))).add(b.mul(float(1).sub(f.y))));
 const slope=select(lower,vec2(b.x.sub(a.x),c.x.sub(a.x)),vec2(d.x.sub(c.x),d.x.sub(b.x))).div(sim.dx);return {data,normal:vec3(slope.x.negate(),1,slope.y.negate()).normalize()};
}
export function reflectedBedHit(sim,origin,ray){return Fn(()=>{
 const near=float(0).toVar(),far=float(6).toVar(),found=bool(false).toVar();
 for(const distance of [.18,.45,.9,1.6,2.6,4,6]){If(found.not(),()=>{const point=origin.add(ray.mul(distance)),height=sampleBedInfo(sim,point.xz).data.x;If(point.y.lessThanEqual(height).and(point.x.abs().lessThan(15.9)).and(point.z.abs().lessThan(15.9)),()=>{far.assign(distance);found.assign(true);}).Else(()=>{near.assign(distance);});});}
 for(let i=0;i<3;i++){If(found,()=>{const t=near.add(far).mul(.5),p=origin.add(ray.mul(t)),height=sampleBedInfo(sim,p.xz).data.x;If(p.y.greaterThan(height),()=>{near.assign(t);}).Else(()=>{far.assign(t);});});}
 return vec2(far,select(found,float(1),float(0)));
})();}
