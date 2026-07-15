#!/usr/bin/env python3
"""
direct_upload_files_to_db.py
============================================================================
Bulk-upload PCL Excel reports (CRM / Call Center / MTD / Management) to the
LIVE PCL system, skipping any whose (department, type, date) already exists.

It works exactly like a person using the website would — but the app is NOT
exposed on the public IP (that's a VPN), so everything runs over SSH against the
nginx the server publishes on https://127.0.0.1:

    1. SSH in (SERVER_LOGIN / SERVER_PASSWORD) and log in to the API as the user
       in CRM/.env (PCL_API_USER / PCL_API_PASSWORD), keeping the returned JWT.
    2. Ask the API which reports already exist (GET /api/reports).
    3. For each missing file: SFTP it to a temp path on the server, then POST it
       to /api/reports (multipart, same as the website "Upload" button) via
       curl on the server. The server saves the file AND parses it into
       report_data on its own — so dashboards light up just like a UI upload.
       The temp file is removed afterwards.

Modes
-----
    python direct_upload_files_to_db.py            # DRY-RUN (read-only, default)
    python direct_upload_files_to_db.py --commit   # actually upload the missing files

Dry-run logs in (read-only) and prints exactly what WOULD be uploaded vs skipped.
Nothing is written without --commit.

Connection details come from CRM/.env:
    SERVER_LOGIN     = ssh -p 2222 pcltz_admin@154.72.68.246
    SERVER_PASSWORD  = ********
    PCL_API_USER     = admin@pcl.com
    PCL_API_PASSWORD = ********
    PCL_API_BASE_URL = https://127.0.0.1           (optional; the in-server app URL)

Requires:  pip install paramiko
============================================================================
"""

import os
import re
import sys
import time
import argparse
from datetime import date

# Windows consoles default to cp1252 and choke on the status emojis below.
# Force UTF-8 so the script runs cleanly everywhere.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# CONFIG — local folders to scan (dynamic: derived from the Automation root so
# the same script works on the dev box and on the server).
#   PCL_AUTOMATION_ROOT  -> .../backend/Automation   (set by the orchestrator)
#   fallback             -> this file's grandparent (…/Automation)
# ---------------------------------------------------------------------------
from pathlib import Path as _Path

_AUTOMATION_ROOT = os.environ.get("PCL_AUTOMATION_ROOT") or str(_Path(__file__).resolve().parents[1])
BASE = _AUTOMATION_ROOT
# Management report output dir (process_management.py writes here). Overridable.
MANAGEMENT_REPORT_DIR = os.environ.get(
    "PCL_MANAGEMENT_OUT", str(_Path(_AUTOMATION_ROOT) / "Management" / "OUTPUT"))

CRM_FOLDERS = [
    (str(_Path(BASE) / "CRM" / "CS" / "NEW_EXCEL"), "CS", "CRM"),
    (str(_Path(BASE) / "CRM" / "LBF" / "NEW_EXCEL"), "LBF", "CRM"),
    (str(_Path(BASE) / "CRM" / "SME" / "NEW_EXCEL"), "SME", "CRM"),
]
CALL_CENTER_FOLDERS = [
    (str(_Path(BASE) / "CALL_CENTER" / "NEW_FILES" / "CS"), "CS", "CALL CENTER"),
    (str(_Path(BASE) / "CALL_CENTER" / "NEW_FILES" / "LBF"), "LBF", "CALL CENTER"),
]
MTD_FOLDER = str(_Path(BASE) / "MTD" / "ROW_FILES")     # "CS MTD as of 13th June 2026.xlsx"
ENV_PATH = os.environ.get("PCL_CRM_ENV", str(_Path(BASE) / "CRM" / ".env"))

# In-server URL of the app's nginx (published on the host as 127.0.0.1:443).
DEFAULT_INTERNAL_URL = "https://127.0.0.1"
REMOTE_TMP_DIR = "/tmp"

# Pacing — nginx limits /api to ~10 req/s (burst 20). Stay comfortably under.
UPLOAD_DELAY_SEC = 0.5
CURL_TIMEOUT     = 180          # seconds (uploads can be large; nginx allows 55 MB)
MAX_RETRIES      = 3

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


# ---------------------------------------------------------------------------
# .env parsing
# ---------------------------------------------------------------------------
def _strip(v):
    v = v.strip()
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        v = v[1:-1]
    return v


