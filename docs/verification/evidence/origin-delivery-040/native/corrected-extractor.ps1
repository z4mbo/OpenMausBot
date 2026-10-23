param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][ValidateSet('mac','windows')][string]$Platform
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
$ownerRoot = [IO.Path]::GetFullPath($PSScriptRoot) + [IO.Path]::DirectorySeparatorChar
if (!$destinationPath.StartsWith($ownerRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction destination is outside this owned audit directory.' }
if (Test-Path -LiteralPath $destinationPath) { throw 'Extraction destination already exists.' }
New-Item -ItemType Directory -Path $destinationPath | Out-Null
$destinationPrefix = $destinationPath + [IO.Path]::DirectorySeparatorChar
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
$entries = [Collections.Generic.List[object]]::new()
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\','/')
    if ($name -match '(^/|(^|/)\.{1,2}(/|$)|[:\x00])') { throw "Unsafe ZIP path: $name" }
    $selected = if ($Platform -eq 'mac') {
      $name -match '^Origin\.app/Contents/(Info\.plist|MacOS/Origin|Resources/(app\.asar|app-update\.yml|ui/.+|server/(openmausbot\.js|index\.js|package\.json|server/(origin-cloud-session|origin-run-lease)\.js)))$'
    } else {
      $name -match '(^|/)resources/(app\.asar|app-update\.yml|ui/.+|server/.+|browser-engine/.+)$' -or $name -match '(^|/)Origin\.exe$'
    }
    $row = [ordered]@{name=$name;bytes=$entry.Length;compressedBytes=$entry.CompressedLength;externalAttributes=$entry.ExternalAttributes;selected=[bool]$selected}
    if ($selected -and !$name.EndsWith('/')) {
      $targetPath = [IO.Path]::GetFullPath((Join-Path $destinationPath $name.Replace('/',[IO.Path]::DirectorySeparatorChar)))
      if (!$targetPath.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Escaping ZIP path: $name" }
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($targetPath)) -Force | Out-Null
      $entryInput = $entry.Open()
      $entryOutput = [IO.File]::Open($targetPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try { $entryInput.CopyTo($entryOutput) } finally { $entryOutput.Dispose(); $entryInput.Dispose() }
      $row.sha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $entries.Add([pscustomobject]$row)
  }
} finally { $zip.Dispose() }
$manifest = [ordered]@{
  archive=$archivePath
  archiveBytes=(Get-Item -LiteralPath $archivePath).Length
  platform=$Platform
  extractedTo=$destinationPath
  entries=@($entries.ToArray())
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $destinationPath 'archive-manifest.json') -Encoding utf8
[pscustomobject]@{archive=$archivePath;archiveBytes=$manifest.archiveBytes;entryCount=$entries.Count;selectedCount=@($entries | Where-Object selected).Count;extractedTo=$destinationPath} | ConvertTo-Json
