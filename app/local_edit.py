"""Deterministic editor. Arguments come from validated plans, never model code."""
import json,sys,pathlib,tempfile,subprocess,hashlib,math
import cv2,numpy as np
from media_engine import probe,run,FFMPEG,validate_masks,mask_at,validate_visible_ranges

PIXEL_TOOLS={'blur','pixelate','exposure','contrast','title','logo','planar','freeze','crop','resize'}
MASK_TOOLS={'blur','pixelate','exposure','contrast','planar'}
TIMELINE_TOOLS={'trim','cut','move_start','move_end','speed'}

def mapping(tool,n,first,last,params):
 before=list(range(first));selected=list(range(first,last));after=list(range(last,n))
 if tool=='trim':return selected,[(first,last,1)]
 if tool=='cut':return before+after,[(0,first,1),(last,n,1)]
 if tool=='move_start':return selected+before+after,[(first,last,1),(0,first,1),(last,n,1)]
 if tool=='move_end':return before+after+selected,[(0,first,1),(last,n,1),(first,last,1)]
 if tool=='speed':
  rate=float(params['amount'])
  if not .25<=rate<=4:raise ValueError('Speed must be 0.25x to 4x')
  count=max(1,round(len(selected)/rate))
  return before+[min(last-1,first+int(i*rate)) for i in range(count)]+after,[(0,first,1),(first,last,rate),(last,n,1)]
 if tool=='freeze':return before+[first]*len(selected)+after,None
 return list(range(n)),None

def rectangle(mask):
 y,x=np.nonzero(mask)
 if not len(x):raise ValueError('Empty selection')
 return x.min(),y.min(),x.max()+1,y.max()+1

