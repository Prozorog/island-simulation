import * as THREE from 'three/webgpu';
export function createSkyEnvironment(){
 const w=128,h=64,data=new Uint16Array(w*h*4),sun=new THREE.Vector3(-.48,.84,-.42).normalize();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const phi=(x+.5)/w*Math.PI*2,theta=(y+.5)/h*Math.PI,dy=Math.cos(theta),s=Math.sin(theta);
  const direction=new THREE.Vector3(-s*Math.cos(phi),dy,s*Math.sin(phi));const blend=Math.max(0,dy),glow=Math.exp((direction.dot(sun)-1)*500)*8;
  const rgb=dy>0?[.43-.25*blend,.56-.28*blend,.66-.26*blend]:[.16,.14,.10];
  const i=(y*w+x)*4;for(let c=0;c<3;c++)data[i+c]=THREE.DataUtils.toHalfFloat(rgb[c]+glow*[1,.91,.73][c]);data[i+3]=THREE.DataUtils.toHalfFloat(1);
 }
 const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.HalfFloatType);t.mapping=THREE.EquirectangularReflectionMapping;t.needsUpdate=true;return t;
}
