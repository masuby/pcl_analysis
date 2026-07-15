#!/usr/bin/env python3
"""
equalize_reports.py
============================================================================
Pull every report that exists in the PRODUCTION pcl_analysis database but is
missing from the LOCAL database, so the two are "equalised".

The production app is only reachable over SSH (its DB/API are not public), so
this connects over SSH and reads production via `docker exec ... psql`, then
writes into the local Postgres directly (psycopg2) and drops the report files
into the local uploads directory.

For each missing report it copies:
    • the report row              (reports)           — keeping production's UUID
    • the parsed analytics rows   (report_data)       — exact copy
    • the Excel file              (uploads/<file_path>)

A report counts as "already local" when a row with the same
(department, type, date, file_name) exists locally — so re-running only ever
pulls the delta.

Modes
-----
    python equalize_reports.py            # DRY-RUN (read-only, default)
    python equalize_reports.py --commit   # actually pull the missing reports
    python equalize_reports.py --commit --json   # + machine-readable summary line

Config comes from backend/.env (next to this script's parent):
    DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME   (local target DB)
    EQUALIZE_SSH_HOST / _PORT / _USER / _PASSWORD         (production SSH)
    EQUALIZE_PG_CONTAINER / EQUALIZE_API_CONTAINER        (optional; auto-detected)

Requires:  pip install paramiko psycopg2
============================================================================
"""

import io
import os
import sys
import csv
import json
import time
import shlex
import argparse

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")
# Honour UPLOAD_PATH (set to /var/reports inside the dockerised backend, which
# is bind-mounted to the host's backend/uploads); fall back to backend/uploads
# when the script is run directly on the host.
UPLOADS_DIR = os.environ.get("UPLOAD_PATH") or os.path.join(BACKEND_DIR, "uploads")

LOCAL_ADMIN_FALLBACK = None  # resolved at runtime: first admin user in local DB

REPORT_COLS = ["id", "title", "file_name", "file_path", "file_size",
               "department", "type", "date", "views", "downloads",
               "is_active", "created_at", "updated_at"]
REPORT_DATA_COLS = ["report_id", "branch", "metric_name", "metric_value",
                    "report_date", "created_at", "sheet_name", "row_type",
                    "parent_team_leader"]


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------
def load_env(path):
    env = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
                    v = v[1:-1]
                env[k.strip()] = v
    # allow process env to override
    env.update({k: os.environ[k] for k in os.environ if k in env or k.startswith(("DB_", "EQUALIZE_"))})
    return env


def cfg(env):
    ssh = {
        "host": env.get("EQUALIZE_SSH_HOST", "154.72.68.246"),
        "port": int(env.get("EQUALIZE_SSH_PORT", "2222")),
        "user": env.get("EQUALIZE_SSH_USER", "pcltz_admin"),
        "password": env.get("EQUALIZE_SSH_PASSWORD", ""),
    }
    db = {
        "host": env.get("DB_HOST", "localhost"),
        "port": int(env.get("DB_PORT", "5432")),
        "user": env.get("DB_USER", "pcl_user"),
        "password": env.get("DB_PASSWORD", ""),
        "dbname": env.get("DB_NAME", "pcl_analysis"),
    }
    if not ssh["password"]:
        sys.exit("❌ EQUALIZE_SSH_PASSWORD is not set in backend/.env (needed to reach production).")
    if not db["password"]:
        sys.exit("❌ DB_PASSWORD is not set in backend/.env (local database).")
    return ssh, db, env


# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------
def ssh_connect(ssh):
    try:
        import paramiko
    except ImportError:
        sys.exit("❌ paramiko is required:  pip install paramiko")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(ssh["host"], port=ssh["port"], username=ssh["user"],
              password=ssh["password"], timeout=25)
    # Keep the channel busy so a long-running COPY doesn't trip the rekey timeout.
    tr = c.get_transport()
    if tr is not None:
        tr.set_keepalive(15)
    return c


def ssh_run(client, cmd, timeout=120):
    _in, out, err = client.exec_command(cmd, timeout=timeout)
    data = out.read()
    errtxt = err.read().decode("utf-8", "replace")
    status = out.channel.recv_exit_status()
    return data, errtxt, status


