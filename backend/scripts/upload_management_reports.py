#!/usr/bin/env python3
"""
Upload management reports from Management_data_backups to the API - mimics browser upload flow.
Uses the same endpoint as AddReportModal: POST /api/reports with file + metadata.

Requirements: requests (pip install requests)
Prerequisites: API server running, admin@pcl.com / admin123 seeded.
"""

import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install: pip install requests")
    sys.exit(1)

# Paths
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "Management_data_backups"
ENV_PATH = BACKEND_DIR / ".env"
METADATA_FILE = DATA_DIR / "readable_metadata.json"

# Credentials - override via ADMIN_EMAIL, ADMIN_PASSWORD env vars (seed-admin: admin@pcl.com / admin123)


def load_env():
    """Load .env into os.environ."""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def get_api_url():
    """Get API base URL from env or default."""
    return os.environ.get("VITE_API_URL", os.environ.get("API_URL", "http://localhost:8080")).rstrip("/")


def check_api(api_url):
    """Verify API is reachable."""
    try:
        r = requests.get(f"{api_url}/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def login(api_url, email, password):
    """Login and return JWT token."""
    r = requests.post(
        f"{api_url}/api/auth/login",
        json={"email": email, "password": password},
        headers={"Content-Type": "application/json"},
    )
    if r.status_code != 200:
        raise SystemExit(f"Login failed ({r.status_code}): {r.text}")
    data = r.json()
    token = data.get("data", {}).get("token") or data.get("token")
    if not data.get("success") or not token:
        raise SystemExit(f"Login failed: {data}")
    return token


def upload_report(api_url, token, file_path, metadata):
    """
    Upload one report via POST /api/reports (same as AddReportModal).
    metadata: dict with title, file_name, file_path, department, type, date
    """
    path_for_api = metadata["file_path"].replace("\\", "/")
    date_val = metadata["date"]
    if not date_val:
        raise ValueError(f"Missing date for {metadata['file_name']}")

    with open(file_path, "rb") as f:
        files = {"file": (metadata["file_name"], f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {
            "path": path_for_api,
            "title": metadata["title"],
            "department": metadata["department"],
            "type": metadata["type"],
            "date": date_val,
        }
        headers = {"Authorization": f"Bearer {token}"}
        r = requests.post(
            f"{api_url}/api/reports",
            files=files,
            data=data,
            headers=headers,
        )

    if r.status_code not in (200, 201):
        return False, f"{r.status_code}: {r.text}"
    resp = r.json()
    if not resp.get("success"):
        return False, resp.get("error", "Unknown error")
    return True, resp.get("data")


def main():
    load_env()
    api_url = get_api_url()

    if not METADATA_FILE.exists():
        raise SystemExit(f"Metadata not found: {METADATA_FILE}")

    meta = json.loads(METADATA_FILE.read_text())
    reports = meta.get("reports", [])
    if not reports:
        raise SystemExit("No reports in metadata.")

    if not check_api(api_url):
        raise SystemExit(f"API not reachable at {api_url}. Ensure the backend server is running.")

    email = os.environ.get("ADMIN_EMAIL", "admin@pcl.com")
    password = os.environ.get("ADMIN_PASSWORD", "Admin@123")
    print(f"Logging in as {email}...")
    token = login(api_url, email, password)
    print("Login OK.")

    ok = 0
    fail = []
    total = len(reports)

    for i, r in enumerate(reports, 1):
        fn = r.get("file_name")
        fp = DATA_DIR / fn
        if not fp.exists():
            print(f"  [{i}/{total}] SKIP (file not found): {fn}")
            fail.append((fn, "File not found"))
            continue

        success, result = upload_report(api_url, token, fp, r)
        if success:
            ok += 1
            rid = result.get("id", "?") if isinstance(result, dict) else "?"
            print(f"  [{i}/{total}] OK: {fn} (id: {rid})")
        else:
            fail.append((fn, result))
            print(f"  [{i}/{total}] FAIL: {fn} -> {result}")

        # Small delay to avoid hammering the server (parser runs async)
        if i < total:
            time.sleep(0.5)

    print()
    print(f"Done: {ok}/{total} uploaded.")
    if fail:
        print(f"Failed: {len(fail)}")
        for fn, err in fail:
            print(f"  - {fn}: {err}")


if __name__ == "__main__":
    main()
