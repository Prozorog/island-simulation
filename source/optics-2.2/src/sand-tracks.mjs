import * as THREE from 'three/webgpu';
import {texture,positionWorld,attribute,vec2,vec3,float} from 'three/tsl';
import {createSandDeformation} from './sand-deformation.mjs';
export function createSandTracks(renderer,sim){
 const model=createSandDeformation({baseBed:sim.bedArray,bedResolution:sim.n}),n=model.resolution,size=64;
 const packed=new Uint16Array(n*n*4),map=new THREE.DataTexture(packed,n,n,THREE.RGBAFormat,THREE.HalfFloatType);map.magFilter=map.minFilter=THREE.LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;
 const stagingData=new Uint16Array(size*size*4),staging=new THREE.DataTexture(stagingData,size,size,THREE.RGBAFormat,THREE.HalfFloatType);staging.generateMipmaps=false;
 const tileData=new Uint8Array(16*16),tileMap=new THREE.DataTexture(tileData,16,16,THREE.RedFormat,THREE.UnsignedByteType);tileMap.magFilter=tileMap.minFilter=THREE.NearestFilter;tileMap.generateMipmaps=false;tileMap.needsUpdate=true;
 const sample=texture(map,positionWorld.xz.add(16).div(32)),heightSample=texture(map,attribute('position','vec3').xz.add(16).div(32)).r,refined=attribute('groundRefined','float'),tileMask=texture(tileMap,positionWorld.xz.add(16).div(32)).r;
 const texel=1/n,delta=32/n,at=offset=>texture(map,positionWorld.xz.add(16).div(32).add(offset)).r;
 const gradient=vec3(at(vec2(-texel,0)).sub(at(vec2(texel,0))).div(2*delta),0,at(vec2(0,-texel)).sub(at(vec2(0,texel))).div(2*delta)).mul(refined).toVertexStage();
 const group=new THREE.Group(),patches=new Map(),box=new THREE.Box2(new THREE.Vector2(),new THREE.Vector2()),destination=new THREE.Vector2();let ground,material,normalData,uploadBytes=0,bedCellsUpdated=0;
 function baseAt(x,z,ch=0,array=model.baseBed,stride=4){const px=Math.max(0,Math.min(sim.n-1,(x+16)/sim.dx-.5)),pz=Math.max(0,Math.min(sim.n-1,(z+16)/sim.dx-.5)),ix=Math.min(sim.n-2,Math.floor(px)),iz=Math.min(sim.n-2,Math.floor(pz)),u=px-ix,v=pz-iz,get=(a,b)=>array[(b*sim.n+a)*stride+ch];return u+v<=1?get(ix,iz)*(1-u-v)+get(ix+1,iz)*u+get(ix,iz+1)*v:get(ix+1,iz+1)*(u+v-1)+get(ix+1,iz)*(1-v)+get(ix,iz+1)*(1-u);}
 function activate(id){if(patches.has(id)||!ground)return;const tx=id%16,tz=Math.floor(id/16),g=new THREE.PlaneGeometry(2,2,32,32);g.rotateX(-Math.PI/2);const p=g.attributes.position,count=p.count,biome=new Float32Array(count*4),normals=new Float32Array(count*3);
  for(let i=0;i<count;i++){const x=p.getX(i)+tx*2-15,z=p.getZ(i)+tz*2-15;p.setXYZ(i,x,baseAt(x,z),z);for(let c=0;c<4;c++)biome[i*4+c]=baseAt(x,z,c);for(let c=0;c<3;c++)normals[i*3+c]=baseAt(x,z,c,normalData,3);}
  g.setAttribute('biome',new THREE.BufferAttribute(biome,4));g.setAttribute('normal',new THREE.BufferAttribute(normals,3));g.setAttribute('groundRefined',new THREE.BufferAttribute(new Float32Array(count).fill(1),1));g.computeBoundingBox();g.boundingBox.min.y-=.10;g.boundingBox.max.y+=.14;g.boundingSphere=g.boundingBox.getBoundingSphere(new THREE.Sphere());const mesh=new THREE.Mesh(g,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(1);group.add(mesh);patches.set(id,mesh);tileData[id]=255;tileMap.needsUpdate=true;
 }
 function flush(){const dirty=model.consumeDirty();if(!dirty)return null;const r=dirty.rect;
  for(let y=r.y;y<r.y+r.height;y+=size)for(let x=r.x;x<r.x+r.width;x+=size){const w=Math.min(size,r.x+r.width-x),h=Math.min(size,r.y+r.height-y);for(let row=0;row<h;row++)for(let col=0;col<w;col++)for(let c=0;c<4;c++)stagingData[(row*size+col)*4+c]=THREE.DataUtils.toHalfFloat(model.data[((y+row)*n+x+col)*4+c]);staging.needsUpdate=true;box.min.set(0,0);box.max.set(w,h);destination.set(x,y);renderer.copyTextureToTexture(staging,map,box,destination);uploadBytes+=size*size*8;}
  const x0=Math.max(0,Math.floor(r.x/n*sim.n)-1),x1=Math.min(sim.n-1,Math.ceil((r.x+r.width)/n*sim.n)+1),z0=Math.max(0,Math.floor(r.y/n*sim.n)-1),z1=Math.min(sim.n-1,Math.ceil((r.y+r.height)/n*sim.n)+1),q=sim.dx*.25;
  for(let z=z0;z<=z1;z++){for(let x=x0;x<=x1;x++){const wx=(x+.5)*sim.dx-16,wz=(z+.5)*sim.dx-16,i=(z*sim.n+x)*4;sim.bedArray[i]=model.baseBed[i]+(model.sample(wx-q,wz-q)+model.sample(wx+q,wz-q)+model.sample(wx-q,wz+q)+model.sample(wx+q,wz+q))*.25;bedCellsUpdated++;}sim.bed.value.addUpdateRange((z*sim.n+x0)*4,(x1-x0+1)*4);}sim.bed.value.needsUpdate=true;
  if(dirty.reset){for(const mesh of patches.values()){group.remove(mesh);mesh.geometry.dispose();}patches.clear();tileData.fill(0);tileMap.needsUpdate=true;}else for(const id of dirty.tiles)activate(id);
  return dirty;
 }
 return {model,group,node:sample.g,height:heightSample,gradient,mask:refined.greaterThan(.5).or(tileMask.lessThan(.5)),refined,
  attachGround(mesh){ground=mesh;material=mesh.material;normalData=mesh.geometry.attributes.normal.array;},
  floorAt:(x,z)=>baseAt(x,z)+model.sample(x,z),baseAt,
  stampSegment(...args){const result=model.stampSegment(...args);flush();return result;},
  reset(){model.reset();flush();},flush,stats(){return {...model.stats(),patches:patches.size,patchTriangles:patches.size*32*32*2,uploadBytes,bedCellsUpdated}}};
}
