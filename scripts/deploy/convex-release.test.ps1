$ErrorActionPreference = 'Stop'
$taskOriginalLocation = Get-Location
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskFixture = Join-Path $taskTempRoot ('origin-convex-release-' + [guid]::NewGuid())
$taskSavedEnvironment = @{}
foreach ($name in @('CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY','CONVEX_DEPLOYMENT_URL','CONVEX_DEPLOYMENT','ORIGIN_PRODUCTION_APPROVED')) {
    $taskSavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
    [Environment]::SetEnvironmentVariable($name, $null)
}
$global:OriginReleaseFixtureCommands = [Collections.Generic.List[string]]::new()
function git {
    if ($args -contains 'rev-parse') { 'a' * 40 }
    $global:LASTEXITCODE = 0
}
function node {
    if ($args -contains 'export') { '{"tables":[]}' }
    $global:LASTEXITCODE = 0
}
function npx.cmd {
    $global:OriginReleaseFixtureCommands.Add(($args -join ' '))
    if ($args -contains 'export') {
        $index = [array]::IndexOf($args, '--path')
        if ($index -lt 0) { throw 'Missing export path' }
        [IO.File]::WriteAllText($args[$index + 1], 'synthetic-export')
    }
    $global:LASTEXITCODE = 0
}
function Assert-Fixture([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
}
try {
    foreach ($name in @('git','node','npx.cmd')) {
        Assert-Fixture ((Get-Command $name).CommandType -eq 'Function') 'Fixture command interception failed'
    }
    $taskScripts = Join-Path $taskFixture 'web/scripts/deploy'
    New-Item -ItemType Directory -Force $taskScripts | Out-Null
    $taskScript = Join-Path $taskScripts 'convex-release.ps1'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'convex-release.ps1') -Destination $taskScript
    $taskSchema = Join-Path $taskFixture 'production-schema.json'
    [IO.File]::WriteAllText($taskSchema, '{"tables":[]}')
    & $taskScript | Out-Null
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 0) 'Plan invoked a CLI'
    $taskRelease = 'a' * 40
    & $taskScript -Mode Prepare -Release $taskRelease -ProductionSchema $taskSchema | Out-Null
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 2) 'Prepare did not export and dry-run exactly once'
    Assert-Fixture ($global:OriginReleaseFixtureCommands[0] -match 'export --deployment-name example-deployment') 'Export target is not pinned'
    Assert-Fixture ($global:OriginReleaseFixtureCommands[1] -match 'deploy .* --dry-run$') 'Prepare attempted a deploy'
    $global:OriginReleaseFixtureCommands.Clear()
    $taskDenied = $false
    try { & $taskScript -Mode Deploy -Release $taskRelease -ProductionSchema $taskSchema | Out-Null }
    catch { $taskDenied = $_.Exception.Message -match 'later owner deployment session' }
    Assert-Fixture $taskDenied 'Deploy accepted missing owner execution flag'
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 0) 'Denied deploy invoked a CLI'
    $env:ORIGIN_PRODUCTION_APPROVED = 'YES'
    $taskReceipt = Join-Path $taskFixture 'receipt.json'
    [IO.File]::WriteAllText($taskReceipt, '{"release":"' + $taskRelease + '","deployment":"example-deployment"}')
    $taskDenied = $false
    try { & $taskScript -Mode Deploy -Release $taskRelease -ProductionSchema $taskSchema -Receipt $taskReceipt | Out-Null }
    catch { $taskDenied = $_.Exception.Message -match 'Missing receipt evidence' }
    Assert-Fixture $taskDenied 'Deploy accepted missing release gates'
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 0) 'Missing gates invoked a CLI'
    $taskApproval = @{release=$taskRelease; deployment='example-deployment'}
    foreach ($gate in @('releaseGatePassed','productionSchemaCompared','additiveOnly','convexRestoreTested','oldWebNewBackendTested','newWebNewBackendTested','midRunRecoveryTested')) { $taskApproval[$gate] = $true }
    [IO.File]::WriteAllText($taskReceipt, ($taskApproval | ConvertTo-Json))
    $taskDenied = $false
    try { & $taskScript -Mode Deploy -Release $taskRelease -ProductionSchema $taskSchema -Receipt $taskReceipt | Out-Null }
    catch { $taskDenied = $_.Exception.Message -match 'Missing receipt evidence: freshBackupVerified' }
    Assert-Fixture $taskDenied 'Deploy accepted historical gates without fresh data evidence'
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 0) 'Missing data evidence invoked a CLI'
    foreach ($gate in @('freshBackupVerified','convexExportVerified','localRestoreTested','verifyDataPassed','accountAccessVerified')) { $taskApproval[$gate] = $true }
    $taskApproval.verifyDataPassed = 'true'
    [IO.File]::WriteAllText($taskReceipt, ($taskApproval | ConvertTo-Json))
    $taskDenied = $false
    try { & $taskScript -Mode Deploy -Release $taskRelease -ProductionSchema $taskSchema -Receipt $taskReceipt | Out-Null }
    catch { $taskDenied = $_.Exception.Message -match 'Missing receipt evidence: verifyDataPassed' }
    Assert-Fixture $taskDenied 'Deploy accepted a string instead of a verified boolean'
    $taskApproval.verifyDataPassed = $true
    [IO.File]::WriteAllText($taskReceipt, ($taskApproval | ConvertTo-Json))
    & $taskScript -Mode Deploy -Release $taskRelease -ProductionSchema $taskSchema -Receipt $taskReceipt | Out-Null
    Assert-Fixture ($global:OriginReleaseFixtureCommands.Count -eq 2) 'Approved fixture did not dry-run then deploy'
    Assert-Fixture ($global:OriginReleaseFixtureCommands[0] -match '--dry-run$') 'First deploy stage is not dry-run'
    Assert-Fixture ($global:OriginReleaseFixtureCommands[1] -notmatch '--dry-run') 'Final deploy stage did not run'
    Write-Output 'PASS: Plan, pinned export, Prepare dry-run, denied flags/gates and ordered approved deploy (all CLIs mocked)'
} finally {
    Set-Location $taskOriginalLocation
    foreach ($name in $taskSavedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $taskSavedEnvironment[$name]) }
    $taskResolvedFixture = [IO.Path]::GetFullPath($taskFixture)
    if (!$taskResolvedFixture.StartsWith($taskTempRoot) -or !(Split-Path $taskResolvedFixture -Leaf).StartsWith('origin-convex-release-')) { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $taskResolvedFixture -Recurse -Force
}
