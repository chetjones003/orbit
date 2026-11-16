# Run by the Orbit installer before the new version is written. Removes the file type and app registrations
# that earlier Orbit installs left under Software\Classes, so nothing points at a file that is gone. The
# new install registers its own afterwards. Only keys named Orbit, Orbit.* and dev.orbit.app are removed,
# plus Applications\Orbit.exe. Other keys are left alone.
param(
  [string]$ClassesRoot = 'HKCU:\Software\Classes'
)

$names = Get-ChildItem -LiteralPath $ClassesRoot -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -eq 'Orbit' -or $_.PSChildName -like 'Orbit.*' } |
  ForEach-Object { $_.PSChildName }
foreach ($name in $names) {
  Remove-Item -LiteralPath (Join-Path $ClassesRoot $name) -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($extra in @('Applications\Orbit.exe', 'dev.orbit.app')) {
  $path = Join-Path $ClassesRoot $extra
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
}
exit 0
