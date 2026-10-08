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



const {uniform}=await import('three/tsl');const {createLocalRipples}=await import('../src/local-ripples.mjs');
const sim={time:uniform(0),body:uniform(new THREE.Vector4(-3,-2,0,.32)),bodyMotion:uniform(new THREE.Vector4(1,0,.7,0))};const ripple=createLocalRipples(renderer,sim,{resolution:256,extent:4});
ripple.impact({position:{x:-3,z:-2},radius:.485,impact:.6});for(let i=0;i<30;i++){sim.time.value+=1/60;sim.body.value.x+=1/60;ripple.step(1/60);if(i%5===4)await device.queue.onSubmittedWorkDone();}
const read=await ripple.read();let maxHeight=0,maxVelocity=0;for(let i=0;i<read.length;i+=4){maxHeight=Math.max(maxHeight,Math.abs(read[i]));maxVelocity=Math.max(maxVelocity,Math.abs(read[i+1]));}
if(!read.every(Number.isFinite)||maxHeight>=.075)throw Error('Ripple unstable');console.log(JSON.stringify({resolution:ripple.resolution,finite:true,maxHeight,maxVelocity,center:ripple.center.value.toArray()}));ripple.reset();const reset=await ripple.read();if(reset.some(x=>x!==0))throw Error('Reset failed');console.log('reset zero PASS');renderer.dispose();device.destroy();process.exit(0);
