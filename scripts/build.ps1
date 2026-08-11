#Requires -Version 7
<#
.SYNOPSIS
  Build Neon Git Explorer (Electron) into packaged Windows executables.
.DESCRIPTION
  Installs dependencies (if needed), runs the headless git test suite, optionally
  runs the Electron smoke test, then packages the app with electron-builder.
  Produces both the NSIS installer and the portable exe under ./dist.
.PARAMETER Target
  What to build: 'both' (default), 'installer', 'portable'.
.PARAMETER Test
  Run `npm test` (headless git checks) before building.
.PARAMETER Smoke
  Run the Electron smoke test (`electron . --smoke`) before building. This opens
  a real app window; on a headless machine it will fail.
.PARAMETER SkipInstall
  Skip `npm install` and the allowScripts approval step.
.EXAMPLE
  .\scripts\build.ps1
.EXAMPLE
  .\scripts\build.ps1 -Target portable -Test
#>
[CmdletBinding()]
param(
  [ValidateSet('both', 'installer', 'portable')]
  [string]$Target = 'both',

  [switch]$Test,
  [switch]$Smoke,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Assert-Tool([string]$name, [string]$checkCmd) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required tool '$name' not found on PATH. $checkCmd"
  }
}

try {
  Push-Location $ProjectRoot

  Write-Host @"

  NEON // GIT EXPLORER -- build
  root : $ProjectRoot
  target: $Target

"@ -ForegroundColor DarkCyan

  Assert-Tool 'node'  'Install Node.js 18+ and retry.'
  Assert-Tool 'npm'   'Install Node.js 18+ and retry.'
  Assert-Tool 'git'   'Install Git for Windows and retry.'

  if (-not $SkipInstall) {
    if (-not (Test-Path "$ProjectRoot\node_modules")) {
      Write-Step 'installing dependencies'
      & npm install
      if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    } else {
      Write-Host 'node_modules present; skipping install (use -SkipInstall never needed, or delete node_modules to reinstall).'
    }

    Write-Step 'approving blocked install scripts (electron-winstaller)'
    & npm install-scripts approve electron-winstaller 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'allowScripts approval failed; electron-builder may error later.' }
  }

  if ($Test) {
    Write-Step 'running headless tests (npm test)'
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'npm test failed' }
  }

  if ($Smoke) {
    Write-Step 'running Electron smoke test'
    & "$ProjectRoot\node_modules\electron\dist\electron.exe" . --smoke 2>&1 | Tee-Object -Variable smokeOut
    if ("$smokeOut" -notmatch 'SMOKE OK') { throw 'Electron smoke test did not report SMOKE OK' }
  }

  Write-Step "cleaning dist"
  if (Test-Path "$ProjectRoot\dist") {
    Remove-Item "$ProjectRoot\dist\*.exe", "$ProjectRoot\dist\*.blockmap" -Force -ErrorAction SilentlyContinue
  }

  Write-Step "building $Target"
  switch ($Target) {
    'installer' { & npm run build:installer }
    'portable'  { & npm run build:portable }
    default     { & npm run build }
  }
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed for target '$Target'" }

  Write-Step 'verifying artifacts'
  $artifacts = @(Get-ChildItem "$ProjectRoot\dist" -Filter '*.exe' -File -ErrorAction SilentlyContinue)
  if (-not $artifacts.Count) { throw 'No .exe artifacts produced in ./dist' }
  foreach ($a in $artifacts) {
    $mb = [math]::Round($a.Length / 1MB, 1)
    Write-Host ("  {0,-48} {1,8} MB" -f $a.Name, $mb) -ForegroundColor Green
  }

  Write-Host "`nBUILD COMPLETE -- artifacts in $ProjectRoot\dist" -ForegroundColor Green
}
catch {
  Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
finally {
  Pop-Location
}
