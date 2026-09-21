"""Actual SAM2.1 tiny segmentation, isolated from the editor's media dependencies.
Provenance: https://github.com/facebookresearch/sam2 (Apache-2.0).
"""
import json, math, os, pathlib, sys, tempfile
import numpy as np
import cv2
ROOT = pathlib.Path(__file__).resolve().parent
CHECKPOINT = pathlib.Path(os.environ.get('SAM2_CHECKPOINT', str(ROOT / '.segmentation' / 'sam2.1_hiera_tiny.pt')))
CONFIG = 'configs/sam2.1/sam2.1_hiera_t.yaml'
_PREDICTOR = None

def validate_polygon(polygon):
    points = np.asarray(polygon, dtype=np.float32)
    if points.ndim != 2 or points.shape[1] != 2 or not 3 <= len(points) <= 256 or not np.isfinite(points).all():
        raise ValueError('Polygon requires 3..256 finite normalized [x,y] points')
    if (points < 0).any() or (points > 1).any(): raise ValueError('Polygon coordinates must be normalized to [0,1]')
    if abs(cv2.contourArea(points)) < 0.00001: raise ValueError('Polygon area is too small')
    return points

def prompts(polygon, width, height):
    points = validate_polygon(polygon) * [width-1, height-1]
    selection = np.zeros((height, width), np.uint8)
    cv2.fillPoly(selection, [np.rint(points).astype(np.int32)], 1)
    distance = cv2.distanceTransform(selection, cv2.DIST_L2, 5)
    y, x = np.unravel_index(np.argmax(distance), distance.shape)
    box = np.array([points[:,0].min(), points[:,1].min(), points[:,0].max(), points[:,1].max()], np.float32)
    # A deep interior positive point avoids centroid-outside errors on concave selections.
    coords = [[x, y]]
    labels = [1]
    for corner in [[0,0],[width-1,0],[0,height-1],[width-1,height-1]]:
        if not selection[corner[1], corner[0]]: coords.append(corner); labels.append(0)
    return np.asarray(coords, np.float32), np.asarray(labels, np.int32), box

def selection_prompts(polygon, width, height, clicks=None):
    if clicks is None: return prompts(polygon, width, height)
    if not isinstance(clicks, list) or not 1 <= len(clicks) <= 64:
        raise ValueError('Select an object with 1..64 Include/Exclude points')
    coords, labels = [], []
    for click in clicks:
        if not isinstance(click, dict) or click.get('label') not in (0, 1):
            raise ValueError('Selection labels must be Include or Exclude')
        point = np.asarray(click.get('point'), dtype=np.float32)
        if point.shape != (2,) or not np.isfinite(point).all() or (point < 0).any() or (point > 1).any():
            raise ValueError('Selection points must be normalized coordinates')
        coords.append(point * [width-1, height-1]); labels.append(click['label'])
    if 1 not in labels: raise ValueError('Include at least one point inside your object')
    return np.asarray(coords, np.float32), np.asarray(labels, np.int32), None

def boundary_matches_clicks(points, clicks):
    contour = np.asarray(points, np.float32)
    return all((cv2.pointPolygonTest(contour, tuple(map(float,c['point'])), False) >= 0) == bool(c['label']) for c in (clicks or []))

def boundary(mask, seed=None):
    mask = np.asarray(mask, dtype=np.uint8)
    if mask.ndim != 2: raise ValueError('Expected a 2D model mask')
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = [c for c in contours if cv2.contourArea(c) >= 8]
    if not contours: raise ValueError('SAM2 produced no usable object boundary')
    selected = [c for c in contours if seed is not None and cv2.pointPolygonTest(c, tuple(map(float, seed)), False) >= 0]
    contour = max(selected or contours, key=cv2.contourArea)
    epsilon = max(0.5, cv2.arcLength(contour, True)*0.00025)
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    while len(simplified) > 256:
        epsilon *= 1.3
        simplified = cv2.approxPolyDP(contour, epsilon, True)
    if len(simplified) < 3: raise ValueError('Model boundary is degenerate')
    height, width = mask.shape
    return (simplified[:,0,:] / [width-1, height-1]).tolist()

def predictor():
    global _PREDICTOR
    if _PREDICTOR is None:
        if not CHECKPOINT.is_file(): raise RuntimeError('SAM2 checkpoint missing; run setup_segmentation.py')
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        torch.set_num_threads(min(8, torch.get_num_threads()))
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        _PREDICTOR = SAM2ImagePredictor(build_sam2(CONFIG, str(CHECKPOINT), device=device, apply_postprocessing=False))
    return _PREDICTOR

