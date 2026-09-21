"""Automatic local silhouette repair. No provider calls or credentials."""
import json,sys,pathlib,tempfile,subprocess,hashlib,math
from repair_quality import frame_metrics,summarize
import numpy as np
import cv2
from segmentation import predictor,prompts
from media_engine import normalize,probe,run,FFMPEG,validate_masks,mask_at,validate_visible_ranges

def checked_union(authored,source,replacement):
 area=int(np.count_nonzero(authored))
 if area<8:raise ValueError('Selected mask is too small for automatic repair')
 for mask in (source,replacement):
  count=int(np.count_nonzero(mask));overlap=int(np.count_nonzero(mask & (authored>0)))
  if count<max(8,area*.2) or count>area*4 or overlap<min(count,area)*.15:
   raise ValueError('Automatic silhouette is uncertain. Correct the object outline and retry local preparation; no new generation is needed.')
 return ((authored>0)|source|replacement).astype(np.uint8)

def cleanup_region(a,b,region):
 # Include visibly changed fragments connected to the silhouette, within a bounded local band.
 yy,xx=np.nonzero(region)
 if not len(xx):return region
 initial=max(4,min(80,round((xx.max()-xx.min()+1)*.4)))
 delta=np.max(cv2.absdiff(a,b),axis=2)
 # Grow only when connected differences reach the search boundary. A fixed
 # narrow band clipped moving fabric and silently left its tip in the source.
 for radius in [initial,min(160,initial*2),min(200,initial*3)]:
  band=cv2.dilate(region,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(radius*2+1,radius*2+1)))
  changed=((delta>18)&(band!=0)).astype(np.uint8)
  changed=cv2.morphologyEx(changed,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
  joined=((changed!=0)|(region!=0)).astype(np.uint8)
  _,labels=cv2.connectedComponents(joined)
  touching=np.unique(labels[region!=0]);touching=touching[touching!=0]
  result=(np.isin(labels,touching)&(band!=0)).astype(np.uint8)
  if np.count_nonzero(result)>np.count_nonzero(region)*3:raise ValueError('The edit extends too far beyond your selection. Widen the outline to include the whole moving object, then retry the local preview. No new generation is needed.')
  boundary=band-cv2.erode(band,np.ones((3,3),np.uint8))
  if np.count_nonzero((result!=0)&(boundary!=0))<4:return result
 raise ValueError('Part of the moving object may be cut off. Widen the outline around its full movement, then retry the local preview. No new generation is needed.')

def solid_cleanup_core(region,radius):
 # Fill enclosed holes that would otherwise retain original fabric, then put
 # the feather outside a small opaque safety margin rather than over the hem.
 binary=(region!=0).astype(np.uint8)
 contours,_=cv2.findContours(binary,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 filled=np.zeros_like(binary);cv2.drawContours(filled,contours,-1,1,cv2.FILLED)
 margin=max(2,min(8,2*radius))
 return cv2.dilate(filled,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*margin+1,2*margin+1)))

def blend(a,b,region,radius):
 support=cv2.dilate(region,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*radius+1,2*radius+1)))
 alpha=np.minimum(cv2.distanceTransform(support,cv2.DIST_L2,5)/max(2,radius*.6),1)[...,None]
 return np.rint(a.astype(np.float32)*(1-alpha)+b.astype(np.float32)*alpha).astype(np.uint8),support

def protected_mask(areas,width,height):
 if not isinstance(areas,list) or len(areas)>20:raise ValueError('Invalid protected areas')
 result=np.zeros((height,width),np.uint8)
 for polygon in areas:
  if not isinstance(polygon,list) or not 3<=len(polygon)<=64:raise ValueError('Invalid protected polygon')
  if any(not isinstance(p,list) or len(p)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in p) for p in polygon):raise ValueError('Invalid protected coordinates')
  if abs(cv2.contourArea(np.array(polygon,np.float32)))<.00001:raise ValueError('Draw a protected area with a visible interior, not a line')
  points=np.rint(np.array(polygon)*[width-1,height-1]).astype(np.int32)
  cv2.fillPoly(result,[points],1)
 return result

def check_protection(support,protected,index):
 if np.any((support!=0)&(protected!=0)):
  raise ValueError(f'Cleanup reaches a protected area at {index/30:.2f}s. Adjust the object outline or keep-unchanged area, then repair again. No new generation is needed.')

def verify_encoded_frames(path,expected):
 cap=cv2.VideoCapture(str(path));index=0
 try:
  while True:
   ok,frame=cap.read()
   if not ok:break
   if index>=len(expected) or hashlib.sha256(frame.tobytes()).digest()!=expected[index]:
    raise ValueError('Lossless preservation verification failed; candidate was not accepted')
   index+=1
 finally:cap.release()
 if index!=len(expected):raise ValueError('Lossless preservation verification failed: frame count mismatch')
 return index

