param(
  [Parameter(Mandatory=$true)][ValidateSet('mac','windows')][string]$Platform
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ready = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'download-ready.json') -Raw | ConvertFrom-Json
if (!$ready.allActualArchiveDigestsVerified -or $ready.frozenSource -ne 'ab0cd72b4c2f004c1015adca034472241569c04b' -or $ready.version -ne '0.2.14') { throw 'Actual archives are not verified for this final source' }
$artifactName = if ($Platform -eq 'mac') { 'origin-mac' } else { 'origin-windows' }
$archivePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "raw/$artifactName.zip")).Path
$ownedRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destination = [IO.Path]::GetFullPath((Join-Path $ownedRepo ".omb-scratch/artifacts/0.2.14/$Platform"))
$intended = [IO.Path]::GetFullPath((Join-Path $ownedRepo '.omb-scratch/artifacts/0.2.14')) + [IO.Path]::DirectorySeparatorChar
if (!$destination.StartsWith($intended,[StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction escaped owned artifact root' }
if (Test-Path -LiteralPath $destination) { throw 'Refusing to overwrite artifact directory' }
$suffixes = if ($Platform -eq 'mac') { @('arm64.dmg','arm64.dmg.blockmap','arm64.zip','arm64.zip.blockmap','x64.dmg','x64.dmg.blockmap','x64.zip','x64.zip.blockmap') } else { @('setup.exe','setup.exe.blockmap','x64.zip') }
$expected = @($suffixes | ForEach-Object { "Origin-0.2.14-$_" }) + @(if ($Platform -eq 'mac') { 'latest-mac.yml' } else { 'latest.yml' })
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
$entries = [Collections.Generic.List[object]]::new()
try {
  $names = @($zip.Entries | ForEach-Object FullName)
  if ((Compare-Object ($names | Sort-Object) ($expected | Sort-Object))) { throw 'Unexpected API archive file set' }
  New-Item -ItemType Directory -Path $destination | Out-Null
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if ($name -match '[/\\:]' -or $name -in @('.','..') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw "Unsafe archive entry: $name" }
    $target = Join-Path $destination $name
    $input = $entry.Open()
    $output = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    if ((Get-Item -LiteralPath $target).Length -ne $entry.Length) { throw 'Extracted length differs' }
    $entries.Add([pscustomobject]@{name=$name;bytes=$entry.Length;compressedBytes=$entry.CompressedLength;externalAttributes=$entry.ExternalAttributes})
  }
} finally { $zip.Dispose() }
[ordered]@{platform=$Platform;archive=$archivePath;actualArchiveHashVerified=$true;destination=$destination;entries=@($entries.ToArray())} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot "$Platform-api-extraction.json") -Encoding utf8
[pscustomobject]@{platform=$Platform;files=$entries.Count;destination=$destination} | ConvertTo-Json
