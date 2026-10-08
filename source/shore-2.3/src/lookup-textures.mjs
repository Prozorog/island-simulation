import * as THREE from 'three/webgpu';
const tau=Math.PI*2,fract=x=>x-Math.floor(x),hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
function finish(texture){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;}
export function createWindTexture(){
 const n=512,data=new Uint16Array(n*n*4),waves=[];
 for(let i=0;i<24;i++){const a=-.95+1.9*fract(i*.61803398875),cycles=6+36*Math.pow(fract(i*.754877666+.13),1.4),kx=Math.round(Math.cos(a)*cycles),ky=Math.round(Math.sin(a)*cycles),k=Math.hypot(kx,ky),am=.034*(1-.58*smooth(14,42,k));waves.push([kx,ky,k,am,i*2.39996323]);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){let sx=0,sz=0,h=0;for(const [kx,ky,k,am,phase] of waves){const a=tau*((x+.5)/n*kx+(y+.5)/n*ky)+phase,c=Math.cos(a)*am;sx+=kx/k*c;sz+=ky/k*c;h+=Math.sin(a)*am*8/(tau*k);}const i=(y*n+x)*4;data[i]=THREE.DataUtils.toHalfFloat(sx);data[i+1]=THREE.DataUtils.toHalfFloat(sz);data[i+2]=THREE.DataUtils.toHalfFloat(sx*sx+sz*sz);data[i+3]=THREE.DataUtils.toHalfFloat(h);}
 return finish(new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.HalfFloatType));
}
export function createFoamTexture(){
 const n=1024,data=new Uint8Array(n*n*4),grids=new Map(),sites=new Map();
 const grid=p=>{if(!grids.has(p))grids.set(p,Float32Array.from({length:p*p},(_,i)=>hash(i%p,Math.floor(i/p))));return grids.get(p)};
 function noise(x,y,p){const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);const a=grid(p),at=(x,y)=>a[((y%p+p)%p)*p+(x%p+p)%p];return (at(ix,iy)*(1-u)+at(ix+1,iy)*u)*(1-v)+(at(ix,iy+1)*(1-u)+at(ix+1,iy+1)*u)*v;}
 for(const p of [24,112])sites.set(p,Float32Array.from({length:p*p*2},(_,i)=>{const cell=Math.floor(i/2),x=cell%p,y=Math.floor(cell/p);return .12+.76*hash(x+(i%2?19.7:0),y+(i%2?19.7:0))}));
 function bubbles(x,y,p,width){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,a=sites.get(p);let d1=10,d2=10;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const k=(((iy+j)%p+p)%p*p+((ix+i)%p+p)%p)*2,dx=i+a[k]-fx,dy=j+a[k+1]-fy,d=dx*dx+dy*dy;if(d<d1){d2=d1;d1=d}else if(d<d2)d2=d;}const w=width*(.55+1.15*noise(x*9/p,y*9/p,9));return 1-smooth(w*.4,w,Math.sqrt(d2)-Math.sqrt(d1));}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const u=(x+.5)/n,v=(y+.5)/n,wx=noise(u*12,v*12,12)-.5+.35*(noise(u*37,v*37,37)-.5),wy=noise(u*12+3.1,v*12+3.1,12)-.5+.35*(noise(u*37+9.3,v*37+9.3,37)-.5);const web=bubbles(u*24+wx*3.6,v*24+wy*3.6,24,.11)*smooth(.20,.42,noise(u*63+wx,v*63+wy,63)),fine=bubbles(u*112+wx*5,v*112+wy*5,112,.15),raft=.52*noise(u*7+wx*.9,v*7+wy*.9,7)+.30*noise(u*17+wx,v*17+wy,17)+.18*noise(u*43,v*43,43);const k=(y*n+x)*4;data[k]=Math.round(web*255);data[k+1]=Math.round(fine*255);data[k+2]=Math.round(raft*255);data[k+3]=Math.round(noise(u*128,v*128,128)*255);}
 return finish(new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.UnsignedByteType));
}
export function createSurfaceTexture(){
 const n=512,data=new Uint8Array(n*n*4),grids=new Map();
 const grid=p=>{if(!grids.has(p))grids.set(p,Float32Array.from({length:p*p},(_,i)=>hash(i%p,Math.floor(i/p))));return grids.get(p)};
 function noise(u,v,p){const x=u*p,y=v*p,ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);const g=grid(p),at=(x,y)=>g[(y%p)*p+x%p];return (at(ix,iy)*(1-a)+at(ix+1,iy)*a)*(1-b)+(at(ix,iy+1)*(1-a)+at(ix+1,iy+1)*a)*b;}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const u=(x+.5)/n,v=(y+.5)/n,i=(y*n+x)*4;data[i]=Math.round(255*(.6*noise(u,v,17)+.3*noise(u,v,37)+.1*noise(u,v,79)));data[i+1]=Math.round(255*noise(u,v,7));data[i+2]=Math.round(255*noise(u,v,113));data[i+3]=Math.round(255*noise(u,v,251));}
 return finish(new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.UnsignedByteType));
}
