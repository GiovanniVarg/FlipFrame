export const OBJECT_REPAIR_PHASE='Cleaning moving edges and checking untouched pixels';
export function verifiedObjectRepair(result){
 if(result?.ok!==true||!Number.isInteger(result.verifiedFrames)||result.verifiedFrames<1||!Number.isInteger(result.framesRepaired)||result.framesRepaired<1||result.framesRepaired>result.verifiedFrames)throw new Error('Object preview did not pass its pixel-preservation check. Retry local preparation; no new generation is needed.');
 const diagnostics=result.qualityDiagnostics;
 const valid=diagnostics?.version===1&&Number.isInteger(diagnostics.flaggedFrames)&&diagnostics.flaggedFrames>=0&&diagnostics.flaggedFrames<=result.framesRepaired&&Array.isArray(diagnostics.warnings)&&diagnostics.warnings.length<=30&&diagnostics.warnings.every(w=>Number.isFinite(w.seconds)&&w.seconds>=0&&Number.isInteger(w.frame)&&w.frame>=0&&Array.isArray(w.reasons)&&w.reasons.every(r=>['missing-selection','wide-cleanup','area-change','position-jump'].includes(r)));
 if(diagnostics!==undefined&&!valid)throw new Error('Object review diagnostics are invalid. Retry local preparation; no new generation is needed.');
 const qualityDiagnostics=valid?diagnostics:undefined;
 return {...(qualityDiagnostics?{qualityDiagnostics}:{}),pipeline:'adaptive-object-repair-v1',verifiedFrames:result.verifiedFrames,editedFrames:result.framesRepaired,outsideCoverage:'preserved',requiresVisualReview:true};
}