def load_server_creds(env_path):
    """Return dict: ssh host/port/user/password, api_user/api_password, internal_url."""
    host = port = user = password = None
    api_user = api_password = base_url = None
    if not os.path.exists(env_path):
        sys.exit(f"❌ .env not found at {env_path}")
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("SERVER_LOGIN"):
                val = line.split("=", 1)[1].strip()
                m = re.search(r"-p\s+(\d+)\s+([^@]+)@([\d.\w-]+)", val)
                if m:
                    port, user, host = int(m.group(1)), m.group(2).strip(), m.group(3).strip()
            elif line.startswith("SERVER_PASSWORD"):
                password = _strip(line.split("=", 1)[1])
            elif line.startswith("PCL_API_BASE_URL"):
                base_url = _strip(line.split("=", 1)[1])
            elif line.startswith("PCL_API_USER"):
                api_user = _strip(line.split("=", 1)[1])
            elif line.startswith("PCL_API_PASSWORD"):
                api_password = _strip(line.split("=", 1)[1])

    if not all([host, port, user, password]):
        sys.exit("❌ Could not parse SERVER_LOGIN / SERVER_PASSWORD from .env")
    if not api_user or not api_password:
        sys.exit("❌ PCL_API_USER / PCL_API_PASSWORD missing from .env — needed to log in and upload.")
    return {
        "host": host, "port": port, "user": user, "password": password,
        "api_user": api_user, "api_password": api_password,
        "internal_url": (base_url or DEFAULT_INTERNAL_URL).rstrip("/"),
    }


# ---------------------------------------------------------------------------
# Date parsers — return a datetime.date or None
# ---------------------------------------------------------------------------
def parse_crm_date(filename):
    # CS_CRM_01_06_2026.xlsx -> 2026-06-01   (DD_MM_YYYY)
    m = re.search(r"_(\d{2})_(\d{2})_(\d{4})\.xlsx$", filename, re.IGNORECASE)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def parse_callcenter_folder(folder_name):
    # "2026-06-15" -> date ; "2026-03-01_to_2026-03-28" (range) -> None (skip)
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", folder_name)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def parse_mtd_date(filename):
    # "CS MTD as of 13th June 2026.xlsx" -> 2026-06-13
    m = re.search(r"as of\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})", filename, re.IGNORECASE)
    if not m:
        return None
    d = int(m.group(1)); mo = MONTHS.get(m.group(2).lower()); y = int(m.group(3))
    if not mo:
        return None
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def parse_management_date(filename):
    # "Management Report2026-06-15.xlsx" -> 2026-06-15  (must be the DATED one)
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})\.xlsx$", filename, re.IGNORECASE)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Build the local upload plan: list of dicts {path, file_name, department, type, date}
# ---------------------------------------------------------------------------
def discover_local_files():
    items = []

    for folder, dept, rtype in CRM_FOLDERS:
        if not os.path.isdir(folder):
            continue
        for fn in os.listdir(folder):
            if not fn.lower().endswith(".xlsx"):
                continue
            d = parse_crm_date(fn)
            if d is None:
                continue  # skip non-dated files like CRM_PROCESSED_*.xlsx
            items.append({"path": os.path.join(folder, fn), "file_name": fn,
                          "department": dept, "type": rtype, "date": d})

    for folder, dept, rtype in CALL_CENTER_FOLDERS:
        if not os.path.isdir(folder):
            continue
        for sub in os.listdir(folder):
            subpath = os.path.join(folder, sub)
            if not os.path.isdir(subpath):
                continue
            d = parse_callcenter_folder(sub)
            if d is None:
                continue  # skip ranges like 2026-03-01_to_2026-03-28
            for fn in os.listdir(subpath):
                fl = fn.lower()
                # The main call-center report was renamed over time:
                #   old: FINAL_CDR_CALL_REPORT_<DEPT>_<DATE>.xlsx
                #   new: CALL_REPORT_<DEPT>_<DATE>.xlsx
                # Match either, but NOT the helper files (All_Call_CDR_*, AGENT_PERFORMANCE_*).
                if fl.endswith(".xlsx") and (
                    fl.startswith("final_cdr_call_report") or fl.startswith("call_report")
                ):
                    items.append({"path": os.path.join(subpath, fn), "file_name": fn,
                                  "department": dept, "type": rtype, "date": d})

    if os.path.isdir(MTD_FOLDER):
        for fn in os.listdir(MTD_FOLDER):
            if not fn.lower().endswith(".xlsx"):
                continue
            d = parse_mtd_date(fn)
            if d is None:
                continue
            up = fn.upper()
            dept = "CS" if up.startswith("CS") else "LBF" if up.startswith("LBF") else \
                   "SME" if up.startswith("SME") else None
            if dept is None:
                continue
            items.append({"path": os.path.join(MTD_FOLDER, fn), "file_name": fn,
                          "department": dept, "type": "MTD", "date": d})

    if os.path.isdir(MANAGEMENT_REPORT_DIR):
        for fn in os.listdir(MANAGEMENT_REPORT_DIR):
            if not fn.lower().endswith(".xlsx"):
                continue
            d = parse_management_date(fn)
            if d is None:
                continue  # only the dated "Management Report2026-06-15.xlsx"
            items.append({"path": os.path.join(MANAGEMENT_REPORT_DIR, fn), "file_name": fn,
                          "department": "ALL", "type": "MANAGEMENT", "date": d})

    return items


