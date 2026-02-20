# PCL Analysis - Docker Startup Script
# Starts PostgreSQL, Redis, and the Go API via Docker Compose

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "         PCL Analysis - Docker Services" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed and running
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
} catch {
    Write-Host "[X] Docker is not running or not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install: winget install Docker.DockerDesktop" -ForegroundColor Yellow
    Write-Host "  Then start Docker Desktop and run this script again." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "[OK] Docker is running" -ForegroundColor Green
Write-Host ""

# Start services
Write-Host "Starting PostgreSQL, Redis, and API..." -ForegroundColor Yellow
Set-Location $PSScriptRoot\backend
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Services started successfully!" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Backend API:  http://localhost:8080" -ForegroundColor White
    Write-Host "  Health check: http://localhost:8080/health" -ForegroundColor White
    Write-Host "  PostgreSQL:   localhost:5432" -ForegroundColor White
    Write-Host "  Redis:       localhost:6379" -ForegroundColor White
    Write-Host ""
    Write-Host "  To start the React frontend: npm run dev" -ForegroundColor Cyan
    Write-Host "  Frontend will run at: http://localhost:5173" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  To stop: cd backend; docker compose down" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "[X] Failed to start Docker services" -ForegroundColor Red
    exit 1
}
