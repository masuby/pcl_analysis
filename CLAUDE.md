# PCL Analysis — Project Notes for Claude

This file captures conventions, repo layout, and the dual-git workflow so a fresh Claude session can be productive immediately.

---

## Repository Layout

```
pcl_analysis/                     ← project root (full source code)
├─ src/                           — React + Vite frontend source
├─ backend/                       — Go + Gin API source
│  ├─ cmd/server/main.go
│  ├─ internal/{handlers,models,middleware,services,database,config,utils}/
│  ├─ migrations/                 — SQL migrations (live source)
│  ├─ credentials/                — service-account JSON (gitignored at root)
│  └─ Dockerfile                  — full builder image (multi-stage)
├─ dist/                          — Vite build output (gitignored at root)
├─ deploy/                        ← SEPARATE git repo (deploy artifacts only)
│  ├─ dist/                       — built frontend (copied from project's dist/)
│  ├─ pcl-api                     — compiled Go binary (Linux x86_64)
│  ├─ migrations/                 — synced from backend/migrations/
│  ├─ credentials/                — synced from backend/credentials/
│  ├─ db/pcl_analysis.dump        — Postgres custom-format dump (~180 MB)
│  ├─ Dockerfile                  — slim Alpine runtime
│  ├─ docker-compose.yml          — orchestrates api + postgres + nginx
│  └─ nginx/, init-ssl.sh
└─ docs/, scripts/, etc.
```

---

## Two GitHub Remotes — DUAL-REPO WORKFLOW

| Repo               | Path                | Remote                                    | Git user                            | Email                                | What gets pushed                                                              |
| ------------------ | ------------------- | ----------------------------------------- | ----------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| **Source**         | `pcl_analysis/`     | github.com/`masuby`/pcl_analysis (or similar) | `masuby`                            | `www.danielclement468@gmail.com`     | Full source code. `dist/`, `*.dump`, `node_modules/`, large binaries IGNORED. |
| **Deploy** | `pcl_analysis/deploy/` | github.com/`pcltz`/pcl_analysis           | `pcltz`                             | `daniel@platinumcredit.co.tz`        | Only `dist/`, `pcl-api` binary, migrations, credentials, `db/*.dump`. NO source code. |

The `deploy/` directory is a **separate git repo** (it has its own `.git/`) that lives **inside** the source repo's directory tree. The source repo's `.gitignore` excludes the `deploy/` folder to keep the two histories independent.

### Per-repo identity is set LOCALLY

Each repo has its own `user.name` / `user.email` set via `git config --local`. Never use `--global` — the wrong identity would leak across both repos.

```powershell
# Source repo identity (already set)
cd C:\Users\Daniel\Desktop\code\Website\pcl_analysis
git config --local user.name  "masuby"
git config --local user.email "www.danielclement468@gmail.com"

# Deploy repo identity
cd C:\Users\Daniel\Desktop\code\Website\pcl_analysis\deploy
git config --local user.name  "pcltz"
git config --local user.email "daniel@platinumcredit.co.tz"
```

### Pushing — Authentication

Each remote needs the OTHER account's HTTPS Personal Access Token at push time. Don't reuse the same Windows Credential Manager entry for both — credentials are keyed per remote host but git only stores one credential per host by default. Use one of:

1. **PAT-in-URL trick** (per-push, no credential cache):
   ```powershell
   # In deploy folder, after committing as pcltz:
   git push https://pcltz:<TOKEN>@github.com/pcltz/pcl_analysis.git main
   ```
2. **SSH** with separate keys per identity (`~/.ssh/config` host aliases). Recommended long-term.
3. **Different credential helper per repo** via `git config --local credential.helper`.

---

## Build & Deploy Pipeline

### Step 1 — Build the frontend (in source repo root)

```powershell
cd C:\Users\Daniel\Desktop\code\Website\pcl_analysis
npm run build              # produces ./dist
```

### Step 2 — Cross-compile the Linux Go binary

Windows host can't natively produce a Linux binary, so use the official `golang:1.22-alpine` Docker image:

```powershell
docker run --rm `
  -v "C:\Users\Daniel\Desktop\code\Website\pcl_analysis\backend:/app" `
  -w /app `
  -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 `
  golang:1.22-alpine `
  sh -c "go build -ldflags='-s -w' -o /app/pcl-api ./cmd/server"
