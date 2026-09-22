"""Actual SAM2.1 tiny segmentation, isolated from the editor's media dependencies.
Provenance: https://github.com/facebookresearch/sam2 (Apache-2.0).
"""
import json, math, os, pathlib, sys, tempfile
import numpy as np
import cv2
from hardware_probe import resolve_device, configure_threads
ROOT = pathlib.Path(os.environ.get('FLIPFRAME_USER_DIR', str(pathlib.Path(__file__).resolve().parent)))
CHECKPOINT = pathlib.Path(os.environ.get('SAM2_CHECKPOINT', str(ROOT / '.segmentation' / 'sam2.1_hiera_tiny.pt')))
CONFIG = 'configs/sam2.1/sam2.1_hiera_t.yaml'
_PREDICTOR = None

def report_progress(completed, total, stage='tracking'):
    print('FLIPFRAME_PROGRESS '+json.dumps({'completed':completed,'total':total,'stage':stage}), file=sys.stderr, flush=True)

def validate_polygon(polygon):
    points = np.asarray(polygon, dtype=np.float32)
    if points.ndim != 2 or points.shape[1] != 2 or not 3 <= len(points) <= 500 or not np.isfinite(points).all():
        raise ValueError('Polygon requires 3..500 finite normalized [x,y] points')
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

def hole_seed_clicks(polygon, clicks=None, holes=None):
    """Seed retained openings even after the original correction clicks are gone."""
    if not holes: return clicks
    if not isinstance(holes, list) or len(holes) > 64: raise ValueError('Use up to 64 openings')
    outer = validate_polygon(polygon)
    size = 1024
    object_mask = np.zeros((size,size),np.uint8)
    cv2.fillPoly(object_mask,[np.rint(outer*(size-1)).astype(np.int32)],1)
    negatives=[]
    for raw in holes:
        hole = np.asarray(raw,dtype=np.float32)
        if hole.ndim != 2 or hole.shape[1] != 2 or not 3 <= len(hole) <= 500 or not np.isfinite(hole).all() or (hole<0).any() or (hole>1).any():
            raise ValueError('Invalid opening polygon')
        if any(cv2.pointPolygonTest(outer,tuple(map(float,v)),False)<0 for v in hole):
            raise ValueError('Openings must stay inside the object')
        cavity=np.zeros_like(object_mask)
        cv2.fillPoly(cavity,[np.rint(hole*(size-1)).astype(np.int32)],1)
        distance=cv2.distanceTransform(cavity,cv2.DIST_L2,5)
        y,x=np.unravel_index(np.argmax(distance),distance.shape)
        if distance[y,x] <= 0: raise ValueError('Opening is too small to track')
        negatives.append({'point':[float(x/(size-1)),float(y/(size-1))],'label':0})
        object_mask[cavity!=0]=0
    if clicks is None:
        distance=cv2.distanceTransform(object_mask,cv2.DIST_L2,5)
        y,x=np.unravel_index(np.argmax(distance),distance.shape)
        if distance[y,x]<=0: raise ValueError('Openings leave no object to track')
        result=[{'point':[float(x/(size-1)),float(y/(size-1))],'label':1}]
    else:
        if not isinstance(clicks,list) or len(clicks)>64: raise ValueError('Invalid selection clicks')
        result=list(clicks)
        for click in result:
            if click.get('label')==1 and any(cv2.pointPolygonTest(np.asarray(h,np.float32),tuple(map(float,click['point'])),False)>=0 for h in holes):
                raise ValueError('An Include point is inside an opening. Remove that point before tracking.')
    return result+negatives


def selection_prompts(polygon, width, height, clicks=None, holes=None):
    clicks = hole_seed_clicks(polygon, clicks, holes)
    if clicks is None: return prompts(polygon, width, height)
    if not isinstance(clicks, list) or not 1 <= len(clicks) <= 128:
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

def boundary_matches_clicks(points, clicks, holes=None):
    contour = np.asarray(points, np.float32)
    def contains(point):
        point = tuple(map(float, point))
        return cv2.pointPolygonTest(contour, point, False) >= 0 and not any(
            cv2.pointPolygonTest(np.asarray(hole,np.float32), point, False) >= 0 for hole in (holes or []))
    return all(contains(c['point']) == bool(c['label']) for c in (clicks or []))


