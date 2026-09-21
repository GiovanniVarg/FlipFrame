import {directLocalTool} from './local-tools.mjs';
export function selectionIntent(text,ready){
 if(typeof text!=='string')return undefined;
 if(/^\s*edit the entire scene:\s*\S/i.test(text))return 'picture';
 if(!ready)return undefined;
 if(directLocalTool(text))return undefined;
 // An explicit object command supplies intent; the confirmation still controls execution.
 if(/^\s*edit the selected object:\s*\S/i.test(text))return 'object';
 if(/\b(background|whole video|entire video|not|never|instead|don.t)\b/i.test(text))return undefined;
 if(/\b(mute|audio|sound|export|undo|play|pause|delete|discard|apply)\b/i.test(text))return undefined;
 if(/\b(transform(?:ation|ing)?|morph(?:ing)?)\b[\s\S]*\b(into|to)\b/i.test(text))return 'object';
 return /\b(change|replace|recolor|repaint|make|turn)\b.*\bselected\b/i.test(text)?'object':undefined;
}
