"""Reviewed local transformation render; never calls a provider."""
import json,sys,pathlib,tempfile,subprocess,hashlib,math
from media_engine import probe,run,FFMPEG,validate_masks,mask_at
from transformation_core import compose_transformation
from foreground_transfer import build_clean_plate,compose_foreground
import cv2
import numpy as np

def polygon(points,width,height):
    p=np.asarray(points,dtype=np.float32)
    if p.ndim!=2 or p.shape[1]!=2 or not 3<=len(p)<=256 or not np.isfinite(p).all() or (p<0).any() or (p>1).any():
        raise ValueError('Draw a valid repair area inside the frame.')
    if abs(cv2.contourArea(p))<.00001: raise ValueError('Repair area has no interior.')
    out=np.zeros((height,width),np.uint8);cv2.fillPoly(out,[np.rint(p*[width-1,height-1]).astype(np.int32)],1)
    return out

def render(q):
    if q.get('reviewed') is not True: raise ValueError('Review the replacement track and repair area first.')
    mode=q.get('mode','aligned')
    if mode not in ('aligned','foreground','scene'):raise ValueError('Unknown transformation mode.')
    if mode=='scene' and q.get('sceneApproved') is not True:raise ValueError('Approve complete scene replacement first.')
    if q.get('cameraPolicy') not in ('fixed','align'): raise ValueError('Choose an explicit camera policy.')
    start,end=float(q['start']),float(q['end']);info=probe(q['source']);ci=probe(q['candidate'])
    if not 0<=start<end<=info['duration']+1e-6 or end-start>10: raise ValueError('Choose a range up to ten seconds inside the source.')
    if abs(info['fps']-30)>.001: raise ValueError('Transformation requires the imported 30 fps revision.')
    offset=float(q.get('candidateOffset',0))
    if not math.isfinite(offset) or offset<0 or offset+end-start>ci['duration']+1e-6: raise ValueError('Replacement does not cover the complete selected range. No retiming is applied.')
    source_masks=validate_masks(q['masks'],start,end,False) if mode!='scene' else []
    replacement_masks=validate_masks(q['replacementMasks'],start,end,False) if mode!='scene' else []
    w,h=info['width'],info['height'];envelope=polygon(q['envelope'],w,h) if mode!='scene' else np.ones((h,w),np.uint8);protected=np.zeros((h,w),np.uint8)
    for p in q.get('protectedAreas',[]): protected |= polygon(p,w,h)
    first=math.ceil(start*30-1e-7);last=math.ceil(end*30-1e-7)
    expected=[];checks=[];previous=None
    plate=None;valid=None
    if mode=='foreground':
        donor=cv2.VideoCapture(q['source']);frames=[];donor_masks=[]
        try:
            for index in np.unique(np.linspace(first,last-1,min(12,last-first)).astype(int)):
                donor.set(cv2.CAP_PROP_POS_FRAMES,int(index));ok,frame=donor.read()
                if not ok:raise ValueError('Could not read a background donor frame.')
                frames.append(frame);donor_masks.append(mask_at(source_masks,index/30,w,h))
        finally:donor.release()
        plate,valid=build_clean_plate(frames,donor_masks)
    with tempfile.TemporaryDirectory(prefix='transformation-') as tmp:
        temp=pathlib.Path(tmp);replacement=temp/'replacement.mkv'
        run(['-ss',offset,'-i',q['candidate'],'-an','-vf',f'fps=30,scale={w}:{h},setsar=1','-c:v','ffv1','-pix_fmt','bgr0',str(replacement)])
        encoders=[subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','30','-i','pipe:0','-an','-c:v','ffv1',str(temp/(name+'.mkv'))],stdin=subprocess.PIPE,stderr=subprocess.PIPE) for name in ['result','coverage']]
        a=cv2.VideoCapture(q['source']);b=cv2.VideoCapture(str(replacement));index=0
        try:
            while True:
                ok,frame=a.read()
                if not ok: break
                out=frame;overlay=frame.copy()
                if first<=index<last:
                    ok,candidate=b.read()
                    if not ok: raise ValueError('Replacement ended before the selected range.')
                    if mode=='scene':
                        out=candidate;support=np.ones((h,w),bool);check={'method':'explicit-whole-scene'}
                    else:
                        old=mask_at(source_masks,index/30,w,h);new=mask_at(replacement_masks,index/30,w,h)
                        if mode=='foreground':
                            out,support=compose_foreground(frame,candidate,old,new,envelope,protected,plate,valid,q['placement']);check={'method':'observed-source-background'}
                        else:out,support,previous,check=compose_transformation(frame,candidate,old,new,envelope,protected,q['cameraPolicy'],previous)
                    checks.append(check);overlay[support]=(frame[support]*.5+np.array([40,210,120])*.5).astype(np.uint8)
                    print(f'Transformation progress {index-first+1}/{last-first}',file=sys.stderr,flush=True)
                expected.append(hashlib.sha256(out.tobytes()).digest())
                encoders[0].stdin.write(out.tobytes());encoders[1].stdin.write(overlay.tobytes());index+=1
        finally:
            a.release();b.release()
            for encoder in encoders:
                encoder.stdin.close();encoder.stderr.read();encoder.stderr.close();encoder.wait()
        if index!=info['frames'] or len(checks)!=last-first: raise ValueError('Frame coverage is incomplete.')
        if any(e.returncode for e in encoders): raise ValueError('Local transformation encoding failed.')
        for name,target in [('result',q['output']),('coverage',q['reviewOutput'])]:
            run(['-i',str(temp/(name+'.mkv')),'-i',q['source'],'-map','0:v:0','-map','1:a?','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-threads','4','-c:a','libopus','-b:a','192k','-t',info['duration'],'-f','webm',target])
        cap=cv2.VideoCapture(q['output']);count=0
        try:
            while True:
                ok,frame=cap.read()
                if not ok:break
                if count>=len(expected) or hashlib.sha256(frame.tobytes()).digest()!=expected[count]: raise ValueError('Decoded transformation preservation check failed.')
                count+=1
        finally:cap.release()
        if count!=len(expected):raise ValueError('Encoded frame count changed.')
    return {'ok':True,'transformationVerification':{'pipeline':{'aligned':'bounded-transformation-v1','foreground':'foreground-transfer-v1','scene':'scene-replacement-v1'}[mode],'verifiedFrames':count,'editedFrames':len(checks),'outsideCoverage':'preserved','cameraPolicy':q['cameraPolicy'],'alignmentMethods':sorted(set(c['method'] for c in checks)),'backgroundReconstruction':'source-donors' if mode=='foreground' else 'provider-inferred','requiresVisualReview':True},'note':({'scene':'Whole-scene replacement: camera, environment and objects change inside the selected interval. Review both cut boundaries. Original audio is retained and re-encoded.', 'foreground':'Foreground transfer uses observed source-background donors and the generated object viewpoint. It does not correct 3D perspective. Review placement, edges and contact shadows. Source audio is retained and re-encoded.'}.get(mode) or 'Transformation preview: independent replacement shape and motion. Generated background fills the vacated object region. Pixels outside the approved coverage are preserved. Background realism, identity and occlusion still need visual review. Source audio is retained and re-encoded.')}

def track(q):
    from segmentation import segment_video
    start,end=float(q['start']),float(q['end']);offset=float(q['candidateOffset'])
    info=probe(q['source'])
    if offset+end-start>info['duration']+1e-6:raise ValueError('Generated footage is too short for this complete range. No paid request was submitted.')
    with tempfile.TemporaryDirectory(prefix='replacement-track-') as tmp:
        target=str(pathlib.Path(tmp)/'track.mkv')
        run(['-ss',offset,'-i',q['source'],'-t',end-start,'-an','-vf','fps=30,setsar=1','-c:v','ffv1',target])
        result=segment_video(target,0,end-start,q['points'],reference_time=float(q['time'])-start)
        for m in result.get('masks',[]):m['time']=round((m['time']+start)*30)/30
        result['ok']=True;result['start']=start;result['end']=end
        return result

if __name__=='__main__':
    try:
        q=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
        print(json.dumps(track(q) if q.get('action')=='transformation_track' else render(q)))
    except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