def detect_containers(client, env):
    pg = env.get("EQUALIZE_PG_CONTAINER", "").strip()
    api = env.get("EQUALIZE_API_CONTAINER", "").strip()
    if not pg:
        out, _, _ = ssh_run(client, "docker ps --format '{{.Names}}' | grep -i postgres | head -1")
        pg = out.decode().strip()
    if not api:
        out, _, _ = ssh_run(client, "docker ps --format '{{.Names}}' | grep -iE 'pcl-api|_api' | head -1")
        api = out.decode().strip()
    if not pg:
        sys.exit("❌ Could not find the production postgres container.")
    if not api:
        sys.exit("❌ Could not find the production api container.")
    return pg, api


def psql_copy_out(client, pg, select_sql, timeout=600):
    """Run COPY (select) TO STDOUT CSV inside the prod pg container; return bytes."""
    inner = f"COPY ({select_sql}) TO STDOUT WITH (FORMAT csv)"
    cmd = "docker exec %s psql -U pcl_user -d pcl_analysis -v ON_ERROR_STOP=1 -c %s" % (
        pg, shlex.quote(inner))
    data, err, status = ssh_run(client, cmd, timeout=timeout)
    if status != 0:
        raise RuntimeError(f"prod COPY failed: {err.strip()[:300]}")
    return data


# ---------------------------------------------------------------------------
# Local DB
# ---------------------------------------------------------------------------
def local_connect(db):
    try:
        import psycopg2
    except ImportError:
        sys.exit("❌ psycopg2 is required:  pip install psycopg2-binary")
    return psycopg2.connect(connect_timeout=10, **db)


def local_report_index(conn):
    """Return key -> {'id', 'has_data', 'file_path'} for every local report.
    For duplicate keys, the entry that already has report_data wins."""
    cur = conn.cursor()
    cur.execute("SELECT report_id FROM report_data GROUP BY report_id")
    with_data = {str(r[0]) for r in cur.fetchall()}
    cur.execute("SELECT id, department, type, date, file_name, file_path FROM reports")
    index = {}
    for rid, dept, rtype, dval, fname, fpath in cur.fetchall():
        key = report_key(dept, rtype, dval.isoformat() if dval else "", fname)
        has = str(rid) in with_data
        cur_entry = index.get(key)
        if cur_entry is None or (has and not cur_entry["has_data"]):
            index[key] = {"id": str(rid), "has_data": has, "file_path": fpath}
    cur.close()
    return index


def local_admin_id(conn):
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1")
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def report_key(dept, rtype, date_str, file_name):
    return "|".join([
        str(dept or "").strip(),
        str(rtype or "").strip(),
        str(date_str or "")[:10],
        str(file_name or "").strip().lower(),
    ])


