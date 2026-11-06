param(
  [ValidateSet("G0", "G1", "G2", "G3", "G4", "G5")]
  [string]$Gate = "G5"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$artifactDir = Join-Path $root "artifacts\grading-mode"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $artifactDir "$Gate-pm2-$stamp.log"
$listPath = Join-Path $artifactDir "$Gate-pm2-list-$stamp.txt"

pm2 list | Out-File -Encoding utf8 $listPath
pm2 logs server --lines 300 --nostream --timestamp | Out-File -Encoding utf8 $logPath

$ignore = @(
  "AIMS DOWN",
  "AimsSync",
  "AtlasSync",
  "AtlasYear",
  "SCHOOL_SCOPE_REQUIRED",
  "ECONNREFUSED 100.92.245.14:5000",
  "Partial sync"
)

$fail = @(
  "UnhandledPromiseRejection",
  "Uncaught",
  "PrismaClientKnownRequestError",
  "PrismaClientValidationError",
  "\[GradingMode\].*error",
  "\[Transmutation\].*did not match",
  "status 500",
  "Error: Cannot"
)

$lines = Get-Content $logPath
$bad = $lines | Where-Object {
  $line = $_
  $matchesFail = $fail | Where-Object { $line -match $_ }
  $matchesIgnore = $ignore | Where-Object { $line -match $_ }
  $matchesFail -and -not $matchesIgnore
}

if ($bad) {
  $bad | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
  Write-Host "[$Gate] PM2 log gate FAILED ($($bad.Count) line(s))" -ForegroundColor Red
  exit 1
}

Write-Host "[$Gate] PM2 log gate PASSED" -ForegroundColor Green
Write-Host "Artifacts: $logPath"
