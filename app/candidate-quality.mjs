export function qualityChecks(candidate={}){
 const proof=candidate.repairVerification;
 const verified=proof?.pipeline==='adaptive-object-repair-v1'&&proof.outsideCoverage==='preserved'&&Number.isInteger(proof.verifiedFrames)&&proof.verifiedFrames>0&&Number.isInteger(proof.editedFrames)&&proof.editedFrames>0&&proof.editedFrames<=proof.verifiedFrames;
 return [{id:'preservation',title:'Unchanged surroundings',status:verified?'verified':'review',detail:verified?`${proof.verifiedFrames} decoded frames checked. Pixels outside the green cleanup coverage are preserved; cleanup may extend beyond your drawn outline.`:'No automatic pixel-preservation proof is available for this candidate. Compare it with the current revision.'},
 ...(proof?.qualityDiagnostics?.flaggedFrames>0?[{id:'tracking-flags',title:'Automatic tracking needs a closer look',status:'review',detail:`${proof.qualityDiagnostics.flaggedFrames} frames flagged for large cleanup or abrupt selection changes. Check near ${(proof.qualityDiagnostics.warnings||[]).slice(0,5).map(w=>Number(w.seconds).toFixed(2)+'s').join(', ')}. These are heuristic warnings, not a measured accuracy score.`}]:[]),
 {id:'motion',title:'Edges and motion',status:'review',detail:'Play the full range. Look for leftover parts, flicker, disappearing details, and changes when objects overlap.'},
 ...(candidate.referenceImage?[{id:'reference',title:'Reference likeness',status:'review',detail:'Compare shape, color, texture, and identifying details with the supplied image. Reference likeness is not automatically verified.'}]:[])];
}