# ---------------------------------------------------------------------------
# Main equalize
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Equalise local reports DB with production (dry-run by default).")
    ap.add_argument("--commit", action="store_true", help="actually pull the missing reports")
    ap.add_argument("--json", action="store_true", help="print a JSON summary line (for the Equalize button)")
    args = ap.parse_args()

    env = load_env(ENV_PATH)
    ssh, db, env = cfg(env)

    summary = {"prod_total": 0, "local_total": 0,
               "new_reports": 0, "repaired_reports": 0, "skipped": 0,
               "report_data_rows": 0, "files_pulled": 0,
               "committed": bool(args.commit)}

    log(f"🔌 SSH {ssh['user']}@{ssh['host']}:{ssh['port']}  →  production")
    client = ssh_connect(ssh)
    conn = None
    try:
        pg, api = detect_containers(client, env)
        log(f"   postgres={pg}  api={api}")

        # 1. Read production reports (CSV via docker exec psql COPY).
        sel = ("SELECT " + ",".join(REPORT_COLS) +
               " FROM reports WHERE file_path <> '' ORDER BY created_at")
        prod_bytes = psql_copy_out(client, pg, sel)
        prod_reports = [r for r in csv.reader(io.StringIO(prod_bytes.decode("utf-8", "replace")))
                        if len(r) >= len(REPORT_COLS)]
        summary["prod_total"] = len(prod_reports)

        # Which production reports actually have parsed analytics rows — used so
        # reports that are empty on BOTH sides count as "complete", not "repair".
        pwd_bytes = psql_copy_out(client, pg, "SELECT report_id FROM report_data GROUP BY report_id")
        prod_with_data = {r[0] for r in csv.reader(io.StringIO(pwd_bytes.decode("utf-8", "replace"))) if r}

        # 2. Index local reports by logical key.
        conn = local_connect(db)
        local_index = local_report_index(conn)
        summary["local_total"] = len(local_index)

        # 3. Classify every production report: new / repair / skip.
        col = {c: i for i, c in enumerate(REPORT_COLS)}
        new_rows = []                 # prod rows to INSERT (keep prod UUID)
        prod_to_target = {}           # prod_id -> local target id (needs report_data)
        target_files = {}             # target file_path -> needs local file
        repaired = 0
        for row in prod_reports:
            row = [_csv_val(v) for v in row]
            key = report_key(row[col["department"]], row[col["type"]],
                             row[col["date"]], row[col["file_name"]])
            prod_id = row[col["id"]]
            prod_has_data = prod_id in prod_with_data
            match = local_index.get(key)
            if match is None:
                # Brand-new report — always insert the row + pull the file;
                # copy data only when production actually has it.
                new_rows.append(row)
                target_files[row[col["file_path"]]] = True
                if prod_has_data:
                    prod_to_target[prod_id] = prod_id       # inserted with prod UUID
            elif match["has_data"] or not prod_has_data:
                # Complete locally, OR empty on BOTH sides → nothing to do.
                summary["skipped"] += 1
            else:
                prod_to_target[prod_id] = match["id"]       # repair existing local row
                target_files[match["file_path"]] = True
                repaired += 1
        summary["new_reports"] = len(new_rows)
        summary["repaired_reports"] = repaired

        log(f"📊 production: {summary['prod_total']} · local: {summary['local_total']} keys")
        log(f"   new reports : {summary['new_reports']}")
        log(f"   repair (no data) : {summary['repaired_reports']}")
        log(f"   already complete : {summary['skipped']}")

        if not args.commit:
            log("\nDRY-RUN only — nothing written. Re-run with --commit to equalise.")
            _emit_json(args, summary)
            return

        admin_id = local_admin_id(conn) or LOCAL_ADMIN_FALLBACK
        cur = conn.cursor()

        # 4. Insert the brand-new report rows (production UUID, owned by local admin).
        insert_cols = ["id", "title", "file_name", "file_path", "file_size",
                       "department", "type", "date", "views", "downloads",
                       "is_active", "uploaded_by", "created_at", "updated_at"]
        sql = (f"INSERT INTO reports ({','.join(insert_cols)}) "
               f"VALUES ({','.join(['%s']*len(insert_cols))}) ON CONFLICT (id) DO NOTHING")
        for row in new_rows:
            d = dict(zip(REPORT_COLS, row))
            cur.execute(sql, (
                d["id"], d["title"], d["file_name"], d["file_path"],
                _int(d["file_size"]), d["department"], d["type"], _date(d["date"]),
                _int(d["views"]), _int(d["downloads"]), _bool(d["is_active"]),
                admin_id, _ts(d["created_at"]), _ts(d["updated_at"]),
            ))

        # 5. Copy report_data from production, remapping report_id -> local target.
        summary["report_data_rows"] = copy_report_data(client, pg, cur, prod_to_target)

        conn.commit()
        log(f"📝 inserted {summary['new_reports']} new + repaired {summary['repaired_reports']} report(s); "
            f"{summary['report_data_rows']} report_data row(s).")
    except Exception as e:
        if conn is not None:
            conn.rollback()
        log(f"\n❌ Equalize DB step failed (rolled back): {e}")
        summary["error"] = str(e)
        _emit_json(args, summary)
        client.close()
        if conn is not None:
            conn.close()
        sys.exit(1)
    finally:
        client.close()   # the COPY connection is done; files use a fresh one

    # 6. File phase — pull any report whose local file is missing. Runs on a
    #    FRESH ssh connection (the COPY one may have been rekey-dropped) and
    #    never fails the run: the DB is already equalised at this point.
    try:
        cur = conn.cursor()
        cur.execute("SELECT file_path FROM reports WHERE file_path <> ''")
        want = []
        for (fp,) in cur.fetchall():
            if fp and not os.path.exists(os.path.join(UPLOADS_DIR, fp.replace('/', os.sep))):
                want.append(fp)
        cur.close()
        if want:
            fclient = ssh_connect(ssh)
            try:
                summary["files_pulled"] = pull_files(fclient, api, want)
            finally:
                fclient.close()
        log(f"📁 pulled {summary['files_pulled']} file(s) into {UPLOADS_DIR}  "
            f"({len(want)} missing locally)")
    except Exception as e:
        log(f"⚠ file pull incomplete: {e}  (DB is equalised; re-run to finish files)")
        summary["file_error"] = str(e)
    finally:
        if conn is not None:
            conn.close()

    log("\n✅ Equalised.")
    _emit_json(args, summary)


