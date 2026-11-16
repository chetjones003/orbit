# Run by the Orbit installer after the new version is in place. A taskbar pin made from an earlier install
# points at an exe that no longer exists, which Windows draws as a blank page. This points each such pin
# at the new Orbit.exe. Pins that already point at a working Orbit.exe are left alone.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$PinDir = (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)

if (-not (Test-Path -LiteralPath $Exe)) { exit 1 }

$shell = New-Object -ComObject WScript.Shell
Get-ChildItem -LiteralPath $PinDir -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
  $link = $shell.CreateShortcut($_.FullName)
  $target = $link.TargetPath
  if ($target -and $target -like '*\Orbit.exe' -and -not (Test-Path -LiteralPath $target)) {
    $link.TargetPath = $Exe
    $link.IconLocation = "$Exe,0"
    $link.WorkingDirectory = Split-Path -Parent $Exe
    $link.Save()
  }
}
exit 0
