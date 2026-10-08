import * as THREE from 'three/webgpu';
import {uniform,pass,renderOutput,vec4,mrt,output} from 'three/tsl';
import {fxaa} from 'three/addons/tsl/display/FXAANode.js';
import {dof} from 'three/addons/tsl/display/DepthOfFieldNode.js';
import {bloom} from 'three/addons/tsl/display/BloomNode.js';
export function createShorePost(renderer,scene,camera,water,player){
 const scenePass=pass(scene,camera),focus=uniform(8),focalLength=uniform(4.5),bokeh=uniform(.55);
 scenePass.setMRT(mrt({output,waterBloom:vec4(0)}));water.material.mrtNode=mrt({waterBloom:water.material.userData.shoreBloom});
 const image=scenePass.getTextureNode(),depth=scenePass.getViewZNode(),blurred=dof(image,depth,focus,focalLength,bokeh),glow=bloom(scenePass.getTextureNode('waterBloom'),.12,.2,.65);
 const pipeline=new THREE.RenderPipeline(renderer);pipeline.outputColorTransform=false;
 let enabled=!/iPhone|iPad|Android/i.test(navigator.userAgent),bloomEnabled=true,dofEnabled=true;
 function rebuild(){const color=enabled&&dofEnabled?blurred:image,result=enabled&&bloomEnabled?color.add(glow):color;pipeline.outputNode=fxaa(renderOutput(result,THREE.ACESFilmicToneMapping,THREE.SRGBColorSpace));pipeline.needsUpdate=true;}
 rebuild();const direction=new THREE.Vector3(),delta=new THREE.Vector3();
 return{focus,focalLength,bokeh,bloomStrength:glow.strength,get enabled(){return enabled},setEnabled(value){enabled=value;rebuild()},setDOF(value){dofEnabled=value;rebuild()},setBloom(value){bloomEnabled=value;rebuild()},render(){camera.getWorldDirection(direction);focus.value=Math.max(.1,delta.copy(player.position).sub(camera.position).dot(direction));pipeline.render();},dispose(){pipeline.dispose();}};
}
