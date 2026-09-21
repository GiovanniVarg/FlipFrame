import unittest,tempfile,pathlib,subprocess
import cv2,numpy as np
from PIL import Image
from local_edit import edit,transform,mapping,planar
from test_repair_pipeline import write_video,read_video
from media_engine import FFMPEG
class LocalEditTests(unittest.TestCase):
 def fixture(self,d):
  frames=[]
  for i in range(12):
   f=np.full((64,96,3),50+i*3,np.uint8);f[15:40,20+i:50+i]=(10,180,240);frames.append(f)
  path=d/'source.mkv';write_video(path,frames)
  sound=d/'sound.mkv';subprocess.run([FFMPEG,'-v','error','-y','-i',str(path),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-map','0:v','-map','1:a','-c:v','copy','-c:a','pcm_s16le','-t','0.4',str(sound)],check=True)
  masks=[{'time':i/30,'points':[[.15,.15],[.85,.15],[.85,.8],[.15,.8]]} for i in range(3,9)]
  image=d/'image.png';Image.new('RGBA',(30,20),(255,0,0,180)).save(image)
  return frames,{'source':str(sound),'output':str(d/'out.mkv'),'start':.1,'end':.3,'scope':'range','masks':masks,'reference':str(image),'params':{}}
 def test_all_tools_encode_and_match_expected_contracts(self):
  tools={'blur':{},'pixelate':{},'exposure':{'amount':1},'contrast':{'amount':1.2},'title':{'text':'Hello 123'},'logo':{},'planar':{},'trim':{},'cut':{},'move_start':{},'move_end':{},'speed':{'amount':2},'freeze':{},'split':{},'crop':{'ratio':1},'resize':{'width':64,'height':64},'fade_in':{},'fade_out':{}}
  with tempfile.TemporaryDirectory() as tmp:
   d=pathlib.Path(tmp);original,q=self.fixture(d)
   for tool,params in tools.items():
    with self.subTest(tool=tool):
     req={**q,'tool':tool,'params':params}
     if tool in {'crop','resize'}:req.update(start=0,end=.4)
     result=edit(req);out=read_video(q['output']);self.assertEqual(len(out),result['mediaMetadata']['frames'])
     if tool in {'trim','cut','move_start','move_end','speed','freeze'}:
      indices,_=mapping(tool,12,3,9,params)
      for i,frame in enumerate(out):np.testing.assert_array_equal(frame,original[indices[i]])
     elif tool in {'blur','pixelate','exposure','contrast','title','logo','planar'}:
      for i in [0,1,2,9,10,11]:np.testing.assert_array_equal(out[i],original[i])
      if tool not in {'title','logo'}:
       for i in range(3,9):np.testing.assert_array_equal(out[i][0:5],original[i][0:5])
     elif tool in {'fade_in','fade_out','split'}:
      for a,b in zip(out,original):np.testing.assert_array_equal(a,b)
 def test_filters_do_not_touch_pixels_outside_mask(self):
  a=np.random.default_rng(42).integers(0,255,(64,96,3),dtype=np.uint8);m=np.zeros((64,96),np.uint8);m[10:20,10:20]=1
  for tool,params in [('blur',{}),('pixelate',{}),('exposure',{'amount':1}),('contrast',{'amount':1.5})]:
   out,allowed=transform(a,m,tool,params);np.testing.assert_array_equal(out[~allowed],a[~allowed])
 def test_invalid_planar_corners_fail(self):
  with self.assertRaises(ValueError):planar(np.zeros((64,96,3),np.uint8),np.zeros((10,10,4),np.uint8),[[0,0],[1,1],[1,0],[0,1]])
 def test_occlusion_gap_stays_original(self):
  with tempfile.TemporaryDirectory() as tmp:
   original,q=self.fixture(pathlib.Path(tmp));q.update(tool='blur',visibleRanges=[{'start':.1,'end':5/30},{'start':7/30,'end':.3}]);q['masks']=[m for m in q['masks'] if round(m['time']*30) not in [5,6]]
   edit(q);out=read_video(q['output'])
   for i in [5,6]:np.testing.assert_array_equal(out[i],original[i])
if __name__=='__main__':unittest.main()
