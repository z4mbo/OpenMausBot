[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Prepare', 'Deploy')][string]$Mode = 'Plan',
    [string]$Release,
    [string]$ProductionSchema,
    [string]$Receipt
)
$ErrorActionPreference = 'Stop'
$webRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$repoRoot = Split-Path $webRoot
$deployment = 'example-deployment'
if ($Mode -eq 'Plan') {
    Write-Output "No commands executed. Owner sequence from $webRoot :"
    Write-Output 'npm ci --no-audit --no-fund; npm run typecheck; npm test'
    Write-Output 'npx --no-install convex login (owner interactive, later only)'
    Write-Output 'On Windows with script execution disabled, invoke through powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/deploy/convex-release.ps1 (process only).'
    Write-Output 'Obtain active production schema using fetch-production-schema.mjs with a matching protected deploy key, or the authenticated dashboard inspector.'
    Write-Output '.\scripts\deploy\convex-release.ps1 -Mode Prepare -Release FULL_SHA -ProductionSchema PROTECTED_ACTIVE_SCHEMA_JSON'
    Write-Output 'Prepare compares schemas, exports production storage/data, then runs convex deploy --dry-run; it never deploys.'
    Write-Output 'Rehearse recovery and old/new compatibility in isolation, complete release receipt, then -Mode Deploy with the same release/schema/receipt.'
    return
}
if ($Release -notmatch '^[0-9a-f]{40}$') { throw 'A reviewed full commit SHA is required' }
if ($ProductionSchema) { $ProductionSchema = [IO.Path]::GetFullPath($ProductionSchema) }
if ($Receipt) { $Receipt = [IO.Path]::GetFullPath($Receipt) }
Set-Location $webRoot
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed; stop the rollout" }
}
$head = & git -C $repoRoot rev-parse HEAD
if ($LASTEXITCODE -or $head -ne $Release) { throw 'Checkout must be the reviewed release' }
$dirty = & git -C $repoRoot status --porcelain
if ($LASTEXITCODE -or $dirty) { throw 'Release checkout must be clean' }
if (!$ProductionSchema -or !(Test-Path -LiteralPath $ProductionSchema -PathType Leaf)) { throw 'Authoritative active production schema JSON required' }
if ($env:CONVEX_DEPLOY_KEY -and !$env:CONVEX_DEPLOY_KEY.StartsWith('prod:example-deployment|')) { throw 'Wrong production deploy key target' }
if ($env:CONVEX_SELF_HOSTED_URL -or $env:CONVEX_SELF_HOSTED_ADMIN_KEY -or $env:CONVEX_DEPLOYMENT_URL) { throw 'Remove conflicting deployment selectors' }
if ($env:CONVEX_DEPLOYMENT -and $env:CONVEX_DEPLOYMENT -ne 'prod:example-deployment') { throw 'Remove conflicting CONVEX_DEPLOYMENT' }
$privateDir = Join-Path $webRoot ".private/convex-$Release"
New-Item -ItemType Directory -Force $privateDir | Out-Null
$targetFile = Join-Path $privateDir 'target.env'
[IO.File]::WriteAllText($targetFile, "CONVEX_DEPLOYMENT=prod:$deployment`n")
$candidate = Join-Path $privateDir 'candidate-schema.json'
$schema = & node (Join-Path $PSScriptRoot 'schema-audit.mjs') export (Join-Path $webRoot 'convex/schema.ts')
if ($LASTEXITCODE) { throw 'Candidate schema export failed' }
[IO.File]::WriteAllText($candidate, ($schema -join "`n"))
Invoke-Checked node @((Join-Path $PSScriptRoot 'schema-audit.mjs'), 'compare', $ProductionSchema, $candidate)
if ($Mode -eq 'Prepare') {
    $export = Join-Path $privateDir 'production.zip'
    if (Test-Path -LiteralPath $export) { throw 'Production export already exists; preserve it and start from a fresh reviewed release' }
    Invoke-Checked npx.cmd @('--no-install', 'convex', 'export', '--deployment-name', $deployment, '--env-file', $targetFile, '--include-file-storage', '--path', $export)
    Invoke-Checked npx.cmd @('--no-install', 'convex', 'deploy', '--env-file', $targetFile, '--dry-run')
    Write-Output "Prepared only: $privateDir . No backend or web deployed. Keep these sensitive artifacts private."
    return
}
if ($env:ORIGIN_PRODUCTION_APPROVED -ne 'YES') { throw 'Production execution belongs to the later owner deployment session' }
if (!$Receipt) { throw 'Completed evidence-backed release receipt required' }
$approval = Get-Content -LiteralPath $Receipt -Raw | ConvertFrom-Json
if ($approval.release -ne $Release -or $approval.deployment -ne $deployment) { throw 'Receipt target mismatch' }
foreach ($gate in @('releaseGatePassed','productionSchemaCompared','additiveOnly','convexRestoreTested','oldWebNewBackendTested','newWebNewBackendTested','midRunRecoveryTested','freshBackupVerified','convexExportVerified','localRestoreTested','verifyDataPassed','accountAccessVerified')) {
    if ($approval.$gate -isnot [bool] -or !$approval.$gate) { throw "Missing receipt evidence: $gate" }
}
if (!(Test-Path -LiteralPath (Join-Path $privateDir 'production.zip'))) { throw 'Run Prepare first' }
Invoke-Checked npx.cmd @('--no-install', 'convex', 'deploy', '--env-file', $targetFile, '--dry-run')
# Convex's confirmation prints the resolved production target for owner review.
Invoke-Checked npx.cmd @('--no-install', 'convex', 'deploy', '--env-file', $targetFile)
Write-Output 'Backend deployed. Verify index readiness and old-web compatibility before any web recreation.'
