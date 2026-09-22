import pathlib,tempfile,unittest,subprocess,hashlib
import numpy as np
from media_engine import playback_preview,run,FFMPEG,probe,video_packet_count
from test_repair_pipeline import write_video

class PlaybackPreviewTests(unittest.TestCase):
    def test_h264_audio_timeline_and_master_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);raw=root/'raw.mkv';source=root/'master.mkv';output=root/'preview.mp4'
            write_video(raw,[np.full((48,64,3),(i,90,180),np.uint8) for i in range(45)])
            run(['-i',str(raw),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.53','-map','0:v','-map','1:a','-c:v','copy','-c:a','pcm_s16le',str(source)])
            self.assertGreater(probe(str(source))['frames'],video_packet_count(str(source)))
            original=hashlib.sha256(source.read_bytes()).digest()
            result=playback_preview({'source':str(source),'output':str(output)})
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),original)
            self.assertEqual(result['frames'],45);self.assertEqual(result['duration'],1.5)
            self.assertEqual((result['width'],result['height']),(64,48));self.assertTrue(result['hasAudio'])
            metadata=subprocess.run([FFMPEG,'-hide_banner','-i',str(output)],capture_output=True).stderr.decode(errors='replace')
            self.assertIn('h264',metadata);self.assertIn('yuv420p',metadata);self.assertIn('aac',metadata)
            binary=output.read_bytes();self.assertLess(binary.index(b'moov'),binary.index(b'mdat'))

    def test_downscales_to_720_height_without_retiming(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);source=root/'master.mkv';output=root/'preview.mp4'
            write_video(source,[np.full((800,1280,3),90,np.uint8)]*3)
            result=playback_preview({'source':str(source),'output':str(output)})
            self.assertEqual((result['width'],result['height']),(1152,720))
            self.assertEqual(result['frames'],3);self.assertFalse(result['hasAudio'])

    def test_same_path_rejected_before_writing(self):
        with self.assertRaisesRegex(ValueError,'differ'):
            playback_preview({'source':'same.mp4','output':'same.mp4'})

if __name__=='__main__':unittest.main()
