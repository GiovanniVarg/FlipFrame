export function repairProgress(line){
 const match=/^(?:Repair|Transformation) progress (\d+)\/(\d+)$/.exec(line.trim());
 if(!match)return null;
 const transformation=line.trim().startsWith('Transformation');
 const done=Number(match[1]),total=Number(match[2]);
 if(total<1||total>300||done<0||done>total)return null;
 if(transformation)return done===total?`Transformation frames processed (${done}/${total}). Encoding and verifying output…`:`Compositing frame ${done} of ${total}…`;
 return done===total?`Object frames processed (${done}/${total}). Encoding and verifying unchanged pixels…`:`Repairing object frame ${done} of ${total}…`;
}
