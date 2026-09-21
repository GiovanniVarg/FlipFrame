export type CandidateEvidence={note?:string,referenceImage?:{id:string,url:string,name:string},repairVerification?:{pipeline:string,verifiedFrames:number,editedFrames:number,outsideCoverage:string,qualityDiagnostics?:{flaggedFrames:number,warnings:{seconds:number}[]}}};
export function qualityChecks(candidate?:CandidateEvidence):{id:string,title:string,status:'verified'|'review',detail:string}[];