# ---------------------------------------------------------------------------
# SSH transport + server-side curl client (mimics a logged-in website user)
# ---------------------------------------------------------------------------
import json
import shlex


def ssh_connect(host, port, user, password):
    try:
        import paramiko
    except ImportError:
        sys.exit("❌ paramiko is required:  pip install paramiko")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=25)
    return client


def ssh_exec(client, cmd, stdin_bytes=None, timeout=CURL_TIMEOUT):
    """Run a command on the server; return (stdout, stderr, exit_status)."""
    chan_in, chan_out, chan_err = client.exec_command(cmd, timeout=timeout)
    if stdin_bytes is not None:
        chan_in.write(stdin_bytes)
        chan_in.flush()
        chan_in.channel.shutdown_write()
    out = chan_out.read().decode("utf-8", "replace")
    err = chan_err.read().decode("utf-8", "replace")
    status = chan_out.channel.recv_exit_status()
    return out.strip(), err.strip(), status


def api_login(client, base_url, email, password):
    """Log in via curl on the server; return the JWT (login is rate-limited ~5/min).

    The credentials are streamed over stdin (curl -d @-) so they never appear in
    the server's process list.
    """
    cmd = (f"curl -sk -m 30 -X POST {shlex.quote(base_url + '/api/auth/login')} "
           f"-H 'Content-Type: application/json' --data-binary @-")
    body = json.dumps({"email": email, "password": password}).encode()
    out, err, _ = ssh_exec(client, cmd, stdin_bytes=body, timeout=40)
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        sys.exit(f"❌ Login did not return JSON. Response: {out[:300] or err[:300]}")
    token = (data.get("data") or {}).get("token")
    if not token:
        sys.exit(f"❌ Login failed: {str(data)[:300]}")
    user = (data.get("data") or {}).get("user") or {}
    who = user.get("email") or user.get("username") or email
    print(f"🔑 Logged in as {who}")
    return token


def _report_field(rep, *names):
    for n in names:
        if n in rep and rep[n] not in (None, ""):
            return rep[n]
    return None


def fetch_existing_keys(client, base_url, token):
    """Page through /api/reports (via server curl) → set of department|type|YYYY-MM-DD."""
    keys = set()
    limit, offset, total = 500, 0, None
    auth = f"Authorization: Bearer {token}"
    while True:
        url = f"{base_url}/api/reports?limit={limit}&offset={offset}"
        cmd = f"curl -sk -m 60 -H {shlex.quote(auth)} {shlex.quote(url)}"
        out, err, _ = ssh_exec(client, cmd, timeout=80)
        try:
            payload = json.loads(out)
        except json.JSONDecodeError:
            sys.exit(f"❌ Could not list existing reports. Response: {out[:300] or err[:300]}")
        rows = payload.get("data") or []
        if total is None:
            total = (payload.get("meta") or {}).get("total", len(rows))
        for rep in rows:
            dept = _report_field(rep, "department", "Department")
            rtype = _report_field(rep, "type", "Type")
            dval = _report_field(rep, "date", "Date")
            if not (dept and rtype and dval):
                continue
            day = str(dval)[:10]            # "2026-06-01T00:00:00Z" -> "2026-06-01"
            keys.add(f"{dept}|{rtype}|{day}")
        offset += len(rows)
        if not rows or (total is not None and offset >= total):
            break
        time.sleep(0.2)
    return keys, total