def segment_image(image, polygon, time=0, clicks=None):
    import torch
    if image is None or image.ndim != 3 or image.shape[2] != 3: raise ValueError('Expected RGB image')
    height, width = image.shape[:2]
    if width < 2 or height < 2 or width*height > 1920*1080: raise ValueError('Image exceeds supported dimensions')
    coords, labels, box = selection_prompts(polygon, width, height, clicks)
    model = predictor()
    device = str(model.device)
    # RTX2060 lacks native bfloat16; float32 works on both CPU and CUDA.
    with torch.inference_mode():
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, box=box, multimask_output=True)
    selected = None
    for index in np.argsort(scores)[::-1]:
        try: points = boundary(masks[index], coords[np.flatnonzero(labels == 1)[0]])
        except ValueError: continue
        if boundary_matches_clicks(points, clicks):
            selected = int(index); break
    if selected is None:
        raise ValueError('The outline could not honor every Include/Exclude click. Add another point or draw a tighter outline. Your previous selection is retained.')
    index = selected
    score = float(scores[index])
    return {'time': float(time), 'points': points, 'confidence': max(0., min(1., score)), 'method': 'sam2.1-hiera-tiny', 'genuineSegmentation': True, 'device': device, 'reviewRequired': True, 'requiresReview': True, 'reviewed': False, 'confidenceKind': 'model-predicted-mask-IoU-uncalibrated', 'maskAreaPixels': int(np.count_nonzero(masks[index]))}

def segment_frame(source, time, polygon, clicks=None):
    path = pathlib.Path(source)
    if not path.is_file() or path.stat().st_size > 200*1024*1024: raise ValueError('Local media file missing or exceeds 200MB')
    if not math.isfinite(float(time)) or float(time) < 0: raise ValueError('Frame time must be nonnegative and finite')
    with path.open('rb') as handle: header = handle.read(16)
    if not (header[4:8] in (b'ftyp', b'moov', b'mdat', b'wide', b'free') or header[:4] in (b'RIFF', bytes.fromhex('1a45dfa3'))): raise ValueError('Unsupported binary video container')
    cap = cv2.VideoCapture(str(path.resolve()))
    try:
        fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if fps <= 0 or float(time) >= count/fps: raise ValueError('Frame time falls outside video')
        cap.set(cv2.CAP_PROP_POS_MSEC, float(time)*1000)
        ok, frame = cap.read()
        if not ok: raise ValueError('Cannot decode selected frame')
    finally: cap.release()
    return segment_image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), polygon, time, clicks)

def resample_boundary(points, count=256):
    """Equal arc-length boundary vertices for compatible per-frame mask shapes."""
    points=np.asarray(points,dtype=float)
    closed=np.vstack([points,points[0]])
    lengths=np.linalg.norm(np.diff(closed,axis=0),axis=1)
    cumulative=np.r_[0,np.cumsum(lengths)]
    if cumulative[-1] <= 0: raise ValueError('Degenerate boundary')
    targets=np.linspace(0,cumulative[-1],count,endpoint=False)
    return np.column_stack([np.interp(targets,cumulative,closed[:,axis]) for axis in [0,1]]).tolist()

def summarize_masks(predictions, fps):
    accepted, visible, gaps = [], [], []
    for prediction in predictions:
        start=float(prediction['time']); end=start+1/float(fps)
        present=bool(prediction.get('visible') and len(prediction.get('points',[]))>=3)
        spans=visible if present else gaps
        if spans and abs(spans[-1]['end']-start)<1e-6: spans[-1]['end']=end
        else:
            span={'start':start,'end':end}
            if not present: span['reason']='SAM2 produced no usable boundary; this interval must remain untouched'
            spans.append(span)
        if present: accepted.append(prediction)
    return {'masks':accepted,'visibleRanges':visible,'gaps':gaps,'status':'partial' if gaps else 'complete'}

