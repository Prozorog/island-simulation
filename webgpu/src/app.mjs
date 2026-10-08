import * as THREE from 'three/webgpu';
import {createShoreScene} from './scene.mjs';
import {createPlayerController} from './player-controller.mjs';
import {terrain,shoreline,clamp} from './terrain.mjs';
import {legacyHTML} from './legacy.mjs';
const canvas=document.getElementById('view'),hud=document.getElementById('hud'),loading=document.getElementById('loading');
let renderer,shore,device,stopped=false;
const diagnostics={build:'webgpu-local-candidate-1.5',stage:'starting',firstError:null,errorType:null,samples:null,compatibility:null,viewport:null};window.shoreDiagnostics=diagnostics;
function graphicsFailure(error,type='graphics-error'){if(!diagnostics.firstError){diagnostics.firstError=String(error?.message||error||'Unknown graphics error');diagnostics.errorType=error?.constructor?.name||type;diagnostics.failureStage=diagnostics.stage;}fallback(type==='device-lost'?'WebGPU-устройство потеряно.':'Ошибка WebGPU. Точная причина сохранена ниже.');}

function fallback(reason){if(stopped)return;stopped=true;diagnostics.samples=renderer?.samples??null;diagnostics.compatibility=renderer?.backend?.compatibilityMode??null;diagnostics.viewport=[canvas.width||0,canvas.height||0];try{renderer?.setAnimationLoop(null);renderer?.dispose();device?.destroy();}catch(error){console.warn(error);}loading.hidden=true;document.getElementById('menu').hidden=true;document.getElementById('stick').style.display='none';document.getElementById('jump').style.display='none';canvas.hidden=true;const frame=document.getElementById('legacy');frame.srcdoc=legacyHTML;frame.style.display='block';const message=document.getElementById('fallback');message.hidden=false;message.textContent='Открыта совместимая версия V9 · WebGL2. '+reason;hud.hidden=true;window.shoreBackend={backend:'webgl2-fallback',reason};const details=document.getElementById('graphicsDetails');if(diagnostics.firstError){details.hidden=false;document.getElementById('graphicsError').textContent=diagnostics.build+' · этап: '+diagnostics.failureStage+'\n'+diagnostics.errorType+': '+diagnostics.firstError;document.getElementById('copyDiagnostics').onclick=()=>navigator.clipboard?.writeText(JSON.stringify(diagnostics,null,2)).catch(console.warn);}}
async function boot(){
 if(!navigator.gpu){fallback('В этом браузере WebGPU недоступен.');return;}
 diagnostics.stage='adapter';const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance',featureLevel:'compatibility'});if(!adapter){fallback('Браузер не предоставил WebGPU-адаптер.');return;}
 const limits={};if('maxStorageBuffersInVertexStage' in adapter.limits){if(adapter.limits.maxStorageBuffersInVertexStage<3){fallback('Устройство не поддерживает нужный режим WebGPU.');return;}limits.maxStorageBuffersInVertexStage=3;}
 const features=adapter.features.has('core-features-and-limits')?['core-features-and-limits']:[];
 diagnostics.stage='device';device=await adapter.requestDevice({requiredLimits:limits,requiredFeatures:features});
 renderer=new THREE.WebGPURenderer({canvas,device,antialias:true});renderer.onError=e=>graphicsFailure(e);renderer.onDeviceLost=e=>graphicsFailure(e,'device-lost');diagnostics.stage='renderer-init';await renderer.init();if(stopped)return;if(!renderer.backend.isWebGPUBackend)throw Error('WebGPU backend was not selected');
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.90;

 let quality=1;function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5)*quality);renderer.setSize(innerWidth,innerHeight,false);if(shore){shore.camera.aspect=innerWidth/innerHeight;shore.camera.updateProjectionMatrix();}}
 resize();diagnostics.stage='scene-init';shore=await createShoreScene(renderer,{resolution:256});if(stopped)return;resize();
 const controller=createPlayerController(shore),keys=new Set(),touch={x:0,y:0};let jump=false,paused=false,last=performance.now(),fps=60,elapsed=0;
 function reset(){shore.tracks.reset();shore.sim.reset();shore.setView('wide');controller.reset();keys.clear();document.getElementById('follow').checked=false;}

 const panel=document.getElementById('panel'),toggle=document.getElementById('toggle');toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{shore.setView(b.dataset.view);controller.reset();document.getElementById('follow').checked=shore.orbit.follow;canvas.focus();});
 document.getElementById('follow').onchange=e=>shore.orbit.follow=e.target.checked;
 document.getElementById('waves').onchange=e=>shore.sim.forcing.value=e.target.checked?1:0;
 document.getElementById('foam').oninput=e=>shore.foamAmount.value=Number(e.target.value);
 document.getElementById('quality').onchange=e=>{quality=Number(e.target.value);resize();};document.getElementById('reset').onclick=reset;document.getElementById('legacyButton').onclick=()=>fallback('Выбрана версия V9 для сравнения. Обнови страницу, чтобы вернуться к WebGPU.');
 addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON'].includes(e.target.tagName))return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Space'&&!e.repeat)jump=true;if(!e.repeat&&e.code==='KeyF'){shore.orbit.follow=!shore.orbit.follow;document.getElementById('follow').checked=shore.orbit.follow;}if(!e.repeat&&e.code==='KeyR')reset();if(!e.repeat&&e.code==='KeyP')paused=!paused;});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();touch.x=touch.y=0;});
 let pointer=null,px=0,py=0;canvas.onpointerdown=e=>{pointer=e.pointerId;px=e.clientX;py=e.clientY;canvas.setPointerCapture(pointer);canvas.focus();};canvas.onpointermove=e=>{if(e.pointerId!==pointer)return;shore.orbit.yaw-=(e.clientX-px)*.006;shore.orbit.pitch=clamp(shore.orbit.pitch+(e.clientY-py)*.005,.10,1.47);px=e.clientX;py=e.clientY;};canvas.onpointerup=canvas.onpointercancel=()=>pointer=null;canvas.addEventListener('wheel',e=>{e.preventDefault();shore.orbit.radius=clamp(shore.orbit.radius*Math.exp(e.deltaY*.001),2.2,65);},{passive:false});
 const stick=document.getElementById('stick'),nub=document.getElementById('nub');function moveStick(e){const r=stick.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/35,y=(e.clientY-r.top-r.height/2)/35,len=Math.max(1,Math.hypot(x,y));touch.x=x/len;touch.y=-y/len;nub.style.transform=`translate(${touch.x*28}px,${-touch.y*28}px)`;}
 stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);moveStick(e)};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))moveStick(e)};stick.onpointerup=stick.onpointercancel=()=>{touch.x=touch.y=0;nub.style.transform=''};document.getElementById('jump').onpointerdown=()=>jump=true;
 addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>last=performance.now());
 diagnostics.stage='running';diagnostics.samples=renderer.samples;diagnostics.compatibility=renderer.backend.compatibilityMode;loading.hidden=true;canvas.focus();window.shoreBackend={backend:'webgpu',three:THREE.REVISION,compatibility:renderer.backend.compatibilityMode};
 window.shoreDemoGPU={shore,renderer,controller,reset,setView:name=>{shore.setView(name);controller.reset();},pause:v=>paused=v,step:(dt,input)=>controller.step(dt,input),teleport:(x,z,y)=>{controller.reset();shore.player.position.set(x,y??controller.floorAt(x,z),z);return controller.requestWater();},diagnostics:()=>({...window.shoreBackend,...shore.grass.stats(),tracks:shore.tracks.stats(),player:controller.diagnostics,fps})};
 renderer.setAnimationLoop(()=>{
  if(stopped)return;const now=performance.now(),raw=(now-last)/1000;last=now;const dt=Math.min(.033,Math.max(0,raw));if(document.hidden)return;
  if(!paused){const forward=(Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown')))+touch.y,right=(Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft')))+touch.x;controller.step(dt,{forward,right,jump,run:keys.has('ShiftLeft')||keys.has('ShiftRight')});jump=false;}

  shore.updateCamera();shore.syncCamera(canvas.height);shore.render();fps=fps*.96+Math.min(240,1/Math.max(raw,.001))*.04;elapsed+=dt;if(elapsed>.3){elapsed=0;hud.textContent=`Локальный кандидат 1.5 · WebGPU · ${paused?'пауза':Math.round(fps)+' fps'}\nWASD / стрелки — идти · пробел — прыжок\nМышь — камера · F — следовать · R — сброс`;}
 });
}
boot().catch(e=>{console.error(e);graphicsFailure(e,'startup-error');});
