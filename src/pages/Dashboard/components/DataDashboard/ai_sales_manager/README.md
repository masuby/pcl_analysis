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

## Getting the data out (added 2026-08-21)

The point of the agent is leads someone can call, so both delivery paths are
first-class:

**Google Sheet** (`AISM_LEADS_SHEET_ID`) — rewritten per run, laid out per
product instead of one wide half-empty table:

| tab | what it holds |
|---|---|
| `LBF Leads` | car owners: car, year, price, estimated value/loan, **Source Link** |
| `SME Leads` | businesses: type, sector, offering, **Business Location**, shopfront, **Source Link** |
| `Unique Leads` | one row per phone across both products - the call list |
| `Summary` | links discovered / scraped / structured / unique, broken down by source |

**Excel download** — `GET /export.xlsx[?product=LBF|SME]` returns the same tabs
as a formatted workbook; the AISM tab has Download (all / LBF / SME) and
"Publish to Google Sheet" buttons. `app/export.py` reuses the column
definitions from `scraper/upload_to_sheet.py`, so the download and the sheet
cannot drift apart.

## Throughput notes (read before a big backfill)

Cleaning is the slow step, and the ceiling is the provider's **tokens per
minute**, not requests:

- `--batch N` puts N listings in one call. The instructions + output schema cost
  far more than a single listing, so batching is what actually raises the rate
  (measured: 8 -> 250 listings/min). A batch that returns the wrong number of
  entries is retried one-at-a-time, so batching can never put one advert's
  details on another lead.
- `--workers N` adds concurrency. Only helps on a provider that is not TPM-capped.
- 429s are retried with the provider's own `try again in Xs` hint.
- Each Groq model has its own TPM bucket, so two runs on different models
  (`--offset` to split the queue) roughly double throughput on the free tier.

```bash
python -m scraper.crawl --source jiji_motorcycles --max-listings 1500
python -m scraper.clean_with_ai --product LBF --model "deepseek: chat" --batch 4 --workers 8 --loop
python -m scraper.upload_to_sheet
```

**Providers.** Groq retired the `llama-3.x` ids; the registry now lists the ids
the account can actually call. DeepSeek is OpenAI-compatible but rejects
`response_format: json_schema`, so it is driven through function calling
(handled in `llm.py`). `DAILY_TOKEN_LIMIT` still guards spend - raise it before
a backfill of a few thousand listings.

## Source notes

- **cartanzania** now sits behind a Cloudflare challenge (403 "Just a moment").
  It is left in the registry but returns nothing; it is deliberately NOT worked
  around.
- **kupatana** vehicle categories overlap heavily and are dominated by dealers
  re-posting stock, so ~900 listings collapsed to ~70 distinct phone numbers.
  Volume there is not the same thing as people to call.
- **jiji motorcycles / cars** are mostly individual owners, so they yield far
  more distinct people per listing - that is where LBF breadth comes from.

## Next phases
- **P2:** dedupe against existing CS/LBF/SME customer sheets; region → branch/cluster routing.
- **P3:** human approval gate in the AISM tab; Gmail draft; Pushover rep notify.
- **P4:** scheduling, feedback loop (contacted/converted → re-score), add SME.