def segment_video(source, start, end, polygon, sample_fps=None, reference_time=None, clicks=None):
    """Propagate one prompted object at native FPS through <=10s and <=300 frames.
    This operates within one shot; cut/re-entry identity matching belongs to tracking.
    """
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    start, end = float(start), float(end)
    if not all(math.isfinite(x) for x in [start,end]) or start < 0 or not 0 < end-start <= 10:
        raise ValueError('Propagation requires a positive <=10s interval')
    path = pathlib.Path(source)
    if not path.is_file() or path.stat().st_size > 200*1024*1024: raise ValueError('Local video missing or too large')
    with path.open('rb') as handle: header = handle.read(16)
    if not (header[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free') or header[:4] in (b'RIFF',bytes.fromhex('1a45dfa3'))): raise ValueError('Unsupported binary video container')
    selection_prompts(polygon, 2, 2, clicks)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    torch.set_num_threads(min(8, torch.get_num_threads()))
    with tempfile.TemporaryDirectory(prefix='sam2-frames-') as folder:
        cap = cv2.VideoCapture(str(path.resolve()))
        times = []
        try:
            fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if fps <= 0 or end > count/fps + .001: raise ValueError('Propagation interval outside video')
            first=max(0,int(math.ceil(start*fps-1e-7)))
            last=min(int(count),int(math.ceil(end*fps-1e-7)))
            if last <= first: raise ValueError('Interval contains no native frames')
            if last-first > 300: raise ValueError('Propagation exceeds 300 native frames; shorten the selected interval')
            cap.set(cv2.CAP_PROP_POS_FRAMES,first)
            for frame_index in range(first,last):
                timestamp=frame_index/fps
                ok, frame = cap.read()
                if not ok: raise ValueError('Cannot decode propagation frame')
                height,width=frame.shape[:2]
                if width*height > 1920*1080: raise ValueError('Video exceeds 1080p pixel limit')
                scale=min(1.,1280/max(width,height))
                if scale < 1: frame=cv2.resize(frame,(round(width*scale),round(height*scale)))
                height,width=frame.shape[:2]
                if not cv2.imwrite(str(pathlib.Path(folder)/f'{len(times):05d}.jpg'),frame,[cv2.IMWRITE_JPEG_QUALITY,98]): raise ValueError('Cannot write temporary frame')
                times.append(float(timestamp))
        finally: cap.release()
        reference_time=start if reference_time is None else float(reference_time)
        if not math.isfinite(reference_time) or not start <= reference_time < end: raise ValueError("Reference frame must be inside the selected range")
        seed_index=min(len(times)-1,max(0,round(reference_time*fps)-first))
        coords,labels,box=selection_prompts(polygon,width,height,clicks)
        model=build_sam2_video_predictor(CONFIG,str(CHECKPOINT),device=device,apply_postprocessing=False)
        masks=[]
        with torch.inference_mode():
            state=model.init_state(folder,offload_video_to_cpu=True,offload_state_to_cpu=True)
            model.add_new_points_or_box(state,frame_idx=seed_index,obj_id=1,points=coords,labels=labels,box=box)
            import itertools
            seen=set()
            forward=model.propagate_in_video(state,start_frame_idx=seed_index)
            backward=model.propagate_in_video(state,start_frame_idx=seed_index,reverse=True) if seed_index else []
            for index,object_ids,logits in itertools.chain(forward,backward):
                if index in seen: continue
                seen.add(index)
                mask=(logits[0,0]>0).cpu().numpy()
                try:
                    points=resample_boundary(boundary(mask),256)
                    if index == seed_index and not boundary_matches_clicks(points, clicks): raise RuntimeError('Tracking could not honor the correction points. Refine the starting outline again; previous masks retained.')
                    masks.append({'time':times[index],'points':points,'confidence':None,'visible':True,'reviewRequired':True,'method':'sam2.1-video-tiny'})
                except ValueError:
                    masks.append({'time':times[index],'points':[],'confidence':None,'visible':False,'reviewRequired':True,'method':'sam2.1-video-tiny'})
        masks.sort(key=lambda item:item["time"])
        if len(masks)!=len(times): raise ValueError("SAM2 did not process every selected frame; previous masks retained")
        return {**summarize_masks(masks,fps),'method':'sam2.1-video-tiny','genuineSegmentation':True,'device':device,'reviewRequired':True,'requiresReview':True,'reviewed':False,'fps':fps,'sparseSamples':False,'frameCount':len(times),'start':times[0],'end':last/fps,'identityAcrossCuts':False,'note':'Actual SAM2 masks on every native frame. Empty predictions remain gaps. No identity guarantee across cuts; review every mask. Video confidence is unavailable rather than fabricated.'}

if __name__ == '__main__':
    try:
        payload = json.loads(sys.stdin.read())
        if payload.get('operation') == 'video':
            result = segment_video(payload['source'],payload['start'],payload['end'],payload.get('polygon'),payload.get('sampleFps',3),payload.get('time'),payload.get('clicks'))
        else:
            result = segment_frame(payload['source'], payload['time'], payload.get('polygon'), payload.get('clicks'))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
