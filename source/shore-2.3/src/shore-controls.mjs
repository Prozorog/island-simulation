const byId=id=>document.getElementById(id);
export function bindShoreControls(shore){
 const sim=shore.sim;
 const scalars={waveHeight:sim.waveHeight,wavePeriod:sim.wavePeriod,freshLife:sim.foamField.freshLife,residualLife:sim.foamField.residualLife,residualCoverage:sim.foamField.residualCoverage,foamStrength:sim.foamField.strength,chartLife:sim.foamField.chartLife,wind:sim.microSpectrum.wind,microStrength:sim.microSpectrum.strength,causticStrength:shore.causticStrength,rippleStrength:sim.localRipples.strength,rippleDamping:sim.localRipples.damping,focalLength:shore.post.focalLength,bokeh:shore.post.bokeh,bloomStrength:shore.post.bloomStrength};
 for(const [id,node] of Object.entries(scalars)){const input=byId(id);input.value=node.value;input.oninput=()=>{node.value=Number(input.value);byId(id+'Value').textContent=String(node.value);};byId(id+'Value').textContent=String(node.value);}
 for(const group of ['absorption','inscatter'])for(const component of ['x','y','z']){const id=group+component,input=byId(id);input.value=shore[group].value[component];input.oninput=()=>{shore[group].value[component]=Number(input.value);byId(id+'Value').textContent=input.value;};byId(id+'Value').textContent=input.value;}
 const original=shore.water.material.colorNode;byId('debugView').onchange=e=>{shore.water.material.colorNode=shore.water.material.userData.shoreDebug[e.target.value]||original;shore.water.material.needsUpdate=true;};
 byId('postEnabled').checked=shore.post.enabled;byId('postEnabled').onchange=e=>shore.post.setEnabled(e.target.checked);byId('dofEnabled').onchange=e=>shore.post.setDOF(e.target.checked);byId('bloomEnabled').onchange=e=>shore.post.setBloom(e.target.checked);
 byId('extraMSAA').checked=typeof location!=='undefined'&&new URLSearchParams(location.search).get('msaa')==='4';byId('extraMSAA').onchange=e=>{const url=new URL(location.href);if(e.target.checked)url.searchParams.set('msaa','4');else url.searchParams.delete('msaa');location.href=url.href;};
 byId('candidateQuality').onchange=e=>{const url=new URL(location.href);url.searchParams.set('preset',e.target.value);location.href=url.href;};
}