# ── value coercion (CSV → python/pg) ────────────────────────────────────────
def _csv_val(v):
    return v if v != "" else None


def _int(v):
    try:
        return int(float(v)) if v not in (None, "") else 0
    except (ValueError, TypeError):
        return 0


def _bool(v):
    return str(v).lower() in ("t", "true", "1", "yes")


def _date(v):
    return v or None


def _ts(v):
    return v or None


def pull_files(client, api, file_paths):
    """Copy each file out of /var/reports in the api container (binary-safe
    `cat` over SSH) into the local uploads dir. Returns the count written."""
    if not file_paths:
        return 0
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    count = 0
    for path in file_paths:
        remote = "/var/reports/" + path
        cmd = "docker exec %s cat %s" % (api, shlex.quote(remote))
        _in, out, err = client.exec_command(cmd, timeout=300)
        data = out.read()
        status = out.channel.recv_exit_status()
        if status != 0 or not data:
            continue
        dest = os.path.join(UPLOADS_DIR, path.replace("/", os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
        count += 1
    return count


def copy_report_data(client, pg, cur, prod_to_target):
    """Copy report_data from prod for every prod report id, remapping report_id
    to the local target id (handles both fresh inserts and repairs). Runs in the
    caller's transaction (cur). Returns the number of rows inserted."""
    if not prod_to_target:
        return 0
    prod_ids = list(prod_to_target.keys())
    target_ids = list(set(prod_to_target.values()))

    # Stream production report_data (for all prod ids) into a staging temp table.
    id_list = ",".join("'" + str(rid).replace("'", "") + "'" for rid in prod_ids)
    sel = (f"SELECT {','.join(REPORT_DATA_COLS)} FROM report_data "
           f"WHERE report_id IN ({id_list})")
    data = psql_copy_out(client, pg, sel, timeout=2400)

    cur.execute("DROP TABLE IF EXISTS _eq_stage")
    cur.execute("""
        CREATE TEMP TABLE _eq_stage (
            report_id uuid, branch varchar, metric_name varchar,
            metric_value double precision, report_date date,
            created_at timestamptz, sheet_name varchar, row_type varchar,
            parent_team_leader varchar
        ) ON COMMIT DROP
    """)
    if data:
        cur.copy_expert(
            f"COPY _eq_stage ({','.join(REPORT_DATA_COLS)}) FROM STDIN WITH (FORMAT csv)",
            io.StringIO(data.decode("utf-8", "replace")),
        )

    # Map prod_id -> target_id, then move the rows into report_data remapped.
    cur.execute("DROP TABLE IF EXISTS _eq_map")
    cur.execute("CREATE TEMP TABLE _eq_map (prod_id uuid, target_id uuid) ON COMMIT DROP")
    from psycopg2.extras import execute_values
    execute_values(cur, "INSERT INTO _eq_map (prod_id, target_id) VALUES %s",
                   [(p, t) for p, t in prod_to_target.items()])

    # Clear any partial rows already attached to the target reports, then insert.
    cur.execute("DELETE FROM report_data WHERE report_id = ANY(%s::uuid[])", (target_ids,))
    cur.execute(f"""
        INSERT INTO report_data
            (report_id, branch, metric_name, metric_value, report_date,
             created_at, sheet_name, row_type, parent_team_leader)
        SELECT m.target_id, s.branch, s.metric_name, s.metric_value, s.report_date,
               s.created_at, s.sheet_name, s.row_type, s.parent_team_leader
        FROM _eq_stage s JOIN _eq_map m ON m.prod_id = s.report_id
    """)
    return cur.rowcount


def _emit_json(args, summary):
    if args.json:
        print("EQUALIZE_JSON " + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
