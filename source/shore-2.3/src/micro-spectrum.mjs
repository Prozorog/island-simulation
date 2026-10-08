import * as THREE from 'three/webgpu';
import {Fn,instanceIndex,uvec2,vec2,vec4,uniform,wgslFn,textureStore,texture} from 'three/tsl';
// 64 phase-dispersive modes split across incommensurate tiles. The small tile resolves 2 cm.
export function createMicroSpectrum(renderer,sim){
 const wind=uniform(4),strength=uniform(1),tiles=[{size:256,metres:1.73,share:.66},{size:128,metres:6.31,share:.34}];
 const wave=wgslFn(`fn microWaves(p:vec2<f32>,t:f32,tile:f32,share:f32,wind:f32)->vec4<f32>{
 var slope=vec2<f32>(0.0);var height=0.0;
 for(var i=0u;i<32u;i++){
 let fi=f32(i);let angle=-.95+1.9*fract(fi*.61803398875+.17);let cycles=mix(1.0,select(32.0,85.0,tile<2.0),pow(fract(fi*.754877666+.13),1.8));
 let kv=round(vec2<f32>(cos(angle),sin(angle))*cycles)*6.28318530718/tile;let k=max(length(kv),.001);
 let omega=sqrt(9.81*k+.000072*k*k*k);let phase=dot(p,kv)-omega*t+fi*2.39996323;
 let amp=sqrt(max(.003+.00512*wind-.003,0.0)*share/16.0);
 slope+=kv/k*cos(phase)*amp;height+=sin(phase)*amp/k;
 }
 return vec4<f32>(slope,dot(slope,slope),height);
}`);
 const textures=tiles.map(({size})=>{const t=new THREE.StorageTexture(size,size);t.type=THREE.HalfFloatType;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;});
 const nodes=tiles.map((tile,j)=>Fn(()=>{const g=uvec2(instanceIndex.mod(tile.size),instanceIndex.div(tile.size)),p=vec2(g).add(.5).div(tile.size).mul(tile.metres);textureStore(textures[j],g,wave(p,sim.time,tile.metres,tile.share,wind)).toWriteOnly();})().compute(tile.size*tile.size,[64]));
 return{wind,strength,tiles,textures:textures.map(t=>texture(t)),step(){renderer.compute(nodes)},dispose(){for(const t of textures)t.dispose();}};
}
