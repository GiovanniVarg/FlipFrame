"""Replace reviewed background pixels; keep decoded foreground and unknown frames exact."""
import json, sys, pathlib, tempfile, subprocess, hashlib, math
import numpy as np
import cv2
from media_engine import probe, run, FFMPEG, validate_masks, mask_at, finite


def report_progress(completed, total, stage):
    print('FLIPFRAME_PROGRESS '+json.dumps({'completed':int(completed),'total':int(total),'stage':stage}),file=sys.stderr,flush=True)


def run_with_progress(args, total, stage):
    """Drain FFmpeg progress continuously; keep errors out of the progress pipe."""
    report_progress(0,total,stage)
    with tempfile.TemporaryFile(mode='w+b') as errors:
        process=subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-nostats','-progress','pipe:1',*map(str,args)],stdout=subprocess.PIPE,stderr=errors,text=True)
        last=-1
        try:
            for line in process.stdout:
                key,_,value=line.strip().partition('=')
                if key=='frame':
                    try: completed=min(total,max(0,int(value)))
                    except ValueError: continue
                    if completed!=last:
                        report_progress(completed,total,stage);last=completed
            process.wait()
        except BaseException:
            process.terminate();process.wait();raise
        finally: process.stdout.close()
        if process.returncode:
            errors.seek(0);raise ValueError(errors.read(16000).decode(errors='replace') or 'Video encoding failed')
    report_progress(total,total,stage)


def replace_background(q):
    source, candidate, output = q['source'], q['candidate'], q['output']
    if pathlib.Path(output).resolve() in (pathlib.Path(source).resolve(), pathlib.Path(candidate).resolve()):
        raise ValueError('Output must differ from input media')
    report_progress(0,0,'preparing')
    info, replacement_info = probe(source), probe(candidate)
    start, end = finite(q['start'], 'start'), finite(q['end'], 'end')
    if abs(info['fps']-30) > .01 or not 0 <= start < end <= info['duration']+1e-6 or end-start > 10:
        raise ValueError('Background replacement needs a 30fps project and a range up to 10 seconds')
    first, last = math.ceil(start*30-1e-7), math.ceil(end*30-1e-7)
    if q.get('scope') == 'frame':
        last = first+1
    elif q.get('scope', 'range') != 'range':
        raise ValueError('Unknown selection scope')
    # Validate individual frames, not interpolated spans: missing masks remain original.
    masks = {}
    for entry in q.get('masks', []):
        time = finite(entry['time'], 'mask time')
        index = round(time*30)
        if abs(time*30-index) > 1e-5 or index in masks:
            raise ValueError('Mask times must be unique and aligned to frames')
        if not first <= index < last:
            raise ValueError('Mask time lies outside the selected frames')
        masks[index] = validate_masks([entry], index/30, (index+1)/30, True)
    spans = q.get('visibleRanges')
    if spans is not None:
        if not isinstance(spans, list):
            raise ValueError('Visible ranges must be a list')
        previous = first/30
        checked = []
        for span in spans:
            a, b = finite(span['start'], 'visible start'), finite(span['end'], 'visible end')
            if a < previous-1e-6 or b <= a or b > last/30+1e-6 or any(abs(t*30-round(t*30)) > 1e-5 for t in [a,b]):
                raise ValueError('Visible ranges must be ordered frame ranges inside the selection')
            checked.append((round(a*30), round(b*30)))
            previous = b
        masks = {i:mask for i,mask in masks.items() if any(a <= i < b for a,b in checked)}
    duration = (last-first)/30
    tolerance = 1/30+1e-6
    if abs(replacement_info['duration']-duration) <= tolerance:
        offset = 0
    elif abs(replacement_info['duration']-info['duration']) <= tolerance:
        offset = first/30
    else:
        raise ValueError('Background video must match the selected interval or full source duration')
    width, height = info['width'], info['height']
    expected = []
    edited = changed = skipped = 0
    with tempfile.TemporaryDirectory(prefix='background-replace-') as temp:
        bg = str(pathlib.Path(temp)/'background.mkv')
        intermediate = str(pathlib.Path(temp)/'composite.mkv')
        run_with_progress(['-ss',offset,'-i',candidate,'-an','-vf',f'fps=30,scale={width}:{height},setsar=1','-c:v','ffv1','-pix_fmt','bgr0','-f','matroska',bg],last-first,'preparing')
        encoder = subprocess.Popen([FFMPEG,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{width}x{height}','-r','30','-i','pipe:0','-an','-c:v','ffv1',intermediate],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
        original_cap, background_cap = cv2.VideoCapture(source), cv2.VideoCapture(bg)
        index = 0
        report_progress(0,info['frames'],'compositing')
        try:
            while True:
                ok, frame = original_cap.read()
                if not ok: break
                result = frame
                if first <= index < last:
                    ok, replacement = background_cap.read()
                    if not ok: raise ValueError('Background video cannot decode enough frames')
                    if index in masks:
                        foreground = mask_at(masks[index], index/30, width, height) != 0
                        # A degenerate/empty object cannot authorize replacing a whole scene.
                        if foreground.any():
                            result = frame.copy()
                            result[~foreground] = replacement[~foreground]
                            if not np.array_equal(result[foreground], frame[foreground]):
                                raise ValueError('Background edit changed protected foreground')
                            changed += int(np.count_nonzero(np.any(result != frame, axis=2)))
                            edited += 1
                        else: skipped += 1
                    else: skipped += 1
                expected.append(hashlib.sha256(result.tobytes()).digest())
                encoder.stdin.write(result.tobytes())
                index += 1
                if index%30==0 or index==info['frames']: report_progress(index,info['frames'],'compositing')
        finally:
            original_cap.release(); background_cap.release()
            encoder.stdin.close(); encoder.stderr.read(); encoder.stderr.close(); encoder.wait()
        if encoder.returncode: raise ValueError('Background encoder failed')
        if index != info['frames']: raise ValueError('Source could not decode every frame')
        run_with_progress(['-i',intermediate,'-i',source,'-map','0:v:0','-map','1:a?','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb','-cpu-used','4','-row-mt','1','-threads','4','-c:a','copy','-t',str(info['duration']),'-f','matroska',output],info['frames'],'encoding')
        verify = cv2.VideoCapture(output)
        count = 0
        report_progress(0,len(expected),'verifying')
        try:
            while True:
                ok, frame = verify.read()
                if not ok: break
                if count >= len(expected) or hashlib.sha256(frame.tobytes()).digest() != expected[count]:
                    raise ValueError('Background lossless verification failed')
                count += 1
                if count%30==0 or count==len(expected): report_progress(count,len(expected),'verifying')
        finally: verify.release()
        if count != len(expected): raise ValueError('Background output frame count mismatch')
    return {'ok':True, 'precisionVerification':{'pipeline':'background-replace-v1','verifiedFrames':count,'editedFrames':edited,'unchangedSelectedFrames':skipped,'changedPixels':changed,'foregroundPixels':'preserved','outsideRange':'preserved','unknownFrames':'preserved','audio':'stream-copy'},'note':'Background replaced outside reviewed foreground masks, including their holes. Unknown frames and original foreground pixels are unchanged. Mask accuracy still requires visual review. Original audio stream copied.'}


if __name__ == '__main__':
    try: print(json.dumps(replace_background(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig')))))
    except Exception as error:
        print(json.dumps({'error':str(error)})); sys.exit(1)
