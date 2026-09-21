"""Deterministic compositor regression fixtures, not a SAM accuracy benchmark.
Real video decoding, cleanup, blending and lossless encoding; fixture segmentation.
No provider calls, network, credentials, or billable generation.
"""
import unittest,tempfile,pathlib,subprocess
from unittest.mock import patch
import cv2,numpy as np
from object_repair import repair,protected_mask
from media_engine import FFMPEG

class FixtureSegmenter:
 def set_image(self,image):self.image=image
 def predict(self,**kwargs):
  image=self.image
  foreground=(image.max(axis=2)>220)&(image.min(axis=2)<40)
  return np.array([foreground]),np.array([1.0]),None

def write_video(path,frames):
 h,w=frames[0].shape[:2]
 subprocess.run([FFMPEG,'-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','30','-i','pipe:0','-c:v','ffv1',str(path)],input=b''.join(f.tobytes() for f in frames),check=True)

def read_video(path):
 cap=cv2.VideoCapture(str(path));frames=[]
 while True:
  ok,frame=cap.read()
  if not ok:break
  frames.append(frame)
 cap.release();return frames

class PipelineRegressionTests(unittest.TestCase):
 def fixture(self,folder,gap=False):
  a=[];b=[];masks=[]
  for i in range(12):
   # Intentionally changed provider background, which must not leak into output.
   source=np.full((96,160,3),70,np.uint8);candidate=np.full_like(source,78)
   x=48+i;source[30:62,x:x+24]=(0,0,245);candidate[30:62,x:x+24]=(245,0,0)
   # Moving, thin replacement detail extends outside the authored rectangle.
   candidate[48:51,x+24:x+31]=(245,0,0)
   if gap and 4<=i<7:candidate[:]=(245,0,0)
   else:masks.append({'time':i/30,'points':[[x/160,30/96],[(x+24)/160,30/96],[(x+24)/160,62/96],[x/160,62/96]]})
   a.append(source);b.append(candidate)
  source=folder/'source.mkv';replacement=folder/'replacement.mkv';write_video(source,a);write_video(replacement,b)
  q={'source':str(source),'candidate':str(replacement),'output':str(folder/'out.webm'),'reviewOutput':str(folder/'coverage.webm'),'start':0,'end':12/30,'scope':'range','masks':masks,'protectedAreas':[[[.02,.1],[.16,.1],[.16,.9],[.02,.9]]]}
  if gap:q['visibleRanges']=[{'start':0,'end':4/30},{'start':7/30,'end':12/30}]
  return q,a,b
 def test_moving_detail_and_protected_background_survive_encode(self):
  with tempfile.TemporaryDirectory() as tmp:
   q,a,b=self.fixture(pathlib.Path(tmp))
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):result=repair(q)
   frames=read_video(q['output']);self.assertEqual(result['verifiedFrames'],12)
   self.assertEqual(result['framesRepaired'],12)
   protected=protected_mask(q['protectedAreas'],160,96)!=0
   for i,out in enumerate(frames):
    np.testing.assert_array_equal(out[protected],a[i][protected])
    np.testing.assert_array_equal(out[:15],a[i][:15])
    np.testing.assert_array_equal(out[49,48+i+27],b[i][49,48+i+27])
 def test_unreviewed_occlusion_gap_stays_exactly_original(self):
  with tempfile.TemporaryDirectory() as tmp:
   q,a,b=self.fixture(pathlib.Path(tmp),gap=True)
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):result=repair(q)
   self.assertEqual(result['framesRepaired'],9)
   frames=read_video(q['output'])
   for i in range(4,7):np.testing.assert_array_equal(frames[i],a[i])
 def test_protected_conflict_does_not_publish_an_export(self):
  with tempfile.TemporaryDirectory() as tmp:
   q,a,b=self.fixture(pathlib.Path(tmp));q['protectedAreas']=[[[0,0],[1,0],[1,1],[0,1]]]
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):
    with self.assertRaisesRegex(ValueError,'protected area'):repair(q)
   self.assertFalse(pathlib.Path(q['output']).exists())
 def test_fast_motion_does_not_leave_a_trail(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=pathlib.Path(tmp);q,a,b=self.fixture(folder);q['protectedAreas']=[];q['masks']=[]
   for i in range(12):
    x=12+i*10;a[i][:]=70;b[i][:]=78
    a[i][32:58,x:x+15]=(0,0,245);b[i][32:58,x:x+15]=(245,0,0)
    q['masks'].append({'time':i/30,'points':[[x/160,32/96],[(x+15)/160,32/96],[(x+15)/160,58/96],[x/160,58/96]]})
   write_video(q['source'],a);write_video(q['candidate'],b)
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):repair(q)
   for i,out in enumerate(read_video(q['output'])):
    np.testing.assert_array_equal(out[:15],a[i][:15])
    np.testing.assert_array_equal(out[40,15+i*10],b[i][40,15+i*10])
    if i>=3:np.testing.assert_array_equal(out[40,15+(i-3)*10],a[i][40,15+(i-3)*10])
 def test_frames_outside_selected_interval_are_original(self):
  with tempfile.TemporaryDirectory() as tmp:
   q,a,b=self.fixture(pathlib.Path(tmp));q['start']=3/30;q['end']=9/30
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):repair(q)
   frames=read_video(q['output'])
   for i in [0,1,2,9,10,11]:np.testing.assert_array_equal(frames[i],a[i])
 def test_reference_resolution_does_not_reduce_final_resolution(self):
  with tempfile.TemporaryDirectory() as tmp:
   q,a,b=self.fixture(pathlib.Path(tmp))
   # Simulates a smaller provider result; final canvas must remain source-sized.
   write_video(q['candidate'],[cv2.resize(f,(80,48),interpolation=cv2.INTER_NEAREST) for f in b])
   with patch('object_repair.predictor',return_value=FixtureSegmenter()):repair(q)
   self.assertEqual(read_video(q['output'])[0].shape,a[0].shape)
if __name__=='__main__':unittest.main()
