"""Multi-provider LLM registry + a daily token-budget guard.

A model is chosen by a friendly id (e.g. "groq: llama-3.3-70b"). Only models
whose provider key AND langchain package are present are offered. Groq is
listed first so it's the default when no model is selected.
"""
import importlib.util
import threading
from datetime import date

from .config import settings


class BudgetError(RuntimeError):
    """Raised when the daily token budget is exhausted."""


# friendly id -> (provider, model name, langchain package)
MODELS = {
    "groq: llama-3.3-70b":  ("groq", "llama-3.3-70b-versatile", "langchain_groq"),
    "groq: llama-3.1-8b":   ("groq", "llama-3.1-8b-instant", "langchain_groq"),
    "openai: gpt-4o":       ("openai", "gpt-4o", "langchain_openai"),
    "openai: gpt-4o-mini":  ("openai", "gpt-4o-mini", "langchain_openai"),
    "anthropic: sonnet-5":  ("anthropic", "claude-sonnet-5", "langchain_anthropic"),
    "anthropic: haiku-4.5": ("anthropic", "claude-haiku-4-5-20251001", "langchain_anthropic"),
}

_PROVIDER_KEY = {
    "groq": lambda: settings.groq_key,
    "openai": lambda: settings.openai_key,
    "anthropic": lambda: settings.anthropic_key,
}


def _pkg_available(pkg: str) -> bool:
    return importlib.util.find_spec(pkg) is not None


def available_models() -> list[str]:
    """Model ids usable right now (key present + package installed)."""
    out = []
    for mid, (prov, _name, pkg) in MODELS.items():
        key = _PROVIDER_KEY.get(prov, lambda: None)()
        if key and _pkg_available(pkg):
            out.append(mid)
    return out


def default_model() -> str | None:
    avail = available_models()
    return avail[0] if avail else None


def _build(model_id: str):
    prov, name, _pkg = MODELS[model_id]
    key = _PROVIDER_KEY[prov]()
    if prov == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=name, api_key=key, temperature=0)
    if prov == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=name, api_key=key, temperature=0)
    if prov == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=name, api_key=key, temperature=0)
    raise RuntimeError(f"Unknown provider: {prov}")


def get_llm(model_id: str | None = None):
    """Return a LangChain chat model for the id (or the default available one)."""
    if not model_id or model_id not in available_models():
        model_id = default_model()
    if not model_id:
        raise RuntimeError(
            "No usable LLM. Set GROQ_API_KEY (and `pip install langchain-groq`) "
            "or another provider's key + package."
        )
    return _build(model_id)


# ── daily token budget ────────────────────────────────────────────────────
class _Budget:
    def __init__(self, limit: int):
        self.limit = limit
        self._day = date.today()
        self._used = 0
        self._lock = threading.Lock()

    def _roll(self):
        if date.today() != self._day:
            self._day, self._used = date.today(), 0

    def check(self):
        with self._lock:
            self._roll()
            if self._used >= self.limit:
                raise BudgetError(f"Daily token limit reached ({self._used}/{self.limit}).")

    def add(self, tokens: int):
        with self._lock:
            self._roll()
            self._used += max(0, int(tokens or 0))

    def status(self) -> dict:
        self._roll()
        return {"used": self._used, "limit": self.limit, "remaining": max(0, self.limit - self._used)}


budget = _Budget(settings.daily_token_limit)


def invoke_structured(model_id: str | None, schema, messages):
    """Budget-checked structured-output call. `schema` is a pydantic model."""
    budget.check()
    llm = get_llm(model_id).with_structured_output(schema, include_raw=True)
    out = llm.invoke(messages)
    raw = out.get("raw") if isinstance(out, dict) else None
    usage = getattr(raw, "usage_metadata", None) if raw is not None else None
    if usage:
        budget.add(usage.get("total_tokens", 0))
    return out.get("parsed") if isinstance(out, dict) else out
