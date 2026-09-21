import unittest
import numpy as np
import cv2
from transformation_core import compose_transformation,align_background

class TransformationTests(unittest.TestCase):
 def scene(self):
  bg=np.random.default_rng(12).integers(20,200,(240,320,3),dtype=np.uint8)
  old=np.zeros((240,320),np.uint8);old[130:180,110:150]=1
  new=np.zeros_like(old);new[65:160,165:190]=1
  allowed=np.zeros_like(old);allowed[50:195,95:205]=1
  a=bg.copy();b=bg.copy();a[old>0]=[0,200,240];b[new>0]=[200,50,20]
  return a,b,old,new,allowed,np.zeros_like(old),bg
 def test_disjoint_replacement_and_reconstructed_background(self):
  a,b,old,new,env,protected,bg=self.scene()
  out,support,_,_=compose_transformation(a,b,old,new,env,protected)
  np.testing.assert_array_equal(out[old>0],bg[old>0])
  np.testing.assert_array_equal(out[new>0],b[new>0])
  np.testing.assert_array_equal(out[~support],a[~support])
  self.assertTrue(np.all(~support|env.astype(bool)))
 def test_never_expand_permission_or_overwrite_protected_area(self):
  a,b,old,new,env,p,_=self.scene();p[80:90,170:180]=1
  with self.assertRaisesRegex(ValueError,'keep unchanged'):compose_transformation(a,b,old,new,env,p)
  env[:,180:]=0
  with self.assertRaisesRegex(ValueError,'outside'):compose_transformation(a,b,old,new,env,np.zeros_like(p))
 def test_changed_camera_requires_policy(self):
  a,b,old,new,env,p,_=self.scene();b=np.roll(b,8,axis=1)
  with self.assertRaisesRegex(ValueError,'camera or background'):compose_transformation(a,b,old,new,env,p)
 def test_planar_translation_can_be_aligned(self):
  a,b,old,new,env,p,_=self.scene();matrix=np.float32([[1,0,8],[0,1,4]])
  b=cv2.warpAffine(b,matrix,(320,240));new=cv2.warpAffine(new,matrix,(320,240))
  out,support,_,check=compose_transformation(a,b,old,new,env,p,'align')
  self.assertEqual(check['method'],'background-homography');np.testing.assert_array_equal(out[~support],a[~support])
 def test_unrelated_background_abstains(self):
  a,b,old,new,env,p,_=self.scene();b=np.random.default_rng(99).integers(0,255,b.shape,dtype=np.uint8)
  with self.assertRaises(ValueError):compose_transformation(a,b,old,new,env,p,'align')
 def test_large_permission_area_does_not_hide_background_landmarks(self):
  a,b,old,new,env,p,_=self.scene();env[:]=1
  matrix=np.float32([[1,0,8],[0,1,4]])
  b=cv2.warpAffine(b,matrix,(320,240));new=cv2.warpAffine(new,matrix,(320,240))
  out,support,_,check=compose_transformation(a,b,old,new,env,p,'align')
  self.assertEqual(check['method'],'background-homography')
  np.testing.assert_array_equal(out[~support],a[~support])
 def test_full_video_preserves_unselected_frames_and_publishes_proof(self):
  import tempfile,pathlib,subprocess
  from media_engine import FFMPEG
  from transformation_engine import render
  a,b,old,new,env,p,_=self.scene()
  def poly(x1,y1,x2,y2):return [[x1/319,y1/239],[x2/319,y1/239],[x2/319,y2/239],[x1/319,y2/239]]
  with tempfile.TemporaryDirectory() as folder:
   root=pathlib.Path(folder)
   for name,frame in [('source',a),('candidate',b)]:
    result=subprocess.run([FFMPEG,'-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s','320x240','-r','30','-i','pipe:0','-c:v','ffv1',str(root/(name+'.mkv'))],input=frame.tobytes()*30,capture_output=True)
    self.assertEqual(result.returncode,0)
   q={'source':str(root/'source.mkv'),'candidate':str(root/'candidate.mkv'),'output':str(root/'out.webm'),'reviewOutput':str(root/'coverage.webm'),'start':.2,'end':.5,'candidateOffset':.2,'reviewed':True,'cameraPolicy':'fixed','masks':[{'time':f/30,'points':poly(110,130,149,179)} for f in range(6,15)],'replacementMasks':[{'time':f/30,'points':poly(165,65,189,159)} for f in range(6,15)],'envelope':poly(95,50,205,195)}
   result=render(q);self.assertEqual(result['transformationVerification']['verifiedFrames'],30)
   cap=cv2.VideoCapture(q['output']);i=0
   while True:
    ok,frame=cap.read()
    if not ok:break
    if i<6 or i>=15:np.testing.assert_array_equal(frame,a)
    else:
     np.testing.assert_array_equal(frame[env==0],a[env==0]);np.testing.assert_array_equal(frame[new>0],b[new>0])
    i+=1
   cap.release();self.assertEqual(i,30)
   q.update(mode='scene',sceneApproved=True)
   scene=render(q);self.assertEqual(scene['transformationVerification']['pipeline'],'scene-replacement-v1')
   cap=cv2.VideoCapture(q['output']);i=0
   while True:
    ok,frame=cap.read()
    if not ok:break
    np.testing.assert_array_equal(frame,b if 6<=i<15 else a);i+=1
   cap.release();self.assertEqual(i,30)


if __name__=='__main__':unittest.main()