def upload_one(client, sftp, base_url, token, item):
    """SFTP the file to the server, then POST it to /api/reports via curl (multipart)."""
    auth = f"Authorization: Bearer {token}"
    url = f"{base_url}/api/reports"
    # Safe ASCII temp name (no spaces); real name is preserved as the multipart filename.
    remote_tmp = f"{REMOTE_TMP_DIR}/pclup_{int(time.time()*1000)}_{os.getpid()}.xlsx"
    # curl -F file=@TMP;filename=REALNAME;type=...  → keeps the original filename
    # which several dashboards match on (e.g. FINAL_CDR_CALL_REPORT, Management Report…).
    xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    file_field = f"file=@{remote_tmp};filename={item['file_name']};type={xlsx_mime}"
    form = [
        "-F", file_field,
        "-F", f"title={os.path.splitext(item['file_name'])[0]}",
        "-F", f"department={item['department']}",
        "-F", f"type={item['type']}",
        "-F", f"date={item['date'].isoformat()}",   # YYYY-MM-DD (backend accepts this)
    ]
    cmd = ("curl -sk -m %d -o /dev/null -w '%%{http_code}' -X POST %s -H %s %s"
           % (CURL_TIMEOUT, shlex.quote(url), shlex.quote(auth),
              " ".join(shlex.quote(p) for p in form)))

    last = ""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            sftp.put(item["path"], remote_tmp)
            out, err, _ = ssh_exec(client, cmd, timeout=CURL_TIMEOUT + 30)
            code = out.strip()[-3:]
            if code in ("200", "201"):
                return True, "ok"
            last = f"HTTP {out.strip() or '???'} {err[:160]}".strip()
            if code in ("429", "502", "503", "504") and attempt < MAX_RETRIES:
                time.sleep(2.0 * attempt)
                continue
            return False, last
        except Exception as e:
            last = f"transfer/exec error: {e}"
            if attempt < MAX_RETRIES:
                time.sleep(1.5 * attempt)
                continue
            return False, last
        finally:
            try:
                sftp.remove(remote_tmp)
            except Exception:
                pass
    return False, last or "exhausted retries"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def summarize(label, lst):
    print(f"\n{label}: {len(lst)}")
    by = {}
    for it in lst:
        by.setdefault((it["department"], it["type"]), []).append(it["date"])
    for (dept, t), dates in sorted(by.items()):
        ds = ", ".join(sorted(d.isoformat() for d in dates))
        print(f"  {dept:4} {t:12} ({len(dates)}): {ds}")


def main():
    ap = argparse.ArgumentParser(description="Bulk-upload PCL reports to the live system (dry-run by default).")
    ap.add_argument("--commit", action="store_true", help="actually upload the missing files via the API")
    args = ap.parse_args()

    creds = load_server_creds(ENV_PATH)
    base = creds["internal_url"]

    print(f"🔌 SSH {creds['user']}@{creds['host']}:{creds['port']}  →  app at {base}")
    client = ssh_connect(creds["host"], creds["port"], creds["user"], creds["password"])
    try:
        token = api_login(client, base, creds["api_user"], creds["api_password"])

        print("📚 Fetching existing reports from the live DB …")
        existing_keys, total = fetch_existing_keys(client, base, token)
        print(f"   {len(existing_keys)} distinct (department|type|date) keys "
              f"across {total} report row(s).")

        items = discover_local_files()
        to_upload, to_skip = [], []
        for it in items:
            key = f"{it['department']}|{it['type']}|{it['date'].isoformat()}"
            (to_skip if key in existing_keys else to_upload).append(it)
        # Deterministic order: by date then department/type
        to_upload.sort(key=lambda it: (it["date"], it["department"], it["type"], it["file_name"]))

        print("\n" + "=" * 78)
        print(f"LOCAL FILES FOUND: {len(items)}")
        print("=" * 78)
        summarize("WOULD UPLOAD (new — not in DB)", to_upload)
        summarize("WOULD SKIP (date already in DB)", to_skip)

        if not args.commit:
            print("\n" + "-" * 78)
            print("DRY-RUN only. Nothing was uploaded.")
            print("Re-run with  --commit  to upload the files listed under 'WOULD UPLOAD'.")
            print("-" * 78)
            return

        if not to_upload:
            print("\n✅ Nothing to upload — the live DB is already up to date.")
            return

        print("\n" + "!" * 78)
        print(f"COMMIT: uploading {len(to_upload)} file(s) via {base}")
        print("!" * 78)

        sftp = client.open_sftp()
        ok = 0
        failed = []
        try:
            for i, it in enumerate(to_upload, 1):
                label = f"{it['department']}/{it['type']} {it['date'].isoformat()}  {it['file_name']}"
                print(f"[{i}/{len(to_upload)}] ⬆ {label} … ", end="", flush=True)
                success, msg = upload_one(client, sftp, base, token, it)
                if success:
                    ok += 1
                    print("✓")
                else:
                    failed.append((label, msg))
                    print(f"✗ {msg}")
                time.sleep(UPLOAD_DELAY_SEC)
        finally:
            sftp.close()

        print("\n" + "=" * 78)
        print(f"DONE — {ok} uploaded, {len(failed)} failed, of {len(to_upload)} attempted.")
        print("=" * 78)
        if failed:
            print("Failures:")
            for label, msg in failed:
                print(f"  ✗ {label}\n      {msg}")
            sys.exit(1)
        print("✅ All missing reports uploaded. The server parses each file into "
              "report_data automatically, so dashboards will update shortly.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
