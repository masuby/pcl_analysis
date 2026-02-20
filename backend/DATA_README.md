# Persistent Data (Portable)

Docker storage:

| Data | Storage | Notes |
|------|---------|-------|
| PostgreSQL | Named volume `pcl_postgres_data` | Bind mount fails on WSL+Windows path |
| Report files | `backend/data/uploads/` | Excel files (portable) |
| Redis | `backend/data/redis/` | Cache |

**To move to another machine:**
1. Copy the project folder including `backend/data/uploads/`
2. Export/import postgres: `docker run --rm -v pcl_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .`
