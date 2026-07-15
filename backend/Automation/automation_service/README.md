# Automation Orchestrator

Web service that runs the existing report scripts (CRM / Call Center / Management
/ MTD) **as subprocesses** so their logic is never touched — only *paths and flow*
are parameterised. It streams each script's stdout live to the dashboard, supports
Start/Stop, file uploads, email choice, and recipient editing.

```
Automation dashboard (src/pages/Automation)  ──HTTP──►  this service (:8091)
                                                          │ subprocess
                              crm_reports.py · call_center_report_copy.py ·
                              combined/process_users/process_management.py ·
                              cs/lbf_mtd_processor.py · send_email_mtd.py
```

## Run (dev)

```bash
cd backend/Automation/automation_service
pip install -r requirements.txt
uvicorn app.main:app --port 8091
```

The dashboard calls `VITE_AUTOMATION_API_URL` (default `http://localhost:8091`).

## How it works

- **Dynamic paths.** Every script now resolves its folders from `PCL_AUTOMATION_ROOT`
  (set by the service to `backend/Automation`) with a sensible relative fallback,
  so the same code runs on the dev box and the server. No more `C:\…\pcl\…`.
- **Headless prompts.** The scripts' `input()` prompts (date, send-yes/no, email
  confirm) now accept `--date` / `--send` args (or env), so nothing blocks.
- **Uploads.** Files POSTed to `/pipelines/{id}/upload` land in each script's input
  folder (`CRM/ROW_EXCEL`, `CALL_CENTER/ROW_FILES`, `Management/ROW_FILES`,
  `MTD/ROW_FILES`). Validation checks required files are present before Start.
- **Auto-clear.** Only the files uploaded via the UI this session are deleted after
  a clean finish — persisted masters and helper scripts are never touched.
- **Recipients.** CRM recipients are read/written in `Master_crm_emails.xlsx`
  (sheets Actual/Specific/Test, columns CS/LBF/SME). Other pipelines list theirs
  read-only for now (they live in the scripts).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/pipelines` | registry (uploads, inputs, email modes) |
| GET  | `/pipelines/{id}/files` | current uploads + validation |
| POST | `/pipelines/{id}/upload` | multipart upload |
| POST | `/pipelines/{id}/clear` | remove this session's uploads |
| POST | `/pipelines/{id}/start` | validate + launch (body: `{date, send}`) |
| POST | `/pipelines/{id}/stop` | terminate the running step tree |
| GET  | `/pipelines/{id}/logs?after=N` | poll new log lines + state |
| GET/PUT | `/pipelines/{id}/recipients` | read / edit CRM recipients |

## Pipeline status

| Pipeline | Wiring | Notes |
| --- | --- | --- |
| **CRM** | ✅ end-to-end | `crm_reports.py <date> --send <mode>` → DB upload. Recipients editable. |
| **Call Center** | ✅ wired | `--send yes/no`; reads 2 files from `ROW_FILES`; runs RO report + DB upload itself. |
| **MTD** | ✅ wired | CS + LBF processors → `send_email_mtd.py --send`. |
| **Management** | ⚠ wired, Windows-only email | `process_management.py` uses **xlwings + .exe** helpers → won't run on a Linux server as-is; the build steps run, the exe email step needs Windows. |

Paths, prompts, and the orchestration are done. Full end-to-end validation of
Call Center / MTD / Management needs the real daily source files + SMTP/SSH creds
present — run each once from the dashboard with a live dataset to confirm.

## Server move

Set these env vars (all default to the repo layout):
`PCL_AUTOMATION_ROOT`, `CRM_DIR`, `CALL_CENTER_DIR`, `MANAGEMENT_DIR`, `MTD_DIR`,
`PCL_MANAGEMENT_OUT`, `AUTOMATION_PYTHON`.
