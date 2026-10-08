import {wgslFn} from 'three/tsl';

const G=9.81,referenceSpeed=Math.sqrt(G*2);
export const wavePackets=[
 {amplitude:.30,period:4.4,angle:.20,center:-6,width:7.5,beat:.23,groupPhase:.4,phase:.35},
 {amplitude:.21,period:3.2,angle:-.26,center:6,width:6.8,beat:.19,groupPhase:2.1,phase:-1},
 {amplitude:.0825,period:2.6,angle:.42,center:0,width:10,beat:.31,groupPhase:-.7,phase:1.7},
].map(p=>({...p,omega:2*Math.PI/p.period,ky:2*Math.PI/p.period*Math.sin(p.angle)/referenceSpeed}));
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
 let omega=${number(p.omega)};let ky=${number(p.ky)};let k=omega/c;let kx=sqrt(max(k*k-ky*ky,.0001));
 let lateral=.18+.82*exp(-.5*pow((p.y-${number(p.center)})/${number(p.width)},2.0));
 let envelope=${number(p.amplitude)}*lateral*(.65+.35*cos(${number(p.beat)}*t+${number(p.groupPhase)}));
 let eta=envelope*sin(omega*t-kx*(p.x+16.0)+ky*p.y+${number(p.phase)});
 result+=vec3<f32>(eta,c*eta*kx/k,-c*eta*ky/k);
}`).join('\n');
// Phase varies through the forcing strip. Discharge is linear c*eta, avoiding
// the positive eta-squared mean inflow of (depth+eta)*eta*sqrt(g/depth).
export const incomingWaves=wgslFn(`fn shoreIncoming(p:vec2<f32>,t:f32,depth:f32)->vec3<f32>{
 let c=sqrt(9.81*max(depth,.25));var result=vec3<f32>(0.0);
 ${terms}
 return result;
}`);
