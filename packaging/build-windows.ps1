param([string]$PythonBuild=(Get-Command python.exe).Source,[string]$OutputRoot='')
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$app=Join-Path $repo 'app'
$pythonVersion=& $PythonBuild -c 'import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'
if($LASTEXITCODE -or $pythonVersion -ne '3.12'){throw 'Dependency assembly requires Python 3.12 x64 to match the bundled runtime.'}
if(!$OutputRoot){$OutputRoot=Join-Path $repo 'release-build'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$cache=Join-Path $OutputRoot 'cache'
$stage=Join-Path $OutputRoot 'FlipFrame-Windows-x64'
New-Item -ItemType Directory -Force $cache,$stage,(Join-Path $stage 'app'),(Join-Path $stage 'runtime/node'),(Join-Path $stage 'runtime/python') | Out-Null
# Require a clean app payload; preserve cached external downloads only.
$payload=Join-Path $stage 'app'
if((Get-ChildItem $payload -Force | Measure-Object).Count){throw 'Use a fresh OutputRoot for each release build.'}
$node=(Get-Command node.exe).Source
$nodeVersion=& $node --version
if($nodeVersion -notmatch '^v(22|24)\.'){throw 'Build requires a tested Node 22 or 24 runtime with node:sqlite.'}
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime/node/node.exe')
Copy-Item -LiteralPath (Join-Path (Split-Path $node) 'LICENSE') -Destination (Join-Path $stage 'runtime/node/LICENSE')
# Follow only relative server module imports; never enumerate local artifacts into release.
$pending=New-Object 'System.Collections.Generic.Queue[string]';$pending.Enqueue('server.mjs')
$seen=New-Object 'System.Collections.Generic.HashSet[string]'
while($pending.Count){$name=$pending.Dequeue();if(!$seen.Add($name)){continue};if($name -notmatch '^[a-zA-Z0-9_-]+\.mjs$'){throw 'Unexpected runtime import'}
 $source=Join-Path $app $name;Copy-Item -LiteralPath $source -Destination (Join-Path $payload $name)
 $content=[IO.File]::ReadAllText($source)
 foreach($match in [regex]::Matches($content,'[\x27\x22]\./([a-zA-Z0-9_-]+\.mjs)[\x27\x22]')){$pending.Enqueue($match.Groups[1].Value)}
}
$pythonFiles=@('auto_background.py','background_replace.py','foreground_transfer.py','hardware_probe.py','local_edit.py','media_engine.py','object_reidentify.py','object_repair.py','precision_recolor.py','repair_quality.py','segmentation.py','setup_auto_background.py','setup_segmentation.py','transformation_core.py','transformation_engine.py')
foreach($name in $pythonFiles){Copy-Item -LiteralPath (Join-Path $app $name) -Destination (Join-Path $payload $name)}
foreach($name in @('package.json','package-lock.json','requirements.txt','AGENT_API.md','PRICING.md','.env.example')){if(Test-Path (Join-Path $app $name)){Copy-Item -LiteralPath (Join-Path $app $name) -Destination (Join-Path $payload $name)}}
Copy-Item -LiteralPath (Join-Path $app 'dist') -Destination (Join-Path $payload 'dist') -Recurse
foreach($name in @('LICENSE','README.md','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','SETUP.txt')){if(Test-Path (Join-Path $repo $name)){Copy-Item -LiteralPath (Join-Path $repo $name) -Destination (Join-Path $stage $name)}}
# Keep README artwork allowlisted; never copy arbitrary documentation uploads.
$hero=Join-Path $repo 'docs/assets/flipframe-hero.png'
if(Test-Path $hero){New-Item -ItemType Directory -Force (Join-Path $stage 'docs/assets') | Out-Null;Copy-Item -LiteralPath $hero -Destination (Join-Path $stage 'docs/assets/flipframe-hero.png')}
$archive=Join-Path $cache 'python-3.12.10-embed-amd64.zip'
$expected='4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
if(!(Test-Path $archive)){Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $archive}
if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $expected){throw 'Portable Python checksum mismatch'}
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $stage 'runtime/python') -Force
@('python312.zip','.','Lib/site-packages','../../app','import site') | Set-Content (Join-Path $stage 'runtime/python/python312._pth') -Encoding ASCII
Push-Location $payload
try{& npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund;if($LASTEXITCODE){throw 'Production dependency install failed'}}finally{Pop-Location}
& $PythonBuild -m pip install --disable-pip-version-check --only-binary=:all: --target (Join-Path $stage 'runtime/python/Lib/site-packages') -r (Join-Path $app 'requirements.txt')
if($LASTEXITCODE){throw 'Portable Python dependency assembly failed'}
# Remove generated interpreter caches (never needed in distribution).
Get-ChildItem (Join-Path $stage 'runtime/python') -Directory -Recurse -Filter '__pycache__' | ForEach-Object {$resolved=[IO.Path]::GetFullPath($_.FullName);if(!$resolved.StartsWith($stage+[IO.Path]::DirectorySeparatorChar)){throw 'Unsafe cache path'};Remove-Item -LiteralPath $resolved -Recurse -Force}
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ('/out:'+(Join-Path $stage 'FlipFrame.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE){throw 'Launcher compilation failed'}
$python=Join-Path $stage 'runtime/python/python.exe'
& $python -c 'import cv2,numpy,imageio_ffmpeg; print("Portable media runtime ready")'
if($LASTEXITCODE){throw 'Portable Python smoke failed'}
& (Join-Path $PSScriptRoot 'finalize-windows.ps1') -OutputRoot $OutputRoot
