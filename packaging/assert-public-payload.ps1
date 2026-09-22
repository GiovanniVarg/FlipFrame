function Assert-PublicPayload([string]$Stage) {
 $Stage=[IO.Path]::GetFullPath($Stage)
 $forbidden=Get-ChildItem -LiteralPath $Stage -Recurse -Force | Where-Object {
  $relative=$_.FullName.Substring($Stage.Length+1)
  $relative -match '^runtime[\\/]python[\\/]Lib[\\/]site-packages([\\/]|$)' -or
  (!$_.PSIsContainer -and ($_.Extension -eq '.whl' -or $_.Name -match '(?i)^ffmpeg.*\.exe$|opencv.*\.dll$|^cv2.*\.pyd$'))
 }
 if($forbidden){throw 'Public package contains media dependencies or codecs that must be downloaded on the user computer.'}
}
