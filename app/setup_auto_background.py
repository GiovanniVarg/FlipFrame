"""Explicit setup only. Run with .segmentation-env Python; runtime never downloads.
rembg and BiRefNet sources use MIT licenses; retain upstream license notices.
Upstream model checksum: rembg v2.0.67 sessions/birefnet_general_lite.py.
"""
import json,pathlib,subprocess,sys,urllib.request,os
from auto_background import MODEL,READY,MODEL_URL,verified_model


def main():
    subprocess.check_call([sys.executable,'-m','pip','install','rembg==2.0.67','onnxruntime==1.22.1'])
    MODEL.parent.mkdir(parents=True,exist_ok=True)
    try:
        verified_model()
        needs_download=False
    except RuntimeError:
        needs_download=True
    if needs_download:
        temporary=MODEL.with_suffix('.download')
        try:
            urllib.request.urlretrieve(MODEL_URL,temporary)
            verified_model(temporary)
            os.replace(temporary,MODEL)
        finally:
            if temporary.exists(): temporary.unlink()
    verified_model()
    from auto_background import local_session
    session=local_session()
    if session.inner_session.get_providers()!=['CPUExecutionProvider']: raise RuntimeError('Expected CPU-only detector')
    READY.write_text(json.dumps({'model':'birefnet-general-lite','device':'cpu','rembg':'2.0.67','onnxruntime':'1.22.1','checkpoint':str(MODEL),'license':'MIT','source':'https://github.com/ZhengPeng7/BiRefNet'}),encoding='utf8')
    print('Automatic foreground selection is ready (CPU). SAM GPU settings are unchanged.')

if __name__=='__main__': main()

