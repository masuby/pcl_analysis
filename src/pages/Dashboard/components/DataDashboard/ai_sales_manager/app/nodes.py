"""LangGraph nodes: plan → discover → analyze → deliver (LBF focus, Phase 1)."""
import uuid
from datetime import datetime, timezone

from .state import ProspectBatch
from .tools.search import tavily_search
from .tools.sheets import append_leads
from .llm import invoke_structured


def plan_node(state: dict) -> dict:
    product = (state.get("product") or "LBF").upper()
    region = state.get("region") or "Tanzania"
    if product == "LBF":
        queries = [
            f"cars for sale by owner {region}",
            f"used car dealers {region} contact phone",
            f"Toyota Land Cruiser Harrier IST for sale {region}",
            f"vehicle owners classifieds {region}",
        ]
    else:  # SME (later phase)
        queries = [
            f"small and medium businesses directory {region} contact",
            f"wholesalers retailers shops {region}",
        ]
    return {"queries": queries, "log": [f"planned {len(queries)} {product} queries for {region}"]}


def discover_node(state: dict) -> dict:
    results, seen = [], set()
    for q in state.get("queries", []):
        for r in tavily_search(q, max_results=5):
            url = r.get("url")
            if url and url not in seen:
                seen.add(url)
                results.append(r)
    return {"raw_results": results, "log": [f"discovered {len(results)} unique sources"]}


_ANALYZE_SYS = (
    "You are a lending prospecting analyst for Platinum Credit Tanzania. The product is "
    "LBF (Log Book Finance): a loan SECURED BY THE BORROWER'S CAR. From the web-search "
    "results, extract realistic PROSPECTS — people or dealers who own or sell cars and "
    "could take a car-collateral loan. Rules: use ONLY facts present in the results; leave "
    "fields blank when unknown; NEVER invent phone numbers or values. Score each prospect: "
    "Hot = clearly a recent, valuable car AND a public contact; Warm = a car but weak "
    "contact/value; Cold = vague or thin. When a vehicle value is known, set est_loan_tzs to "
    "about 60% of est_value_tzs. Skip results that are not genuine prospects (news, blogs, "
    "forums with no owner/dealer)."
)


def analyze_node(state: dict) -> dict:
    results = state.get("raw_results", [])
    if not results:
        return {"prospects": [], "log": ["no sources to analyze"]}
    blob = "\n\n".join(
        f"[{i}] {r.get('title','')}\nURL: {r.get('url','')}\n{r.get('content','')}"
        for i, r in enumerate(results)
    )
    messages = [
        {"role": "system", "content": _ANALYZE_SYS},
        {"role": "user", "content":
            f"Product: {(state.get('product') or 'LBF').upper()}\n"
            f"Region: {state.get('region') or 'Tanzania'}\n\nSearch results:\n{blob}"},
    ]
    try:
        batch = invoke_structured(state.get("model"), ProspectBatch, messages)
        prospects = [p.model_dump() for p in (batch.prospects if batch else [])]
    except Exception as exc:  # noqa: BLE001
        return {"prospects": [], "log": [f"analyze failed: {exc}"]}
    prospects = prospects[: int(state.get("max_leads", 20))]
    return {"prospects": prospects, "log": [f"extracted {len(prospects)} scored prospects"]}


def deliver_node(state: dict) -> dict:
    prospects = state.get("prospects", [])
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    rows = [[
        uuid.uuid4().hex[:8], now, p.get("product", "LBF"), p.get("name", ""), p.get("location", ""),
        p.get("car_make", ""), p.get("car_model", ""), p.get("car_year", ""), p.get("est_value_tzs", ""),
        p.get("business_type", ""), p.get("contact", ""), p.get("score", "Cold"), p.get("est_loan_tzs", ""),
        p.get("reason", ""), p.get("source_url", ""), "New",
    ] for p in prospects]
    try:
        url = append_leads(rows)
    except Exception as exc:  # noqa: BLE001
        return {"delivered": 0, "log": [f"deliver failed (leads not written): {exc}"]}
    return {"delivered": len(rows), "sheet_url": url, "log": [f"wrote {len(rows)} leads to the sheet"]}
