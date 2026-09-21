"""Constrained hue editing. No synthesis, spatial resampling, or mask expansion."""
import json,sys,pathlib,tempfile,subprocess,hashlib,math
import numpy as np
import cv2
from media_engine import probe,run,FFMPEG,validate_masks,mask_at,validate_visible_ranges

def paint(frame,mask,source,target):
 def hue(value):
  if not isinstance(value,str) or len(value)!=7 or value[0]!='#':raise ValueError('Choose a hex paint color')
  rgb=[int(value[i:i+2],16) for i in (1,3,5)]
  h=cv2.cvtColor(np.array([[rgb[::-1]]],np.uint8),cv2.COLOR_BGR2HSV)[0,0]
  if h[1]<60:raise ValueError('Precision hue editing needs a saturated color')
  return float(h[0])
 sh,th=hue(source),hue(target)
 hsv=cv2.cvtColor(frame,cv2.COLOR_BGR2HSV);h=hsv[:,:,0].astype(float)
 delta=(h-sh+90)%180-90
 # Leave neutral and dark details untouched, feather inward only.
 allowed=(mask!=0)&(np.abs(delta)<15)&(hsv[:,:,1]>=60)&(hsv[:,:,2]>=35)
 weight=np.clip((15-np.abs(delta))/5,0,1)*np.clip((hsv[:,:,1].astype(float)-60)/40,0,1)
 weight*=np.minimum(cv2.distanceTransform((mask!=0).astype(np.uint8),cv2.DIST_L2,5)/2,1)
 shift=(th-sh+90)%180-90
 changed=hsv.copy();changed[:,:,0]=np.rint((h+shift*weight)%180).astype(np.uint8)%180
 proposed=cv2.cvtColor(changed,cv2.COLOR_HSV2BGR)
 output=frame.copy();output[allowed]=proposed[allowed]
 return output,allowed

def recolor(q):
 if pathlib.Path(q['source']).resolve()==pathlib.Path(q['output']).resolve():raise ValueError('Output must differ from source')
 info=probe(q['source']);w,h=info['width'],info['height'];start,end=q['start'],q['end']
 if abs(info['fps']-30)>.01 or not 0<end-start<=10 or w*h>1920*1080:raise ValueError('Precision color supports a 30fps project, up to 1080p and 10 seconds per edit')
 masks=validate_masks(q['masks'],start,end,q.get('scope')=='frame')
 groups=validate_visible_ranges(q['visibleRanges'],q['masks'],start,end) if q.get('visibleRanges') else None
 # No interpolation across unknown frames for this precision contract.
 if groups is None and {round(t*30) for t,_ in masks}!=set(range(math.ceil(start*30-1e-7),math.ceil(end*30-1e-7))):raise ValueError('Track and review every selected frame before recoloring')
 first,last=math.ceil(start*30-1e-7),math.ceil(end*30-1e-7)
 expected=[];changed_pixels=0;count=0
 with tempfile.TemporaryDirectory(prefix='precision-color-') as temp:
  intermediate=str(pathlib.Path(temp)/'color.mkv')
  enc=subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','30','-i','pipe:0','-an','-c:v','ffv1',intermediate],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
  cap=cv2.VideoCapture(q['source']);index=0
  try:
   while True:
    ok,frame=cap.read()
    if not ok:break
    output=frame
    if first<=index<last:
     active=masks if groups is None else next((m for a,b,m in groups if a-1e-6<=index/30<b-1e-6),None)
     if active is not None:
      mask=mask_at(active,index/30,w,h);output,allowed=paint(frame,mask,q['recolor']['source'],q['recolor']['target'])
      if not np.array_equal(output[~allowed],frame[~allowed]):raise ValueError('Precision color escaped its allowed pixels')
      changed_pixels+=int(np.count_nonzero(np.any(output!=frame,axis=2)));count+=1
     print(f'Repair progress {index-first+1}/{last-first}',file=sys.stderr,flush=True)
    expected.append(hashlib.sha256(output.tobytes()).digest());enc.stdin.write(output.tobytes());index+=1
  finally:
   cap.release();enc.stdin.close();error=enc.stderr.read();enc.stderr.close();enc.wait()
  if enc.returncode:raise ValueError('Precision encoder failed')
  if not changed_pixels:raise ValueError('No matching paint pixels were found. Check the source color and selection.')
  run(['-i',intermediate,'-i',q['source'],'-map','0:v:0','-map','1:a?','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-row-mt','1','-threads','4','-c:a','copy','-t',str(info['duration']),'-f','matroska',q['output']])
  verify=cv2.VideoCapture(q['output']);i=0
  try:
   while True:
    ok,frame=verify.read()
    if not ok:break
    if i>=len(expected) or hashlib.sha256(frame.tobytes()).digest()!=expected[i]:raise ValueError('Precision lossless verification failed')
    i+=1
  finally:verify.release()
  if i!=len(expected):raise ValueError('Precision output frame count mismatch')
 return {'ok':True,'precisionVerification':{'pipeline':'precision-hue-v1','verifiedFrames':i,'editedFrames':count,'changedPixels':changed_pixels,'outsideAllowedPixels':'preserved','geometry':'no-spatial-resampling'},'note':'Original frames recolored without synthesis or spatial resampling. Decoded pixels outside the matching-color mask are identical; neutral and dark pixels are excluded. Mask accuracy and desired color appearance still require visual review. Original audio stream copied.'}
if __name__=='__main__':
 try:print(json.dumps(recolor(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')))))
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