def repair(q):
 import torch
 start,end=float(q['start']),float(q['end'])
 if not 0<end-start<=10:raise ValueError('Automatic silhouette repair supports up to 10 seconds per range')
 masks=validate_masks(q['masks'],start,end,q.get('scope')=='frame')
 info=probe(q['source']);width,height=info['width'],info['height']
 if width*height>1920*1080:raise ValueError('Automatic repair currently supports up to 1080p')
 protected=protected_mask(q.get('protectedAreas',[]),width,height)
 groups=validate_visible_ranges(q['visibleRanges'],q['masks'],start,end) if q.get('visibleRanges') is not None else None
 cinfo=probe(q['candidate']);offset=0
 if abs(cinfo['duration']-(end-start))>1/30+.001:
  if abs(cinfo['duration']-info['duration'])<=1/30+.001:offset=start
  else:raise ValueError('Replacement duration must match the range or full source')
 model=predictor();first=math.ceil(start*30-1e-7);last=first+1 if q.get('scope')=='frame' else math.ceil(end*30-1e-7)
 with tempfile.TemporaryDirectory(prefix='silhouette-repair-') as folder:
  folder=pathlib.Path(folder);normal=pathlib.Path(q['source']);replacement=folder/'replacement.mkv'
  if abs(info['fps']-30)>.01:raise ValueError('Exact-preservation object editing requires the imported 30 fps project revision')
  run(['-ss',offset,'-i',q['candidate'],'-an','-vf',f'fps=30,scale={width}:{height},setsar=1','-c:v','ffv1','-pix_fmt','bgr0',str(replacement)])
  a=cv2.VideoCapture(str(normal));b=cv2.VideoCapture(str(replacement))
  encoders=[]
  for name in ['result','coverage']:
   encoders.append(subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{width}x{height}','-r','30','-i','pipe:0','-an','-c:v','ffv1',str(folder/(name+'.mkv'))],stdin=subprocess.PIPE,stderr=subprocess.PIPE))
  index=0;processed=0;expected=[];quality_rows=[]
  try:
   with torch.inference_mode():
    while True:
     ok,frame=a.read()
     if not ok:break
     out=frame;overlay=frame.copy()
     if first<=index<last:
      ok,candidate=b.read()
      if not ok:raise ValueError('Replacement is shorter than the selected range')
      active=masks if groups is None else next((m for x,y,m in groups if x-1e-6<=index/30<y-1e-6),None)
      if active is not None:
       authored=mask_at(active,index/30,width,height)
       yy,xx=np.nonzero(authored);box=np.array([xx.min(),yy.min(),xx.max(),yy.max()],np.float32)
       # Use the selected interior as the prompt; never label a guessed missing region positive.
       distance=cv2.distanceTransform(authored,cv2.DIST_L2,5);y,x=np.unravel_index(distance.argmax(),distance.shape)
       refined=[]
       for image in [frame,candidate]:
        model.set_image(cv2.cvtColor(image,cv2.COLOR_BGR2RGB))
        padding=max(4,min(24,(box[2]-box[0])*.12))
        expanded=np.clip(box+[-padding,-padding,padding,padding],[0,0,0,0],[width-1,height-1,width-1,height-1])
        predictions,scores,_=model.predict(point_coords=np.array([[x,y]],np.float32),point_labels=np.array([1]),box=expanded,multimask_output=True)
        refined.append(predictions[int(np.argmax(scores))].astype(bool))
       region=cleanup_region(frame,candidate,checked_union(authored,*refined))
       radius=max(2,min(10,round((box[2]-box[0])*.035)))
       region=solid_cleanup_core(region,radius)
       out,support=blend(frame,candidate,region,radius)
       check_protection(support,protected,index)
       quality_rows.append(frame_metrics(index,authored,support))
       overlay[support!=0]=(overlay[support!=0]*.6+np.array([35,200,120])*.4).astype(np.uint8)
       processed+=1
       if processed%30==0:print(f'Repaired {processed} frames',file=sys.stderr,flush=True)
     expected.append(hashlib.sha256(out.tobytes()).digest());encoders[0].stdin.write(out.tobytes());encoders[1].stdin.write(overlay.tobytes());index+=1
  finally:
   a.release();b.release()
   for encoder in encoders:
    encoder.stdin.close();error=encoder.stderr.read();encoder.stderr.close();encoder.wait()
    if encoder.returncode:raise ValueError('Local repair encoder failed')
  if processed==0:raise ValueError('No reviewed visible frames to repair')
  for name,target in [('result',q['output']),('coverage',q['reviewOutput'])]:
   run(['-i',str(folder/(name+'.mkv')),'-i',q['source'],'-map','0:v:0','-map','1:a?','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-row-mt','1','-threads','4','-c:a','libopus','-b:a','192k','-t',str(info['duration']),'-f','webm',target])
  verified=verify_encoded_frames(q['output'],expected)
 return {'qualityDiagnostics':summarize(quality_rows,width,height),'ok':True,'verifiedFrames':verified,'framesRepaired':processed,'note':'Lossless WebM: decoded pixels outside the green repair coverage are preserved. Automatic silhouette repair expands the reviewed object region to include the detected replacement, nearby connected differences, filled interior gaps, an opaque cleanup margin and a blended outer edge; nearby background can change. Review the green coverage video and compare playback before applying. Clothing, fine hair, identity and occlusion are not guaranteed; source audio is retained.'}
if __name__=='__main__':
 try:print(json.dumps(repair(json.loads(pathlib.Path(sys.argv[1]).read_text()))))
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
