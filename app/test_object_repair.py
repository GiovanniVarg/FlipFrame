import unittest, tempfile, pathlib, hashlib, subprocess
import numpy as np
from object_repair import checked_union,blend,cleanup_region,verify_encoded_frames,solid_cleanup_core
from media_engine import FFMPEG
class RepairTests(unittest.TestCase):
 def test_union_keeps_both_silhouettes_and_authored_region(self):
  authored=np.zeros((60,60),np.uint8);authored[20:40,20:40]=255
  old=authored>0;new=old.copy();new[15:20,25:35]=True
  region=checked_union(authored,old,new)
  self.assertTrue(region[16,30]);self.assertTrue(np.all(region[authored>0]))
 def test_unrelated_and_runaway_segmentation_stop(self):
  a=np.zeros((60,60),np.uint8);a[20:30,20:30]=255
  for bad in [np.ones((60,60),bool),np.zeros((60,60),bool),np.pad(np.ones((10,10),bool),((0,50),(0,50)))]:
   with self.assertRaises(ValueError):checked_union(a,a>0,bad)
 def test_cleanup_includes_connected_fragment_but_not_distant_change(self):
  a=np.zeros((100,100,3),np.uint8);b=a.copy();r=np.zeros((100,100),np.uint8);r[30:70,40:60]=1
  b[45:55,58:67]=200;b[0:10,0:10]=255
  result=cleanup_region(a,b,r)
  self.assertTrue(result[50,65]);self.assertFalse(result[5,5])
 def test_blending_preserves_every_pixel_outside_explicit_support(self):
  a=np.full((60,60,3),17,np.uint8);b=np.full_like(a,230);r=np.zeros((60,60),np.uint8);r[20:40,20:40]=1
  out,support=blend(a,b,r,4)
  np.testing.assert_array_equal(out[support==0],a[support==0]);np.testing.assert_array_equal(out[30,30],b[30,30])
  self.assertTrue(((out>17)&(out<230)).any())
class AdaptiveCleanupTests(unittest.TestCase):
 def test_connected_flapping_tip_expands_beyond_initial_band(self):
  a=np.zeros((200,200,3),np.uint8);b=a.copy();r=np.zeros((200,200),np.uint8);r[40:160,95:115]=1
  b[140:150,75:100]=180
  result=cleanup_region(a,b,r)
  self.assertTrue(result[145,75]);self.assertFalse(result[10,10])
 def test_runaway_connected_change_requires_outline_instead_of_silent_clipping(self):
  a=np.zeros((600,600,3),np.uint8);b=np.full_like(a,230);r=np.zeros((600,600),np.uint8);r[200:400,290:310]=1
  with self.assertRaisesRegex(ValueError,'outline|selection'):cleanup_region(a,b,r)

class CleanupCoreTests(unittest.TestCase):
 def test_interior_holes_and_hem_are_opaque_but_distant_pixels_preserved(self):
  r=np.zeros((100,100),np.uint8);r[30:70,40:60]=1;r[40:45,45:50]=0
  core=solid_cleanup_core(r,3)
  a=np.full((100,100,3),200,np.uint8);b=np.full_like(a,30)
  out,support=blend(a,b,core,3)
  np.testing.assert_array_equal(out[42,47],b[42,47])
  np.testing.assert_array_equal(out[50,63],b[50,63])
  np.testing.assert_array_equal(out[support==0],a[support==0])
  self.assertFalse(support[5,5])

class LosslessTests(unittest.TestCase):
 def test_rgb_codec_round_trip_and_corruption_gate(self):
  with tempfile.TemporaryDirectory() as d:
   frame=np.random.default_rng(7).integers(0,256,(64,64,3),dtype=np.uint8);p=pathlib.Path(d)/'lossless.webm'
   subprocess.run([FFMPEG,'-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s','64x64','-r','30','-i','pipe:0','-c:v','libvpx-vp9','-lossless','1','-pix_fmt','gbrp','-colorspace','rgb',str(p)],input=frame.tobytes(),check=True)
   self.assertEqual(verify_encoded_frames(p,[hashlib.sha256(frame.tobytes()).digest()]),1)
   with self.assertRaises(ValueError):verify_encoded_frames(p,[b'wrong'])
   with self.assertRaises(ValueError):verify_encoded_frames(p,[])
class ProtectionTests(unittest.TestCase):
 def test_protected_area_rejects_feather_overlap(self):
  from object_repair import protected_mask,check_protection
  protected=protected_mask([[[.5,.5],[.8,.5],[.8,.8],[.5,.8]]],100,100)
  region=np.zeros((100,100),np.uint8);region[40:49,40:49]=1
  a=np.zeros((100,100,3),np.uint8);b=np.full_like(a,255)
  out,support=blend(a,b,region,5)
  with self.assertRaisesRegex(ValueError,'protected'):check_protection(support,protected,12)
  check_protection(region,protected,12)
  out,support=blend(a,b,region,0)
  check_protection(support,protected,12)
  np.testing.assert_array_equal(out[protected!=0],a[protected!=0])
 def test_protected_area_validation(self):
  from object_repair import protected_mask
  for areas in [[[[.1,.1],[.2,.2],[.3,.3]]],None,[[[0,0],[1,0]]],[[[2,0],[1,0],[1,1]]]]:
   with self.assertRaises(ValueError):protected_mask(areas,100,100)

if __name__=='__main__':unittest.main()
