// One registry feeds Jev, plans and command discovery. Executors accept these IDs only.
export const LOCAL_TOOLS=Object.freeze({
 blur:{title:'Blur selected object',command:'blur selected object',mask:true,criterion:'Blur an identified object or region. Preserve pixels outside its tracked mask.',preserves:'Pixels outside the reviewed mask; original frame positions and audio.'},
 pixelate:{title:'Pixelate selected object',command:'pixelate selected object',mask:true,criterion:'Pixelate or mosaic an identified object or region, without generation.',preserves:'Pixels outside the reviewed mask; original frame positions and audio.'},
 exposure:{title:'Adjust selected exposure',command:'exposure +1 stops',mask:true,criterion:'Adjust brightness or exposure of a selected region with an explicit number of stops.',preserves:'Pixels outside the reviewed mask; geometry, motion and audio.'},
 contrast:{title:'Adjust selected contrast',command:'contrast 1.2x',mask:true,criterion:'Adjust contrast of a selected region with an explicit numeric multiplier.',preserves:'Pixels outside the reviewed mask; geometry, motion and audio.'},
 title:{title:'Add supplied text',command:'add text "Your title"',criterion:'Render explicitly supplied quoted title or caption text. Do not transcribe, translate or invent words.',preserves:'Pixels outside the text overlay and interval; original motion and audio.'},
 logo:{title:'Place reference image',command:'add logo',reference:true,criterion:'Place an attached reference image as a static overlay. Do not invent a logo.',preserves:'Pixels outside the overlay and interval; original motion and audio.'},
 planar:{title:'Replace a tracked screen',command:'replace screen',mask:true,reference:true,corners:true,criterion:'Map an attached image onto a tracked flat screen or label using four ordered corners. Not a freeform 3D object replacement.',preserves:'Pixels outside the reviewed quadrilateral and interval; source audio.'},
 trim:{title:'Keep selected range',command:'trim selected range',timeline:true,criterion:'Trim the video to retain only the selected time range. Changes total duration.',preserves:'Decoded retained frames; audio is cut to the same interval.'},
 cut:{title:'Remove selected range',command:'cut selected range',timeline:true,criterion:'Remove a selected time interval and join remaining footage. Changes duration.',preserves:'Decoded remaining frames; audio is cut to match.'},
 move_start:{title:'Move range to beginning',command:'move selected range to start',timeline:true,criterion:'Reorder footage by moving the selected interval to the beginning.',preserves:'Decoded frames; audio reordered with video.'},
 move_end:{title:'Move range to end',command:'move selected range to end',timeline:true,criterion:'Reorder footage by moving the selected interval to the end.',preserves:'Decoded frames; audio reordered with video.'},
 speed:{title:'Change selected speed',command:'speed 2x',timeline:true,criterion:'Change the selected interval playback speed using an explicit multiplier. Uses frame repetition or dropping, never generated intermediate frames.',preserves:'Existing frame contents; timing and audio are adjusted.'},
 freeze:{title:'Freeze selected picture',command:'freeze selected range',criterion:'Repeat the first selected video frame throughout the selected interval without changing duration or audio.',preserves:'Frames outside the interval; original audio.'},
 split:{title:'Split at selection start',command:'split at selection start',criterion:'Store a clip boundary at the selection start. No pixels, audio or duration change.',preserves:'All video and audio; adds a saved boundary.'},
 crop:{title:'Center crop video',command:'crop 9:16',whole:true,criterion:'Center crop the entire video to an explicitly stated aspect ratio. Do not infer tracking or subject-aware reframing.',preserves:'Pixels retained inside the crop; audio. Framing changes across the whole video.'},
 resize:{title:'Resize video',command:'resize 1280x720',whole:true,criterion:'Resize the entire video to explicit pixel dimensions, letterboxing to preserve aspect ratio.',preserves:'Audio and timing. Video pixels are resampled as explicitly requested.'},
 fade_in:{title:'Fade audio in',command:'fade audio in',criterion:'Fade existing audio from silence to original volume over the selected interval. No generated audio.',preserves:'Video stream copied unchanged; audio re-encoded.'},
 fade_out:{title:'Fade audio out',command:'fade audio out',criterion:'Fade existing audio from original volume to silence over the selected interval.',preserves:'Video stream copied unchanged; audio re-encoded.'}
});
export function directLocalTool(text){
 const s=text.trim().toLowerCase().replace(/[.!]$/,'');
 if(/[;\n]|\b(?:not|never|don.t|instead|or|then|also)\b/.test(s))return null;
 for(const [id,t] of Object.entries(LOCAL_TOOLS))if(s===t.command)return id;
 if(/^blur (?:the )?(?:selected )?(?:object|region)$/.test(s))return 'blur';
 if(/^pixelate (?:the )?(?:selected )?(?:object|region)$/.test(s))return 'pixelate';
 if(/^exposure [+-]?\d+(?:\.\d+)? stops?$/.test(s))return 'exposure';
 if(/^contrast \d+(?:\.\d+)?x$/.test(s))return 'contrast';
 if(/^speed \d+(?:\.\d+)?x$/.test(s))return 'speed';
 if(/^crop \d+:\d+$/.test(s))return 'crop';
 if(/^resize \d+x\d+$/.test(s))return 'resize';
 if(/^add (?:text|caption) "[^"\n]{1,200}"$/.test(text.trim()))return 'title';
 return null;
}
export function localParameters(id,text){
 if(!LOCAL_TOOLS[id])throw Error('Unknown local tool');
 const number=(pattern,min,max,label)=>{const m=text.match(pattern),n=m?Number(m[1]):NaN;if(!Number.isFinite(n)||n<min||n>max)throw Error(`Specify ${label} between ${min} and ${max}.`);return n;};
 if(id==='exposure')return {amount:number(/(?:exposure\s*|by\s*)([+-]?\d+(?:\.\d+)?)\s*stops?/i,-4,4,'exposure in stops')};
 if(id==='contrast'||id==='speed')return {amount:number(new RegExp('(?:'+id+'\\s*|to\\s*)(\\d+(?:\\.\\d+)?)x','i'),id==='speed'?.25:0,id==='speed'?4:3,'multiplier')};
 if(id==='title'){const m=text.match(/"([^"\n]{1,200})"/);if(!m)throw Error('Put the exact title or caption in double quotes.');return {text:m[1]};}
 if(id==='crop'){const m=text.match(/\b(\d+):(\d+)\b/);if(!m||Number(m[1])/Number(m[2])<.25||Number(m[1])/Number(m[2])>4)throw Error('Specify a crop ratio between 1:4 and 4:1, such as crop 9:16.');return {ratio:Number(m[1])/Number(m[2])};}
 if(id==='resize'){const m=text.match(/\b(\d+)x(\d+)\b/i);if(!m||m.slice(1).some(v=>Number(v)<64||Number(v)>1920)||Number(m[1])*Number(m[2])>1920*1080)throw Error('Specify output dimensions up to 1080p, such as resize 1280x720.');return {width:Number(m[1]),height:Number(m[2])};}
 return {};
}
