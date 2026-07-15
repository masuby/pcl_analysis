# AI Sales Manager — agent service

A LangGraph agent that **discovers, scores, and lists LBF/SME loan prospects** for
Platinum Credit Tanzania. Phase 1 focuses on **LBF** (Log Book Finance — car
owners/dealers who can borrow against their vehicle). No outreach yet: it finds
prospects, qualifies them, and writes them to a Google Sheet it creates itself.

```
plan ──► discover (Tavily) ──► analyze (LLM: extract + score) ──► deliver (Google Sheet)
```

## Layout
```
ai_sales_manager/
├─ app/
│  ├─ config.py        env loading + settings (falls back to DataDashboard/.env)
│  ├─ state.py         graph state + the Prospect model
│  ├─ llm.py           multi-provider LLM router + daily token-budget guard
│  ├─ tools/
│  │  ├─ search.py     Tavily web discovery
│  │  └─ sheets.py     creates/shares/appends the "AISM Leads" Google Sheet
│  ├─ nodes.py         plan / discover / analyze / deliver
│  ├─ graph.py         LangGraph assembly
│  └─ main.py          FastAPI app (/health, /run)
├─ requirements.txt
└─ .env.example
```

## Run locally

This package lives inside the DataDashboard component folder, so it picks up the
sibling `DataDashboard/.env` (your keys) and `sales-reps-status-*.json` (service
account) automatically — no `AISM_ENV_FILE` needed.

```bash
cd src/pages/Dashboard/components/DataDashboard/ai_sales_manager
python -m venv .venv && source .venv/Scripts/activate   # Windows git-bash
pip install -r requirements.txt

# optional: who to share the auto-created Leads sheet with
export AISM_LEADS_OWNER_EMAIL="daniel@platinumcredit.co.tz"

uvicorn app.main:app --reload --port 8090
```

Then:
```bash
curl localhost:8090/health
curl -X POST localhost:8090/run -H 'content-type: application/json' \
     -d '{"product":"LBF","region":"Dar es Salaam","max_leads":10}'
```

## Notes / gotchas
- **Google Sheet creation quota:** a service account has no personal Drive quota,
  so `spreadsheets.create` can fail. Fallbacks: set `AISM_LEADS_SHEET_ID` to a sheet
  you created and shared with the service-account email, or create it in a Shared
  Drive. The created id is cached in `.leads_sheet_id`.
- **LangSmith:** set `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` and every run is
  traced under `LANGSMITH_PROJECT`.
- **Budget:** `DAILY_TOKEN_LIMIT` caps LLM spend per day (in-process counter).
- **Models:** `GET /models` lists every model whose provider key + langchain package
  are present; the tab shows them in a dropdown. **Groq (`llama-3.3-70b`) is the default**
  (fast + cheap). The chosen id is passed per-run in `POST /run {"model": ...}`. Add
  OpenAI/Anthropic simply by having their key + `pip install langchain-openai`/`-anthropic`.

## Scraper pipeline (no-token discovery) — `scraper/`

Instead of paying LLM tokens to browse car sites, a scraper walks
**cartanzania.com** directly, and the LLM only does the cheap cleaning step.

```
scrape_cartanzania.py  walks /buy-cars?page=1..N, collects every
                       /en/vehicle_listings/ad-… link, opens each and captures
                       the raw "About … Price" block + phone
                          -> data/lbf_ai_raw_data.xlsx     (raw_data, source_url)
clean_with_ai.py       LLM (Groq default) extracts structured fields + score
                          -> data/lbf_ai_cleaned_data.xlsx (16 columns)
upload_to_sheet.py     writes the cleaned rows to the "Scraped LBF" tab of the
                       sheet in AISM_LEADS_SHEET_ID (accepts a full URL or bare id)
run_pipeline.py        runs all three in order
```

Run (from `ai_sales_manager/`):
```bash
python -m scraper.run_pipeline --pages 5                 # scrape 5 pages, clean, upload
python -m scraper.run_pipeline --pages 10 --max-listings 80
python -m scraper.scrape_cartanzania --pages 5           # step 1 only
python -m scraper.clean_with_ai --model "groq: llama-3.3-70b"
python -m scraper.upload_to_sheet --append
```

Each `/buy-cars` page yields ~20 listings; the index runs to ~1000 pages.
`--delay` (default 1.0s) throttles requests to stay polite. Later sources
(facebook, jiji.co.tz) can be added as extra `scrape_*.py` modules feeding the
same `lbf_ai_raw_data.xlsx`.

## Next phases
- **P2:** dedupe against existing CS/LBF/SME customer sheets; region → branch/cluster routing.
- **P3:** human approval gate in the AISM tab; Gmail draft; Pushover rep notify.
- **P4:** scheduling, feedback loop (contacted/converted → re-score), add SME.
