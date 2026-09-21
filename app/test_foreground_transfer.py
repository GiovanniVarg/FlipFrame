import unittest
import numpy as np
from foreground_transfer import build_clean_plate, compose_foreground
class ForegroundTests(unittest.TestCase):
 def test_donors_only_fill_observed_unmasked_pixels(self):
  bg=np.full((40,60,3),80,np.uint8);frames=[];masks=[]
  for x in [5,25,45]:
   mask=np.zeros((40,60),np.uint8);mask[10:20,x:x+5]=1;frame=bg.copy();frame[mask>0]=240;frames.append(frame);masks.append(mask)
  plate,valid=build_clean_plate(frames,masks);self.assertTrue(valid[12,7]);np.testing.assert_array_equal(plate[12,7],bg[12,7])
 def test_unknown_background_blocks(self):
  a=np.zeros((40,60,3),np.uint8);mask=np.zeros((40,60),np.uint8);mask[10:20,10:20]=1
  plate,valid=build_clean_plate([a,a],[mask,mask]);self.assertFalse(valid[15,15])
  with self.assertRaisesRegex(ValueError,'unobserved'):compose_foreground(a,a,mask,mask,np.ones_like(mask),np.zeros_like(mask),plate,valid,{'scale':1,'x':0,'y':0})
 def test_candidate_background_is_never_copied(self):
  a=np.full((40,60,3),80,np.uint8);old=np.zeros((40,60),np.uint8);old[20:25,10:15]=1;a[old>0]=240
  new=np.zeros_like(old);new[10:25,30:35]=1;b=np.full_like(a,220);b[new>0]=[10,20,30]
  plate=np.full_like(a,80);out,support=compose_foreground(a,b,old,new,np.ones_like(old),np.zeros_like(old),plate,np.ones_like(old,dtype=bool),{'scale':1,'x':0,'y':0})
  np.testing.assert_array_equal(out[old>0],plate[old>0]);np.testing.assert_array_equal(out[new>0],b[new>0]);np.testing.assert_array_equal(out[~support],a[~support])
if __name__=='__main__':unittest.main()
