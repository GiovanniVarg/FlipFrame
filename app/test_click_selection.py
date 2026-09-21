import unittest
from segmentation import selection_prompts, boundary_matches_clicks
class ClickSelectionTests(unittest.TestCase):
 def test_clicks_scale_and_preserve_exclusions(self):
  coords,labels,box=selection_prompts(None,101,201,[{'point':[.5,.25],'label':1},{'point':[.8,.6],'label':0}])
  self.assertAlmostEqual(float(coords[0,0]),50);self.assertAlmostEqual(float(coords[1,1]),120,places=4)
  self.assertEqual(labels.tolist(),[1,0]);self.assertIsNone(box)
 def test_reject_invalid_clicks(self):
  for clicks in [[],[{'point':[.2,.3],'label':0}],[{'point':[2,0],'label':1}],[{'point':[.2,.3],'label':2}]]:
   with self.assertRaises(ValueError):selection_prompts(None,100,100,clicks)
 def test_rejects_boundary_ignoring_exclusion(self):
  polygon=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
  self.assertFalse(boundary_matches_clicks(polygon,[{'point':[.5,.5],'label':1},{'point':[.8,.5],'label':0}]))
  self.assertTrue(boundary_matches_clicks(polygon,[{'point':[.5,.5],'label':1},{'point':[.99,.5],'label':0}]))
 def test_polygon_compatible(self):
  coords,labels,box=selection_prompts([[.1,.1],[.9,.1],[.9,.9],[.1,.9]],101,101,None)
  self.assertEqual(labels[0],1);self.assertIsNotNone(box)
if __name__=='__main__':unittest.main()
