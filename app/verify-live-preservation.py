import media_engine
import json,sqlite3,cv2,numpy as np,pathlib
root=pathlib.Path(__file__).resolve().parent
state=json.loads(sqlite3.connect('file:'+str(root/'data/studio.sqlite')+'?mode=ro',uri=True).execute('select body from app_state').fetchone()[0]);qa=json.loads((root/'data/live-editor-validation.json').read_text(encoding='utf-8-sig'));p=state['projects'][qa['projectId']];original=next(r['path'] for r in p['revisions'] if r['id']==qa['originalRevisionId'])
results={}
for kind in ['video','audio','object']:
 if qa.get(kind,{}).get('status')!='completed':continue
 candidate=state['candidates'][qa[kind]['candidate']['id']]['path'];a=cv2.VideoCapture(original);b=cv2.VideoCapture(candidate);outside=[];inside=[];spatial=[];n=0
 while True:
  ra,fa=a.read();rb,fb=b.read()
  if not ra or not rb:
   assert ra==rb,'Frame count changed';break
  assert fa.shape==fb.shape,'Dimensions changed'
  diff=np.abs(fa.astype(float)-fb.astype(float));value=float(np.mean(diff))
  if kind=='object' and 30<=n<120:
   protected=np.ones(fa.shape[:2],bool);h,w=protected.shape;protected[max(0,int(.1*h)-3):int(.4*h)+4,max(0,int(.15*w)-3):int(.75*w)+4]=False;spatial.append(float(diff[protected].mean()))
  (inside if 30<=n<120 else outside).append(value);n+=1
 a.release();b.release()
 assert n>120
 assert max(outside)<5,'Unselected picture changed beyond encoding tolerance'
 if kind=='audio':assert max(inside)<5,'Audio edit changed picture beyond encoding tolerance'
 if spatial:assert max(spatial)<5,'Outside mask changed beyond encoding tolerance'
 results[kind]={'outsideMaskMaxMeanAbsolutePixelDifference':max(spatial) if spatial else None,'frames':n,'outsideMaxMeanAbsolutePixelDifference':max(outside),'selectedMeanAbsolutePixelDifference':float(np.mean(inside)),'pixelTolerance':5,'bitIdenticalClaim':False}
(root/'data/live-preservation-check.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))

import tempfile,wave
with tempfile.TemporaryDirectory() as tmp:
 audio={}
 for kind in ['original','video','audio']:
  if kind!='original' and qa.get(kind,{}).get('status')!='completed':continue
  source=original if kind=='original' else state['candidates'][qa[kind]['candidate']['id']]['path']
  wav=str(pathlib.Path(tmp)/(kind+'.wav'));media_engine.run(['-i',source,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav])
  with wave.open(wav) as w:audio[kind]=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float)
 metrics={}
 for kind in ['video','audio']:
  if kind not in audio:continue
  a,b=audio['original'],audio[kind];n=min(len(a),len(b));x,y=a[:n],b[:n];t=np.arange(n)/16000;outside=((t>.2)&(t<.8))|((t>4.2)&(t<4.8));inside=(t>1.1)&(t<3.9)
  metrics[kind]={'selectedRms':float(np.sqrt(np.mean(y[inside]**2))),'selectedMeanAbsoluteSampleDifference':float(np.abs(x[inside]-y[inside]).mean()),'outsideMeanAbsoluteSampleDifference':float(np.abs(x[outside]-y[outside]).mean())}
  if kind=='audio':assert metrics[kind]['selectedRms']>10,'Generated soundtrack is silent'
 results['audioSamples']=metrics
(root/'data/live-preservation-check.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))
