"""PostgreSQL storage for the AI Sales Manager (project DB: pcl_analysis).

Tables are prefixed aism_. The listing LINK (source_url) is the dedup key:
aism_raw_listings.source_url is UNIQUE, so `ON CONFLICT DO NOTHING` drops links
we already have. Links are saved IMMEDIATELY on discovery (raw_data NULL); the
detail text is filled in afterwards, so an interrupted crawl is resumable.

Run migrations with migrate() (also POST /migrate).
"""
from __future__ import annotations

import re
import threading
from pathlib import Path

import psycopg2
import psycopg2.extras

from .config import settings

_APP_DIR = Path(__file__).resolve().parent
MIGRATIONS_DIR = _APP_DIR / "migrations"
_lock = threading.Lock()

# Public lead shape (order used by the sheet + dashboard).
LEAD_FIELDS = [
    "seller_name", "phone", "car_make", "car_model", "car_year", "mileage",
    "body_type", "fuel_type", "condition", "location", "price_text",
    "est_value_tzs", "est_loan_tzs", "score", "reason", "source_url",
    "date_obtained", "flag",
]
_CLEAN_COLS = ["source_url", "seller_name", "phone", "phone_norm", "car_make",
               "car_model", "car_year", "mileage", "body_type", "fuel_type",
               "condition", "location", "price_text", "est_value_tzs",
               "est_loan_tzs", "score", "reason", "date_obtained", "flag"]


