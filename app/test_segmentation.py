import unittest, tempfile, pathlib, os
import numpy as np
import cv2
from segmentation import prompts, boundary, validate_polygon, segment_image, segment_video, summarize_masks, resample_boundary, CHECKPOINT
class SegmentationTests(unittest.TestCase):
    def test_concave_selection_uses_interior_positive(self):
        poly=[[.1,.1],[.9,.1],[.9,.3],[.3,.3],[.3,.9],[.1,.9]]
        coords, labels, box=prompts(poly,100,100)
        self.assertEqual(labels[0],1)
        self.assertGreaterEqual(cv2.pointPolygonTest(np.array(poly,np.float32)*99,tuple(map(float,coords[0])),False),0)
    def test_boundary_selects_seed_component_and_is_bounded(self):
        mask=np.zeros((200,200),np.uint8)
        cv2.circle(mask,(50,50),30,1,-1); cv2.rectangle(mask,(100,100),(190,190),1,-1)
        result=boundary(mask,[50,50])
        self.assertGreaterEqual(len(result),3); self.assertLessEqual(len(result),256)
        self.assertTrue(all(x<.5 and y<.5 for x,y in result))
    def test_resampling_has_fixed_vertex_count(self):
        points=resample_boundary([[0,0],[1,0],[1,1],[0,1]])
        self.assertEqual(len(points),256)
        self.assertTrue(np.isfinite(points).all())
    def test_fine_boundary_survives_polygon_conversion(self):
        angles=np.linspace(0,2*np.pi,240,endpoint=False)
        radii=np.where(np.arange(240)%2,140,155)
        vertices=np.column_stack([200+radii*np.cos(angles),200+radii*np.sin(angles)]).round().astype(np.int32)
        mask=np.zeros((400,400),np.uint8)
        cv2.fillPoly(mask,[vertices],1)
        points=boundary(mask)
        self.assertGreater(len(points),64)
        self.assertLessEqual(len(points),256)
        restored=np.zeros_like(mask)
        cv2.fillPoly(restored,[np.rint(np.asarray(points)*399).astype(np.int32)],1)
        iou=np.count_nonzero(mask & restored)/np.count_nonzero(mask | restored)
        self.assertGreater(iou,.97)

    def test_gaps_remove_empty_masks_without_bridging(self):
        points=[[0,0],[1,0],[1,1]]
        result=summarize_masks([{'time':i/30,'points':points if i!=1 else [],'visible':i!=1} for i in range(3)],30)
        self.assertEqual(len(result['masks']),2)
        self.assertEqual(len(result['visibleRanges']),2)
        self.assertEqual(result['gaps'][0]['start'],1/30)
        self.assertEqual(result['gaps'][0]['end'],2/30)
        self.assertEqual(result['status'],'partial')
    def test_invalid_polygons_fail(self):
        for poly in [[[0,0],[1,1]], [[0,0],[1,1],[float('nan'),.2]], [[0,0],[1,1],[2,0]]]:
            with self.assertRaises(ValueError): validate_polygon(poly)
    @unittest.skipUnless(os.environ.get('SAM2_SMOKE')=='1','Explicit model smoke test')
    def test_real_model_synthetic_object(self):
        image=np.full((256,256,3),[35,65,90],np.uint8)
        cv2.ellipse(image,(128,125),(36,85),0,0,360,(235,230,220),-1)
        result=segment_image(image,[[.30,.10],[.70,.10],[.70,.90],[.30,.90]])
        self.assertEqual(result['method'],'sam2.1-hiera-tiny')
        self.assertTrue(result['genuineSegmentation'])
        self.assertGreater(result['confidence'],.5)
        self.assertLessEqual(len(result['points']),256)
        self.assertGreater(result['maskAreaPixels'],1000)
        self.assertLess(result['maskAreaPixels'],25000)
        print('SAM2_SMOKE', {k:v for k,v in result.items() if k!='points'})
    @unittest.skipUnless(os.environ.get('SAM2_VIDEO_SMOKE')=='1','Explicit video model smoke test')
    def test_real_video_three_native_frames(self):
        with tempfile.TemporaryDirectory() as folder:
            path=pathlib.Path(folder)/'moving.mp4'
            writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'mp4v'),3,(256,256))
            for offset in [0,8,16]:
                frame=np.full((256,256,3),[90,65,35],np.uint8)
                cv2.ellipse(frame,(100+offset,125),(30,75),0,0,360,(220,230,235),-1)
                writer.write(frame)
            writer.release()
            result=segment_video(str(path),0,1,[[.27,.12],[.58,.12],[.58,.86],[.27,.86]],reference_time=1/3)
            self.assertEqual(result['frameCount'],3)
            self.assertFalse(result['sparseSamples'])
            self.assertEqual(len(result['masks']),3)
            self.assertEqual(result['status'],'complete')
            self.assertEqual(result['gaps'],[])
            self.assertEqual(result['visibleRanges'],[{'start':0.0,'end':1.0}])
            self.assertTrue(result['requiresReview'])
            self.assertEqual([m['time'] for m in result['masks']],[0.0,1/3,2/3])
            for mask in result['masks']:
                self.assertTrue(mask['visible'])
                self.assertEqual(len(mask['points']),256)
            print('SAM2_VIDEO_SMOKE',{'frames':result['frameCount'],'device':result['device']})
if __name__=='__main__': unittest.main()
