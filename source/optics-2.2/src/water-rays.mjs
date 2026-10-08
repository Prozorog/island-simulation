import {Fn,If,Loop,Break,bool,float,int,uint,vec2,vec3,vec4,select,min,max,abs,clamp,cameraProjectionMatrix,cameraViewMatrix,cameraProjectionMatrixInverse,cameraNear,cameraFar,viewportDepthTexture,viewportSharedTexture,perspectiveDepthToViewZ,getViewPosition,length} from 'three/tsl';
export const waterDepthBuffer=viewportDepthTexture();
export const waterSceneBuffer=viewportSharedTexture();
export const projectWaterRay=point=>{const clip=cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(point,1)));return vec2(clip.x.div(clip.w).mul(.5).add(.5),float(.5).sub(clip.y.div(clip.w).mul(.5)));};
const insideUV=uv=>uv.x.greaterThan(.002).and(uv.x.lessThan(.998)).and(uv.y.greaterThan(.002)).and(uv.y.lessThan(.998));
// Exact first intersection with the two triangles in each rendered heightfield cell.
// A runtime DDA loop visits cells in ray order: no unrolled march or endpoint bracket.
// At most 2*n cells can be crossed in the finite square. Misses return (limit, 0).
export function heightfieldRayHit(sim,origin,ray,limit,heightAt=i=>sim.bed.element(i).x){return Fn(()=>{
 const low=-16+sim.dx*.5,high=low+(sim.n-1)*sim.dx;
 const enter=float(.0001).toVar(),exit=limit.toVar(),inside=bool(true).toVar();
 for(const axis of ['x','z']){
  const o=origin[axis],r=ray[axis];
  If(abs(r).lessThan(1e-7),()=>{If(o.lessThan(low).or(o.greaterThan(high)),()=>{inside.assign(false);});}).Else(()=>{
   const a=float(low).sub(o).div(r),b=float(high).sub(o).div(r);
   enter.assign(max(enter,min(a,b)));exit.assign(min(exit,max(a,b)));
  });
 }
 const distance=limit.toVar(),found=bool(false).toVar();
 If(inside.and(enter.lessThanEqual(exit)).and(limit.greaterThan(0)),()=>{
  const start=origin.add(ray.mul(enter)),cell=start.xz.sub(low).div(sim.dx).floor().clamp(0,sim.n-2).toVar();
  const sx=select(ray.x.greaterThanEqual(0),float(1),float(-1)),sz=select(ray.z.greaterThanEqual(0),float(1),float(-1));
  const tx=float(1e20).toVar(),tz=float(1e20).toVar();
  If(abs(ray.x).greaterThanEqual(1e-7),()=>{tx.assign(cell.x.add(select(ray.x.greaterThan(0),float(1),float(0))).mul(sim.dx).add(low).sub(origin.x).div(ray.x));});
  If(abs(ray.z).greaterThanEqual(1e-7),()=>{tz.assign(cell.y.add(select(ray.z.greaterThan(0),float(1),float(0))).mul(sim.dx).add(low).sub(origin.z).div(ray.z));});
  const stepX=float(sim.dx).div(max(abs(ray.x),1e-7)),stepZ=float(sim.dx).div(max(abs(ray.z),1e-7)),near=enter.toVar();
  Loop({start:int(0),end:int(sim.n*2),type:'int',condition:'<'},()=>{
   If(cell.x.lessThan(0).or(cell.y.lessThan(0)).or(cell.x.greaterThan(sim.n-2)).or(cell.y.greaterThan(sim.n-2)).or(near.greaterThan(exit)),()=>{Break();});
   const far=min(exit,min(tx,tz)).toVar(),index=uint(cell.y.mul(sim.n).add(cell.x));
   const a=heightAt(index).toVar(),b=heightAt(index.add(1)).toVar(),c=heightAt(index.add(sim.n)).toVar(),d=heightAt(index.add(sim.n+1)).toVar();
   const local=origin.xz.sub(cell.mul(sim.dx).add(low));
   // Both planes must be tested: their ordering depends on the ray direction.
   for(const upper of [false,true]){
    const slope=upper?vec2(d.sub(c),d.sub(b)).div(sim.dx):vec2(b.sub(a),c.sub(a)).div(sim.dx);
    const base=upper?b.add(c).sub(d):a;
    const denominator=ray.y.sub(slope.x.mul(ray.x)).sub(slope.y.mul(ray.z));
    If(abs(denominator).greaterThan(1e-7),()=>{
     const t=base.add(slope.x.mul(local.x)).add(slope.y.mul(local.y)).sub(origin.y).div(denominator).toVar();
     const f=local.add(ray.xz.mul(t)).div(sim.dx),sum=f.x.add(f.y);
     const triangle=upper?sum.greaterThanEqual(.99998):sum.lessThanEqual(1.00002);
     If(t.greaterThanEqual(near.sub(1e-6)).and(t.greaterThanEqual(enter)).and(t.lessThanEqual(far.add(1e-6))).and(t.lessThanEqual(exit)).and(t.lessThanEqual(distance)).and(triangle),()=>{distance.assign(t);found.assign(true);});
    });
   }
   If(found.or(far.greaterThanEqual(exit)),()=>{Break();});
   const crossX=tx.lessThanEqual(tz).toVar(),crossZ=tz.lessThanEqual(tx).toVar();
   near.assign(far);
   If(crossX,()=>{cell.x.addAssign(sx);tx.addAssign(stepX);});
   If(crossZ,()=>{cell.y.addAssign(sz);tz.addAssign(stepZ);});
  });
 });
 return vec2(distance,select(found,float(1),float(0)));
})();}
export function bedRayHit(sim,origin,ray,depth){
 const limit=max(depth,0).div(max(ray.y.negate(),.22)).mul(2).add(.5).min(12);
 return heightfieldRayHit(sim,origin,ray,limit);
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
// Fade the finite reflection reach rather than popping at the six-unit cutoff.
export function reflectedBedHit(sim,origin,ray){return Fn(()=>{
 const hit=heightfieldRayHit(sim,origin,ray,float(6)).toVar();
 return vec2(hit.x,hit.y.mul(float(1).sub(hit.x.smoothstep(4.8,6))));
})();}
