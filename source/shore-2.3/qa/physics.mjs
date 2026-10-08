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
const report=[];
async function stats(sim){const a=await sim.read();let mass=0,maxSpeed=0,minH=Infinity,maxH=0,maxEta=0;for(let i=0;i<sim.count;i++){const h=a[i*4];mass+=h*sim.dx**2;minH=Math.min(minH,h);maxH=Math.max(maxH,h);if(h>.003){maxSpeed=Math.max(maxSpeed,Math.hypot(a[i*4+1],a[i*4+2])/h);maxEta=Math.max(maxEta,Math.abs(h+sim.bedArray[i*4]));}}return{mass,minH,maxH,maxSpeed,maxEta,finite:a.every(Number.isFinite)};}
const sim=await createWaterCompute(renderer,{resolution:256,quiet:true,edgeAbsorption:false,diagnostics:true});
const initial=await stats(sim);console.log('initial',JSON.stringify(initial));for(let i=0;i<120;i++){sim.step(1/60);if(i%15===14)await device.queue.onSubmittedWorkDone();}const rest=await stats(sim);console.log('rest',JSON.stringify(rest));report.push({test:'lake-at-rest',initial,rest,relativeMassDrift:Math.abs(rest.mass-initial.mass)/initial.mass});
if(!rest.finite||rest.minH<0||rest.maxSpeed>.005||Math.abs(rest.mass-initial.mass)/initial.mass>1e-5)throw Error('Lake at rest failed '+JSON.stringify(rest));
sim.impact({position:{x:-8,z:-3},radius:.35,relativeSpeed:3});for(let i=0;i<120;i++){sim.step(1/60);if(i%15===14)await device.queue.onSubmittedWorkDone();}const impact=await stats(sim);console.log('impact',JSON.stringify(impact));report.push({test:'impact-mass',impact,relativeMassDrift:Math.abs(impact.mass-rest.mass)/rest.mass});if(!impact.finite||impact.minH<0||Math.abs(impact.mass-rest.mass)/rest.mass>1e-4)throw Error('Impact failed');
sim.reset();sim.forcing.value=1;for(let i=0;i<600;i++){sim.step(1/60);if(i%15===14)await device.queue.onSubmittedWorkDone();}const waves=await stats(sim);report.push({test:'ten-second-forcing-wet-dry',waves});if(!waves.finite||waves.minH<0||waves.maxSpeed>3.501)throw Error('Forced waves failed');
const audit=await sim.readAudit();let clippedMass=0;for(let i=0;i<audit.length;i+=4)clippedMass+=audit[i+1];report.push({test:'positivity-audit',clippedMass});
sim.reset();report.push({test:'reset',state:await stats(sim)});console.log(JSON.stringify(report,null,2));renderer.dispose();device.destroy();process.exit(0);
