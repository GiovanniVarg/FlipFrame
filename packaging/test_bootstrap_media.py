import hashlib,io,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import bootstrap_media as b
class BootstrapTests(unittest.TestCase):
 def test_integrity_rejects_wrong_hash_and_size(self):
  with tempfile.TemporaryDirectory() as d:
   for size,digest in [(3,'0'*64),(4,hashlib.sha256(b'abc').hexdigest()),(2,hashlib.sha256(b'abc').hexdigest())]:
    with self.assertRaises(ValueError):b.download({'url':'unused','size':size,'sha256':digest},Path(d)/'wheel',opener=lambda *a,**k:io.BytesIO(b'abc'))
 def test_archive_rejects_traversal_absolute_backslash_and_symlink(self):
  with tempfile.TemporaryDirectory() as d:
   d=Path(d)
   for name in ['../escape','/absolute','C:/escape','folder\\escape']:
    with zipfile.ZipFile(d/'bad.zip','w') as z:z.writestr(name,b'no')
    if chr(92) in name:(d/'bad.zip').write_bytes((d/'bad.zip').read_bytes().replace(b'folder/escape',b'folder'+bytes([92])+b'escape'))
    with self.assertRaises(ValueError):b.safe_extract(d/'bad.zip',d/'out')
   with zipfile.ZipFile(d/'bad.zip','w') as z:
    entry=zipfile.ZipInfo('link');entry.external_attr=0o120777<<16;z.writestr(entry,'../escape')
   with self.assertRaises(ValueError):b.safe_extract(d/'bad.zip',d/'out')
   self.assertFalse((d/'escape').exists())
 def test_promotion_failure_restores_previous_runtime(self):
  with tempfile.TemporaryDirectory() as d:
   parent=Path(d);final=parent/'media-v1';stage=parent/'stage';final.mkdir();stage.mkdir();(final/'old').write_text('preserved');original=Path.rename
   def rename(path,target):
    if path==stage:raise OSError('simulated promotion failure')
    return original(path,target)
   with patch.object(Path,'rename',rename):
    with self.assertRaises(OSError):b.promote(stage,final,parent)
   self.assertEqual((final/'old').read_text(),'preserved')
   self.assertEqual(list(parent.glob('media-v1-backup-*')),[])
 def test_failed_install_leaves_no_ready_marker_and_retry_then_cache(self):
  with tempfile.TemporaryDirectory() as d:
   d=Path(d);bundle=d/'bundle';base=bundle/'runtime'/'python';base.mkdir(parents=True);(base/'python.exe').write_bytes(b'fake');(bundle/'app').mkdir();user=d/'user';calls=[]
   def fetch(w,p):
    calls.append(w['name'])
    with zipfile.ZipFile(p,'w') as z:z.writestr('fake/__init__.py','')
   def fail(root):
    self.assertFalse((root/'ready.json').exists());raise RuntimeError('incomplete')
   wheel=[{'name':'fake'}]
   with self.assertRaises(RuntimeError):b.install(bundle,user,fetch,fail,wheel)
   self.assertFalse(b.marker_valid(user/'runtime'/'media-v1'))
   self.assertEqual(list((user/'runtime').glob('media-v1-install-*')),[])
   def verify(root):self.assertTrue((root/'Lib/site-packages/fake/__init__.py').is_file())
   result=b.install(bundle,user,fetch,verify,wheel);self.assertTrue(result.is_file());self.assertTrue(b.marker_valid(result.parent))
   b.install(bundle,user,lambda *a: self.fail('cached runtime downloaded'),verify,wheel)
   self.assertEqual(calls,['fake','fake'])
if __name__=='__main__':unittest.main()
