"""Which leads have actually been handed to the call centre.

The Google Sheets are the source of truth, not our own bookkeeping. A lead
counts as distributed because its phone number is sitting in a month's tab —
not because a distribute run once said it added it. That distinction matters:
rows get deleted, tabs get rebuilt by hand, and a lead removed from the sheet is
one nobody is calling, whatever our database once recorded.

So `mark` reads both workbooks back, collects every phone number present, and
sets the status on matching leads. Everything else becomes NEVER DISTRIBUTED,
which is the point of the exercise — it makes the untouched backlog visible
instead of leaving fresh leads and long-sent ones looking identical.

Matching is on the last nine digits (the subscriber part), the same key
`db.normalize_phone` and the deduper already use, so +255 / 0 / spacing
variants line up.
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import db
from .callback_report import PRODUCT_SHEETS, _column_reader, _read_tab
from .tools.sheets import _services

DISTRIBUTED = "DISTRIBUTED"
NEVER = "NEVER DISTRIBUTED"


def phones_in_sheets(month: str = "") -> tuple[dict[str, str], list[dict]]:
    """Every phone currently in the working sheets -> the tab it sits in.

    Returns (phone_norm -> "PRODUCT · tab", per-sheet detail).
    """
    svc, _ = _services()
    found: dict[str, str] = {}
    detail = []

    for product, get_id in PRODUCT_SHEETS.items():
        sheet_id = get_id()
        if not sheet_id:
            detail.append({"product": product, "ok": False,
                           "error": f"AISM_{product}_SHEET_ID is not set"})
            continue
        try:
            meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
        except Exception as exc:  # noqa: BLE001
            detail.append({"product": product, "ok": False, "error": str(exc)})
            continue

        tabs = [s["properties"]["title"] for s in meta["sheets"]]
        wanted = [t for t in tabs if not month or month.strip().lower() in t.lower()]
        for tab in wanted:
            header, rows = _read_tab(svc, sheet_id, tab)
            if not header:
                continue
            get, _idx = _column_reader(header)
            n = 0
            for r in rows:
                norm = db.normalize_phone(get(r, "Phone Number"))
                if len(norm) == 9:
                    found.setdefault(norm, f"{product} · {tab}")
                    n += 1
            detail.append({"product": product, "ok": True, "tab": tab,
                           "rowsWithPhone": n,
                           "sheetTitle": meta["properties"]["title"]})
    return found, detail


def mark(month: str = "", dry_run: bool = False) -> dict:
    """Set DISTRIBUTED on leads whose phone is in a sheet, NEVER DISTRIBUTED on
    the rest. Idempotent — safe to run as often as you like."""
    found, detail = phones_in_sheets(month)
    if not found and not any(d.get("ok") for d in detail):
        return {"ok": False,
                "error": "Neither working sheet could be read, so nothing was changed.",
                "sheets": detail}

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM aism_clean_leads")
        total = cur.fetchone()[0]

        if dry_run:
            cur.execute(
                "SELECT COUNT(*) FROM aism_clean_leads WHERE phone_norm = ANY(%s)",
                (list(found),))
            would = cur.fetchone()[0]
            return {"ok": True, "dryRun": True, "leads": total,
                    "phonesInSheets": len(found), "wouldMarkDistributed": would,
                    "wouldMarkNever": total - would, "sheets": detail}

        # Reset first so a lead deleted from a sheet stops counting as sent.
        cur.execute(
            f"""UPDATE aism_clean_leads
                   SET distribution_status = '{NEVER}',
                       distributed_at = NULL,
                       distributed_to = NULL
                 WHERE distribution_status <> '{NEVER}'""")
        reset = cur.rowcount

        now = datetime.now(timezone.utc)
        marked = 0
        # Grouped by destination so the tab a lead went to is recorded, not just
        # the fact that it went somewhere.
        by_dest: dict[str, list[str]] = {}
        for norm, dest in found.items():
            by_dest.setdefault(dest, []).append(norm)
        for dest, norms in by_dest.items():
            cur.execute(
                f"""UPDATE aism_clean_leads
                       SET distribution_status = '{DISTRIBUTED}',
                           distributed_at = %s,
                           distributed_to = %s
                     WHERE phone_norm = ANY(%s)""",
                (now, dest, norms))
            marked += cur.rowcount

        cur.execute(
            """SELECT distribution_status, COUNT(*), COUNT(DISTINCT phone_norm)
                 FROM aism_clean_leads GROUP BY 1 ORDER BY 1""")
        breakdown = [{"status": s, "leads": n, "people": p} for s, n, p in cur.fetchall()]

        cur.execute(
            """SELECT product, distribution_status, COUNT(*)
                 FROM aism_clean_leads GROUP BY 1,2 ORDER BY 1,2""")
        by_product = [{"product": a, "status": b, "leads": n} for a, b, n in cur.fetchall()]

    return {"ok": True, "leads": total, "phonesInSheets": len(found),
            "markedDistributed": marked, "reset": reset,
            "breakdown": breakdown, "byProduct": by_product, "sheets": detail}
