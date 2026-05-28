#!/usr/bin/env bash
# ─── Build everything needed for the deploy/ folder ──────────────────────
#
#   ./build-deploy.sh         — frontend + backend binary + migrations + creds
#   ./build-deploy.sh --dump  — also pg_dump the current local DB
#
# Produces / refreshes:
#   deploy/dist/                       (frontend bundle)
#   deploy/pcl-api                     (Linux amd64 Go binary)
#   deploy/migrations/                 (synced from backend/migrations)
#   deploy/credentials/                (service-account JSON)
#   deploy/db/pcl_analysis.dump        (optional, with --dump)
#
# After running, commit & push the deploy/ repo to the server.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$ROOT/deploy"
WITH_DUMP=0
[[ "${1:-}" == "--dump" ]] && WITH_DUMP=1

echo "── 1/5  Building frontend (vite) ──────────────────────────────────"
(cd "$ROOT" && rm -rf dist && npx --no-install vite build)

echo "── 2/5  Cross-compiling Go backend (linux/amd64) ──────────────────"
docker run --rm \
  -v "$ROOT/backend:/app" \
  -w /app \
  -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 \
  golang:1.22-alpine \
  sh -c "apk add --no-cache git ca-certificates >/dev/null && \
         go build -trimpath -ldflags '-s -w' -o pcl-api ./cmd/server"

echo "── 3/5  Syncing artifacts into deploy/ ────────────────────────────"
rm -rf "$DEPLOY/dist"
cp -r "$ROOT/dist" "$DEPLOY/dist"
cp "$ROOT/backend/pcl-api" "$DEPLOY/pcl-api"
chmod +x "$DEPLOY/pcl-api"
mkdir -p "$DEPLOY/migrations" "$DEPLOY/credentials"
cp -u "$ROOT/backend/migrations/"*.sql "$DEPLOY/migrations/"
cp "$ROOT/backend/credentials/sheets-service-account.json" "$DEPLOY/credentials/"

if [[ "$WITH_DUMP" == "1" ]]; then
  echo "── 4/5  pg_dump local pcl_analysis ────────────────────────────────"
  mkdir -p "$DEPLOY/db"
  docker exec pcl-postgres pg_dump -U pcl_user -Fc -Z 6 \
    --no-owner --no-privileges \
    -d pcl_analysis -f /tmp/pcl_analysis.dump
  docker cp pcl-postgres:/tmp/pcl_analysis.dump "$DEPLOY/db/pcl_analysis.dump"
  docker exec pcl-postgres rm -f /tmp/pcl_analysis.dump
  echo "    → $(du -h "$DEPLOY/db/pcl_analysis.dump" | cut -f1) written to deploy/db/"
else
  echo "── 4/5  Skipping pg_dump (pass --dump to refresh database snapshot) ─"
fi

echo "── 5/5  Summary ────────────────────────────────────────────────────"
echo "  dist files  : $(find "$DEPLOY/dist" -type f | wc -l)"
echo "  api binary  : $(du -h "$DEPLOY/pcl-api" | cut -f1)"
echo "  migrations  : $(ls "$DEPLOY/migrations" | wc -l)"
echo "  credentials : $(ls "$DEPLOY/credentials" | wc -l) file(s)"
[[ -f "$DEPLOY/db/pcl_analysis.dump" ]] && \
  echo "  db dump     : $(du -h "$DEPLOY/db/pcl_analysis.dump" | cut -f1)"
echo
echo "✓ deploy/ is ready to commit and push."
