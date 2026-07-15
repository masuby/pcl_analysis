"""Configuration + environment loading for the AI Sales Manager service."""
import os
import re
from pathlib import Path
from dotenv import load_dotenv


def _sheet_id(raw: str | None) -> str | None:
    """Accept either a bare spreadsheet id or a full Google Sheets URL."""
    if not raw:
        return None
    raw = raw.strip()
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", raw)
    return m.group(1) if m else raw

# This package lives inside the DataDashboard component folder, so the keys
# (.env) and the service-account JSON sit one level up, in DataDashboard/.
_APP_DIR = Path(__file__).resolve().parent          # .../DataDashboard/ai_sales_manager/app
_PKG_DIR = _APP_DIR.parent                          # .../DataDashboard/ai_sales_manager
_DATADASH_DIR = _PKG_DIR.parent                     # .../DataDashboard  (holds .env + creds json)
_DATADASH_ENV = _DATADASH_DIR / ".env"

# Load env: explicit override → package .env → the DataDashboard .env (holds the keys).
_candidates = [os.getenv("AISM_ENV_FILE"), _PKG_DIR / ".env", _DATADASH_ENV]
ENV_PATH = next((Path(p) for p in _candidates if p and Path(p).exists()), None)
if ENV_PATH:
    load_dotenv(ENV_PATH)


def _find_backend_env(start: Path) -> Path | None:
    """Walk up to find the Go backend's .env (holds the Postgres DB_* creds)."""
    p = start
    for _ in range(8):
        cand = p / "backend" / ".env"
        if cand.exists():
            return cand
        if p.parent == p:
            break
        p = p.parent
    return None


# Reuse the project's Postgres creds (DB_HOST/PORT/USER/PASSWORD/NAME) without
# overriding anything the DataDashboard .env already set.
_BACKEND_ENV = _find_backend_env(_DATADASH_DIR)
if _BACKEND_ENV:
    load_dotenv(_BACKEND_ENV, override=False)


def _resolve_creds(path: str | None) -> str | None:
    """Resolve the service-account JSON path (absolute, package-relative, or
    relative to the env file's directory — the DataDashboard folder)."""
    if not path:
        return None
    p = Path(path.lstrip("\\/"))  # the DataDashboard .env stores a leading-slash relative path
    for base in ([Path(path)] if os.path.isabs(path) else []) + [
        _PKG_DIR / p, (ENV_PATH.parent / p if ENV_PATH else _PKG_DIR / p), _DATADASH_ENV.parent / p
    ]:
        if base.exists():
            return str(base)
    return path


class Settings:
    # LLM providers (first available per tier wins)
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")

    # Tools
    tavily_key = os.getenv("TAVILY_API_KEY")
    google_creds = _resolve_creds(os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))

    # LangSmith (LangChain auto-traces when LANGSMITH_TRACING=true + key set)
    langsmith_project = os.getenv("LANGSMITH_PROJECT", "ai-sales-manager")

    # Guards / behaviour
    daily_token_limit = int(os.getenv("DAILY_TOKEN_LIMIT") or 200000)
    leads_owner_email = os.getenv("AISM_LEADS_OWNER_EMAIL")
    leads_sheet_id = _sheet_id(os.getenv("AISM_LEADS_SHEET_ID"))

    env_path = str(ENV_PATH) if ENV_PATH else None
    # Where we persist the auto-created Leads spreadsheet id between runs.
    sheet_id_cache = _PKG_DIR / ".leads_sheet_id"

    # PostgreSQL — reuse the project DB (pcl_analysis) unless AISM_* overrides.
    database_url = os.getenv("AISM_DATABASE_URL") or os.getenv("DATABASE_URL")
    db_host = os.getenv("AISM_DB_HOST") or os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("AISM_DB_PORT") or os.getenv("DB_PORT", "5432")
    db_user = os.getenv("AISM_DB_USER") or os.getenv("DB_USER", "pcl_user")
    db_password = os.getenv("AISM_DB_PASSWORD") or os.getenv("DB_PASSWORD", "")
    db_name = os.getenv("AISM_DB_NAME") or os.getenv("DB_NAME", "pcl_analysis")

    def db_dsn(self) -> str:
        if self.database_url:
            return self.database_url
        return (f"host={self.db_host} port={self.db_port} dbname={self.db_name} "
                f"user={self.db_user} password={self.db_password}")

    def db_summary(self) -> dict:
        return {"host": self.db_host, "port": self.db_port, "name": self.db_name,
                "user": self.db_user}

    def provider_summary(self) -> dict:
        return {
            "anthropic": bool(self.anthropic_key),
            "openai": bool(self.openai_key),
            "groq": bool(self.groq_key),
            "tavily": bool(self.tavily_key),
            "google_creds": bool(self.google_creds),
            "langsmith": os.getenv("LANGSMITH_TRACING", "false").lower() == "true",
        }


settings = Settings()
