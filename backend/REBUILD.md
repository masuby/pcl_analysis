# Rebuild API image (e.g. after adding new routes)

From the **backend** folder:

```powershell
cd backend
docker compose build api
docker compose up -d
```

Or in one step (build and restart):

```powershell
cd backend
docker compose up -d --build api
```

To force a full rebuild without cache (if something seems stale):

```powershell
cd backend
docker compose build --no-cache api
docker compose up -d
```

Then check: http://localhost:8080/health
