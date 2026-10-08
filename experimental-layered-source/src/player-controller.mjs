import {createLandingEvents} from './landing-events.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const footOffsets=Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*.24,Math.sin(i*Math.PI/4)*.24]);
export function entryPulse(remaining,dt){const next=remaining*Math.exp(-dt/.20);return {remaining:next,rate:(remaining-next)/dt};}
export function capsuleImmersion(height,radius=.32,stem=1.06){
 const h=clamp(height,0,stem+2*radius),hemisphere=2/3*Math.PI*radius**3,total=Math.PI*radius**2*stem+2*hemisphere;
 let volume;if(h<radius)volume=Math.PI*h*h*(radius-h/3);else if(h<=radius+stem)volume=hemisphere+Math.PI*radius**2*(h-radius);else{const dry=stem+2*radius-h;volume=total-Math.PI*dry*dry*(radius-dry/3);}return volume/total;
}
export function createPlayerController(shore){
 const landingEvents=createLandingEvents();
 let sampleTime=0;
 let vy=0,water={eta:0,h:0,u:0,v:0},pending=null,sampleClock=0,generation=0,entry=0,lastImmersion=0,grounded=true;
 function floorAt(x,z){let y=shore.tracks.floorAt(x,z)+.85;for(const [dx,dz]of footOffsets)y=Math.max(y,shore.tracks.floorAt(x+dx,z+dz)+.53+Math.sqrt(.32*.32-.24*.24));return y;}
 function requestWater(){if(pending)return pending;const stamp=generation,requestedAt=shore.sim.time.value;pending=shore.sim.sample(shore.player.position.x,shore.player.position.z).then(v=>{if(stamp===generation){water={eta:v[0],h:v[1],u:v[2],v:v[3],etaDt:v[4]||0};sampleTime=requestedAt;};}).finally(()=>pending=null);return pending;}
 function reset(){landingEvents.reset(shore.sim.time.value);shore.spray?.reset(shore.sim.time.value);generation++;vy=0;water={eta:0,h:0,u:0,v:0};sampleClock=0;entry=0;lastImmersion=0;shore.sim.body.value.set(1000,1000,0,.32);shore.sim.bodyMotion.value.set(0,0,0,0);}
 function step(dt,{forward=0,right=0,jump=false,yaw=shore.orbit.yaw,run=false}={}){
  if(!(dt>0))return;const p=shore.player.position,px=p.x,pz=p.z,previousVy=vy,len=Math.max(1,Math.hypot(forward,right));
  const surface=water.eta+(water.etaDt||0)*Math.min(.06,shore.sim.time.value-sampleTime);const immersion=water.h>.003?capsuleImmersion(surface-(p.y-.85)):0,speed=(run?4.2:3)*(1-immersion*.42),vx=(-Math.sin(yaw)*forward+Math.cos(yaw)*right)/len*speed,vz=(-Math.cos(yaw)*forward-Math.sin(yaw)*right)/len*speed;
  p.x=clamp(p.x+(vx+water.u*immersion*.10)*dt,-15.6,15.6);p.z=clamp(p.z+(vz+water.v*immersion*.10)*dt,-15.6,15.6);
  let floor=floorAt(p.x,p.z);const stickToGround=grounded&&!jump&&vy<=0&&p.y-floor<.18&&immersion<.68;grounded=p.y<=floor+.015;if(jump&&(grounded||immersion>.15)){vy=4.2*(1-immersion*.3);grounded=false;}vy+=(-9.81+14*immersion-vy*immersion*2.6)*dt;p.y+=vy*dt;const fallingVelocity=vy;
  if(stickToGround||p.y<=floor){p.y=floor;vy=Math.max(0,vy);grounded=true;}else grounded=false;
  if(grounded){shore.tracks.stampSegment(px,pz,p.x,p.z,{grounded:true,...(water.h>.003?{waterEta:water.eta}:{})});floor=floorAt(p.x,p.z);p.y=floor;}
  const immersedHeight=water.h>.003?Math.max(0,surface-(p.y-.85)):0,columnOverlap=clamp(immersedHeight/Math.max(water.h,.025),0,1);
  const event=landingEvents.update({x:p.x,z:p.z,bottom:p.y-.85,surface,surfaceVelocity:water.etaDt||0,verticalVelocity:fallingVelocity,radius:.32,wet:water.h>.004,time:shore.sim.time.value+dt},dt);if(event)shore.onLanding?.(event);lastImmersion=immersedHeight;
  const bodyVX=(p.x-px)/dt,bodyVZ=(p.z-pz)/dt,radius=Math.max(.10,Math.sqrt(Math.max(0,.32*.32-Math.max(0,.32-immersedHeight)**2)));
  shore.sim.body.value.set(p.x,p.z,0,radius);shore.sim.bodyMotion.value.set(bodyVX,bodyVZ,columnOverlap,0);shore.step(dt);
  sampleClock-=dt;if(sampleClock<=0&&!pending){sampleClock=.025;requestWater().catch(console.error);}
 }
 return {step,reset,floorAt,requestWater,get pending(){return pending},get diagnostics(){return {vy,water:{...water},grounded,entry,lastImmersion,bodyMotion:shore.sim.bodyMotion.value.toArray(),landing:landingEvents.stats(),spray:shore.spray?.stats()}}};
}