def mask_geometry(mask, seed=None):
    """Outer selected component and internal background contours from SAM pixels."""
    mask = np.asarray(mask, dtype=np.uint8)
    if mask.ndim != 2: raise ValueError('Expected a 2D model mask')
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None: raise ValueError('SAM2 produced no usable object boundary')
    tree = hierarchy[0]
    roots = [i for i,c in enumerate(contours) if tree[i][3] == -1 and cv2.contourArea(c) >= 8]
    selected = [i for i in roots if seed is not None and cv2.pointPolygonTest(contours[i], tuple(map(float, seed)), False) >= 0]
    if not roots: raise ValueError('SAM2 produced no usable object boundary')
    index = max(selected or roots, key=lambda i:cv2.contourArea(contours[i]))
    height, width = mask.shape
    def polygon(contour):
        epsilon = max(0.5, cv2.arcLength(contour, True)*0.00025)
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        while len(simplified) > 256:
            epsilon *= 1.3
            simplified = cv2.approxPolyDP(contour, epsilon, True)
        if len(simplified) < 3: raise ValueError('Model boundary is degenerate')
        return (simplified[:,0,:] / [width-1, height-1]).tolist()
    # Direct children are background holes. Nested foreground islands cannot be
    # represented by a single outer polygon plus holes; exclude those cavities
    # conservatively rather than erasing foreground inside them.
    holes = []
    for i in range(len(contours)):
        if tree[i][3] != index or tree[i][2] != -1 or cv2.contourArea(contours[i]) < 8: continue
        # OpenCV's hole contour runs along neighboring foreground pixels.
        # Trace the actual zero pixels instead, so subtraction keeps the rim.
        cavity = np.zeros_like(mask)
        cv2.drawContours(cavity, contours, i, 1, cv2.FILLED)
        cavity[mask != 0] = 0
        interiors, _ = cv2.findContours(cavity, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for interior in interiors:
            if cv2.contourArea(interior) >= 8: holes.append(polygon(interior))
    if len(holes) > 64: raise ValueError('Object has too many openings; choose a simpler selection')
    return {'points':polygon(contours[index]), 'holes':holes}


def boundary(mask, seed=None):
    return mask_geometry(mask, seed)['points']

def predictor():
    global _PREDICTOR
    if _PREDICTOR is None:
        if not CHECKPOINT.is_file(): raise RuntimeError('SAM2 checkpoint missing; run setup_segmentation.py')
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        configure_threads(torch)
        device = resolve_device(torch)
        _PREDICTOR = SAM2ImagePredictor(build_sam2(CONFIG, str(CHECKPOINT), device=device, apply_postprocessing=False))
    return _PREDICTOR

def segment_image(image, polygon, time=0, clicks=None, holes=None):
    import torch
    if image is None or image.ndim != 3 or image.shape[2] != 3: raise ValueError('Expected RGB image')
    height, width = image.shape[:2]
    if width < 2 or height < 2 or width*height > 1920*1080: raise ValueError('Image exceeds supported dimensions')
    clicks = hole_seed_clicks(polygon, clicks, holes)
    coords, labels, box = selection_prompts(polygon, width, height, clicks)
    model = predictor()
    device = str(model.device)
    # RTX2060 lacks native bfloat16; float32 works on both CPU and CUDA.
    with torch.inference_mode():
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, box=box, multimask_output=True)
    selected = None
    for index in np.argsort(scores)[::-1]:
        try:
            geometry = mask_geometry(masks[index], coords[np.flatnonzero(labels == 1)[0]])
            points = geometry['points']
        except ValueError: continue
        if boundary_matches_clicks(points, clicks, geometry['holes']):
            selected = int(index); break
    if selected is None:
        raise ValueError('The outline could not honor every Include/Exclude click. Add another point or draw a tighter outline. Your previous selection is retained.')
    index = selected
    score = float(scores[index])
    return {'time': float(time), 'points': points, 'holes': geometry['holes'], 'confidence': max(0., min(1., score)), 'method': 'sam2.1-hiera-tiny', 'genuineSegmentation': True, 'device': device, 'reviewRequired': True, 'requiresReview': True, 'reviewed': False, 'confidenceKind': 'model-predicted-mask-IoU-uncalibrated', 'maskAreaPixels': int(np.count_nonzero(masks[index]))}

def segment_frame(source, time, polygon, clicks=None, holes=None):
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
    return segment_image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), polygon, time, clicks, holes)

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

def tracking_geometry(mask, seed_geometry=None):
    if seed_geometry is not None:
        return {'points':seed_geometry['points'], 'holes':seed_geometry.get('holes',[])}
    geometry=mask_geometry(mask)
    return {'points':resample_boundary(geometry['points'],256), 'holes':geometry['holes']}


