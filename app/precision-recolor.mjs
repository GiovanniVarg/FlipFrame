export const PAINT_COLORS={yellow:'#ffd000',blue:'#0047ab','cobalt blue':'#0047ab',red:'#dc2626',green:'#16a34a',purple:'#9333ea',orange:'#f97316',pink:'#ec4899',cyan:'#06b6d4'};
export function precisionRecolor(text){
 if(typeof text==='string'&&/\b(remove|replace|reshape|resize|add|material|texture|pattern)\b/i.test(text))return null;
 if(typeof text!=='string'||! /\b(recolor|repaint|paint|colou?r)\b/i.test(text))return null;
 const names=Object.keys(PAINT_COLORS).sort((a,b)=>b.length-a.length).join('|');
 const found=[...text.toLowerCase().matchAll(new RegExp('\\b('+names+')\\b','g'))];
 if(found.length!==2||found[0][1]===found[1][1])return null;
 // Two named colors in order are explicit, reviewable parameters, never model guesses.
 return {source:PAINT_COLORS[found[0][1]],target:PAINT_COLORS[found[1][1]],sourceName:found[0][1],targetName:found[1][1]};
}
