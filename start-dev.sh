#!/bin/bash

# PCL Analysis Development Startup Script
# This script starts both the Go backend and React frontend

echo "═══════════════════════════════════════════════════════"
echo "         PCL Analysis - Development Server"
echo "═══════════════════════════════════════════════════════"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}✗ Go is not installed${NC}"
    echo "  Install with: sudo snap install go --classic"
    exit 1
fi
echo -e "${GREEN}✓ Go is installed${NC}"

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js is installed${NC}"

# Check PostgreSQL connection
if ! PGPASSWORD='Masubi98%' psql -U masubi -h localhost -d pcl_analysis -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}✗ Cannot connect to PostgreSQL${NC}"
    echo "  Make sure PostgreSQL is running and credentials are correct"
    exit 1
fi
echo -e "${GREEN}✓ PostgreSQL connection OK${NC}"

echo ""
echo -e "${YELLOW}Starting servers...${NC}"
echo ""

# Create uploads directory if it doesn't exist
mkdir -p backend/uploads

# Start Go backend in background
echo "Starting Go backend on http://localhost:8080..."
cd backend
go run cmd/server/main.go &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 3

# Start React frontend
echo "Starting React frontend on http://localhost:5173..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}Servers started!${NC}"
echo ""
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8080"
echo "  API Docs: http://localhost:8080/health"
echo ""
echo "Press Ctrl+C to stop both servers"
echo "═══════════════════════════════════════════════════════"

# Handle Ctrl+C
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID 2>/dev/null; kill $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for processes
wait