def seed_video_predictor(model, state, frame_index, width, height, polygon, clicks=None, holes=None):
    """Condition on the complete saved silhouette, not sparse guesses at its shape."""
    if polygon is None:
        coords,labels,box=selection_prompts(polygon,width,height,clicks)
        model.add_new_points_or_box(state,frame_idx=frame_index,obj_id=1,points=coords,labels=labels,box=box)
        return None
    points=validate_polygon(polygon)
    # Validate hole geometry and manual click structure before handing data to SAM.
    hole_seed_clicks(polygon,clicks,holes)
    if clicks is not None:
        selection_prompts(polygon,width,height,clicks)
        if not boundary_matches_clicks(points,clicks,holes):
            raise ValueError('Correction points conflict with the saved outline. Refine this frame before tracking.')
    seed=np.zeros((height,width),np.uint8)
    cv2.fillPoly(seed,[np.rint(points*[width-1,height-1]).astype(np.int32)],1)
    for hole in (holes or []):
        cv2.fillPoly(seed,[np.rint(np.asarray(hole)*[width-1,height-1]).astype(np.int32)],0)
    if not seed.any(): raise ValueError('Saved outline contains no foreground pixels')
    model.add_new_mask(state,frame_idx=frame_index,obj_id=1,mask=seed.astype(bool))
    return seed


def segment_video(source, start, end, polygon, sample_fps=None, reference_time=None, clicks=None, temp_directory=None, holes=None):
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
    manual_clicks = clicks
    clicks = hole_seed_clicks(polygon, clicks, holes)
    selection_prompts(polygon, 2, 2, clicks)
    device = resolve_device(torch)
    configure_threads(torch)
    report_progress(0, 0, 'preparing')
    with tempfile.TemporaryDirectory(prefix='sam2-frames-', dir=temp_directory) as folder:
        cap = cv2.VideoCapture(str(path.resolve()))
        times = []
        try:
            fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if fps <= 0 or end > count/fps + .001: raise ValueError('Propagation interval outside video')
            first=max(0,int(math.ceil(start*fps-1e-7)))
            last=min(int(count),int(math.ceil(end*fps-1e-7)))
            if last <= first: raise ValueError('Interval contains no native frames')
            if last-first > 300: raise ValueError('Propagation exceeds 300 native frames; shorten the selected interval')
            report_progress(0, last-first, 'preparing')
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
        model=build_sam2_video_predictor(CONFIG,str(CHECKPOINT),device=device,apply_postprocessing=False)
        masks=[]
        with torch.inference_mode():
            state=model.init_state(folder,offload_video_to_cpu=True,offload_state_to_cpu=True,async_loading_frames=True)
            seed_mask=seed_video_predictor(model,state,seed_index,width,height,polygon,manual_clicks,holes)
            import itertools
            seen=set()
            forward=model.propagate_in_video(state,start_frame_idx=seed_index)
            backward=model.propagate_in_video(state,start_frame_idx=seed_index,reverse=True) if seed_index else []
            for index,object_ids,logits in itertools.chain(forward,backward):
                if index in seen: continue
                seen.add(index)
                mask=seed_mask if index == seed_index and seed_mask is not None else (logits[0,0]>0).cpu().numpy()
                try:
                    geometry=tracking_geometry(mask,{'points':polygon,'holes':holes or []} if index == seed_index and seed_mask is not None else None)
                    points=geometry['points']
                    if index == seed_index and not boundary_matches_clicks(geometry['points'], clicks, geometry['holes']): raise RuntimeError('Tracking could not honor the correction points. Refine the starting outline again; previous masks retained.')
                    masks.append({'time':times[index],'points':points,'holes':geometry['holes'],'confidence':None,'visible':True,'reviewRequired':True,'method':'sam2.1-video-tiny'})
                except ValueError:
                    masks.append({'time':times[index],'points':[],'confidence':None,'visible':False,'reviewRequired':True,'method':'sam2.1-video-tiny'})
                report_progress(len(seen), len(times))
        masks.sort(key=lambda item:item["time"])
        if len(masks)!=len(times): raise ValueError("SAM2 did not process every selected frame; previous masks retained")
        return {**summarize_masks(masks,fps),'method':'sam2.1-video-tiny','genuineSegmentation':True,'device':device,'reviewRequired':True,'requiresReview':True,'reviewed':False,'fps':fps,'sparseSamples':False,'frameCount':len(times),'start':times[0],'end':last/fps,'identityAcrossCuts':False,'note':'Actual SAM2 masks on every native frame. Empty predictions remain gaps. No identity guarantee across cuts; review every mask. Video confidence is unavailable rather than fabricated.'}

if __name__ == '__main__':
    try:
        payload = json.loads(sys.stdin.read())
        report_progress(0, 0 if payload.get('operation') == 'video' else 1, 'preparing')
        if payload.get('operation') == 'video':
            result = segment_video(payload['source'],payload['start'],payload['end'],payload.get('polygon'),payload.get('sampleFps',3),payload.get('time'),payload.get('clicks'),payload.get('tempDirectory'),payload.get('holes'))
        else:
            result = segment_frame(payload['source'], payload['time'], payload.get('polygon'), payload.get('clicks'),payload.get('holes'))
            report_progress(1, 1)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
