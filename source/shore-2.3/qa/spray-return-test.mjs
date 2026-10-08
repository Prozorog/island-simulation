import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {createSpray} from '../src/spray.mjs';
const scene=new THREE.Scene(),hits=[];const spray=createSpray(scene,{floorAt:()=>-1,onReturn:e=>hits.push(e)});
const event={id:1,time:0,position:{x:0,y:0,z:0},radius:.485,impact:.6};assert.equal(spray.emit(event),30);assert.equal(spray.emit(event),0);
for(let i=1;i<=60;i++){const before=hits.length;spray.update(i/60);assert(hits.length-before<=2);}
assert(hits.length>0);assert(hits.every(e=>e.secondary&&Math.abs(e.position.y)<1e-7&&Number.isFinite(e.position.x)));assert.equal(spray.stats().active,0);spray.reset();assert.equal(spray.stats().emitted,0);spray.dispose();assert.equal(scene.children.length,0);
const dryHits=[],dry=createSpray(scene,{floorAt:()=>1,onReturn:e=>dryHits.push(e)});dry.emit(event);for(let i=1;i<=60;i++)dry.update(i/60);assert.equal(dryHits.length,0);dry.dispose();console.log(JSON.stringify({duplicateSuppressed:true,secondaryWetReturns:hits.length,maxReturnsPerTick:2,drySuppressed:true,reset:true,disposed:true}));