```

### Step 3 — Refresh the Postgres dump

Always dump *inside* the container then `docker cp` out — PowerShell mangles binary streams through pipes.

```powershell
docker exec pcl-postgres sh -c `
  "pg_dump -U pcl_user -F c --no-owner --no-acl -d pcl_analysis -f /tmp/pcl.dump"
docker cp pcl-postgres:/tmp/pcl.dump `
  C:\Users\Daniel\Desktop\code\Website\pcl_analysis\deploy\db\pcl_analysis.dump
```

### Step 4 — Sync into `deploy/`

```bash
# from project root, in git-bash
rm -rf deploy/dist && cp -r dist deploy/dist
cp backend/pcl-api                 deploy/pcl-api
cp backend/migrations/*.sql         deploy/migrations/
cp backend/credentials/*.json       deploy/credentials/
```

### Step 5 — Asset-path case consistency (Windows gotcha)

Windows is case-insensitive but Linux servers are case-sensitive. Vite writes `dist/assets/...` (lowercase), but the `public/Assets/` folder (e.g. logos) stays capital and gets copied through verbatim. When everything lands on Windows, the two folders collide into one.

**Convention: standardize on lowercase `assets/` for everything in `deploy/dist/`.**

After copying, run:
```bash
cd deploy/dist
# Rename folder via temp (Windows case-rename trick):
mv assets _tmp && mv _tmp assets   # (or use PowerShell Rename-Item twice)

# Rewrite hardcoded /Assets/ references to /assets/ in HTML, JS, CSS:
sed -i 's|/Assets/|/assets/|g' index.html assets/*.js assets/*.css
```

Verify with `grep -ron '/Assets/' deploy/dist/` — should return nothing.

### Step 6 — Commit & push

```powershell
# DEPLOY REPO  (as pcltz)
cd C:\Users\Daniel\Desktop\code\Website\pcl_analysis\deploy
git add -A
git commit -m "build: refresh frontend + backend + db dump"
git push origin main         # auth as pcltz / daniel@platinumcredit.co.tz

# SOURCE REPO  (as masuby) — separately, when source code changes
cd C:\Users\Daniel\Desktop\code\Website\pcl_analysis
git add -A
git commit -m "feat: ..."
git push origin main         # auth as masuby
```

> **Verified one-shot (git-bash, from project root)** — build both, sync, case-fix, commit the deploy repo. This whole block is confirmed working; the `pcl-api` binary is committed into `deploy/` alongside `dist/` (do NOT rely on the source repo for it — it's gitignored there):
> ```bash
> npm run build
> docker run --rm -v "C:/Users/Daniel/Desktop/code/Website/pcl_analysis/backend:/app" -w /app \
>   -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 golang:1.22-alpine \
>   sh -c "go build -ldflags='-s -w' -o /app/pcl-api ./cmd/server"
> rm -rf deploy/dist && cp -r dist deploy/dist && cp backend/pcl-api deploy/pcl-api
> cd deploy/dist && mv Assets _t && mv _t assets \
>   && for f in index.html assets/*.js assets/*.css; do sed -i 's|/Assets/|/assets/|g' "$f"; done && cd ../..
> cd deploy && git add -A && git commit -m "build: refresh frontend + backend" && cd ..
> ```

### Credentials required (NOT on the dev machine — supply at run time)

Neither secret is stored in the repo, git credential cache, or `~/.ssh`, so a fresh session **cannot push or deploy on its own** — it can only build/sync/commit locally and then hand these steps to the operator:

- **GitHub push (pcltz)** — a Personal Access Token. Use the PAT-in-URL trick per push (no cache):
  ```bash
  cd deploy && git push https://pcltz:<TOKEN>@github.com/pcltz/pcl_analysis.git main
  ```
  (A plain `git push origin main` returns `Repository not found` / `Authentication failed` without it.)
- **Server SSH** — the operator's private key + host. `~/.ssh/known_hosts` shows `139.59.64.29`; the frontend `.env.production` targets `154.72.68.246:8443`. Confirm which host is live before deploying.

### Step 7 — Deploy on the server (Ubuntu + Docker)

Once the **deploy** repo is pushed, SSH in and pull + rebuild. First-time setup (`.env`, admin user, DB restore) is in `deploy/README.md`.

```bash
ssh <user>@<server>
cd pcl_analysis                 # the cloned pcltz/pcl_analysis (deploy) repo
git pull origin main
docker compose down
docker compose up -d --build    # rebuilds the pcl-api image, reloads nginx + dist/
docker compose logs -f api      # verify the API came up
```

Brings up 4 containers: **pcl-postgres**, **pcl-redis**, **pcl-api** (:8080), **pcl-nginx** (:80, serves `dist/` + proxies `/api/*`). Only re-run the DB restore (`./db/restore.sh`) when the committed `db/*.dump` actually changed — the dump is ~180 MB and unchanged by frontend/backend-only releases.

---

## Source-Repo `.gitignore` Reminders

The root `.gitignore` MUST exclude:
- `node_modules/`
- `dist/`
- `backend/pcl-api`         (compiled binary)
- `backend/credentials/`    (service-account JSON contains a private key)
- `**/.env`
- `*.dump`                  (DB dumps are huge)
- `deploy/`                 (the entire deploy folder is its own repo — keep histories separate)

---

## Operational Notes

- **Local dev DB**: container `pcl-postgres`, db `pcl_analysis`, user `pcl_user`, password in `backend/.env`.
- **Migrations**: applied manually via `docker exec pcl-postgres psql -U pcl_user -d pcl_analysis -f /tmp/NNN.sql`. There is no automatic migration runner. Always copy the file into the container first with `docker cp`.
- **Google Sheets credentials**: `backend/credentials/sheets-service-account.json` — the service account is `sales-reps-status@…`. It has read/write access to two workbooks: the LBF/SME call-centre sheet (id `1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE`) and the CS sheet (id `14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI`). Both have a `MAY 2026 SHEET` tab as the canonical analyst view.
- **xlsx-js-style freeze panes**: must use `ws['!views'] = [{ pane: { state: 'frozen', xSplit, ySplit, topLeftCell, activePane: 'bottomRight' }, ... }]`. Setting `ws['!freeze']` alone is silently dropped on write.
- **Frontend shared spinner**: `src/components/Common/Loading/LoadingSpinner.jsx`. Pass `fullScreen` for the PayPal-style cloud overlay. Used everywhere; do not introduce other spinner styles.
- **ReportShell**: `src/pages/Dashboard/components/DepartmentalDashboard/components/ReportShell/`. Wraps any auto-loading DepartmentalDashboard section so it only mounts after the user clicks Generate Report. Reuses LoadingSpinner.
- **Feedback primitives**: `src/components/feedback/Feedback.jsx` exports `<Toast/>` and `<ConfirmDialog/>`. Use these instead of `window.alert` / `window.confirm`.

---

## UI Styling Conventions

This is an internal business tool for analysts and managers. It should look like
a plain, serious reporting system — not a landing page. **Restraint is the house
style.** Confirmed by the user on 2026-08-10.

### Do not use — these read as "vibe coded"

- **Coloured left-accent stripes on cards/boxes** (`border-left: 3px solid orange`
  and similar). This is the single worst offender — no decorative edge bars on
  stat cards, issue cards, callouts, or panels. Use a plain 1px `--dd-line`
  border on all four sides.
- **Tinted card backgrounds used purely for mood** (`#fff7f7`, pastel fills).
  White cards on a light grey page.
