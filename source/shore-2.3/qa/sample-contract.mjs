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



const {createWaterCompute}=await import('../src/water-compute.mjs');const sim=await createWaterCompute(renderer,{quiet:true});
const a=await sim.sample(-8.001,-3),b=await sim.sample(-7.999,-3);if(a.length!==8||!a.every(Number.isFinite)||Math.abs(a[4])>1e-5||Math.abs(a[0]-b[0])>1e-5)throw Error('Sampler contract failed '+JSON.stringify(Array.from(a)));
sim.impact({position:{x:-8,z:-3},radius:.35,relativeSpeed:3});sim.step(.1);await device.queue.onSubmittedWorkDone();sim.reset();const reset=await sim.sample(-8,-3);if(Math.abs(reset[4])>1e-5)throw Error('Reset injected surface velocity');console.log(JSON.stringify({samplerLength:a.length,continuousRestSurface:true,resetRate:reset[4],finite:true}));renderer.dispose();device.destroy();process.exit(0);
