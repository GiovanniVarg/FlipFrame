import unittest,tempfile,pathlib
import numpy as np,cv2
from precision_recolor import paint,recolor
from test_repair_pipeline import write_video,read_video
class PrecisionColorTests(unittest.TestCase):
 def test_only_matching_masked_color_changes(self):
  a=np.full((30,40,3),80,np.uint8);a[5:20,10:30]=(0,220,220);a[10:13,15:20]=255
  m=np.zeros((30,40),np.uint8);m[:,0:22]=1
  out,allowed=paint(a,m,'#ffd000','#0047ab')
  np.testing.assert_array_equal(out[~allowed],a[~allowed]);self.assertTrue(np.any(out!=a));np.testing.assert_array_equal(out[10:13,15:20],a[10:13,15:20])
  np.testing.assert_array_equal(cv2.cvtColor(out,cv2.COLOR_BGR2HSV)[:,:,2],cv2.cvtColor(a,cv2.COLOR_BGR2HSV)[:,:,2])
 def test_moving_geometry_and_unselected_frames_survive_lossless_encoding(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=pathlib.Path(tmp);frames=[];masks=[]
   for i in range(8):
    f=np.full((48,80,3),75,np.uint8);x=10+i*3;f[15:30,x:x+15]=(0,220,220);frames.append(f)
    if 2<=i<6:masks.append({'time':i/30,'points':[[x/79,15/47],[(x+14)/79,15/47],[(x+14)/79,29/47],[x/79,29/47]]})
   source=d/'source.mkv';output=d/'out.mkv';write_video(source,frames)
   result=recolor({'source':str(source),'output':str(output),'start':2/30,'end':6/30,'scope':'range','masks':masks,'recolor':{'source':'#ffd000','target':'#0047ab'}})
   decoded=read_video(output);self.assertEqual(result['precisionVerification']['verifiedFrames'],8)
   for i,frame in enumerate(decoded):
    if i not in range(2,6):np.testing.assert_array_equal(frame,frames[i])
    np.testing.assert_array_equal(frame.max(2),frames[i].max(2))
    np.testing.assert_array_equal(np.any(frame!=75,axis=2),np.any(frames[i]!=75,axis=2))
 def test_unknown_frames_fail_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=pathlib.Path(tmp);source=d/'s.mkv';write_video(source,[np.full((32,32,3),100,np.uint8)]*4)
   masks=[{'time':i/30,'points':[[0,0],[1,0],[1,1],[0,1]]} for i in [0,3]]
   with self.assertRaisesRegex(ValueError,'every selected frame'):recolor({'source':str(source),'output':str(d/'o.mkv'),'start':0,'end':4/30,'scope':'range','masks':masks,'recolor':{'source':'#ffd000','target':'#0047ab'}})
if __name__=='__main__':unittest.main()
