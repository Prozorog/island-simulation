// Fixed physics ticks; bounded catch-up prevents a delayed tab from queuing seconds of GPU work.
export function createFrameClock({step=1/60,maxSteps=4,maxGap=.25}={}){
 let remainder=0,dropped=0,lastSteps=0;
 return{step,tick(seconds){if(!Number.isFinite(seconds)||seconds<=0){lastSteps=0;return 0;}const accepted=Math.min(seconds,maxGap);dropped+=Math.max(0,seconds-accepted);remainder+=accepted;let count=Math.min(maxSteps,Math.floor((remainder+1e-9)/step));remainder-=count*step;if(remainder>=step){const lost=Math.floor(remainder/step)*step;dropped+=lost;remainder-=lost;}lastSteps=count;return count;},reset(){remainder=0;lastSteps=0;},stats(){return{step,maxSteps,lastSteps,remainder,droppedSeconds:dropped}}};
}
