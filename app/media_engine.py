"""Local, explicit interval media editing. No inferred object tracking."""
import json, math, os, pathlib, shutil, subprocess, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).parent / 'python_packages'))
import cv2
import numpy as np
import imageio_ffmpeg

FFMPEG = shutil.which('ffmpeg') or imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    restricted = []
    for index, arg in enumerate(args):
        if arg == '-i' and index+1<len(args) and os.path.isfile(str(args[index+1])):
            validate_local_media(args[index+1])
            restricted += ['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,avi,mp3,ogg,flac,aac']
        restricted.append(str(arg))
    result = subprocess.run([FFMPEG, '-hide_banner', '-y', *restricted], capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode(errors='replace')[-3000:])
    return result

def finite(value, name):
    value = float(value)
    if not math.isfinite(value): raise ValueError(name + ' must be finite')
    return value

def validate_local_media(source):
    path = pathlib.Path(source)
    if not path.is_file(): raise ValueError('Media file does not exist')
    with path.open('rb') as handle: header = handle.read(64)
    # Require binary container signatures before handing user bytes to any decoder.
    # MP4/QuickTime may begin with ftyp, moov, mdat, wide, free, skip, or uuid.
    is_bmff = False
    if len(header)>=12 and header[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free',b'skip',b'uuid'):
        box_size=int.from_bytes(header[:4],'big')
        is_bmff=box_size in (0,1) or 8<=box_size<=path.stat().st_size
    is_riff = header[:4]==b'RIFF' and header[8:12] in (b'WAVE',b'AVI ')
    is_audio = header[:3]==b'ID3' or header[:4] in (b'OggS',b'fLaC') or (len(header)>1 and header[0]==255 and header[1]&224==224)
    if not (is_bmff or is_riff or is_audio or header[:4]==bytes.fromhex('1a45dfa3')):
        raise ValueError('Unsupported media container; playlists and external references are not accepted')
    return str(path.resolve())


def probe(source):
    source = validate_local_media(source)
    if not os.path.isfile(source): raise ValueError('Source file does not exist')
    # Upload byte limits belong to admission; lossless working files may be larger.
    cap = cv2.VideoCapture(source)
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(cap.get(3)), int(cap.get(4))
    cap.release()
    if fps <= 0 or count <= 0 or not width or not height: raise ValueError('No readable video stream')
    duration = count / fps
    if not math.isfinite(duration) or duration > 3600.1: raise ValueError('Video exceeds 60 minute limit')
    if width * height > 1920 * 1080: raise ValueError('Video exceeds 1080p pixel limit')
    result = subprocess.run([FFMPEG, '-hide_banner', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,wav,avi,mp3,ogg,flac,aac', '-i', source], capture_output=True)
    return dict(duration=duration, width=width, height=height, fps=fps, frames=count,
                hasAudio='Audio:' in result.stderr.decode(errors='replace'))

def normalize(source, output, lossless=False):
    info = probe(source)
    if lossless:
        run(['-i',source,'-map','0:v:0','-map','0:a:0?','-vf','fps=30,setsar=1','-c:v','ffv1','-c:a','pcm_s16le','-t',info['duration'],'-f','matroska',output])
        return probe(output)
    run(['-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-vf',
         'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1', '-c:v', 'libx264',
         '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
         '-af', 'aresample=async=1:first_pts=0', '-t', info['duration'], '-movflags', '+faststart', output])
    return probe(output)

class MaskKeyframe(tuple):
    """Retains the historical (time, points) unpacking API with hole metadata."""
    def __new__(cls, time, points, holes=()):
        instance = super().__new__(cls, (time, points))
        instance.holes = holes
        return instance


def validate_masks(masks, start, end, frame_scope):
    if not masks: raise ValueError('Explicit reviewed polygon masks are required')
    def polygon(value):
        pts = np.array(value, dtype=float)
        if pts.ndim != 2 or pts.shape[1] != 2 or not 3 <= len(pts) <= 500 or not np.isfinite(pts).all():
            raise ValueError('Each polygon needs 3..500 finite [x,y] vertices')
        if (pts < 0).any() or (pts > 1).any(): raise ValueError('Polygon coordinates must be normalized to [0,1]')
        return pts
    result = []
    for mask in masks:
        t = finite(mask['time'], 'mask time')
        pts = polygon(mask['points'])
        raw_holes = mask.get('holes', [])
        if not isinstance(raw_holes, list) or len(raw_holes) > 64:
            raise ValueError('A mask supports up to 64 hole polygons')
        holes = [polygon(hole) for hole in raw_holes]
        outer = pts.astype(np.float32)
        if any(cv2.pointPolygonTest(outer, tuple(map(float, vertex)), False) < 0 for hole in holes for vertex in hole):
            raise ValueError('Hole vertices must stay inside the object outline')
        result.append(MaskKeyframe(t, pts, holes))
    result.sort(key=lambda item: item[0])
    if not any(item.holes for item in result) and len({len(p) for _, p in result}) != 1:
        raise ValueError('All mask keyframes require matching vertex counts')
    if len({t for t, _ in result}) != len(result): raise ValueError('Mask keyframe times must be unique')
    first_time = math.ceil(start*30-1e-7)/30
    last_time = (math.ceil(end*30-1e-7)-1)/30
    if not frame_scope and (result[0][0] > first_time + 1e-6 or result[-1][0] < last_time - 1e-6):
        raise ValueError('Reviewed mask keyframes must cover the complete selected range')
    if frame_scope and abs(result[0][0] - start) > 1 / 30 + 1e-6:
        raise ValueError('Frame mask must correspond to the selected frame')
    return result


def mask_at(masks, time, width, height):
    chosen = min(masks, key=lambda item:abs(item[0]-time))
    points, holes = chosen[1], getattr(chosen, 'holes', ())
    # Hole count and topology can change between frames. Never morph a cavity
    # through foreground: use the nearest actual frame's complete geometry.
    if not any(getattr(item, 'holes', ()) for item in masks):
        for (a, p), (b, q) in zip(masks, masks[1:]):
            if a <= time <= b:
                points = p + (q - p) * ((time-a)/(b-a)); break
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [np.rint(points * [width-1, height-1]).astype(np.int32)], 255)
    for hole in holes:
        cv2.fillPoly(mask, [np.rint(hole * [width-1, height-1]).astype(np.int32)], 0)
    return mask

def composite(original, candidate, mask):
    result = original.copy()
    result[mask != 0] = candidate[mask != 0]
    return result

def render(request):
    source, output = request['source'], request['output']
    if pathlib.Path(source).resolve() == pathlib.Path(output).resolve(): raise ValueError('Output must differ from source')
    info = probe(source)
    start, end = finite(request['start'], 'start'), finite(request['end'], 'end')
    if start < 0 or end <= start or end > info['duration'] + 1e-6:
        raise ValueError('Selection must satisfy 0 <= start < end <= duration')
    operation = request['operation']
    if operation not in ('mute','gain','replace_audio','picture','object'): raise ValueError('Unknown operation')
    with tempfile.TemporaryDirectory(prefix='local-editor-') as temporary:
        normalized = os.path.join(temporary, 'normalized.mp4')
        normalize(source, normalized, lossless=True)
        info = probe(normalized)
        fps = 30
        first, last = math.ceil(start*fps-1e-7), math.ceil(end*fps-1e-7)
        frame_scope = operation == 'object' and request.get('scope') == 'frame'
        if frame_scope: last = first + 1
        if first >= info['frames']: raise ValueError('Selection contains no video frame')
        last = min(last, info['frames'])
        actual_start, actual_end = first/fps, last/fps
        video = normalized
        if operation in ('picture','object'):
            candidate = request.get('candidate')
            if not candidate: raise ValueError('A replacement candidate video is required')
            cinfo = probe(candidate)
            selected_duration = (last-first)/fps
            tolerance = 1/fps + 1e-6
            candidate_offset = 0
            if abs(cinfo['duration'] - selected_duration) <= tolerance:
                pass
            elif abs(cinfo['duration'] - info['duration']) <= tolerance:
                candidate_offset = actual_start
            elif cinfo['duration'] < selected_duration:
                raise ValueError('Candidate is shorter than the selected interval')
            else:
                raise ValueError('Candidate duration must match the selection or the full source within one frame')
            candidate_normalized = os.path.join(temporary, 'candidate.mp4')
            run(['-ss', candidate_offset, '-i', candidate, '-an', '-vf', f"fps=30,scale={info['width']}:{info['height']},setsar=1", '-c:v', 'ffv1', '-pix_fmt','bgr0','-f','matroska', candidate_normalized])
            groups=None
            if operation=='object' and request.get('visibleRanges') is not None:
                groups=validate_visible_ranges(request['visibleRanges'],request.get('masks',[]),actual_start,actual_end)
                masks=groups[0][2]
            else:
                masks = validate_masks(request.get('masks'), start, end, frame_scope) if operation == 'object' else None
            raw_video = os.path.join(temporary, 'composited.mkv')
            encoder = subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f"{info['width']}x{info['height']}",'-r','30','-i','pipe:0','-an','-c:v','ffv1',raw_video],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
            original_cap, candidate_cap = cv2.VideoCapture(source if abs(probe(source)['fps']-30)<.01 else normalized), cv2.VideoCapture(candidate_normalized)
            try:
                index = 0
                while True:
                    ok, frame = original_cap.read()
                    if not ok: break
                    if first <= index < last:
                        ok, replacement = candidate_cap.read()
                        if not ok: raise ValueError('Candidate cannot decode enough frames')
                        active=masks
                        if groups is not None:
                            active=next((group for a,b,group in groups if a-1e-6<=index/fps<b-1e-6),None)
                        if groups is None or active is not None:
                            frame = replacement if masks is None else composite(frame,replacement,mask_at(active,index/fps,info['width'],info['height']))
                    encoder.stdin.write(frame.tobytes())
                    index += 1
            finally:
                original_cap.release(); candidate_cap.release(); encoder.stdin.close()
            errors = encoder.stderr.read(); encoder.stderr.close(); encoder.wait()
            if encoder.returncode: raise ValueError(errors.decode(errors='replace'))
            video = raw_video
        args = ['-i',video]
        if video != normalized: args += ['-i', normalized]
        source_audio_index = 1 if video != normalized else 0
        audio_filter = None
        if operation in ('mute','gain') and info['hasAudio']:
            gain = 0 if operation == 'mute' else 10 ** (finite(request.get('gainDb',0),'gainDb') / 20)
            if gain > 1000: raise ValueError('Gain must not exceed 60 dB')
            audio_filter = f"volume={gain}:enable='gte(t,{start})*lt(t,{end})'"
        if operation == 'replace_audio':
            audio = request.get('audio')
            if not audio or not os.path.isfile(audio): raise ValueError('Replacement audio file is required')
            args += ['-i',audio]
            # Validate decoded replacement duration, including audio-only inputs.
            check = os.path.join(temporary,'audio.wav')
            validate_local_media(audio)
            run(['-i',audio,'-t',end-start,'-vn','-ac','1','-ar','8000',check])
            import wave
            with wave.open(check) as wav: available = wav.getnframes()/wav.getframerate()
            if available + 1e-6 < end-start: raise ValueError('Replacement audio is shorter than the selected interval')
            base = '[0:a]' if info['hasAudio'] else f'anullsrc=r=48000:cl=stereo,atrim=duration={info["duration"]}[silence];[silence]'
            graph = base + f"volume=0:enable='gte(t,{start})*lt(t,{end})'[base];[1:a]atrim=duration={end-start},asetpts=PTS-STARTPTS,adelay={round(start*1000)}:all=1[replacement];[base][replacement]amix=inputs=2:normalize=0:duration=first[a]"
            args += ['-filter_complex',graph,'-map','0:v:0','-map','[a]']
        else:
            args += ['-map','0:v:0','-map',f'{source_audio_index}:a:0?']
            if audio_filter: args += ['-af',audio_filter]
        args += ['-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-row-mt','1','-threads','4','-c:a','libopus','-b:a','192k','-t',info['duration'],'-f','webm',output]
        run(args)
    return dict(output=str(pathlib.Path(output).resolve()), **probe(output), actualStart=actual_start, actualEnd=actual_end,
                note=('Lossless WebM. Only the reviewed object region is replaced; check its boundary and motion.' if operation == 'object' else 'Only the selected picture interval is replaced. The source soundtrack is preserved.' if operation == 'picture' else 'Only the selected audio interval is changed. The source picture is preserved.'))

def track(request):
    source = request['source']
    info = probe(source)
    start, end = finite(request['start'], 'start'), finite(request['end'], 'end')
    if start < 0 or end <= start or end > info['duration'] + 1e-6:
        raise ValueError('Tracking requires 0 <= start < end <= duration')
    initial = validate_masks([dict(time=start, points=request['points'])], start, end, True)[0][1]
    masks = []
    reason = None
    with tempfile.TemporaryDirectory(prefix='local-track-') as temporary:
        normalized = os.path.join(temporary, 'source.mp4')
        normalize(source, normalized)
        cap = cv2.VideoCapture(normalized)
        first, last = math.ceil(start*30-1e-7), math.ceil(end*30-1e-7)
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        ok, frame = cap.read()
        if not ok:
            cap.release(); raise ValueError('Selected initial frame cannot be decoded')
        height, width = frame.shape[:2]
        polygon = initial * [width-1,height-1]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        masks.append(dict(time=first/30,points=initial.tolist(),confidence=1.0))
        try:
            for index in range(first+1,last):
                region = np.zeros((height,width),np.uint8)
                cv2.fillPoly(region,[np.rint(polygon).astype(np.int32)],255)
                features = cv2.goodFeaturesToTrack(gray,maxCorners=100,qualityLevel=.01,minDistance=3,mask=region,blockSize=3)
                if features is None or len(features)<6:
                    reason='Insufficient visible texture inside the polygon'; break
                ok, frame = cap.read()
                if not ok:
                    reason='Unable to decode the next frame'; break
                next_gray = cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
                if np.mean(np.abs(next_gray.astype(float)-gray.astype(float)))>45:
                    reason='Possible scene cut'; break
                moved, status, error = cv2.calcOpticalFlowPyrLK(gray,next_gray,features,None,winSize=(21,21),maxLevel=3)
                if moved is None:
                    reason='Optical flow lost'; break
                backward, back_status, _ = cv2.calcOpticalFlowPyrLK(next_gray,gray,moved,None,winSize=(21,21),maxLevel=3)
                if backward is None:
                    reason='Optical flow consistency failed'; break
                valid=(status.ravel()!=0)&(back_status.ravel()!=0)&(np.linalg.norm(backward-features,axis=2).ravel()<1.5)&(error.ravel()<30)
                if valid.sum()<6:
                    reason='Too few reliable motion features'; break
                matrix,inliers=cv2.estimateAffinePartial2D(features[valid],moved[valid],method=cv2.RANSAC,ransacReprojThreshold=2)
                confidence=float(inliers.sum()/len(features)) if inliers is not None else 0
                if matrix is None or confidence<.5:
                    reason='Motion confidence fell below 0.5'; break
                scale=float(np.linalg.norm(matrix[:,0]))
                if not .8<scale<1.25:
                    reason='Abrupt size change'; break
                transformed=cv2.transform(polygon.astype(np.float32)[None],matrix)[0]
                if not np.isfinite(transformed).all() or (transformed<0).any() or (transformed>[width-1,height-1]).any():
                    reason='Tracked polygon reached the frame boundary'; break
                polygon=transformed;gray=next_gray
                masks.append(dict(time=index/30,points=(polygon/[width-1,height-1]).tolist(),confidence=round(confidence,4)))
        finally:
            cap.release()
    return dict(masks=masks,status='stopped' if reason else 'complete',reason=reason,
                reviewed=False,requiresReview=True,start=first/30,end=min(last/30,masks[-1]['time']+1/30),
                note='Optical flow estimates local polygon motion. Review every frame before approval; no object identity or re-identification is inferred.')


def extract(request):
    source, output = request['source'], request['output']
    if pathlib.Path(source).resolve() == pathlib.Path(output).resolve():
        raise ValueError('Output must differ from source')
    info = probe(source)
    start, end = finite(request['start'], 'start'), finite(request['end'], 'end')
    if start < 0 or end <= start or end > info['duration'] + 1e-6:
        raise ValueError('Extraction requires 0 <= start < end <= duration')
    provider_filters = []
    resolution = request.get('providerResolution')
    if resolution is not None:
        if resolution not in ('480p', '720p'): raise ValueError('Unsupported provider resolution')
        if end-start < 4-1e-6 or end-start > 30+1e-6: raise ValueError('Provider source must contain 4 to 30 seconds')
        width,height = (1280,720) if resolution == '720p' else (854,480)
        if info['width'] < info['height']: width,height=height,width
        if abs(info['width']/info['height']-1) < .05: width=height=int(resolution[:-1])
        provider_filters = ['-vf', f'scale={width}:{height},setsar=1']
    tail_padding = finite(request.get('tailPadding', 0), 'tailPadding')
    if tail_padding < 0 or tail_padding > .5 or (tail_padding and resolution is None):
        raise ValueError('Input tail protection must be 0 to 0.5 seconds on provider sources only')
    if end-start+tail_padding > 30+1e-6:
        raise ValueError('Provider source including tail protection exceeds 30 seconds')
    if tail_padding:
        provider_filters[1] += f',trim=duration={end-start},setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop={round(tail_padding*30)+1}'
        if info['hasAudio']: provider_filters += ['-af', f'atrim=duration={end-start},asetpts=PTS-STARTPTS,apad=pad_dur={tail_padding}']
    first, last = math.ceil(start*30-1e-7), math.ceil(end*30-1e-7)
    if first == last: raise ValueError('Selection contains no video frame')
    with tempfile.TemporaryDirectory(prefix='local-extract-') as temporary:
        normalized = os.path.join(temporary,'source.mp4')
        normalize(source,normalized)
        normalized_info=probe(normalized)
        last=min(last,normalized_info['frames'])
        if first>=last: raise ValueError('Selection contains no video frame')
        actual_start,actual_end=first/30,last/30
        run(['-ss',actual_start,'-i',normalized,'-t',actual_end-actual_start+tail_padding,
             '-map','0:v:0','-map','0:a:0?',*provider_filters,'-c:v','libx264','-preset','veryfast',
             '-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output])
    return dict(output=str(pathlib.Path(output).resolve()),actualStart=actual_start,actualEnd=actual_end,**probe(output))


def analyze(request):
    source, output = request['source'], request['output']
    if pathlib.Path(source).resolve() == pathlib.Path(output).resolve():
        raise ValueError('Output must differ from source')
    info = probe(source)
    height=max(1,round(160*info['height']/info['width']))
    cap=cv2.VideoCapture(source)
    frames=[]
    try:
        for index in range(8):
            frame_number=round(index*(info['frames']-1)/7)
            cap.set(cv2.CAP_PROP_POS_FRAMES,frame_number)
            ok,frame=cap.read()
            if not ok: raise ValueError('Unable to decode timeline thumbnail')
            frames.append(cv2.resize(frame,(160,height),interpolation=cv2.INTER_AREA))
    finally:
        cap.release()
    if not cv2.imwrite(output,np.concatenate(frames,axis=1),[cv2.IMWRITE_JPEG_QUALITY,85]):
        raise ValueError('Could not write thumbnail sprite')
    peaks=[]
    if info['hasAudio']:
        result=run(['-i',source,'-t',info['duration'],'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'])
        samples=np.frombuffer(result.stdout,dtype='<f4')
        if len(samples):
            amplitudes=np.array([np.max(np.abs(block)) if len(block) else 0 for block in np.array_split(samples,96)])
            maximum=float(np.max(amplitudes))
            peaks=np.round(amplitudes/maximum if maximum>0 else amplitudes,4).tolist()
    return dict(output=str(pathlib.Path(output).resolve()),peaks=peaks,duration=info['duration'],
                thumbnailCount=8,thumbnailWidth=160,thumbnailHeight=height)


def track_appearances(request):
    from object_reidentify import AppearanceReference
    source=request['source'];info=probe(source)
    start,end=finite(request['start'],'start'),finite(request['end'],'end')
    if start<0 or end<=start or end>info['duration']+1e-6:
        raise ValueError('Appearance search requires 0 <= start < end <= duration')
    points=validate_masks([dict(time=start,points=request['points'])],start,end,True)[0][1]
    reference_time=finite(request.get('referenceTime',start),'referenceTime')
    if reference_time<start or reference_time>=end: raise ValueError('Reference frame must be inside the search range')
    reference_index=round(reference_time*30)
    masks=[];visible=[];gaps=[]
    with tempfile.TemporaryDirectory(prefix='appearance-search-') as temporary:
        normalized=os.path.join(temporary,'source.mp4');normalize(source,normalized)
        cap=cv2.VideoCapture(normalized)
        first,last=math.ceil(start*30-1e-7),math.ceil(end*30-1e-7)
        cap.set(cv2.CAP_PROP_POS_FRAMES,reference_index)
        try:
            ok,frame=cap.read()
            if not ok:raise ValueError('Reference frame cannot be decoded')
            reference=AppearanceReference(frame,points)
            cap.set(cv2.CAP_PROP_POS_FRAMES,first)
            for index in range(first,last):
                ok,frame=cap.read()
                if not ok:raise ValueError('Appearance search frame cannot be decoded')
                polygon,confidence,reason=(points.tolist(),1.0,None) if index==reference_index else reference.locate(frame)
                t=index/30
                if polygon is not None:
                    masks.append(dict(time=t,points=polygon,confidence=confidence))
                    if visible and abs(visible[-1]['end']-t)<1e-6:visible[-1]['end']=(index+1)/30
                    else:visible.append(dict(start=t,end=(index+1)/30))
                else:
                    if gaps and abs(gaps[-1]['end']-t)<1e-6:gaps[-1]['end']=(index+1)/30
                    else:gaps.append(dict(start=t,end=(index+1)/30,reason=reason))
        finally:cap.release()
    return dict(masks=masks,visibleRanges=visible,gaps=gaps,requiresReview=True,reviewed=False,
                method='reference-feature-homography',status='partial' if gaps else 'complete',
                start=first/30,end=last/30,
                note='Feature-based appearance search can reacquire a distinctive reference after gaps. It does not infer semantic identity or changing object boundaries. Confidence is geometric inlier agreement, not an identity probability. Review every accepted frame; gaps must remain untouched.')


def validate_visible_ranges(ranges,masks,start,end):
    if not isinstance(ranges,list) or not ranges:raise ValueError('Visible ranges must be a nonempty list')
    groups=[];previous=start
    for span in ranges:
        a,b=finite(span['start'],'visible start'),finite(span['end'],'visible end')
        if a<start-1e-6 or b>end+1e-6 or a<previous-1e-6 or b<=a:
            raise ValueError('Visible ranges must be ordered, nonoverlapping, and inside the selection')
        if abs(a*30-round(a*30))>1e-5 or abs(b*30-round(b*30))>1e-5:
            raise ValueError('Visible range boundaries must align to video frames')
        subset=[mask for mask in masks if a-1e-6<=mask['time']<b-1e-6]
        checked=validate_masks(subset,a,b,False)
        # Search results must contain every visible frame; never bridge unknown frames.
        actual={round(t*30) for t,_ in checked}
        if actual!=set(range(round(a*30),round(b*30))):
            raise ValueError('Appearance ranges require an explicit mask for every visible frame')
        groups.append((a,b,checked));previous=b
    return groups


def object_reference(request):
    source,output=request['source'],request['output']
    if pathlib.Path(source).resolve()==pathlib.Path(output).resolve(): raise ValueError('Output must differ from source')
    info=probe(source)
    time=finite(request['time'],'time')
    if not 0<=time<info['duration']: raise ValueError('Reference outside source')
    polygon=np.asarray(request['points'],dtype=float)
    if polygon.ndim!=2 or polygon.shape[1]!=2 or len(polygon)<3 or not np.isfinite(polygon).all() or (polygon<0).any() or (polygon>1).any(): raise ValueError('Invalid reference polygon')
    cap=cv2.VideoCapture(source)
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC,time*1000);ok,frame=cap.read()
        if not ok: raise ValueError('Cannot decode object reference')
    finally: cap.release()
    h,w=frame.shape[:2]
    region=np.zeros((h,w),np.uint8)
    cv2.fillPoly(region,[np.rint(polygon*[w-1,h-1]).astype(np.int32)],255)
    reference=frame.copy();reference[region==0]=(reference[region==0]*.18).astype(np.uint8)
    ok,data=cv2.imencode('.png',reference)
    if not ok: raise ValueError('Cannot encode object reference')
    pathlib.Path(output).write_bytes(data.tobytes())
    return dict(output=output,width=w,height=h)


def prepare_reference(request):
    from PIL import Image, ImageOps, ImageDraw
    def read(path):
        with Image.open(path) as image:
            if image.format not in ('PNG','JPEG','WEBP') or image.width*image.height>16000000 or min(image.size)<16:
                raise ValueError('Reference must be PNG, JPEG or WebP, 16 pixels minimum and at most 16 megapixels')
            image=ImageOps.exif_transpose(image).convert('RGB');image.thumbnail((2048,2048));return image.copy()
    image=read(request['source'])
    if request.get('guide'):
        guide=read(request['guide']);board=Image.new('RGB',(1536,800),(25,28,27));draw=ImageDraw.Draw(board)
        for offset,label,item in [(0,'SOURCE SELECTION',guide),(768,'DESIRED REFERENCE',image)]:
            item.thumbnail((744,744));board.paste(item,(offset+12+(744-item.width)//2,44+(744-item.height)//2));draw.text((offset+16,16),label,fill=(255,255,255))
        image=board
    image.save(request['output'],format='PNG')
    return {'width':image.width,'height':image.height,'mimeType':'image/png'}

def video_packet_count(source):
    # Matroska CAP_PROP_FRAME_COUNT is often inferred from container duration,
    # including a slightly longer audio tail. Count actual encoded video packets.
    result=run(['-loglevel','error','-nostats','-progress','pipe:1','-i',source,
                '-map','0:v:0','-c:v','copy','-f','null','-'])
    counts=[int(line.split('=',1)[1]) for line in result.stdout.decode().splitlines()
            if line.startswith('frame=') and line.split('=',1)[1].strip().isdigit()]
    if not counts or counts[-1]<=0: raise ValueError('Could not count source video frames')
    return counts[-1]


def playback_preview(request):
    """Fast viewing copy only. The verified master stays untouched for export."""
    source,output=request['source'],request['output']
    if pathlib.Path(source).resolve()==pathlib.Path(output).resolve() or (os.path.exists(output) and os.path.samefile(source,output)):
        raise ValueError('Output must differ from source')
    info=probe(source)
    if abs(info['fps']-30)>.01:
        raise ValueError('Playback preview requires the 30fps project video')
    scale=min(1.,1280/info['width'],720/info['height'])
    width=max(2,int(info['width']*scale)//2*2)
    height=max(2,int(info['height']*scale)//2*2)
    encoded=run(['-nostats','-progress','pipe:1','-i',source,'-map','0:v:0','-map','0:a:0?',
         '-vf',f'scale={width}:{height}:flags=lanczos,setsar=1','-fps_mode','passthrough',
         '-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p',
         '-g','30','-keyint_min','30','-sc_threshold','0','-threads','4',
         '-c:a','aac','-b:a','160k','-movflags','+faststart','-f','mp4',output])
    actual=probe(output)
    # With fps_mode=passthrough there is no frame duplication/drop or retiming.
    # Count frames reported by the actual decode/encode, not source metadata.
    counts=[int(line.split('=',1)[1]) for line in encoded.stdout.decode().splitlines()
            if line.startswith('frame=') and line.split('=',1)[1].strip().isdigit()]
    if not counts or counts[-1]<=0: raise ValueError('Could not verify encoded frame count')
    source_frames=counts[-1]
    # Our H264 MP4 output has one encoded video packet per frame.
    if video_packet_count(output)!=source_frames or abs(actual['duration']-info['duration'])>1/30+1e-6:
        raise ValueError('Playback copy did not preserve the video timeline')
    if actual['hasAudio']!=info['hasAudio']:
        raise ValueError('Playback copy did not preserve audio availability')
    return {'output':str(pathlib.Path(output).resolve()),**actual,'viewingCopy':True,
            'note':'Compressed viewing copy. Export uses the verified original-quality video.'}


def main(request):
    action = request.get('action','render')
    if action == 'playback_preview': return playback_preview(request)
    if action == 'object_reference': return object_reference(request)
    if action == 'probe': return probe(request['source'])
    if action == 'track': return track(request)
    if action == 'track_appearances': return track_appearances(request)
    if action == 'extract': return extract(request)
    if action == 'analyze': return analyze(request)
    if action == 'normalize':
        if pathlib.Path(request['source']).resolve() == pathlib.Path(request['output']).resolve(): raise ValueError('Output must differ from source')
        return dict(output=request['output'], **normalize(request['source'],request['output']))
    if action == 'prepare_reference': return prepare_reference(request)
    if action == 'render': return render(request)
    raise ValueError('Unknown action')

if __name__ == '__main__':
    try:
        with open(sys.argv[1],encoding='utf-8-sig') as handle: request = json.load(handle)
        print(json.dumps(dict(ok=True, **main(request))))
    except Exception as exc:
        print(json.dumps(dict(ok=False,error=str(exc))))
        sys.exit(1)
