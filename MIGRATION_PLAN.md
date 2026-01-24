# PCL Analysis - Migration Plan

## From Cloud Services to On-Premise Enterprise Deployment

---

## Table of Contents
1. [Current Status](#current-status)
2. [Architecture Overview](#architecture-overview)
3. [Quick Start Guide](#quick-start-guide)
4. [Database Setup](#database-setup)
5. [Backend Setup](#backend-setup)
6. [Frontend Configuration](#frontend-configuration)
7. [Production Deployment](#production-deployment)

---

## Current Status

| Task | Status |
|------|--------|
| Data Export from Firebase/Supabase | ✅ Completed |
| Go Backend Structure | ✅ Created |
| Database Migrations | ✅ Created |
| Frontend API Service | ✅ Created |
| PostgreSQL Setup | 🔄 In Progress |
| Data Import | ⏳ Pending |
| Full Integration Test | ⏳ Pending |

### Exported Data Location
```
exports/
├── firestore_export.json    # User, Reports, Challenges data
├── file_list.json           # List of all files
└── files/                   # 118 Excel files organized by department
    ├── ALL/MANAGEMENT/      # Management reports
    ├── CS/                  # CS department files
    ├── LBF/                 # LBF department files
    └── SME/                 # SME department files
```

---

## Architecture Overview

### New Architecture (Local Server)
```
┌─────────────────────────────────────────────────────────────────┐
│              Company Server (1TB SSD, 32GB RAM)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐  │
│   │    React     │────▶│   Go API     │────▶│  PostgreSQL  │  │
│   │   :5173      │◀────│   :8080      │◀────│   :5432      │  │
│   │   (Vite)     │     │   (Gin)      │     │              │  │
│   └──────────────┘     └──────────────┘     └──────────────┘  │
│                               │                                 │
│                               ▼                                 │
│                        ┌──────────────┐                        │
│                        │ File Storage │                        │
│                        │  ./uploads   │                        │
│                        └──────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack
| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React 18 + Vite | User interface |
| Backend | Go + Gin | REST API server |
| Database | PostgreSQL 16 | Data storage |
| Cache | Redis (optional) | Performance caching |
| Auth | JWT | Token-based authentication |

---

## Quick Start Guide

### Prerequisites
- Go 1.22+ (`sudo snap install go --classic`)
- PostgreSQL 16
- Node.js 18+
- Redis (optional)

### Step 1: Database Setup
```bash
# Grant permissions (run as superuser)
sudo -u postgres psql -d pcl_analysis -c "
GRANT ALL ON SCHEMA public TO masubi;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO masubi;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO masubi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO masubi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO masubi;
"

# Run migrations
cd backend
PGPASSWORD='Masubi98%' psql -U masubi -h localhost -d pcl_analysis -f migrations/001_create_users.sql
PGPASSWORD='Masubi98%' psql -U masubi -h localhost -d pcl_analysis -f migrations/002_create_reports.sql
PGPASSWORD='Masubi98%' psql -U masubi -h localhost -d pcl_analysis -f migrations/003_create_report_data.sql
PGPASSWORD='Masubi98%' psql -U masubi -h localhost -d pcl_analysis -f migrations/004_create_challenges.sql
```

### Step 2: Import Data
```bash
# From project root
cd /home/masubi/Desktop/code/pcl_analysis

# Install dependencies
npm install pg bcrypt

# Run import script
node scripts/import-to-postgres.mjs
```

### Step 3: Start Backend
```bash
cd backend
go mod tidy
go run cmd/server/main.go
```

### Step 4: Start Frontend
```bash
# In another terminal
npm run dev
```

### Step 5: Access Application
- Frontend: http://localhost:5173
- API: http://localhost:8080
- Health check: http://localhost:8080/health

---

## Database Setup

### PostgreSQL Configuration

**Database:** `pcl_analysis`
**User:** `masubi`
**Password:** `Masubi98%`

### Tables Created

| Table | Description |
|-------|-------------|
| `users` | User accounts and authentication |
| `reports` | Report metadata |
| `report_data` | Pre-parsed Excel data (performance key!) |
| `challenges` | Challenge/competition data |
| `dashboard_summary` | Materialized view for fast dashboard |

### Performance Indexes
- Reports by department and type
- Report data by date, branch, metric
- Full-text search on reports

---

## Backend Setup

### Project Structure
```
backend/
├── cmd/server/main.go       # Entry point
├── internal/
│   ├── config/              # Configuration
│   ├── database/            # PostgreSQL & Redis
│   ├── handlers/            # API endpoints
│   ├── middleware/          # Auth, CORS, logging
│   ├── models/              # Data models
│   └── services/            # Excel parser
├── migrations/              # SQL migrations
├── .env                     # Environment config
└── go.mod                   # Dependencies
```

### Environment Variables (backend/.env)
```env
# Server
SERVER_PORT=8080
GIN_MODE=debug

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=masubi
DB_PASSWORD=Masubi98%
DB_NAME=pcl_analysis

# JWT
JWT_SECRET=your_secret_key
JWT_EXPIRY_HOURS=24

# Storage
UPLOAD_PATH=./uploads

# CORS
CORS_ORIGINS=http://localhost:5173
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/reports` | List reports |
| POST | `/api/reports` | Upload report |
| GET | `/api/dashboard` | Dashboard data |
| GET | `/api/challenges` | List challenges |
| GET | `/api/admin/users` | User management (admin) |

---

## Frontend Configuration

### API Service (`src/services/api.js`)

The new API service replaces Firebase/Supabase calls:

```javascript
import api from './services/api';

// Authentication
await api.auth.login(email, password);
await api.auth.logout();

// Reports
const reports = await api.reports.getAll();
await api.reports.upload(file, title, department, type, date);

// Dashboard
const data = await api.dashboard.getData(department, fromDate, toDate);
```

### Environment Variables

Add to `.env.local`:
```env
VITE_API_URL=http://localhost:8080
```

---

## Production Deployment

### Option 1: Docker Compose
```bash
cd backend
docker-compose up -d
```

### Option 2: Manual Deployment
```bash
# Build Go binary
cd backend
go build -o pcl-api cmd/server/main.go

# Build React frontend
cd ..
npm run build

# Run backend
./backend/pcl-api

# Serve frontend with nginx
```

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name pcl.yourcompany.com;

    location /api/ {
        proxy_pass http://localhost:8080;
    }

    location / {
        root /var/www/pcl;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Default Credentials

After migration, use these credentials:

| User | Password | Role |
|------|----------|------|
| admin@pcl.com | admin123 | Admin |
| Imported users | changeme123 | User |

**⚠️ Change all passwords after first login!**

---

## Troubleshooting

### Database Connection Failed
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U masubi -h localhost -d pcl_analysis
```

### Permission Denied on Tables
```bash
# Grant permissions as postgres user
sudo -u postgres psql -d pcl_analysis -c "GRANT ALL ON SCHEMA public TO masubi;"
```

### Go Module Issues
```bash
cd backend
rm -rf go.sum
go mod tidy
```

### CORS Errors
Ensure `CORS_ORIGINS` in backend `.env` includes your frontend URL.

---

## Migration Scripts

| Script | Purpose |
|--------|---------|
| `scripts/export-data.mjs` | Export from Firebase/Supabase |
| `scripts/import-to-postgres.mjs` | Import to PostgreSQL |

---

*Document Version: 2.0*
*Last Updated: January 2026*
