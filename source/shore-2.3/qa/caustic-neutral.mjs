import {create,globals} from 'webgpu';
Object.assign(globalThis,globals);globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
const gpu=create(['backend=vulkan']);Object.defineProperty(globalThis,'navigator',{value:{gpu,userAgent:'Native Dawn QA'},configurable:true});
const adapter=await gpu.requestAdapter({featureLevel:'compatibility'});if(!adapter)throw Error('No native WebGPU adapter');
const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersInVertexStage:3}});
const canvas={width:256,height:256,style:{},addEventListener(){},removeEventListener(){},setAttribute(){},getContext(){return context}};
let target;
const context={configure(c){target?.destroy();target=device.createTexture({size:[canvas.width,canvas.height],format:c.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});},getCurrentTexture(){return target},unconfigure(){}};
globalThis.self={requestAnimationFrame(){return 0},cancelAnimationFrame(){}};
const THREE=await import('three/webgpu');
const renderer=new THREE.WebGPURenderer({canvas,context,device,antialias:false});
renderer.onError=e=>{throw Error(e.message)};
renderer.setSize(256,256,false);await renderer.init();


const {createWaterCompute}=await import('../src/water-compute.mjs');
const {createWaterCaustics}=await import('../src/water-caustics.mjs');
const sim=await createWaterCompute(renderer,{resolution:256,quiet:true,edgeAbsorption:false});
const caustics=createWaterCaustics(renderer,sim);caustics.update();const data=await caustics.read();
const decode=data instanceof Uint16Array?THREE.DataUtils.fromHalfFloat:x=>x;let ratios=[],bad=[];
for(let i=0;i<data.length;i+=4){const r=decode(data[i]),g=decode(data[i+1]);if(g>.02){const v=r/g;ratios.push(v);if(Math.abs(v-1)>.02)bad.push({x:(i/4)%512,y:Math.floor(i/4/512),r,g,v});}}
ratios.sort((a,b)=>a-b);console.log(JSON.stringify({pixels:ratios.length,min:ratios[0],max:ratios.at(-1),median:ratios[Math.floor(ratios.length/2)],badCount:bad.length,worst:bad.slice(0,20)},null,2));
caustics.dispose();sim.dispose?.();renderer.dispose();device.destroy();process.exit(bad.length>ratios.length*.01?1:0);