def transform(frame,mask,tool,params):
 out=frame.copy();allowed=mask!=0
 if tool=='blur':modified=cv2.GaussianBlur(frame,(31,31),0)
 elif tool=='pixelate':
  x,y,r,b=rectangle(mask);roi=frame[y:b,x:r];small=cv2.resize(roi,(max(1,(r-x)//16),max(1,(b-y)//16)),interpolation=cv2.INTER_AREA)
  modified=frame.copy();modified[y:b,x:r]=cv2.resize(small,(r-x,b-y),interpolation=cv2.INTER_NEAREST)
 elif tool=='exposure':
  amount=float(params['amount'])
  if not -4<=amount<=4:raise ValueError('Invalid exposure')
  modified=np.rint(np.clip(frame.astype(float)*2**amount,0,255)).astype(np.uint8)
 elif tool=='contrast':
  amount=float(params['amount'])
  if not 0<=amount<=3:raise ValueError('Invalid contrast')
  modified=np.rint(np.clip((frame.astype(float)-127.5)*amount+127.5,0,255)).astype(np.uint8)
 else:raise ValueError('Unknown masked filter')
 out[allowed]=modified[allowed];return out,allowed

def overlay_asset(q,w,h):
 from PIL import Image,ImageDraw,ImageFont
 tool=q['tool'];params=q['params']
 if tool=='title':
  text=params.get('text','')
  if not isinstance(text,str) or not 1<=len(text)<=200:raise ValueError('Supply up to 200 characters of text')
  layer=Image.new('RGBA',(w,h));draw=ImageDraw.Draw(layer)
  font_path=next((p for p in ['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'] if pathlib.Path(p).exists()),None)
  if not font_path:raise ValueError('Install a supported font to render titles')
  size=max(12,round(h*.055));font=ImageFont.truetype(font_path,size)
  while draw.textbbox((0,0),text,font=font)[2]>w*.9 and size>8:size-=1;font=ImageFont.truetype(font_path,size)
  draw.text((w/2,h*.86),text,font=font,anchor='mm',fill='white',stroke_width=max(1,size//18),stroke_fill='black')
  return np.array(layer)
 with Image.open(q['reference']) as raw:
  if raw.width*raw.height>16000000:raise ValueError('Reference is too large')
  image=raw.convert('RGBA');image.load()
 if tool=='planar':return np.array(image)
 image.thumbnail((max(1,w//4),max(1,h//4)))
 layer=Image.new('RGBA',(w,h));layer.alpha_composite(image,(w-image.width-max(4,w//40),max(4,h//40)))
 return np.array(layer)

def composite(frame,layer,allowed=None):
 alpha=layer[:,:,3].astype(float)/255
 if allowed is not None:alpha*=allowed
 active=alpha>0;out=frame.copy();rgb=layer[:,:,:3][:,:,::-1]
 out[active]=np.rint(frame[active]*(1-alpha[active,None])+rgb[active]*alpha[active,None]).astype(np.uint8)
 return out,active

def planar(frame,image,points):
 h,w=frame.shape[:2];quad=np.asarray(points,np.float32)*[w-1,h-1]
 if quad.shape!=(4,2) or not cv2.isContourConvex(quad.astype(np.float32)) or abs(cv2.contourArea(quad.astype(np.float32)))<16:raise ValueError('Screen replacement requires four convex corners in consistent order: top-left, top-right, bottom-right, bottom-left')
 ih,iw=image.shape[:2]
 matrix=cv2.getPerspectiveTransform(np.array([[0,0],[iw-1,0],[iw-1,ih-1],[0,ih-1]],np.float32),quad.astype(np.float32))
 layer=cv2.warpPerspective(image,matrix,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
 mask=np.zeros((h,w),np.uint8);cv2.fillConvexPoly(mask,np.rint(quad).astype(np.int32),1)
 return composite(frame,layer,mask)

def audio_graph(parts):
 graph=[];labels=[]
 for a,b,speed in parts:
  if b<=a:continue
  label=f'a{len(labels)}';chain=f'[1:a]atrim=start={a/30}:end={b/30},asetpts=PTS-STARTPTS'
  if speed!=1:
   rates=[]
   while speed>2:rates.append(2);speed/=2
   while speed<.5:rates.append(.5);speed/=.5
   rates.append(speed);chain+=','+','.join(f'atempo={r}' for r in rates)
  graph.append(chain+f'[{label}]');labels.append(f'[{label}]')
 return ';'.join(graph+[''.join(labels)+f'concat=n={len(labels)}:v=0:a=1[a]'])

def edit(q):
 source,output=q['source'],q['output'];tool=q['tool'];params=q.get('params',{})
 if tool not in PIXEL_TOOLS|TIMELINE_TOOLS|{'fade_in','fade_out','split'}:raise ValueError('Unsupported deterministic tool')
 if pathlib.Path(source).resolve()==pathlib.Path(output).resolve():raise ValueError('Output must differ from source')
 info=probe(source);w,h=info['width'],info['height'];start,end=q['start'],q['end']
 if abs(info['fps']-30)>.01 or not 0<=start<end<=info['duration']+.001 or w*h>1920*1080:raise ValueError('Use a valid range in a 30fps project up to 1080p')
 n=info['frames'];first,last=math.ceil(start*30-1e-7),min(n,math.ceil(end*30-1e-7))
 if tool in {'fade_in','fade_out','split'}:
  args=['-i',source,'-map','0:v:0','-map','0:a?','-c:v','copy']
  if tool=='split':args+=['-c:a','copy']
  else:
   if not info['hasAudio']:raise ValueError('This video has no audio to fade')
   # Piecewise volume affects this interval only, unlike afade which mutes outside it.
   gain=f'(t-{start})/{end-start}' if tool=='fade_in' else f'({end}-t)/{end-start}'
   args+=['-af',f"volume='if(between(t,{start},{end}),{gain},1)':eval=frame",'-c:a','pcm_s16le']
  run(args+['-f','matroska',output])
  return {'ok':True,'mediaMetadata':{**info,'splitTimes':sorted(set(q.get('splitTimes',[])+([first/30] if tool=='split' and 0<first<n else [])))},'localVerification':{'tool':tool,'videoStreamCopied':True},'note':'Video stream copied unchanged. '+('Audio stream copied; saved split boundary added.' if tool=='split' else 'Audio faded inside the selected interval and encoded as PCM. Audio frame boundaries may differ by a few milliseconds.')}
 indices,parts=mapping(tool,n,first,last,params)
 if not indices or len(indices)>1800:raise ValueError('Result must contain 1 to 1800 frames (up to 60 seconds)')
 ow,oh=w,h
 if tool in {'crop','resize'} and (first!=0 or last!=n):raise ValueError('Crop and resize require the whole video')
 if tool=='crop':
  ratio=float(params['ratio'])
  if not .25<=ratio<=4:raise ValueError('Invalid crop ratio')
  ow=min(w,round(h*ratio));oh=min(h,round(w/ratio))
 if tool=='resize':
  ow,oh=int(params['width']),int(params['height'])
  if min(ow,oh)<64 or max(ow,oh)>1920 or ow*oh>1920*1080:raise ValueError('Invalid output dimensions')
 masks=groups=None
 if tool in MASK_TOOLS:
  if end-start>10:raise ValueError('Select up to 10 seconds for a tracked edit')
  if q.get('visibleRanges'):groups=validate_visible_ranges(q['visibleRanges'],q['masks'],start,end)
  else:
   masks=validate_masks(q['masks'],start,end,q.get('scope')=='frame')
   if {round(t*30) for t,_ in masks}!=set(range(first,last)):raise ValueError('Every selected frame requires a reviewed mask')
 asset=overlay_asset(q,w,h) if tool in {'title','logo','planar'} else None
 expected=[];changed=0
 with tempfile.TemporaryDirectory(prefix='deterministic-edit-') as temp:
  raw=str(pathlib.Path(temp)/'frames.mkv');enc=subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{ow}x{oh}','-r','30','-i','pipe:0','-an','-c:v','ffv1',raw],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
  cap=cv2.VideoCapture(source);next_index=0
  try:
   for dest,idx in enumerate(indices):
    if idx!=next_index:cap.set(cv2.CAP_PROP_POS_FRAMES,idx)
    ok,frame=cap.read();next_index=idx+1
    if not ok:raise ValueError('Source frame unavailable')
    out=frame;allowed=np.zeros((h,w),bool)
    if tool=='crop':out=frame[(h-oh)//2:(h-oh)//2+oh,(w-ow)//2:(w-ow)//2+ow].copy()
    elif tool=='resize':
     scale=min(ow/w,oh/h);rw,rh=max(1,round(w*scale)),max(1,round(h*scale));out=np.zeros((oh,ow,3),np.uint8);out[(oh-rh)//2:(oh-rh)//2+rh,(ow-rw)//2:(ow-rw)//2+rw]=cv2.resize(frame,(rw,rh),interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_CUBIC)
    elif first<=idx<last and tool in MASK_TOOLS:
     active=masks if groups is None else next((m for a,b,m in groups if a-1e-6<=idx/30<b-1e-6),None)
     if active is not None:
      if tool=='planar':out,allowed=planar(frame,asset,next(points for t,points in active if abs(t-idx/30)<1e-5))
      else:out,allowed=transform(frame,mask_at(active,idx/30,w,h),tool,params)
    elif first<=idx<last and tool in {'title','logo'}:out,allowed=composite(frame,asset)
    if tool in MASK_TOOLS|{'title','logo'}:
     if not np.array_equal(out[~allowed],frame[~allowed]):raise ValueError('Pixel edit exceeded its allowed region')
     changed+=int(np.count_nonzero(np.any(out!=frame,axis=2)))
    expected.append(hashlib.sha256(out.tobytes()).digest());enc.stdin.write(out.tobytes())
  finally:
   cap.release();enc.stdin.close();error=enc.stderr.read();enc.stderr.close();enc.wait()
  if enc.returncode:raise ValueError('Deterministic encoder failed')
  args=['-i',raw,'-i',source]
  if parts and info['hasAudio']:args+=['-filter_complex',audio_graph(parts),'-map','0:v:0','-map','[a]','-c:a','pcm_s16le']
  else:args+=['-map','0:v:0','-map','1:a?','-c:a','copy']
  run(args+['-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-row-mt','1','-threads','4','-t',str(len(indices)/30),'-f','matroska',output])
  cap=cv2.VideoCapture(output);i=0
  try:
   while True:
    ok,frame=cap.read()
    if not ok:break
    if i>=len(expected) or hashlib.sha256(frame.tobytes()).digest()!=expected[i]:raise ValueError('Encoded pixels failed exact verification')
    i+=1
  finally:cap.release()
  if i!=len(expected):raise ValueError('Encoded frame count mismatch')
 return {'ok':True,'sourceFrames':indices if tool in TIMELINE_TOOLS|{'freeze'} else None,'mediaMetadata':{'duration':len(indices)/30,'width':ow,'height':oh,'fps':30,'frames':len(indices),'splitTimes':[] if tool in TIMELINE_TOOLS else q.get('splitTimes',[])},'localVerification':{'tool':tool,'verifiedFrames':len(indices),'outsideAllowedPixels':'preserved' if tool in MASK_TOOLS|{'title','logo'} else 'not-applicable','changedPixels':changed},'note':'Deterministic edit with lossless decoded-frame verification. '+('Original audio copied.' if not parts else 'Audio cut/reordered/retimed with the video and re-encoded. Speed uses existing frames, with no synthesis.')}
if __name__=='__main__':
 try:print(json.dumps(edit(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')))))
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
