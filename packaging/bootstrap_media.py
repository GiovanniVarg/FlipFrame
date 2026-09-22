"""Install verified media wheels into a private runtime, never system Python."""
import argparse, hashlib, json, os, shutil, stat, subprocess, sys, tempfile, time, urllib.request, uuid, zipfile
from pathlib import Path, PurePosixPath
WHEELS = [
 {"name":"numpy","url":"https://files.pythonhosted.org/packages/36/fa/8c9210162ca1b88529ab76b41ba02d433fd54fecaf6feb70ef9f124683f1/numpy-2.2.6-cp312-cp312-win_amd64.whl","size":12614190,"sha256":"c1f9540be57940698ed329904db803cf7a402f3fc200bfe599334c9bd84a40b2"},
 {"name":"opencv-python-headless","url":"https://files.pythonhosted.org/packages/b8/88/763b967f7efd7226b82c9fae16d560cba049b1f0c036647e65c610fd636e/opencv_python_headless-5.0.0.93-cp37-abi3-win_amd64.whl","size":43825962,"sha256":"829717b6a95554f273e49e357cee3b3a2a26b6f4842fbc1bed2b45bdd8f87e0e"},
 {"name":"imageio-ffmpeg","url":"https://files.pythonhosted.org/packages/2c/c6/fa760e12a2483469e2bf5058c5faff664acf66cadb4df2ad6205b016a73d/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl","size":31246824,"sha256":"02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a"}
]
IDENTITY=hashlib.sha256(json.dumps(WHEELS,sort_keys=True).encode()).hexdigest()
def progress(message): print(message,flush=True)
def safe_extract(archive, target):
 target=Path(target).resolve();seen=set()
 with zipfile.ZipFile(archive) as z:
  if sum(i.file_size for i in z.infolist())>1024**3: raise ValueError("Archive expands beyond the permitted size")
  for item in z.infolist():
   name=item.orig_filename;parts=PurePosixPath(name).parts
   if not parts or name.startswith('/') or '\\' in name or ':' in name or any(p in ('..','.') for p in parts) or stat.S_ISLNK(item.external_attr>>16): raise ValueError("Unsafe archive member")
   key=name.rstrip('/').casefold()
   if key in seen: raise ValueError("Duplicate archive member")
   seen.add(key);out=target.joinpath(*parts)
   if not out.resolve().is_relative_to(target): raise ValueError("Archive escapes destination")
  z.extractall(target)
def download(wheel, destination, opener=urllib.request.urlopen):
 digest=hashlib.sha256();count=0
 with opener(wheel['url'],timeout=45) as response, open(destination,'wb') as output:
  while True:
   data=response.read(1024*1024)
   if not data: break
   count+=len(data)
   if count>wheel['size']: raise ValueError("Download exceeded its pinned size")
   digest.update(data);output.write(data)
 if count!=wheel['size'] or digest.hexdigest()!=wheel['sha256']: raise ValueError("Download failed integrity verification")
def marker_valid(root):
 try:return json.loads((root/'ready.json').read_text(encoding='utf-8')).get('identity')==IDENTITY and (root/'python.exe').is_file()
 except (OSError,ValueError):return False
CHECK = """import tempfile,subprocess,cv2,numpy,imageio_ffmpeg
from pathlib import Path
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'check.mp4'
 subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-f','lavfi','-i','color=c=red:s=64x48:r=30:d=0.1','-c:v','libx264','-pix_fmt','yuv420p',str(p)],check=True,capture_output=True,timeout=30)
 c=cv2.VideoCapture(str(p));n=0
 while True:
  ok,frame=c.read()
  if not ok:break
  assert frame.shape==(48,64,3)
  n+=1
 c.release();assert n==3
"""
def configure(root, app):
 (root/'python312._pth').write_text('python312.zip\n.\nLib/site-packages\n'+str(app.resolve())+'\nimport site\n',encoding='utf-8')
def verify(root):
 subprocess.run([str(root/'python.exe'),'-c',CHECK],check=True,capture_output=True,timeout=90)
def remove_local(path, parent):
 if path.is_symlink() or path.is_junction() or path.parent.resolve()!=parent.resolve():raise ValueError("Unsafe runtime directory")
 if path.exists():shutil.rmtree(path)
def promote(stage, final, parent):
 backup=parent/('media-v1-backup-'+uuid.uuid4().hex)
 had_previous=final.exists()
 if had_previous:final.rename(backup)
 try:stage.rename(final)
 except Exception:
  if had_previous and not final.exists():backup.rename(final)
  raise
 if backup.exists():remove_local(backup,parent)
def install(bundle, user, downloader=download, verifier=verify, wheels=WHEELS):
 bundle=Path(bundle).resolve();user=Path(user).resolve();parent=user/'runtime';parent.mkdir(parents=True,exist_ok=True)
 if parent.is_symlink() or parent.is_junction():raise ValueError("Runtime directory must not be a link")
 final=parent/'media-v1'
 if final.is_symlink() or final.is_junction():raise ValueError("Runtime directory must not be a link")
 if marker_valid(final):
  configure(final,bundle/'app')
  try:verifier(final);progress('Media tools ready.');return final/'python.exe'
  except Exception:progress('Repairing media tools…')
 stage=parent/('media-v1-install-'+uuid.uuid4().hex)
 try:
  shutil.copytree(bundle/'runtime'/'python',stage)
  deps=stage/'Lib'/'site-packages';deps.mkdir(parents=True,exist_ok=True)
  for wheel in wheels:
   progress('Downloading '+wheel['name']+'…')
   archive=stage/(wheel['name']+'.whl');downloader(wheel,archive);safe_extract(archive,deps);archive.unlink()
  configure(stage,bundle/'app');progress('Checking video tools…');verifier(stage)
  (stage/'ready.json').write_text(json.dumps({'identity':IDENTITY}),encoding='utf-8')
  promote(stage,final,parent)
  progress('Media tools ready.');return final/'python.exe'
 finally:
  if stage.exists():remove_local(stage,parent)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--bundle',required=True);parser.add_argument('--user-dir',required=True);args=parser.parse_args()
 # OS releases this lock after crashes, so an interrupted setup can be retried.
 import msvcrt
 user=Path(args.user_dir).resolve();user.mkdir(parents=True,exist_ok=True)
 with open(user/'media-setup.lock','a+b') as lock:
  lock.seek(0);lock.write(b'0');lock.flush();deadline=time.monotonic()+600
  while True:
   try:lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1);break
   except OSError:
    if time.monotonic()>deadline:raise RuntimeError('Another setup is still running. Try again later.')
    time.sleep(1)
  try:install(args.bundle,user)
  finally:lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)
if __name__=='__main__':
 try:main()
 except Exception:
  print('Media setup could not finish. Check your internet connection and reopen FlipFrame to retry.',file=sys.stderr,flush=True);sys.exit(1)
