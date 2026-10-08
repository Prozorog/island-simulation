import {wgslFn} from 'three/tsl';

// Shared by simulation emission and the rendered fresh-foam cap. Primitive
// vectors contain free-surface elevation and the two horizontal velocities.
export const breakingSignal=wgslFn(`fn shoreBreaking(pc:vec3<f32>,west:vec3<f32>,east:vec3<f32>,south:vec3<f32>,north:vec3<f32>,depths:vec4<f32>,h:f32,dx:f32)->f32{
 let w=select(pc,west,depths.x>.006);let e=select(pc,east,depths.y>.006);
 let s=select(pc,south,depths.z>.006);let n=select(pc,north,depths.w>.006);
 let speed=length(pc.yz);let direction=pc.yz/max(speed,.04);
 let gradient=vec2<f32>(e.x-w.x,n.x-s.x)/(2.0*dx);
 let leading=max(-dot(gradient,direction),0.0);
 let compression=max(-(e.y-w.y+n.z-s.z)/(2.0*dx),0.0);
 let convexity=max((4.0*pc.x-w.x-e.x-s.x-n.x)/(dx*dx),0.0);
 let froude=speed/sqrt(9.81*max(h,.025));let energetic=smoothstep(.60,1.10,froude);
 let converging=smoothstep(.40,1.60,compression)*(.45+.55*energetic);
 let spilling=smoothstep(.18,.60,leading)*smoothstep(.30,2.20,convexity)*(.35+.65*energetic);
 return clamp(max(converging,spilling)*smoothstep(.08,.34,speed)*smoothstep(.012,.08,h),0.0,1.0);
}`);
