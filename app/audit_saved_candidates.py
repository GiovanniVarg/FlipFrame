"""Read-only audit of retained media. No network, credentials, or generation.
Metrics measure decoded frame differences; they do not establish semantic accuracy.
"""
import json,sys,hashlib
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'outputs'/'submission-rehearsal'
def media(url):
 if not isinstance(url,str) or not url.startswith('/media/'):raise ValueError('Expected local media URL')
 root=(ROOT/'data'/'media').resolve();p=(root/url.removeprefix('/media/')).resolve()
 if p.parent!=root or not p.is_file():raise ValueError('Media outside local store or missing')
 return p
def audit(case):
 a_path,b_path=media(case['source']),media(case['candidate'])
 a,b=cv2.VideoCapture(str(a_path)),cv2.VideoCapture(str(b_path))
 if not a.isOpened() or not b.isOpened():raise ValueError('Cannot decode media')
 afps,bfps=a.get(cv2.CAP_PROP_FPS),b.get(cv2.CAP_PROP_FPS)
 acount,bcount=int(a.get(cv2.CAP_PROP_FRAME_COUNT)),int(b.get(cv2.CAP_PROP_FRAME_COUNT))
 sample=set(np.linspace(0,max(0,acount-1),6,dtype=int).tolist());rows=[];fractions=[];i=0;shape=None
 try:
  while True:
   oka,x=a.read();okb,y=b.read()
   if not oka and not okb:break
   if oka!=okb:raise ValueError('Decoded frame counts differ')
   if x.shape!=y.shape:raise ValueError('Source and candidate dimensions differ')
   shape=x.shape;changed=np.any(x!=y,axis=2);fractions.append(float(changed.mean()))
   if i in sample:
    row=Image.new('RGB',(960,300),(17,25,21));draw=ImageDraw.Draw(row);draw.text((8,5),f"{i/afps:.2f}s / frame {i}    Original (left) | Candidate (right)",fill='white')
    for j,frame in enumerate((x,y)):
     im=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));im.thumbnail((480,270));row.paste(im,(480*j,30))
    rows.append(row)
   i+=1
 finally:a.release();b.release()
 if not i:raise ValueError('No frames decoded')
 sheet=Image.new('RGB',(960,len(rows)*300),(17,25,21))
 for j,row in enumerate(rows):sheet.paste(row,(0,j*300))
 sheet.save(OUT/(case['name']+'-contact-sheet.jpg'),quality=92)
 return {**case,'decodedFrames':i,'width':shape[1],'height':shape[0],'sourceFps':afps,'candidateFps':bfps,'timingMatches':abs(afps-bfps)<.001 and acount==bcount,'changedPixelFractionMin':min(fractions),'changedPixelFractionMax':max(fractions),'candidateSha256':hashlib.sha256(b_path.read_bytes()).hexdigest(),'semanticAccuracy':'not established by this audit','outsideCoverageReverified':False,'note':'Frame dimensions, counts and timestamps checked. Existing pipeline proof is reported separately; no independent coverage mask was available.'}
if __name__=='__main__':
 cases=json.loads((OUT/'audit-input.json').read_text());results=[audit(c) for c in cases];(OUT/'retained-media-audit.json').write_text(json.dumps(results,indent=2));print(json.dumps([{k:r[k] for k in ['name','decodedFrames','width','height','timingMatches','changedPixelFractionMin','changedPixelFractionMax']} for r in results],indent=2))
