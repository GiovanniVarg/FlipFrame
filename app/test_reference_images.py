import unittest,tempfile,pathlib
from PIL import Image
from media_engine import prepare_reference
class ReferenceTests(unittest.TestCase):
 def test_validated_png_and_combined_guide(self):
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d);source=d/'input.jpg';out=d/'output.png';Image.new('RGB',(300,200),'red').save(source)
   result=prepare_reference({'source':str(source),'output':str(out)})
   with Image.open(out) as image:self.assertEqual(image.format,'PNG')
   self.assertEqual(result['width'],300)
   prepare_reference({'source':str(source),'guide':str(source),'output':str(out)})
   with Image.open(out) as image:self.assertEqual(image.size,(1536,800))
 def test_desired_reference_stays_on_right_without_stretching(self):
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d);reference=d/'reference.png';guide=d/'guide.png';out=d/'board.png'
   Image.new('RGB',(100,300),(10,20,240)).save(reference)
   Image.new('RGB',(300,100),(240,20,10)).save(guide)
   prepare_reference({'source':str(reference),'guide':str(guide),'output':str(out)})
   with Image.open(out) as image:
    self.assertEqual(image.getpixel((384,416)),(240,20,10))
    self.assertEqual(image.getpixel((1152,416)),(10,20,240))
    self.assertEqual(image.getpixel((1000,416)),(25,28,27))
    self.assertEqual(image.getpixel((1152,200)),(25,28,27))
 def test_non_image_and_large_pixels_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d);source=d/'input.png';out=d/'output.png';source.write_text('not an image')
   with self.assertRaises(Exception):prepare_reference({'source':str(source),'output':str(out)})
   Image.new('RGB',(4001,4000)).save(source)
   with self.assertRaises(ValueError):prepare_reference({'source':str(source),'output':str(out)})
if __name__=='__main__':unittest.main()
