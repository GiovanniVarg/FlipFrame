"""BiRefNet-General-Lite automatic foreground selection. CPU ONNX, local only.
Sources: https://github.com/danielgatis/rembg/tree/v2.0.67
https://github.com/ZhengPeng7/BiRefNet (MIT). Explicit model, never rembg default.
"""
import hashlib,json,math,pathlib,sys,os
import cv2
import numpy as np
from segmentation import mask_geometry
ROOT=pathlib.Path(os.environ.get('FLIPFRAME_USER_DIR',str(pathlib.Path(__file__).resolve().parent)))
MODEL=ROOT/'.segmentation'/'background-models'/'birefnet-general-lite.onnx'
READY=ROOT/'.segmentation'/'background-ready.json'
MODEL_MD5='4fab47adc4ff364be1713e97b7e66334'
MODEL_URL='https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx'


def verified_model(path=MODEL):
    path=pathlib.Path(path)
    if not path.is_file(): raise RuntimeError('Automatic selection model is not installed. Run setup_auto_background.py first.')
    digest=hashlib.md5()
    with path.open('rb') as handle:
        for block in iter(lambda:handle.read(1024*1024),b''): digest.update(block)
    if digest.hexdigest()!=MODEL_MD5: raise RuntimeError('Automatic selection model checksum failed. Run setup_auto_background.py again.')
    return str(path)


def local_session():
    # Override the library download hook: a missing/corrupt file fails, never downloads.
    verified_model()
    import onnxruntime as ort
    from rembg.sessions.birefnet_general_lite import BiRefNetSessionGeneralLite
    class LocalBiRefNet(BiRefNetSessionGeneralLite):
        @classmethod
        def download_models(cls,*args,**kwargs): return str(MODEL)
    options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1
    return LocalBiRefNet('birefnet-general-lite',options,providers=['CPUExecutionProvider'])


def selection_from_mask(prediction,time=0):
    predicted=np.asarray(prediction)
    if predicted.ndim!=2 or not np.isfinite(predicted).all(): raise ValueError('Automatic selection returned an invalid mask')
    mask=(predicted>=128).astype(np.uint8)
    ratio=float(np.count_nonzero(mask))/mask.size
    if ratio<.002 or ratio>.98: raise ValueError('Could not find a clear foreground object. Select the object yourself, then try tracking.')
    geometry=mask_geometry(mask)
    return {'ok':True,'time':float(time),**geometry,'method':'birefnet-general-lite','device':'cpu','genuineSegmentation':True,'confidence':None,'confidenceKind':'unavailable','reviewRequired':True,'requiresReview':True,'reviewed':False,'maskAreaPixels':int(np.count_nonzero(mask)),'note':'Automatic foreground guess. Check the outline and openings before tracking. Detection runs on CPU; SAM tracking uses your processing choice.'}


def detect(source,time,session=None):
    path=pathlib.Path(source);time=float(time)
    # Upload limits apply at admission; lossless working revisions can be larger.
    if not path.is_file(): raise ValueError('Video is missing')
    if not math.isfinite(time) or time<0: raise ValueError('Choose a valid video time')
    with path.open('rb') as handle: header=handle.read(16)
    if not(header[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free') or header[:4] in (b'RIFF',bytes.fromhex('1a45dfa3'))): raise ValueError('Unsupported binary video container')
    cap=cv2.VideoCapture(str(path.resolve()))
    try:
        fps,count=cap.get(cv2.CAP_PROP_FPS),cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if not math.isfinite(fps) or fps<=0 or time>=count/fps: raise ValueError('Selected time is outside the video')
        cap.set(cv2.CAP_PROP_POS_MSEC,time*1000);ok,frame=cap.read()
        if not ok: raise ValueError('Could not read the selected frame')
        if frame.shape[0]*frame.shape[1]>1920*1080: raise ValueError('Automatic selection currently supports up to 1080p')
    finally: cap.release()
    from PIL import Image
    from rembg import remove
    prediction=remove(Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)),session=session or local_session(),only_mask=True)
    return selection_from_mask(prediction,time)

if __name__=='__main__':
    try:
        payload=json.loads(pathlib.Path(sys.argv[1]).read_text() if len(sys.argv)>1 else sys.stdin.read())
        print(json.dumps(detect(payload['source'],payload['time'])))
    except Exception as error:
        print(json.dumps({'error':str(error)}));sys.exit(1)

