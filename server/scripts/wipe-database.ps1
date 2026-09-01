# Wipe SMART Database for Fresh EnrollPro Rollover Simulation
# Run AFTER EnrollPro has wiped their data

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  SMART Database Wipe Script" -ForegroundColor Yellow
Write-Host "  For EnrollPro Rollover Simulation" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# Confirm
$confirm = Read-Host "This will DELETE ALL data in smart_db. Continue? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Aborted." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[1/4] Dropping and recreating database..." -ForegroundColor Cyan

# Get DATABASE_URL from .env
$envContent = Get-Content "$PSScriptRoot\..\.env" | Where-Object { $_ -match "DATABASE_URL" }
$dbUrl = ($envContent -split "=", 2)[1].Trim()

# Parse database name from URL
if ($dbUrl -match "smart_db") {
    $dbName = "smart_db"
} else {
    $dbName = Read-Host "Enter database name (default: smart_db)"
    if (-not $dbName) { $dbName = "smart_db" }
}

# Drop and create using psql (requires PostgreSQL in PATH)
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlPath) {
    Write-Host "ERROR: psql not found in PATH. Add PostgreSQL bin to PATH." -ForegroundColor Red
    Write-Host "Typical path: C:\Program Files\PostgreSQL\17\bin" -ForegroundColor Yellow
    exit 1
}

& psql -U postgres -c "DROP DATABASE IF EXISTS $dbName;"
& psql -U postgres -c "CREATE DATABASE $dbName;"

Write-Host "  Database recreated." -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Running Prisma migrations..." -ForegroundColor Cyan
Set-Location "$PSScriptRoot\.."
npx prisma db push --accept-data-loss

Write-Host ""
Write-Host "[3/4] Generating Prisma client..." -ForegroundColor Cyan
npx prisma generate

Write-Host ""
Write-Host "[4/4] Optional: Seed database?" -ForegroundColor Cyan
$seed = Read-Host "Run prisma db seed? (yes/no)"
if ($seed -eq "yes") {
    npx prisma db seed
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Database wiped successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Start SMART: npm run dev" -ForegroundColor White
Write-Host "  2. Login with dev account" -ForegroundColor White
Write-Host "  3. Go to System Settings > EnrollPro Credentials" -ForegroundColor White
Write-Host "  4. Enter new EnrollPro credentials" -ForegroundColor White
Write-Host "  5. Wait for first sync (or click Sync Now)" -ForegroundColor White
Write-Host ""
