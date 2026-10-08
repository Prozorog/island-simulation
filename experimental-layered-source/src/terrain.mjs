export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
let seed=93457;
function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function hash(x,z){let n=Math.imul(x,374761393)^Math.imul(z,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
function fbm(x,z){return .57*noise(x,z)+.28*noise(x*2.1+31,z*2.1+8)+.15*noise(x*4.3-7,z*4.3+17);}
const smooth=(a,b,v)=>{const f=clamp((v-a)/(b-a),0,1);return f*f*(3-2*f);};
const rocks=[[-8.2,-7.1,1.2,1.3,2.45],[-6.7,4.1,1.12,1.18,1.50],[-5.5,10.9,.52,.61,1.44],[-2.1,-11.1,.65,.64,.88],[-.65,-6.3,.54,.61,.64],[-.18,-4.9,.69,.52,.73],[.85,-4.1,.49,.42,.56],[.4,4.35,.89,.64,.87],[1.65,5,.35,.43,.47],[3.5,3.8,1.34,1.14,.78]];
function shoreline(z){return -2.2+1.22*Math.sin(z*.23-.6)+.62*Math.sin(z*.48+.3);}
function terrain(x,z){
 const d=x-shoreline(z);
 let b=.115*d+.016*Math.sin(z*1.1+x*.7)+.015*(fbm(x*1.1,z*1.1)-.5);
 b-=.42*smooth(1.2,5.5,-d);
  b+=.14*Math.exp(-(((d+3.7)/1.2)**2))*(.65+.35*Math.sin(z*.38));
 b+=.41*smooth(4.8,13,d)+.15*Math.sin(z*.22+.7)*smooth(4,9,d);
 let rise=0;
 for(let k=0;k<rocks.length;k++){
  const r=rocks[k],angle=hash(k,7)*2.1,c=Math.cos(angle),s=Math.sin(angle),dx=(x-r[0])/r[2],dz=(z-r[1])/r[3];
  const rx=c*dx+s*dz,rz=-s*dx+c*dz;
  // Unequal planes and offset shoulders form an eroded outcrop, not a cone.
  const rr=Math.max(Math.abs(rx+.18*rz)*.82,Math.abs(-.46*rx+.88*rz),Math.abs(.76*rx-.51*rz))+.07*(noise(x*4.1,z*4.1)-.5);
  if(rr<1.22){const mass=clamp((1.22-rr)/.64,0,1),tilt=.88+.08*rx-.055*rz+.10*fbm(x*4.2+6,z*4.2);const shelf=.065*Math.floor(mass*4)/4;rise=Math.max(rise,r[4]*(mass*tilt+shelf));}
 }
 // One basal ledge joins differently sized, fractured blocks across the beach.
 const rx=x-3.8,rz=z-8.2-.17*rx,rr=(rx/6.1)**2+(rz/.92)**2;
 if(rr<1.8){
  rise=Math.max(rise,.66*Math.pow(Math.max(0,1-rr),.45));
  const blocks=[[-1.65,.90,.96,1.12,-.15],[-.10,1.10,.87,1.37,.12],[1.35,1.03,.92,1.18,-.22],[2.85,1.44,.96,1.55,.13],[4.65,1.16,1.13,1.31,-.08],[6.25,1.30,.89,1.43,.21],[8.05,1.53,.96,1.60,-.05],[9.35,.73,.72,.96,.12]];
  for(const block of blocks){const u=(x-block[0])/block[1],v=(rz-block[4])/block[2],edge=Math.max(Math.abs(u+.24*v)*.84,Math.abs(-.36*u+.95*v),Math.abs(.87*u-.42*v));if(edge<1.12){const mass=clamp((1.12-edge)/.53,0,1);rise=Math.max(rise,block[3]*mass*(.93+.05*u+.06*fbm(x*4,z*4)));}}
 }
 // Erosion follows the rock mass, leaving the beach height unchanged.
 if(rise>.06){const layers=(b+rise+x*.28-z*.17)*16+4.5*fbm(x*2.1,z*2.1);const erosion=.026*Math.sin(layers)+.055*(fbm(x*9.3,z*9.3)-.5);rise+=erosion*smooth(.06,.35,rise);}
 const rock=smooth(.075,.24,rise);
 const patch=fbm(x*.85+18,z*.85),edge=1.9*(patch-.5)+.45*Math.sin(z*1.3);
 const grass=smooth(5.25+edge,5.95+edge,d)*(1-rock);
 return [b+rise,grass,rock,b];
}


export {terrain,shoreline,noise,fbm,smooth,rand,rocks};
