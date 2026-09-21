import json, pathlib, tempfile, unittest
import media_engine as m
import numpy as np

class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = pathlib.Path(cls.tmp.name)
        cls.source = str(cls.root/'source.mp4')
        cls.candidate = str(cls.root/'candidate.mp4')
        m.run(['-f','lavfi','-i','color=c=blue:s=160x96:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',cls.source])
        m.run(['-f','lavfi','-i','color=c=red:s=160x96:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',cls.candidate])
    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()
    def request(self, **kwargs):
        return dict(source=self.source,output=str(self.root/'out.mp4'),start=.5,end=1.5,operation='mute',**kwargs)
    def test_provider_preparation_resizes_only_the_upload_copy(self):
        source=str(self.root/'provider-source.mp4')
        output=str(self.root/'provider-input.mp4')
        m.run(['-f','lavfi','-i','color=c=blue:s=752x416:r=30:d=4',
               '-c:v','libx264','-pix_fmt','yuv420p',source])
        before=pathlib.Path(source).read_bytes()
        result=m.extract(dict(source=source,output=output,start=0,end=4,providerResolution='720p'))
        self.assertEqual((result['width'],result['height'],result['frames']),(1280,720,120))
        self.assertEqual(pathlib.Path(source).read_bytes(),before)
        with self.assertRaisesRegex(ValueError,'4 to 30'):
            m.extract(dict(source=source,output=output,start=0,end=2.8,providerResolution='720p'))

    def test_object_reference_preserves_selected_pixels(self):
        import cv2
        output=str(self.root/'object-reference.png')
        m.object_reference(dict(source=self.source,output=output,time=0,points=[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]))
        ref=cv2.imread(output);cap=cv2.VideoCapture(self.source);ok,original=cap.read();cap.release()
        self.assertTrue(ok)
        np.testing.assert_array_equal(ref[48,80],original[48,80])
        self.assertLess(float(ref[0,0].sum()),float(original[0,0].sum())*.3)

    def test_probe_normalize_audio_duration(self):
        p=m.probe(self.source)
        self.assertTrue(p['hasAudio']); self.assertAlmostEqual(p['duration'],2,places=2)
        r=m.render(self.request())
        self.assertEqual(r['frames'],60); self.assertTrue(r['hasAudio'])
    def test_lossless_picture_export_preserves_unselected_frames_and_pixels(self):
        import cv2
        source=self.tracking_fixture();candidate=str(self.root/'replacement-red.mp4')
        m.run(['-f','lavfi','-i','color=c=red:s=160x96:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',candidate])
        r=dict(source=source,candidate=candidate,output=str(self.root/'precise.webm'),start=.2,end=.8,operation='object',masks=[dict(time=.2,points=[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]),dict(time=23/30,points=[[.4,.4],[.6,.4],[.6,.6],[.4,.6]])])
        m.render(r);a=cv2.VideoCapture(source);b=cv2.VideoCapture(r['output']);index=0
        while True:
            ok,x=a.read();ok2,y=b.read()
            self.assertEqual(ok,ok2)
            if not ok:break
            np.testing.assert_array_equal(x[:20],y[:20])
            if index<6 or index>=24:np.testing.assert_array_equal(x,y)
            index+=1
        a.release();b.release();self.assertEqual(index,30)
    def test_muted_audio_samples(self):
        import wave
        r=self.request();m.render(r)
        wav=str(self.root/'muted.wav')
        m.run(['-i',r['output'],'-vn','-ac','1','-ar','8000',wav])
        with wave.open(wav) as w: samples=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float)
        self.assertLess(np.sqrt(np.mean(samples[6000:10000]**2)),5)
        self.assertGreater(np.sqrt(np.mean(samples[1000:3000]**2)),500)
    def test_single_frame_scope(self):
        import cv2
        full=str(self.root/'full-red.mp4');m.run(['-f','lavfi','-i','color=c=red:s=160x96:r=30:d=2','-c:v','libx264','-pix_fmt','yuv420p',full])
        r=self.request();r.update(operation='object',scope='frame',candidate=full,masks=[dict(time=.5,points=[[0,0],[1,0],[1,1],[0,1]])])
        result=m.render(r);self.assertAlmostEqual(result['actualEnd']-result['actualStart'],1/30)
        cap=cv2.VideoCapture(r['output']);reds=[]
        while True:
            ok,frame=cap.read()
            if not ok:break
            reds.append(frame[48,80,2]>200)
        cap.release();self.assertEqual(sum(reds),1)
    def test_full_source_candidate_uses_selected_offset(self):
        import cv2
        candidate=str(self.root/'full-timed.mp4')
        m.run(['-f','lavfi','-i','color=c=red:s=160x96:r=30:d=1','-f','lavfi','-i','color=c=green:s=160x96:r=30:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',candidate])
        r=self.request();r.update(operation='picture',start=1,end=2,candidate=candidate)
        m.render(r);cap=cv2.VideoCapture(r['output']);cap.set(cv2.CAP_PROP_POS_FRAMES,40);ok,frame=cap.read();cap.release()
        self.assertTrue(ok);self.assertGreater(frame[48,80,1],90);self.assertLess(frame[48,80,2],30)
        r.update(start=0,end=.2,candidate=self.candidate)
        with self.assertRaisesRegex(ValueError,'duration must match'):m.render(r)
    def tracking_fixture(self, cut=False):
        import cv2
        output=str(self.root/('cut.avi' if cut else 'moving.avi'))
        writer=cv2.VideoWriter(output,cv2.VideoWriter_fourcc(*'MJPG'),30,(160,96))
        rng=np.random.default_rng(22)
        texture=rng.integers(20,240,(32,32,3),dtype=np.uint8)
        for i in range(30):
            frame=np.zeros((96,160,3),np.uint8)
            frame[30:62,20+i:52+i]=texture
            if cut and i>=15:frame[:]=255
            writer.write(frame)
        writer.release();return output
    def test_optical_flow_translation(self):
        result=m.track(dict(source=self.tracking_fixture(),start=0,end=1,points=[[20/159,30/95],[51/159,30/95],[51/159,61/95],[20/159,61/95]]))
        self.assertEqual(result['status'],'complete');self.assertEqual(len(result['masks']),30)
        displacement=(result['masks'][-1]['points'][0][0]-result['masks'][0]['points'][0][0])*159
        self.assertAlmostEqual(displacement,29,delta=2);self.assertTrue(result['requiresReview'])
    def test_optical_flow_stops_at_cut(self):
        result=m.track(dict(source=self.tracking_fixture(True),start=0,end=1,points=[[20/159,30/95],[51/159,30/95],[51/159,61/95],[20/159,61/95]]))
        self.assertEqual(result['status'],'stopped');self.assertLessEqual(len(result['masks']),15)
        self.assertIn('cut',result['reason'])
    def test_extract_frame_aligned_interval(self):
        output=str(self.root/'extracted.mp4')
        result=m.main(dict(action='extract',source=self.source,output=output,start=.51,end=1.49))
        self.assertEqual(result['frames'],29);self.assertAlmostEqual(result['duration'],29/30)
        self.assertTrue(result['hasAudio']);self.assertAlmostEqual(result['actualStart'],16/30)
        with self.assertRaisesRegex(ValueError,'bounds|requires'):
            m.extract(dict(source=self.source,output=output,start=0,end=3))
    def test_mask_coverage_uses_selected_frame_times(self):
        points=[[0,0],[1,0],[1,1]]
        m.validate_masks([dict(time=16/30,points=points),dict(time=44/30,points=points)],.51,1.49,False)
        with self.assertRaisesRegex(ValueError,'cover'):
            m.validate_masks([dict(time=17/30,points=points),dict(time=44/30,points=points)],.51,1.49,False)
    def test_playlist_rejected_before_decode(self):
        playlist=self.root/'malicious.mp4'
        playlist.write_text('#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:1/secret\n')
        from unittest.mock import patch
        with patch.object(m.cv2,'VideoCapture',side_effect=AssertionError('Decoder must not run')):
            with self.assertRaisesRegex(ValueError,'playlists'):
                m.probe(str(playlist))
        with patch.object(m.subprocess,'run',side_effect=AssertionError('FFmpeg must not run')):
            with self.assertRaisesRegex(ValueError,'playlists'):
                m.run(['-i',str(playlist),str(self.root/'blocked.mp4')])
    def test_analyze_sprite_and_waveform(self):
        import cv2,hashlib
        before=hashlib.sha256(pathlib.Path(self.source).read_bytes()).digest()
        output=str(self.root/'timeline.jpg')
        result=m.main(dict(action='analyze',source=self.source,output=output))
        image=cv2.imread(output)
        self.assertEqual(image.shape[:2],(96,1280));self.assertEqual(len(result['peaks']),96)
        self.assertGreater(max(result['peaks']),.9);self.assertGreaterEqual(min(result['peaks']),0)
        self.assertEqual(before,hashlib.sha256(pathlib.Path(self.source).read_bytes()).digest())
        result=m.analyze(dict(source=self.candidate,output=output));self.assertEqual(result['peaks'],[])
    def test_frame_scope_applies_only_to_object(self):
        import cv2
        r=self.request();r.update(operation='picture',scope='frame',candidate=self.candidate)
        result=m.render(r)
        self.assertAlmostEqual(result['actualEnd'],1.5)
        cap=cv2.VideoCapture(r['output']);cap.set(cv2.CAP_PROP_POS_FRAMES,40);ok,frame=cap.read();cap.release()
        self.assertTrue(ok);self.assertGreater(frame[48,80,2],200)
        r.update(operation='mute');result=m.render(r)
        self.assertAlmostEqual(result['actualStart'],.5);self.assertAlmostEqual(result['actualEnd'],1.5)
    def test_reacquires_after_cut_and_occlusion_with_decoy(self):
        import cv2
        output=str(self.root/'reappear.avi')
        writer=cv2.VideoWriter(output,cv2.VideoWriter_fourcc(*'MJPG'),30,(320,180))
        rng=np.random.default_rng(23)
        texture=rng.integers(0,256,(80,80,3),dtype=np.uint8)
        texture=cv2.GaussianBlur(texture,(3,3),0)
        decoy=np.random.default_rng(55).integers(0,256,(80,80,3),dtype=np.uint8)
        for i in range(30):
            frame=np.full((180,320,3),20 if i<15 else 190,np.uint8)
            frame[90:170,230:310]=decoy
            if i<10:frame[30:110,20:100]=texture
            if i>=20:frame[60:140,130:210]=texture
            writer.write(frame)
        writer.release()
        result=m.track_appearances(dict(source=output,start=0,end=1,points=[[20/319,30/179],[99/319,30/179],[99/319,109/179],[20/319,109/179]]))
        self.assertEqual(len(result['visibleRanges']),2)
        self.assertAlmostEqual(result['visibleRanges'][0]['end'],10/30)
        self.assertAlmostEqual(result['visibleRanges'][1]['start'],20/30)
        self.assertTrue(result['requiresReview']);self.assertEqual(result['status'],'partial')
        self.assertAlmostEqual(result['masks'][-1]['points'][0][0]*319,130,delta=3)
        # A reference drawn after the gap must find appearances before it too.
        reverse=m.track_appearances(dict(source=output,start=0,end=1,referenceTime=24/30,points=[[130/319,60/179],[209/319,60/179],[209/319,139/179],[130/319,139/179]]))
        self.assertEqual(len(reverse['visibleRanges']),2)
        self.assertEqual(reverse['visibleRanges'][0]['start'],0)
        self.assertAlmostEqual(reverse['visibleRanges'][0]['end'],10/30)
        self.assertAlmostEqual(reverse['visibleRanges'][1]['start'],20/30)
        with self.assertRaisesRegex(ValueError,'Reference frame'):
            m.track_appearances(dict(source=output,start=0,end=1,referenceTime=1,points=[[0,0],[1,0],[1,1]]))

    def test_appearance_ambiguity_rejected(self):
        from object_reidentify import AppearanceReference
        import cv2
        texture=cv2.GaussianBlur(np.random.default_rng(23).integers(0,256,(80,80,3),dtype=np.uint8),(3,3),0)
        frame=np.zeros((180,320,3),np.uint8);frame[30:110,20:100]=texture
        reference=AppearanceReference(frame,[[20/319,30/179],[99/319,30/179],[99/319,109/179],[20/319,109/179]])
        frame[30:110,160:240]=texture
        points,confidence,reason=reference.locate(frame)
        self.assertIsNone(points)
    def test_appearance_gaps_are_not_composited(self):
        import cv2
        points=[[0,0],[1,0],[1,1],[0,1]]
        ranges=[dict(start=.5,end=.8),dict(start=1.2,end=1.5)]
        masks=[dict(time=i/30,points=points) for i in list(range(15,24))+list(range(36,45))]
        request=self.request();request.update(operation='object',scope='range',candidate=self.candidate,masks=masks,visibleRanges=ranges)
        m.render(request)
        cap=cv2.VideoCapture(request['output'])
        for index in [20,30,40]:
            cap.set(cv2.CAP_PROP_POS_FRAMES,index);_,frame=cap.read()
            self.assertGreater(frame[48,80,0 if index==30 else 2],200)
        cap.release()
        with self.assertRaisesRegex(ValueError,'explicit mask'):
            m.validate_visible_ranges(ranges,masks[:2]+masks[3:],.5,1.5)
    def test_bad_ranges(self):
        for a,b in [(float('nan'),1),(0,float('inf')),(-1,1),(1,1),(0,3)]:
            r=self.request();r.update(start=a,end=b)
            with self.assertRaises(ValueError):m.render(r)
    def test_object_export_and_unaffected_frames(self):
        r=self.request();r.update(operation='object',candidate=self.candidate,masks=[dict(time=t,points=[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]) for t in [.5,1.5]])
        m.render(r)
        import cv2
        original=cv2.VideoCapture(self.source); edited=cv2.VideoCapture(r['output'])
        for i in range(60):
            _,a=original.read();_,b=edited.read()
            if i<15 or i>=45:self.assertLess(np.abs(a.astype(float)-b).mean(),4)
            elif i==30:
                self.assertGreater(b[48,80,2],200)
                self.assertLess(np.abs(a[0:10].astype(float)-b[0:10]).mean(),4)
        original.release();edited.release()
    def test_compositor_exact_outside(self):
        rng=np.random.default_rng(1);a=rng.integers(0,256,(50,50,3),dtype=np.uint8);b=255-a
        mask=np.zeros((50,50),np.uint8);mask[10:20,10:20]=255
        out=m.composite(a,b,mask)
        np.testing.assert_array_equal(out[mask==0],a[mask==0])
    def test_candidate_and_mask_validation(self):
        r=self.request();r.update(operation='picture',candidate=self.candidate,start=0,end=2)
        with self.assertRaisesRegex(ValueError,'shorter'):m.render(r)
        with self.assertRaisesRegex(ValueError,'cover'):m.validate_masks([dict(time=.7,points=[[0,0],[1,0],[1,1]])],.5,1.5,False)
    def test_replace_audio_and_picture(self):
        audio=str(self.root/'sound.wav')
        m.run(['-f','lavfi','-i','sine=frequency=880:duration=1',audio])
        for op in ['replace_audio','picture','gain']:
            r=self.request();r.update(operation=op,audio=audio,candidate=self.candidate,gainDb=-6)
            result=m.render(r);self.assertTrue(result['hasAudio']);self.assertEqual(result['frames'],60)

if __name__=='__main__':unittest.main()
