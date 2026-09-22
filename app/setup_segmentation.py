"""Install isolated SAM2 runtime from Meta's official source; no paid services.
Use --cuda for GPU wheels, --cpu for explicit CPU wheels, --isolated for a venv
without system packages. SAM2_ENV_ROOT and SAM2_CHECKPOINT support container
runtime/model directories. Git and Python>=3.10 are required. Docker image builds
are unverified here because Docker is unavailable on this host.
"""
import pathlib, subprocess, sys, os, urllib.request, venv, hashlib, json
ROOT = pathlib.Path(os.environ.get('FLIPFRAME_USER_DIR', str(pathlib.Path(__file__).resolve().parent)))
ENV = pathlib.Path(os.environ.get('SAM2_ENV_ROOT', str(ROOT / '.segmentation-env')))
SOURCE = ROOT / '.segmentation' / 'sam2'
CHECKPOINT = pathlib.Path(os.environ.get('SAM2_CHECKPOINT', str(ROOT / '.segmentation' / 'sam2.1_hiera_tiny.pt')))
REVISION = '2b90b9f5ceec907a1c18123530e92e794ad901a4'
URL = 'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt'

def download_cuda_wheel():
    """Bounded parallel byte ranges; verify against official PyTorch index SHA256."""
    from concurrent.futures import ThreadPoolExecutor
    url='https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp310-cp310-win_amd64.whl'
    expected='9b22d6d98aa56f9317902dec0e066814a6edba1aada90110ceea2bb0678df22f'
    cache=ROOT/'.segmentation'/'downloads'; cache.mkdir(parents=True,exist_ok=True)
    target=cache/'torch-2.5.1+cu121-cp310-cp310-win_amd64.whl'
    def digest(path):
        hasher=hashlib.sha256()
        with path.open('rb') as stream:
            while chunk:=stream.read(8*1024*1024): hasher.update(chunk)
        return hasher.hexdigest()
    if target.exists() and digest(target)==expected: return target
    size=2449372784; block=8*1024*1024
    temporary=target.with_suffix('.download')
    with temporary.open('wb') as stream: stream.truncate(size)
    def part(index):
        start=index*block; end=min(size,start+block)-1
        for attempt in range(3):
            try:
                request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
                with urllib.request.urlopen(request,timeout=90) as response:
                    if response.status!=206: raise RuntimeError('Server did not honor bounded range')
                    data=response.read(block+1)
                    if len(data)!=end-start+1: raise RuntimeError('Wrong range length')
                with temporary.open('r+b') as stream: stream.seek(start); stream.write(data)
                return len(data)
            except Exception:
                if attempt==2: raise
    completed=0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for received in pool.map(part,range((size+block-1)//block)):
            completed+=received
            if completed%(128*1024*1024)==0: print(f'CUDA wheel: {completed//(1024*1024)} / {size//(1024*1024)} MiB',flush=True)
    if digest(temporary)!=expected: raise RuntimeError('Official CUDA wheel SHA256 mismatch')
    temporary.replace(target)
    return target

def setup():
    if sys.version_info < (3,10): raise RuntimeError('SAM2 requires Python 3.10 or newer')
    if '--cpu' in sys.argv and '--cuda' in sys.argv: raise ValueError('Choose either --cpu or --cuda')
    # --isolated is useful for reproducible container builds. Default shares only
    # read access to existing packages; all pip mutations target this new venv.
    if not ENV.exists(): venv.EnvBuilder(with_pip=True, system_site_packages='--isolated' not in sys.argv).create(ENV)
    python = ENV / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    SOURCE.parent.mkdir(exist_ok=True)
    CHECKPOINT.parent.mkdir(parents=True,exist_ok=True)
    if '--cuda' in sys.argv:
        wheel = str(download_cuda_wheel()) if os.name=='nt' and sys.version_info[:2]==(3,10) else 'torch==2.5.1'
        subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', wheel, 'torchvision==0.20.1', '--index-url', 'https://download.pytorch.org/whl/cu121'], check=True)
    if not SOURCE.exists():
        SOURCE.mkdir()
        subprocess.run(['git', '-C', str(SOURCE), 'init'], check=True)
        subprocess.run(['git', '-C', str(SOURCE), 'remote', 'add', 'origin', 'https://github.com/facebookresearch/sam2.git'], check=True)
        subprocess.run(['git', '-C', str(SOURCE), 'fetch', '--depth', '1', 'origin', REVISION], check=True)
        subprocess.run(['git', '-C', str(SOURCE), 'checkout', '--detach', REVISION], check=True)
    if '--cpu' in sys.argv:
        subprocess.run([str(python), '-m', 'pip', 'install', '--upgrade', 'torch==2.5.1+cpu', 'torchvision==0.20.1+cpu', '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    elif '--cuda' not in sys.argv and subprocess.run([str(python), '-c', "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('torch') and importlib.util.find_spec('torchvision') else 1)"]).returncode:
        subprocess.run([str(python), '-m', 'pip', 'install', 'torch==2.5.1', 'torchvision==0.20.1', '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    actual = subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != REVISION: raise RuntimeError('SAM2 revision differs from audited source; review before installation')
    subprocess.run([str(python), '-m', 'pip', 'install', 'wheel', 'setuptools>=64', 'hydra-core>=1.3.2', 'iopath>=0.1.10', 'tqdm>=4.66.1', 'opencv-python-headless==4.12.0.88', 'imageio-ffmpeg==0.6.0'], check=True)
    environment = dict(os.environ, SAM2_BUILD_CUDA='0')
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-build-isolation', '--no-deps', str(SOURCE)], check=True, env=environment)
    if not CHECKPOINT.exists():
        temporary = CHECKPOINT.with_suffix('.download')
        total = 0
        with urllib.request.urlopen(URL, timeout=60) as remote, temporary.open('wb') as local:
            while chunk := remote.read(1024*1024):
                total += len(chunk)
                if total > 200*1024*1024: raise RuntimeError('Checkpoint exceeds expected 200MB bound')
                local.write(chunk)
        temporary.replace(CHECKPOINT)
    digest = hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()
    if digest != '7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69': raise RuntimeError('Checkpoint hash differs from verified official tiny checkpoint')
    print(json.dumps({'python': str(python), 'checkpointBytes': CHECKPOINT.stat().st_size, 'checkpointSha256': hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest(), 'revision': actual}))

if __name__ == '__main__': setup()


