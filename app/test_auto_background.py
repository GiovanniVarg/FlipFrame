import tempfile,pathlib,unittest
import numpy as np
from auto_background import selection_from_mask,verified_model,detect

class AutoBackgroundTests(unittest.TestCase):
    def test_foreground_and_opening_require_review(self):
        mask=np.zeros((100,100),np.uint8);mask[10:90,10:90]=255;mask[40:60,40:60]=0
        result=selection_from_mask(mask,2)
        self.assertEqual(len(result['holes']),1)
        self.assertEqual(result['device'],'cpu')
        self.assertTrue(result['reviewRequired'])
        self.assertIsNone(result['confidence'])
        self.assertEqual(result['time'],2)

    def test_empty_or_all_foreground_rejected(self):
        for mask in [np.zeros((100,100),np.uint8),np.full((100,100),255,np.uint8)]:
            with self.assertRaisesRegex(ValueError,'clear foreground'): selection_from_mask(mask)

    def test_missing_and_bad_model_fail_without_downloading(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'model.onnx'
            with self.assertRaisesRegex(RuntimeError,'not installed'): verified_model(path)
            path.write_bytes(b'wrong')
            with self.assertRaisesRegex(RuntimeError,'checksum'): verified_model(path)

    def test_missing_video_rejected_before_inference(self):
        with self.assertRaisesRegex(ValueError,'missing'): detect('missing-video.mp4',0)



class AutoBackgroundSetupTests(unittest.TestCase):
    def test_large_working_revision_can_be_selected(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import sys, os
        with tempfile.TemporaryDirectory() as directory:
            file=pathlib.Path(directory)/'large.mkv'
            file.write_bytes(bytes.fromhex('1a45dfa3')+bytes(20))
            real_stat=pathlib.Path.stat
            def large_stat(path,*args,**kwargs):
                stat=real_stat(path,*args,**kwargs)
                if path==file:
                    values=list(stat);values[6]=3*1024**3
                    return os.stat_result(values)
                return stat
            mask=np.zeros((32,32),np.uint8);mask[8:24,8:24]=255
            cap=SimpleNamespace(get=lambda field:30 if field==5 else 60,set=lambda *args:True,read=lambda:(True,np.zeros((32,32,3),np.uint8)),release=lambda:None)
            with patch.object(pathlib.Path,'stat',large_stat),patch('auto_background.cv2.VideoCapture',return_value=cap),patch.dict(sys.modules,{'rembg':SimpleNamespace(remove=lambda *args,**kwargs:mask)}):
                self.assertTrue(detect(str(file),0,session=object())['ok'])

    def test_setup_replaces_corrupt_model_only_after_verification(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import setup_auto_background as setup
        with tempfile.TemporaryDirectory() as directory:
            model=pathlib.Path(directory)/'model.onnx';ready=pathlib.Path(directory)/'ready.json'
            model.write_bytes(b'corrupt')
            checks=[]
            def verify(path=None):
                path=pathlib.Path(path) if path else model
                checks.append(path)
                if path.read_bytes()!=b'verified-model':raise RuntimeError('checksum')
                return str(path)
            def download(url,target):
                self.assertEqual(model.read_bytes(),b'corrupt')
                pathlib.Path(target).write_bytes(b'verified-model')
            session=SimpleNamespace(inner_session=SimpleNamespace(get_providers=lambda:['CPUExecutionProvider']))
            with patch.object(setup,'MODEL',model),patch.object(setup,'READY',ready),patch.object(setup,'verified_model',verify),patch.object(setup.subprocess,'check_call'),patch.object(setup.urllib.request,'urlretrieve',side_effect=download) as retrieval,patch('auto_background.local_session',return_value=session):
                setup.main()
            self.assertEqual(retrieval.call_count,1)
            self.assertEqual(model.read_bytes(),b'verified-model')
            self.assertIn(model.with_suffix('.download'),checks)
            self.assertFalse(model.with_suffix('.download').exists())
            self.assertTrue(ready.exists())

    def test_bad_repair_download_keeps_existing_model(self):
        from unittest.mock import patch
        import setup_auto_background as setup
        with tempfile.TemporaryDirectory() as directory:
            model=pathlib.Path(directory)/'model.onnx';model.write_bytes(b'original-corrupt')
            def download(url,target):pathlib.Path(target).write_bytes(b'bad-download')
            with patch.object(setup,'MODEL',model),patch.object(setup,'verified_model',side_effect=RuntimeError('checksum')),patch.object(setup.subprocess,'check_call'),patch.object(setup.urllib.request,'urlretrieve',side_effect=download):
                with self.assertRaisesRegex(RuntimeError,'checksum'):setup.main()
            self.assertEqual(model.read_bytes(),b'original-corrupt')
            self.assertFalse(model.with_suffix('.download').exists())

if __name__=='__main__': unittest.main()
