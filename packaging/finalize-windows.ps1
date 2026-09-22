param([Parameter(Mandatory=$true)][string]$OutputRoot)
$ErrorActionPreference='Stop'
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
$stage=Join-Path $OutputRoot 'FlipFrame-Windows-x64'
$nodeVersion=& (Join-Path $stage 'runtime/node/node.exe') --version
$files=Get-ChildItem $stage -File -Recurse -Force | Where-Object {$_.FullName -ne (Join-Path $stage 'release-manifest.json')}
$blocked=$files | Where-Object {$relative=$_.FullName.Substring($stage.Length+1);($relative -match '(^|[\\/])(\.env(?!\.example$)[^\\/]*|\.local-settings|\.git|\.segmentation|\.segmentation-env)([\\/]|$)' -or ($relative -match '(^|[\\/])data([\\/]|$)' -and $relative -notmatch '^runtime[\\/]python[\\/]Lib[\\/]site-packages[\\/](numpy|cv2)[\\/]')) -or $_.Extension -in @('.sqlite','.db','.log','.pt','.pth')}
if($blocked){throw ('Private or generated files blocked: '+($blocked.Name -join ', '))}
$manifest=$files | ForEach-Object {[ordered]@{path=$_.FullName.Substring($stage.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}}
@{version=(Get-Content (Join-Path $stage 'app/package.json') -Raw | ConvertFrom-Json).version;builtAt=[DateTime]::UtcNow.ToString('o');node=$nodeVersion;python='3.12.10';unsigned=$true;files=$manifest} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $stage 'release-manifest.json') -Encoding UTF8
$zip=Join-Path $OutputRoot 'FlipFrame-Windows-x64.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$buildZip=Join-Path $OutputRoot ('FlipFrame-Windows-x64-'+[guid]::NewGuid().ToString('N')+'.zip')
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$buildZip,[IO.Compression.CompressionLevel]::Optimal,$true)
Move-Item -LiteralPath $buildZip -Destination $zip -Force
Get-Item $zip | Select-Object FullName,Length
$zipHash=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLower();($zipHash+'  FlipFrame-Windows-x64.zip') | Set-Content ($zip+'.sha256') -Encoding ASCII;Write-Output $zipHash


$extract=Join-Path $OutputRoot ('smoke-extracted-'+[guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $zip -DestinationPath $extract
$smokeUser=Join-Path $OutputRoot ('smoke-user-'+[guid]::NewGuid().ToString('N'))
$exe=Join-Path $extract 'FlipFrame-Windows-x64/FlipFrame.exe'
$process=Start-Process -FilePath $exe -ArgumentList ('--smoke --user-dir "'+$smokeUser+'"') -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -ne 0){throw 'Extracted ZIP launcher smoke failed'}
Write-Output 'Extracted ZIP launcher smoke passed'
