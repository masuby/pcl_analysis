"""Google Sheets tool — the agent creates its own 'AISM Leads' spreadsheet
(shared with the owner email) and appends discovered leads to it.

Note: a service account has no personal Drive quota, so creating a brand-new
spreadsheet may fail with a quota error. Two fallbacks:
  • set AISM_LEADS_SHEET_ID to a sheet you created and shared with the SA, or
  • create the SA's file inside a Shared Drive.
The created sheet id is cached in ai_sales_manager/.leads_sheet_id for reuse.
"""
from ..config import settings

SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]

HEADERS = [
    "Lead ID", "Found (UTC)", "Product", "Name / Business", "Location",
    "Car Make", "Car Model", "Car Year", "Est. Value (TZS)", "Business Type",
    "Public Contact", "Score", "Est. Loan (TZS)", "Reason", "Source URL", "Status",
]


def service_account_email() -> str | None:
    """The service-account address a user must share their sheet with."""
    if getattr(settings, "sa_email", None):
        return settings.sa_email
    try:
        import json
        with open(settings.google_creds, encoding="utf-8") as fh:
            return json.load(fh).get("client_email")
    except Exception:
        return None


def _creds():
    from google.oauth2.service_account import Credentials
    if not settings.google_creds:
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS not configured / file not found.")
    return Credentials.from_service_account_file(settings.google_creds, scopes=SCOPES)


def _services():
    from googleapiclient.discovery import build
    creds = _creds()
    return build("sheets", "v4", credentials=creds, cache_discovery=False), \
        build("drive", "v3", credentials=creds, cache_discovery=False)


def _cached_sheet_id() -> str | None:
    if settings.leads_sheet_id:
        return settings.leads_sheet_id
    try:
        return settings.sheet_id_cache.read_text().strip() or None
    except Exception:
        return None


def get_or_create_leads_sheet() -> tuple[str, str]:
    """Return (spreadsheet_id, url), creating + sharing + header-seeding once."""
    sheets, drive = _services()
    sid = _cached_sheet_id()
    if sid:
        return sid, f"https://docs.google.com/spreadsheets/d/{sid}/edit"

    try:
        created = sheets.spreadsheets().create(
            body={
                "properties": {"title": "AISM Leads — LBF/SME Prospects"},
                "sheets": [{"properties": {"title": "Leads"}}],
            },
            fields="spreadsheetId",
        ).execute()
    except Exception as exc:  # noqa: BLE001
        sa = service_account_email() or "the service account"
        raise RuntimeError(
            "Could not auto-create the Leads sheet (a service account has no Drive "
            f"quota). Fix: in Google Sheets create an empty sheet, click Share and add "
            f"{sa} as Editor, copy its ID from the URL, then set AISM_LEADS_SHEET_ID to "
            f"that ID in DataDashboard/.env and restart the service. (Underlying error: {exc})"
        ) from exc
    sid = created["spreadsheetId"]

    # header row
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range="Leads!A1",
        valueInputOption="RAW", body={"values": [HEADERS]},
    ).execute()

    # share with the human owner so it shows up in their Drive
    if settings.leads_owner_email:
        try:
            drive.permissions().create(
                fileId=sid, sendNotificationEmail=True,
                body={"type": "user", "role": "writer", "emailAddress": settings.leads_owner_email},
            ).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"[sheets] could not share with {settings.leads_owner_email}: {exc}")

    try:
        settings.sheet_id_cache.write_text(sid)
    except Exception:
        pass
    return sid, f"https://docs.google.com/spreadsheets/d/{sid}/edit"


def append_leads(rows: list[list]) -> str:
    """Append lead rows to the Leads sheet; returns the spreadsheet URL."""
    if not rows:
        sid, url = get_or_create_leads_sheet()
        return url
    sheets, _ = _services()
    sid, url = get_or_create_leads_sheet()
    sheets.spreadsheets().values().append(
        spreadsheetId=sid, range="Leads!A1",
        valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()
    return url
