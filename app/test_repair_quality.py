import unittest
from repair_quality import summarize
class QualityTests(unittest.TestCase):
 def row(self,i,area=100,coverage=150,x=10):return dict(frame=i,selectedPixels=area,coveragePixels=coverage,centerX=x,centerY=10)
 def test_stable(self):self.assertEqual(summarize([self.row(0),self.row(1)],1000,1000)['flaggedFrames'],0)
 def test_expansion(self):self.assertIn('wide-cleanup',summarize([self.row(0,coverage=400)],100,100)['warnings'][0]['reasons'])
 def test_jump_and_area(self):self.assertEqual(set(summarize([self.row(0),self.row(1,area=300,x=500)],1000,1000)['warnings'][0]['reasons']),{'area-change','position-jump'})
 def test_visibility_gap(self):self.assertEqual(summarize([self.row(0),self.row(10,x=500)],1000,1000)['flaggedFrames'],0)
 def test_bounded(self):self.assertEqual(len(summarize([self.row(i,coverage=400) for i in range(100)],100,100)['warnings']),30)
if __name__=='__main__':unittest.main()