- Gradient fills, glows, drop shadows beyond a soft `0 1px 2px`, animated
  entrances, emoji used as decoration rather than as a label icon.
- Rounded "pill" containers around whole sections; oversized display type.

### Do use

- Flat white cards, `1px solid` neutral border, `8-12px` radius.
- **Severity belongs in the words, not the chrome.** Group items under an
  explicit heading ("Blocking — these leads cannot be worked" vs "Gaps — worth
  fixing at source") instead of colour-coding the container.
- Colour only where it carries data: status pills, progress-bar fills, an
  invalid-row highlight. Never colour as ornament.
- Existing palette in `DigitalData.css` (`--dd-blue/ink/muted/line/bg`) — reuse
  rather than inventing new hues.

### Excel exports

Same principle: solid header band, thin grey cell borders, subtle alternating
row banding, no accent stripes or gradient fills. See
`DataDashboard/DigitalData/utils/digitalDataExport.js` for the reference
implementation.

---

## Past Decisions / Gotchas

- `google.golang.org/api` is pinned to **v0.205.0** in `backend/go.mod` because newer versions need Go ≥ 1.25 and the project is on Go 1.22.
- The LBF source workbook has **TWO** tabs called `MAY SHEET` (one with a trailing space). The May-2026 data lives in `MAY SHEET ` (trailing space). Always quote sheet names in Sheets API ranges.
- The Lead "CALLING DATE" column has 46+ wildly inconsistent date formats. `bootstrap_may2026.py` has a smart parser; don't reinvent.
- EA Trip Excel report: Qualified / Not Qualified sheets show MANAGERS ONLY (LBF Branch Managers + CS/SME Regional Managers). Sales agents go in `All Agents` sheet only.
- Always use `Title` from the Users file (not `Role`) for the agent identifier — confirmed by user on 2026-05-23.
