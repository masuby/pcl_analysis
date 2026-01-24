# PCL Analysis API - Go Backend

High-performance REST API for PCL Analysis Dashboard, built with Go and PostgreSQL.

## Features

- **Fast Performance**: Pre-parsed Excel data stored in PostgreSQL for instant queries
- **JWT Authentication**: Secure token-based authentication
- **Redis Caching**: Optional caching for dashboard data
- **Excel Parsing**: Server-side parsing with excelize library
- **RESTful API**: Clean API design following REST principles
- **Docker Support**: Easy deployment with Docker Compose

## Tech Stack

- **Go 1.22+** - Backend language
- **Gin** - HTTP web framework
- **PostgreSQL 16** - Primary database
- **Redis** - Caching layer (optional)
- **Docker** - Containerization

## Quick Start

### Prerequisites

- Go 1.22 or higher
- PostgreSQL 16
- Redis (optional)
- Docker & Docker Compose (for containerized deployment)

### Development Setup

1. **Clone and navigate to backend:**
   ```bash
   cd backend
   ```

2. **Copy environment file:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Install dependencies:**
   ```bash
   go mod download
   ```

4. **Run database migrations:**
   ```bash
   psql -U pcl_user -d pcl_analysis -f migrations/001_create_users.sql
   psql -U pcl_user -d pcl_analysis -f migrations/002_create_reports.sql
   psql -U pcl_user -d pcl_analysis -f migrations/003_create_report_data.sql
   psql -U pcl_user -d pcl_analysis -f migrations/004_create_challenges.sql
   ```

5. **Run the server:**
   ```bash
   go run cmd/server/main.go
   ```

### Docker Deployment

1. **Start all services:**
   ```bash
   docker-compose up -d
   ```

2. **With Nginx (production):**
   ```bash
   docker-compose --profile production up -d
   ```

3. **View logs:**
   ```bash
   docker-compose logs -f api
   ```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | User registration |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update profile |
| PUT | `/api/auth/password` | Change password |
| POST | `/api/auth/refresh` | Refresh token |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports` | List all reports |
| GET | `/api/reports/:id` | Get report by ID |
| GET | `/api/reports/:id/data` | Get parsed report data |
| GET | `/api/reports/:id/download` | Download report file |
| POST | `/api/reports` | Upload new report |
| PUT | `/api/reports/:id` | Update report |
| DELETE | `/api/reports/:id` | Delete report |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Get dashboard data |
| GET | `/api/dashboard/stats` | Get statistics |
| GET | `/api/dashboard/metrics` | Get available metrics |
| GET | `/api/dashboard/dates` | Get available dates |

### Challenges
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/challenges` | List all challenges |
| GET | `/api/challenges/:id` | Get challenge by ID |
| POST | `/api/challenges` | Create challenge |
| PUT | `/api/challenges/:id` | Update challenge |
| DELETE | `/api/challenges/:id` | Delete challenge |

### Admin (Admin role required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| POST | `/api/admin/refresh-views` | Refresh materialized views |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SERVER_PORT` | Server port | `8080` |
| `SERVER_HOST` | Server host | `0.0.0.0` |
| `GIN_MODE` | Gin mode (debug/release) | `debug` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USER` | Database user | `pcl_user` |
| `DB_PASSWORD` | Database password | - |
| `DB_NAME` | Database name | `pcl_analysis` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRY_HOURS` | Token expiry in hours | `24` |
| `UPLOAD_PATH` | File upload directory | `./uploads` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:5173` |

## Project Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go           # Application entry point
├── internal/
│   ├── config/               # Configuration management
│   ├── database/             # Database connections
│   ├── handlers/             # HTTP handlers
│   ├── middleware/           # Middleware (auth, cors, logging)
│   ├── models/               # Data models
│   ├── services/             # Business logic
│   └── utils/                # Utility functions
├── migrations/               # SQL migrations
├── nginx/                    # Nginx configuration
├── Dockerfile
├── docker-compose.yml
├── go.mod
└── README.md
```

## Default Credentials

After running migrations, a default admin user is created:

- **Email**: `admin@pcl.com`
- **Password**: `admin123`

**⚠️ IMPORTANT**: Change this password immediately in production!

## Performance

Expected performance after migration:

| Operation | Cloud (Before) | Local (After) |
|-----------|----------------|---------------|
| Dashboard load | 5-15 sec | 200-500ms |
| Filter change | 3-8 sec | 50-100ms |
| Report search | 2-5 sec | 20-50ms |
| Concurrent users | 5-10 | 100+ |

## License

Private - All rights reserved