def normalize_phone(raw: str) -> str:
    """Last 9 digits (TZ subscriber part) so +255 / 0 / spacing variants match."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-9:] if len(digits) >= 9 else digits


def connect():
    conn = psycopg2.connect(settings.db_dsn(), connect_timeout=10)
    conn.autocommit = True
    return conn


# ── migrations ───────────────────────────────────────────────────────────────
def migrate() -> list[str]:
    """Apply any *.sql not yet recorded. Returns names applied this call."""
    with _lock:
        conn = connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "CREATE TABLE IF NOT EXISTS aism_schema_migrations "
                    "(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())"
                )
                cur.execute("SELECT name FROM aism_schema_migrations")
                applied = {r[0] for r in cur.fetchall()}
                done = []
                for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
                    if f.name in applied:
                        continue
                    cur.execute(f.read_text(encoding="utf-8"))
                    cur.execute("INSERT INTO aism_schema_migrations(name) VALUES(%s)", (f.name,))
                    done.append(f.name)
                return done
        finally:
            conn.close()


def migrations_status() -> dict:
    conn = connect()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT name FROM aism_schema_migrations ORDER BY name")
                applied = [r[0] for r in cur.fetchall()]
            except psycopg2.Error:
                applied = []
    finally:
        conn.close()
    available = [f.name for f in sorted(MIGRATIONS_DIR.glob("*.sql"))]
    return {"applied": applied, "available": available,
            "pending": [n for n in available if n not in applied]}


# ── raw_listings ─────────────────────────────────────────────────────────────
def known_urls() -> set[str]:
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT source_url FROM aism_raw_listings")
            return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


def insert_links(urls: list[str], date_obtained: str) -> int:
    """Save links immediately (raw_data NULL). Returns count of NEW links."""
    if not urls:
        return 0
    with _lock:
        conn = connect()
        try:
            with conn.cursor() as cur:
                rows = psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO aism_raw_listings(source_url, date_obtained) VALUES %s "
                    "ON CONFLICT (source_url) DO NOTHING RETURNING source_url",
                    [(u, date_obtained) for u in urls], fetch=True,
                )
                return len(rows)
        finally:
            conn.close()


def pending_detail(limit: int = 0) -> list[str]:
    """Links saved but not yet detail-scraped (raw_data NULL/empty)."""
    sql = ("SELECT source_url FROM aism_raw_listings "
           "WHERE raw_data IS NULL OR raw_data = '' ORDER BY id")
    if limit and limit > 0:
        sql += f" LIMIT {int(limit)}"
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def update_details(pairs: list[tuple[str, str]]) -> int:
    """pairs = [(source_url, raw_data)] — fill in scraped detail text."""
    if not pairs:
        return 0
    with _lock:
        conn = connect()
        try:
            with conn.cursor() as cur:
                cur.executemany(
                    "UPDATE aism_raw_listings SET raw_data = %s WHERE source_url = %s",
                    [(raw, url) for url, raw in pairs],
                )
                return cur.rowcount
        finally:
            conn.close()


def raw_uncleaned() -> list[dict]:
    """Detail-scraped raw rows with no clean_leads row yet (the unique data)."""
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.source_url, r.raw_data, r.date_obtained "
                "FROM aism_raw_listings r "
                "LEFT JOIN aism_clean_leads c ON c.source_url = r.source_url "
                "WHERE c.id IS NULL AND r.raw_data IS NOT NULL AND r.raw_data <> '' "
                "ORDER BY r.id"
            )
            return [{"source_url": a, "raw_data": b, "date_obtained": c}
                    for a, b, c in cur.fetchall()]
    finally:
        conn.close()


def count_raw() -> int:
    return _scalar("SELECT COUNT(*) FROM aism_raw_listings")


def count_detailed() -> int:
    return _scalar("SELECT COUNT(*) FROM aism_raw_listings WHERE raw_data IS NOT NULL AND raw_data <> ''")


# ── clean_leads ──────────────────────────────────────────────────────────────
def seen_phone_norms() -> set[str]:
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT phone_norm FROM aism_clean_leads WHERE phone_norm <> ''")
            return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


def insert_clean_many(dicts: list[dict]) -> int:
    if not dicts:
        return 0
    tmpl = "(" + ",".join(["%s"] * len(_CLEAN_COLS)) + ")"
    values = [[d.get(c, "") for c in _CLEAN_COLS] for d in dicts]
    with _lock:
        conn = connect()
        try:
            with conn.cursor() as cur:
                rows = psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO aism_clean_leads({','.join(_CLEAN_COLS)}) VALUES %s "
                    "ON CONFLICT (source_url) DO NOTHING RETURNING id",
                    values, template=tmpl, fetch=True,
                )
                return len(rows)
        finally:
            conn.close()


def count_clean() -> int:
    return _scalar("SELECT COUNT(*) FROM aism_clean_leads")


def count_unique() -> int:
    return _scalar("SELECT COUNT(DISTINCT phone_norm) FROM aism_clean_leads WHERE phone_norm <> ''")


def _scalar(sql: str) -> int:
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            return cur.fetchone()[0]
    finally:
        conn.close()


def _fetch_leads(sql: str) -> list[dict]:
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            out = []
            for r in cur.fetchall():
                out.append({f: (r.get(f) if r.get(f) is not None else "") for f in LEAD_FIELDS})
            return out
    finally:
        conn.close()


def all_clean(limit: int = 0, newest_first: bool = True) -> list[dict]:
    order = "DESC" if newest_first else "ASC"
    sql = f"SELECT * FROM aism_clean_leads ORDER BY id {order}"
    if limit and limit > 0:
        sql += f" LIMIT {int(limit)}"
    return _fetch_leads(sql)


def unique_clean(limit: int = 0, newest_first: bool = True) -> list[dict]:
    """One lead per unique phone (earliest occurrence), phone required."""
    order = "DESC" if newest_first else "ASC"
    sql = (
        "SELECT * FROM aism_clean_leads WHERE id IN "
        "(SELECT MIN(id) FROM aism_clean_leads WHERE phone_norm <> '' GROUP BY phone_norm) "
        f"ORDER BY id {order}"
    )
    if limit and limit > 0:
        sql += f" LIMIT {int(limit)}"
    return _fetch_leads(sql)


def stats() -> dict:
    return {"links": count_raw(), "detailed": count_detailed(),
            "clean": count_clean(), "unique": count_unique()}
