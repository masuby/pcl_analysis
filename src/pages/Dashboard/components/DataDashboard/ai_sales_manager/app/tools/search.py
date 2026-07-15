"""Tavily web-discovery tool."""
from ..config import settings


def tavily_search(query: str, max_results: int = 6) -> list[dict]:
    """Run one Tavily search and return normalised results.
    Best-effort: returns [] on any failure so a single bad query never kills a run."""
    if not settings.tavily_key:
        raise RuntimeError("TAVILY_API_KEY not configured.")
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=settings.tavily_key)
        resp = client.search(query=query, max_results=max_results, search_depth="advanced")
        results = resp.get("results", []) if isinstance(resp, dict) else []
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": (r.get("content", "") or "")[:2000],
            }
            for r in results
        ]
    except Exception as exc:  # noqa: BLE001 — best-effort discovery
        print(f"[tavily] query failed: {query!r} — {exc}")
        return []
