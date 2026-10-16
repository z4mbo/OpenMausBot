param([string]$Installer, [switch]$SkipInstall, [switch]$Reinstall)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Invoke-Registry([string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  try {
    # reg.exe writes its success message to stderr; judge its native exit code.
    $ErrorActionPreference = 'Continue'
    & reg.exe @Arguments 2>&1 | Out-Null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  if ($code -ne 0) { throw "Registry backup/restore failed with exit code $code" }
}
$repo = Split-Path $PSScriptRoot -Parent
$artifacts = [IO.Path]::GetFullPath((Join-Path $repo 'artifacts'))
$install = Join-Path $artifacts 'installed-origin'
$data = Join-Path $env:APPDATA 'fun.imbored.origin.desktop'
$backup = "$data.ci-backup-$([guid]::NewGuid().ToString('N'))"
if (Get-Process origin-desktop -ErrorAction SilentlyContinue) { throw 'Close the existing Origin desktop before smoke testing.' }
if ((Test-Path -LiteralPath $install) -and -not ($SkipInstall -or $Reinstall)) { throw "Smoke installation already exists: $install; use -Reinstall to replace its binaries." }
if (-not $Installer) {
  $candidates = @(Get-ChildItem (Join-Path $artifacts 'desktop/windows-x86_64/*.exe'))
  if ($candidates.Count -ne 1) { throw 'Expected exactly one built Windows installer.' }
  $Installer = $candidates[0].FullName
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OriginCiWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
}
'@
$app = $null
$ownedNodes = @()
$hadData = Test-Path -LiteralPath $data
$previousMonitor = $env:ORIGIN_DESKTOP_MONITOR2
$stateReplaced = $false
$registration = @()
$registrationPaths = @('Software\Microsoft\Windows\CurrentVersion\Uninstall\Origin', 'Software\imbored\Origin', 'Software\Classes\origin')
foreach ($key in $registrationPaths) {
  $saved = Join-Path $artifacts ("desktop-registry-" + $registration.Count + '.reg')
  $exists = Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\$key"
  if ($exists) {
    Invoke-Registry @('export', "HKCU\$key", $saved, '/y')
  }
  $registration += @{key=$key;exists=$exists;file=$saved}
}
try {
  # NSIS /D must be last and unquoted, including paths with spaces.
  if (-not $SkipInstall) {
    $setup = Start-Process -FilePath $Installer -ArgumentList "/S /NS /D=$install" -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installer exited $($setup.ExitCode)" }
  }
  $exe = Join-Path $install 'origin-desktop.exe'
  $metadata = Get-Content (Join-Path $install 'host/packaging.json') -Raw | ConvertFrom-Json
  if ($metadata.mode -ne 'production') { throw 'Installed daemon is a mock.' }
  if (Test-Path -LiteralPath (Join-Path $install 'host/mock-host.mjs')) { throw 'Stale mock leaked into production installation.' }
  if ($hadData) { Move-Item -LiteralPath $data -Destination $backup }
  $stateReplaced = $true
  New-Item -ItemType Directory -Path $data -Force | Out-Null
  $configPath = Join-Path $data 'desktop-config.json'
  $config = @{originUrl='http://127.0.0.1:1';onboarded=$true;hostEnabled=$true;notifications=$false} | ConvertTo-Json
  [IO.File]::WriteAllText($configPath, $config, (New-Object Text.UTF8Encoding($false)))
  $env:ORIGIN_DESKTOP_MONITOR2 = '1'
  $app = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
  $health = $null
  $launcher = $null
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    $app.Refresh()
    if ($app.HasExited) { throw 'Installed desktop exited during startup.' }
    $nodes = @(Get-CimInstance Win32_Process -Filter "name='origin-node.exe'")
    $ownedNodes = @($nodes | Where-Object { $_.ExecutablePath -eq (Join-Path $install 'origin-node.exe') })
    $launcher = $ownedNodes | Where-Object { $_.ParentProcessId -eq $app.Id -and $_.CommandLine -like '*bin*origin-agent-host.mjs*' } | Select-Object -First 1
    if ($launcher -and $launcher.CommandLine -match '--port\s+"?(\d+)"?') {
      $port = $Matches[1]
      if ($launcher.CommandLine -notmatch '--token\s+"?([a-f0-9]{64})"?') { throw 'Cannot locate desktop-generated owner token.' }
      $token = $Matches[1]
      try { $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -Headers @{Authorization="Bearer $token"} -TimeoutSec 2 } catch { $health = $null }
      if ($health -and $health.app -eq 'openmausbot' -and $health.static -eq $true -and $health.pid) { break }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $health -or $health.app -ne 'openmausbot' -or -not $health.static) { throw 'Real daemon did not become healthy.' }
  $daemon = $ownedNodes | Where-Object { $_.ProcessId -eq $health.pid -and $_.ParentProcessId -eq $launcher.ProcessId }
  if (-not $daemon) { throw 'Health PID is not the installed desktop-owned daemon child.' }
  $app.Refresh()
  $rect = New-Object OriginCiWindow+Rect
  if (-not [OriginCiWindow]::GetWindowRect($app.MainWindowHandle, [ref]$rect)) { throw 'Cannot read installed window geometry.' }
  if ($rect.Left -lt -1920 -or $rect.Left -ge 0 -or $rect.Top -lt 60 -or $rect.Right -gt 0 -or $rect.Bottom -gt 1140) { throw 'Desktop window escaped DISPLAY2.' }
  $result = @{passed=$true;mode=$metadata.mode;installerSha256=(Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash;desktopPid=$app.Id;launcherPid=$launcher.ProcessId;daemonPid=$health.pid;healthApp=$health.app;staticUi=$health.static;left=$rect.Left;top=$rect.Top;right=$rect.Right;bottom=$rect.Bottom}
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts 'desktop-smoke.json')
  Write-Output "Installed REAL daemon health OK; desktop PID $($app.Id), daemon PID $($health.pid); DISPLAY2 ($($rect.Left),$($rect.Top))."
} catch {
  Write-Output "Installed smoke failure: $($_.Exception.Message)"
  throw
} finally {
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force; $app.WaitForExit(10000) | Out-Null }
  Start-Sleep -Milliseconds 700
  $remaining = @(Get-CimInstance Win32_Process -Filter "name='origin-node.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $install 'origin-node.exe') })
  foreach ($child in $remaining) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:ORIGIN_DESKTOP_MONITOR2 = $previousMonitor
  if ($stateReplaced) {
    if ([IO.Path]::GetFullPath($data) -ne (Join-Path $env:APPDATA 'fun.imbored.origin.desktop')) { throw 'Unsafe data cleanup path.' }
    Remove-Item -LiteralPath $data -Recurse -Force
    if ($hadData) { Move-Item -LiteralPath $backup -Destination $data }
  }
  foreach ($entry in $registration) {
    $registryPath = "Registry::HKEY_CURRENT_USER\$($entry.key)"
    if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
    if ($entry.exists) {
      Invoke-Registry @('import', $entry.file)
    }
  }
  # Leave the installed files as inspectable local evidence; no uninstaller is opened.
  if ($remaining.Count -gt 0) { throw 'Desktop Job Object did not clean all daemon processes; remaining children were stopped.' }
}
