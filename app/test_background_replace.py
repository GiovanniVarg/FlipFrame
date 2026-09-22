import pathlib, tempfile, unittest, subprocess, io, json
from contextlib import redirect_stderr
import numpy as np
from background_replace import replace_background
from media_engine import FFMPEG, run, probe
from test_repair_pipeline import write_video, read_video

class BackgroundReplacementTests(unittest.TestCase):
    def test_donut_hole_changes_foreground_outside_range_gaps_and_audio_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            frames=[np.full((48,64,3),(15+i,90,180),np.uint8) for i in range(8)]
            background=[np.full((48,64,3),(220,35,25),np.uint8)]*4
            raw=root/'raw.mkv';source=root/'source.mkv';candidate=root/'bg.mkv';output=root/'out.mkv'
            write_video(raw,frames);write_video(candidate,background)
            run(['-i',str(raw),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.266666667','-map','0:v','-map','1:a','-c:v','copy','-c:a','pcm_s16le',str(source)])
            # Outer rectangle 10..50 x 8..40; internal hole 24..34 x 20..28.
            points=[[10/63,8/47],[50/63,8/47],[50/63,40/47],[10/63,40/47]]
            holes=[[[24/63,20/47],[34/63,20/47],[34/63,28/47],[24/63,28/47]]]
            masks=[dict(time=i/30,points=points,holes=holes) for i in [2,3,5]]
            result=replace_background(dict(source=str(source),candidate=str(candidate),output=str(output),start=2/30,end=6/30,masks=masks,scope='range'))
            actual=read_video(output);self.assertEqual(len(actual),8)
            for i in [0,1,4,6,7]:np.testing.assert_array_equal(actual[i],frames[i])
            for i in [2,3,5]:
                np.testing.assert_array_equal(actual[i][12,15],frames[i][12,15])
                np.testing.assert_array_equal(actual[i][24,28],background[0][24,28])
                np.testing.assert_array_equal(actual[i][0,0],background[0][0,0])
            def audio(file):
                return subprocess.run([FFMPEG,'-v','error','-i',str(file),'-map','0:a:0','-c:a','copy','-f','s16le','pipe:1'],capture_output=True,check=True).stdout
            self.assertEqual(audio(source),audio(output))
            self.assertEqual(result['precisionVerification']['editedFrames'],3)
            self.assertEqual(result['precisionVerification']['unchangedSelectedFrames'],1)
            self.assertEqual(probe(output)['duration'],probe(source)['duration'])

    def test_missing_masks_preserve_every_pixel(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'s.mkv';candidate=root/'b.mkv';output=root/'o.mkv'
            frames=[np.full((32,32,3),90,np.uint8)]*3
            write_video(source,frames);write_video(candidate,[np.full((32,32,3),200,np.uint8)]*3)
            progress=io.StringIO()
            with redirect_stderr(progress):
                result=replace_background(dict(source=str(source),candidate=str(candidate),output=str(output),start=0,end=.1,masks=[]))
            events=[json.loads(line.split(' ',1)[1]) for line in progress.getvalue().splitlines() if line.startswith('FLIPFRAME_PROGRESS ')]
            self.assertTrue({'preparing','compositing','encoding','verifying'} <= {event['stage'] for event in events})
            for stage in ['compositing','encoding','verifying']:
                stage_events=[event for event in events if event['stage']==stage]
                self.assertEqual(stage_events[0]['completed'],0)
                self.assertEqual(stage_events[-1]['completed'],3)
                self.assertEqual(stage_events[-1]['total'],3)
            for frame in read_video(output):np.testing.assert_array_equal(frame,frames[0])
            self.assertEqual(result['precisionVerification']['changedPixels'],0)

    def test_visible_ranges_limit_valid_masks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'s.mkv';candidate=root/'b.mkv';output=root/'o.mkv'
            frames=[np.full((32,32,3),90,np.uint8)]*3
            write_video(source,frames);write_video(candidate,[np.full((32,32,3),200,np.uint8)]*3)
            masks=[dict(time=i/30,points=[[.25,.25],[.75,.25],[.75,.75],[.25,.75]]) for i in range(3)]
            replace_background(dict(source=str(source),candidate=str(candidate),output=str(output),start=0,end=.1,masks=masks,visibleRanges=[dict(start=1/30,end=2/30)]))
            actual=read_video(output)
            np.testing.assert_array_equal(actual[0],frames[0]);np.testing.assert_array_equal(actual[2],frames[2])
            self.assertEqual(int(actual[1][0,0,0]),200)

if __name__=='__main__':unittest.main()
