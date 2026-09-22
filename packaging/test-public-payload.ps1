. (Join-Path $PSScriptRoot 'assert-public-payload.ps1')
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('flipframe-payload-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
Assert-PublicPayload $root
foreach($name in @('codec.whl','ffmpeg-test.exe','opencv_world.dll','cv2.pyd','runtime/python/Lib/site-packages/fake.py')) {
 $case=Join-Path $root ([guid]::NewGuid().ToString('N'));$file=Join-Path $case $name
 New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
 [IO.File]::WriteAllText($file,'fake')
 $rejected=$false;try{Assert-PublicPayload $case}catch{$rejected=$true}
 if(!$rejected){throw ('Public payload guard accepted '+$name)}
}
Write-Output 'Public payload tests passed: empty package and five forbidden insertions.'
