import unittest
import numpy as np
import cv2
from segmentation import mask_geometry, boundary_matches_clicks, hole_seed_clicks, selection_prompts, seed_video_predictor
from media_engine import validate_masks, mask_at

class MaskHolesTests(unittest.TestCase):
    def test_donut_preserves_object_and_excludes_opening(self):
        source = np.zeros((101,101),np.uint8)
        cv2.rectangle(source,(10,10),(90,90),1,-1)
        cv2.rectangle(source,(35,35),(65,65),0,-1)
        geometry = mask_geometry(source,[20,20])
        self.assertEqual(len(geometry['holes']),1)
        checked = validate_masks([dict(time=0,**geometry)],0,1/30,True)
        result = mask_at(checked,0,101,101)
        self.assertEqual(result[50,50],0)
        self.assertEqual(result[20,20],255)
        self.assertEqual(result[34,50],255)
        self.assertTrue(np.array_equal(result != 0, source != 0))

    def test_topology_change_does_not_interpolate_hole(self):
        outer = [[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
        hole = [[.4,.4],[.6,.4],[.6,.6],[.4,.6]]
        checked = validate_masks([{'time':0,'points':outer,'holes':[hole]},
                                  {'time':1/30,'points':outer,'holes':[]}],0,2/30,False)
        self.assertEqual(mask_at(checked,0,101,101)[50,50],0)
        self.assertEqual(mask_at(checked,1/30,101,101)[50,50],255)
        self.assertEqual(mask_at(checked,.03,101,101)[50,50],255)

    def test_holes_are_bounded_and_normalized(self):
        outer = [[0,0],[1,0],[1,1],[0,1]]
        for holes in ([[[0,0],[2,0],[0,1]]], [outer]*65, 'bad'):
            with self.assertRaises(ValueError):
                validate_masks([{'time':0,'points':outer,'holes':holes}],0,1/30,True)

    def test_exclude_click_inside_opening_is_honored(self):
        points=[[0,0],[1,0],[1,1],[0,1]]
        holes=[[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]]
        self.assertTrue(boundary_matches_clicks(points,[{'point':[.5,.5],'label':0}],holes))
        self.assertFalse(boundary_matches_clicks(points,[{'point':[.5,.5],'label':1}],holes))

    def test_saved_opening_becomes_exclude_seed_after_seek(self):
        outer=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
        holes=[[[.3,.3],[.7,.3],[.7,.7],[.3,.7]]]
        clicks=hole_seed_clicks(outer,holes=holes)
        self.assertEqual([c['label'] for c in clicks],[1,0])
        self.assertTrue(boundary_matches_clicks(outer,clicks,holes))
        self.assertFalse(boundary_matches_clicks(outer,clicks,[]))
        coords,labels,box=selection_prompts(outer,100,100,holes=holes)
        self.assertEqual(list(labels),[1,0])
        self.assertEqual(coords.shape,(2,2))

    def test_saved_opening_does_not_erase_existing_correction_clicks(self):
        outer=[[0,0],[1,0],[1,1],[0,1]]
        holes=[[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]]
        original=[{'point':[.2,.2],'label':1}]
        result=hole_seed_clicks(outer,original,holes)
        self.assertEqual(result[0],original[0])
        self.assertEqual(len(original),1)
        with self.assertRaisesRegex(ValueError,'Include point'):
            hole_seed_clicks(outer,[{'point':[.5,.5],'label':1}],holes)

    def test_video_predictor_receives_full_resolution_mask_with_holes(self):
        from unittest.mock import Mock
        model=Mock();state={}
        outer=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
        holes=[[[.4,.4],[.6,.4],[.6,.6],[.4,.6]]]
        seed=seed_video_predictor(model,state,3,201,101,outer,holes=holes)
        model.add_new_points_or_box.assert_not_called()
        passed=model.add_new_mask.call_args.kwargs['mask']
        self.assertEqual(passed.shape,(101,201))
        self.assertEqual(seed[50,100],0)
        self.assertTrue(passed[20,40])
        self.assertFalse(passed[50,100])
        self.assertEqual(model.add_new_mask.call_args.kwargs['frame_idx'],3)

    def test_video_seed_refuses_conflicting_manual_click(self):
        from unittest.mock import Mock
        model=Mock()
        outer=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]
        with self.assertRaisesRegex(ValueError,'conflict'):
            seed_video_predictor(model,{},0,100,100,outer,[{'point':[.5,.5],'label':0},{'point':[.2,.2],'label':1}])
        model.add_new_mask.assert_not_called()

    def test_click_only_video_keeps_point_prompt_path(self):
        from unittest.mock import Mock
        model=Mock()
        self.assertIsNone(seed_video_predictor(model,{},0,100,100,None,[{'point':[.5,.5],'label':1}]))
        model.add_new_points_or_box.assert_called_once()
        model.add_new_mask.assert_not_called()

    def test_saved_seed_geometry_is_not_resampled(self):
        from segmentation import tracking_geometry
        points=[[.1,.1],[.8,.11],[.83,.6],[.6,.9],[.1,.8]]
        holes=[[[.2,.2],[.3,.2],[.3,.3],[.2,.3]]]
        result=tracking_geometry(np.zeros((10,10),np.uint8),{'points':points,'holes':holes})
        self.assertEqual(result['points'],points)
        self.assertEqual(result['holes'],holes)
        self.assertEqual(len(result['points']),5)

    def test_mask_tuple_unpack_remains_compatible(self):
        checked=validate_masks([{'time':0,'points':[[0,0],[1,0],[1,1]]}],0,1/30,True)
        time,points=checked[0]
        self.assertEqual(time,0)
        self.assertEqual(len(points),3)

if __name__ == '__main__': unittest.main()
