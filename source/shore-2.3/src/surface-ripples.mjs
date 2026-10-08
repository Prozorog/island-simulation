import {wgslFn} from 'three/tsl';

// Centimetre-scale displacement and its exact analytic spatial derivatives.
// These supplement, rather than replace, the mass-conserving shallow-water field.
export const surfaceRipples=wgslFn(`fn shoreRipples(p:vec2<f32>,t:f32,h:f32,depthGradient:vec2<f32>)->vec3<f32>{
 var result=vec3<f32>(0.0);
 for(var i=0u;i<3u;i++){
  var k=vec2<f32>(2.2,.7);var omega=4.8;var amplitude=.045;
  if(i==1u){k=vec2<f32>(4.4,-1.6);omega=6.8;amplitude=.024;}
  if(i==2u){k=vec2<f32>(1.1,3.9);omega=6.3;amplitude=.017;}
  let crossK=vec2<f32>(-k.y,k.x)*.13;let m=dot(p,crossK)-t*.32;
  let phase=dot(p,k)+.48*sin(m)-omega*t;let gradient=k+.48*cos(m)*crossK;
  let f=dot(p,vec2<f32>(.33,.57))+t*.09;let envelope=.74+.26*sin(f);
  let height=envelope*sin(phase);let slope=envelope*cos(phase)*gradient+sin(phase)*.26*cos(f)*vec2<f32>(.33,.57);
  result+=amplitude*vec3<f32>(height,slope);
 }
 let f=clamp((h-.025)/.195,0.0,1.0);let wet=f*f*(3.0-2.0*f);let wetDerivative=6.0*f*(1.0-f)/.195;
 return vec3<f32>(result.x*wet,result.yz*wet+result.x*wetDerivative*depthGradient);
}`);

// Height and time derivative of the resolved ripple layer, including its depth fade.
export const surfaceRippleMotion=wgslFn(`fn shoreRippleMotion(p:vec2<f32>,t:f32,h:f32,hdot:f32)->vec2<f32>{
 var result=vec2<f32>(0.0);
 for(var i=0u;i<3u;i++){
  var k=vec2<f32>(2.2,.7);var omega=4.8;var amplitude=.045;
  if(i==1u){k=vec2<f32>(4.4,-1.6);omega=6.8;amplitude=.024;}
  if(i==2u){k=vec2<f32>(1.1,3.9);omega=6.3;amplitude=.017;}
  let m=dot(p,vec2<f32>(-k.y,k.x)*.13)-t*.32;
  let phase=dot(p,k)+.48*sin(m)-omega*t;let phaseDot=-.48*.32*cos(m)-omega;
  let f=dot(p,vec2<f32>(.33,.57))+t*.09;let envelope=.74+.26*sin(f);
  result+=amplitude*vec2<f32>(envelope*sin(phase),.26*.09*cos(f)*sin(phase)+envelope*cos(phase)*phaseDot);
 }
 let f=clamp((h-.025)/.195,0.0,1.0);let fade=f*f*(3.0-2.0*f);let fadeDot=6.0*f*(1.0-f)/.195*hdot;
 return vec2<f32>(result.x*fade,result.y*fade+result.x*fadeDot);
}`);
