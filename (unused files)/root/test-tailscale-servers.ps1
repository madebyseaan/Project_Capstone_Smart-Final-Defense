# Test all team servers on Tailscale
# Run this to check which servers are online

Write-Host "Testing Tailscale Microservices..." -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

$teams = @(
    @{name="dev-jegs (Enrollment)"; ip="100.120.169.123"; port=3000},
    @{name="njgrm (Scheduling)"; ip="100.88.55.125"; port=3000},
    @{name="tfrog (Learning Management)"; ip="100.92.245.14"; port=3000},
    @{name="YOU (Grading)"; ip="100.93.66.120"; port=3000}
)

$onlineCount = 0
$offlineCount = 0

foreach($team in $teams) {
    Write-Host "Testing $($team.name) at $($team.ip):$($team.port)..." -NoNewline
    
    try {
        $response = Invoke-WebRequest -Uri "http://$($team.ip):$($team.port)" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        Write-Host " ✅ ONLINE" -ForegroundColor Green
        $onlineCount++
        
        # Try to get more info
        try {
            $apiResponse = Invoke-WebRequest -Uri "http://$($team.ip):$($team.port)/api" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            Write-Host "   └─ API endpoint responding" -ForegroundColor Gray
        } catch {
            Write-Host "   └─ Server running but /api not found" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " ❌ OFFLINE" -ForegroundColor Red
        Write-Host "   └─ $($_.Exception.Message)" -ForegroundColor DarkGray
        $offlineCount++
    }
    Write-Host ""
}

Write-Host "=================================" -ForegroundColor Cyan
Write-Host "Summary: $onlineCount online, $offlineCount offline" -ForegroundColor Cyan

if ($offlineCount -gt 0) {
    Write-Host ""
    Write-Host "⚠️  Some servers are offline. Ask teams to start their servers:" -ForegroundColor Yellow
    Write-Host "   cd server && npm run dev" -ForegroundColor Gray
}
