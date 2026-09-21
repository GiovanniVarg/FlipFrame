export function transformationRequest(description,mode='aligned') {
 const text=String(description||'').trim();
 if(!text||text.length>1800)throw Error('Describe the replacement in 1–1800 characters.');
 if(mode==='scene')return `Edit the entire scene: ${text}\n\nCamera movement, environment and objects may change inside the selected interval. Keep the clip temporally coherent. Review the whole scene and both cut boundaries before applying.`;
 return `Edit the selected object: ${text}\n\nPreserve the source camera position, lens, framing and camera movement. Keep the same scene, background, lighting and timing. Only the selected object changes shape or movement. No cuts, zooms, pans or replacement scenery. Reconstruct only background revealed by the object. This request requires visual review; camera consistency is not guaranteed.`;
}
