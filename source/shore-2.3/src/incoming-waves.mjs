import {wgslFn} from 'three/tsl';

const G=9.81,referenceSpeed=Math.sqrt(G*2);
const ratios=[.68,.81,.93,1.00,1.11,1.27,1.49,1.83];
const weights=ratios.map(r=>Math.pow(r,-5)*Math.exp(-1.25*Math.pow(r,-4))*Math.pow(3.3,Math.exp(-.5*((r-1)/(r<1?.07:.09))**2)));
const norm=Math.sqrt(weights.reduce((a,b)=>a+b,0)/2);
export const wavePackets=ratios.map((r,i)=>{const period=5/r,angle=Math.sin(i*2.39996)*.349,omega=2*Math.PI/period;return {amplitude:.42/4*Math.sqrt(weights[i])/norm,period,angle,center:0,width:100,beat:.071+i*.00913,groupPhase:i*2.39996323,phase:i*4.763932,omega,ky:omega*Math.sin(angle)/referenceSpeed};});
const smooth=(a,b,x)=>{const f=Math.max(0,Math.min(1,(x-a)/(b-a)));return f*f*(3-2*f)};
export function packetKx(packet,depth){const k=packet.omega/Math.sqrt(G*Math.max(depth,.25));return Math.sqrt(Math.max(k*k-packet.ky*packet.ky,.0001));}
function envelope(p,z,t){return p.amplitude*(.18+.82*Math.exp(-.5*((z-p.center)/p.width)**2))*(.65+.35*Math.cos(p.beat*t+p.groupPhase));}
export function sampleIncoming(x,z,t,depth){
 const c=Math.sqrt(G*Math.max(depth,.25));let eta=0,qx=0,qz=0;
 for(const p of wavePackets){const k=p.omega/c,kx=packetKx(p,depth),e=envelope(p,z,t)*Math.sin(p.omega*t-kx*(x+16)+p.ky*z+p.phase);eta+=e;qx+=c*e*kx/k;qz-=c*e*p.ky/k;}
 return [eta,qx,qz];
}
export function sampleSeed(phases,z,depth){
 const c=Math.sqrt(G*Math.max(depth,.25)),fade=smooth(.03,.55,depth);let eta=0,qx=0,qz=0;
 for(let i=0;i<wavePackets.length;i++){const p=wavePackets[i],k=p.omega/c,kx=packetKx(p,depth),e=envelope(p,z,0)*Math.sin(-phases[i]+p.ky*z+p.phase)*fade;eta+=e;qx+=c*e*kx/k;qz-=c*e*p.ky/k;}
 return [eta,qx,qz];
}
const number=x=>Number(x).toFixed(10);
const terms=wavePackets.map(p=>`{
 let omega=${number(p.omega)}*5.0/wavePeriod;let ky=${number(p.ky)}*5.0/wavePeriod;let k=omega/c;let kx=sqrt(max(k*k-ky*ky,.0001));
 let lateral=.18+.82*exp(-.5*pow((p.y-${number(p.center)})/${number(p.width)},2.0));
 let envelope=${number(p.amplitude)}*(waveHeight/.42)*lateral*(.65+.35*cos(${number(p.beat)}*t+${number(p.groupPhase)}));
 let eta=envelope*sin(omega*t-kx*(p.x+16.0)+ky*p.y+${number(p.phase)});
 result+=vec3<f32>(eta,c*eta*kx/k,-c*eta*ky/k);
}`).join('\n');
// Phase varies through the forcing strip. Discharge is linear c*eta, avoiding
// the positive eta-squared mean inflow of (depth+eta)*eta*sqrt(g/depth).
export const incomingWaves=wgslFn(`fn shoreIncoming(p:vec2<f32>,t:f32,depth:f32,waveHeight:f32,wavePeriod:f32)->vec3<f32>{
 let c=sqrt(9.81*max(depth,.25));var result=vec3<f32>(0.0);
 ${terms}
 return result;
}`);
