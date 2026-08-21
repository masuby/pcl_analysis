"""Source registry — where the Digital Agent looks for prospects.

Each Source knows three things: how to page through an index, how to recognise a
listing link, and how to turn a detail page into a text blob for the AI step.
Adding a site means adding a Source here; nothing else changes.

Two products are served:
  LBF — people who own a car (the loan is secured on the car)
  SME — people who run a business (the loan is against the business)

Only publicly listed classified ads are read, and only from sites whose
robots.txt permits a generic crawler on those paths. Each source records the
check that was done, so the basis is auditable rather than assumed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

from bs4 import BeautifulSoup

# ── product constants ────────────────────────────────────────────────────────
LBF = "LBF"
SME = "SME"


@dataclass
class Source:
    key: str                       # stable id stored on every row
    label: str                     # shown in the UI
    product: str                   # LBF | SME
    base: str                      # scheme + host
    index_url: Callable[[int], str]  # page number -> index URL
    listing_re: re.Pattern         # matches listing paths in index HTML
    extract: Callable[[str], str]  # detail HTML -> text blob for the AI
    robots_note: str = ""          # what robots.txt permitted, and when checked
    enabled: bool = True
    categories: list[str] = field(default_factory=list)


# ── shared helpers ───────────────────────────────────────────────────────────

# Tanzanian mobile numbers as written in listings: 07xx / 06xx, +255…, 255….
TZ_PHONE_RE = re.compile(r"(?:\+?255|0)\s?[67]\d{2}\s?\d{3}\s?\d{3}")


def find_phone(html: str) -> str:
    """First plausible TZ mobile number in the page, normalised to 255XXXXXXXXX."""
    for raw in (TZ_PHONE_RE.findall(html) or []):
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("255"):
            digits = digits[3:]
        digits = digits.lstrip("0")
        if len(digits) == 9 and digits[0] in "67":
            return "255" + digits
    return ""


def _soup_text(html: str) -> BeautifulSoup:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()
    return soup


def _meta(soup: BeautifulSoup, prop: str) -> str:
    tag = soup.find("meta", {"property": prop}) or soup.find("meta", {"name": prop})
    return (tag.get("content") or "").strip() if tag else ""


# ── cartanzania (LBF — cars) ─────────────────────────────────────────────────

CARTANZANIA_BASE = "https://cartanzania.com"
_CT_STOP = ("Show more", "Show all ads", "Need to sell your car",
            "Write message", "Share ad with")


def cartanzania_extract(html: str) -> str:
    """The original extractor: the 'About … Price' block plus any tel: link."""
    soup = _soup_text(html)

    phone = ""
    tel = re.search(r"tel:\+?([\d\s]{7,})", html)
    if tel:
        phone = "+" + re.sub(r"\s+", "", tel.group(1))

    body = soup.find("main") or soup.body or soup
    lines = [l for l in body.get_text("\n", strip=True).split("\n") if l.strip()]
    joined = "\n".join(lines)

    start = joined.find("About")
    block = joined[start:] if start >= 0 else joined
    cut = len(block)
    for marker in _CT_STOP:
        idx = block.find(marker)
        if 0 <= idx < cut:
            cut = idx
    block = block[:cut].strip()

    header = _meta(soup, "og:title") or (soup.title.string.strip() if soup.title and soup.title.string else "")
    parts = []
    if header:
        parts.append(f"Title: {header}")
    if phone:
        parts.append(f"Phone: {phone}")
    parts.append(block)
    return "\n".join(parts).strip()


# ── jiji.co.tz (LBF cars + SME businesses) ───────────────────────────────────

JIJI_BASE = "https://jiji.co.tz"

# Ad URLs are /{region}/{sub-category}/{slug}-{id}.html — note the middle segment
# is the SUB-category ("building-and-trades-services"), not the top-level one you
# browsed ("services"), so a source cannot match on its own category name.
# Each index page only lists its own category's ads, so matching any three-segment
# ad path is safe; cars are excluded so an SME crawl can never pick one up.
JIJI_LISTING_RE = re.compile(
    r"/[a-z0-9-]+/(?!cars/)[a-z0-9-]+/[a-zA-Z0-9-]+\.html", re.I)
JIJI_CARS_LISTING_RE = re.compile(r"/[a-z0-9-]+/cars/[a-zA-Z0-9-]+\.html", re.I)


def jiji_extract(html: str) -> str:
    """Title, price, location, description and seller phone from a jiji ad.

    Price is read from the schema.org markup (`itemprop="price"`), which is a
    clean integer, rather than parsed out of the display string.
    """
    soup = _soup_text(html)

    title = _meta(soup, "og:title") or ""
    if not title:
        node = soup.find(class_=re.compile(r"qa-advert-title"))
        title = node.get_text(" ", strip=True) if node else ""

    price = ""
    price_meta = soup.find(attrs={"itemprop": "price"})
    if price_meta and price_meta.get("content"):
        price = price_meta["content"].strip()
    if not price:
        node = soup.find(class_=re.compile(r"qa-advert-price"))
        price = node.get_text(" ", strip=True) if node else ""

    description = ""
    desc_node = soup.find(class_=re.compile(r"qa-advert-description|b-advert-attributes"))
    if desc_node:
        description = desc_node.get_text("\n", strip=True)
    if not description:
        description = _meta(soup, "og:description")

    # Attribute pairs ("Year of manufacture: 2016", "Condition: Foreign Used")
    attrs = []
    for node in soup.find_all(class_=re.compile(r"b-advert-attribute")):
        text = node.get_text(" ", strip=True)
        if text and len(text) < 120:
            attrs.append(text)
    attrs = list(dict.fromkeys(attrs))[:25]

    phone = find_phone(html)
    seller = ""
    seller_node = soup.find(class_=re.compile(r"b-seller-block__name|qa-seller-name"))
    if seller_node:
        seller = seller_node.get_text(" ", strip=True)

    parts = []
    if title:
        parts.append(f"Title: {title}")
    if price:
        parts.append(f"Price: TZS {price}")
    if seller:
        parts.append(f"Seller: {seller}")
    if phone:
        parts.append(f"Phone: {phone}")
    if attrs:
        parts.append("Attributes:\n" + "\n".join(attrs))
    if description:
        parts.append(f"About\n{description}")
    return "\n".join(parts).strip()


def _jiji_index(path: str) -> Callable[[int], str]:
    return lambda page: f"{JIJI_BASE}/{path}?page={page}"


# jiji categories whose sellers are businesses rather than private individuals.
# These are the SME signal: someone advertising commercial equipment, trade
# services or wholesale foodstuff is running a business.
JIJI_SME_CATEGORIES = [
    "services",
    "office-and-commercial-equipment-tools",
    "repair-and-construction",
    "agriculture-and-foodstuff",
]

_ROBOTS_JIJI = ("robots.txt checked 2026-08-10: User-agent * disallows only "
                "/test/, /admin/, /crm/, /auth/facebook — listing paths permitted")
_ROBOTS_CARTANZANIA = ("DISABLED 2026-08-21: the site now answers every page with a "
                       "Cloudflare challenge (403 'Just a moment'), i.e. it is refusing "
                       "automated access. That is a decision by the site owner and is "
                       "left alone rather than worked around. "
                       "(robots.txt checked 2026-08-10: User-agent * was Allow: / , with "
                       "named AI crawlers disallowed and ai-train=no / use=reference.)")

SOURCES: dict[str, Source] = {
    "cartanzania": Source(
        key="cartanzania",
        label="CarTanzania — car listings",
        product=LBF,
        base=CARTANZANIA_BASE,
        index_url=lambda page: f"{CARTANZANIA_BASE}/buy-cars?page={page}",
        listing_re=re.compile(r"/en/vehicle_listings/ad-[a-z0-9-]+", re.I),
        extract=cartanzania_extract,
        robots_note=_ROBOTS_CARTANZANIA,
        enabled=False,
    ),
    "jiji_cars": Source(
        key="jiji_cars",
        label="Jiji — cars",
        product=LBF,
        base=JIJI_BASE,
        index_url=_jiji_index("cars"),
        listing_re=JIJI_CARS_LISTING_RE,
        extract=jiji_extract,
        robots_note=_ROBOTS_JIJI,
    ),
    # Motorcycles are the other asset LBF lends against, and — unlike the car
    # categories, which are dominated by dealers re-posting the same stock
    # against one phone number — these are mostly individual owners, so a page
    # of them yields far more distinct people to call.
    "jiji_motorcycles": Source(
        key="jiji_motorcycles",
        label="Jiji — motorcycles & scooters",
        product=LBF,
        base=JIJI_BASE,
        index_url=_jiji_index("motorcycles-and-scooters"),
        listing_re=re.compile(
            r"/[a-z0-9-]+/motorcycles-and-scooters/[a-zA-Z0-9-]+\.html", re.I),
        extract=jiji_extract,
        robots_note=_ROBOTS_JIJI,
        categories=["motorcycles-and-scooters"],
    ),
}

# One Source per SME category, so they can be enabled independently.
for _cat in JIJI_SME_CATEGORIES:
    SOURCES[f"jiji_{_cat.replace('-', '_')}"] = Source(
        key=f"jiji_{_cat.replace('-', '_')}",
        label=f"Jiji — {_cat.replace('-', ' ')}",
        product=SME,
        base=JIJI_BASE,
        index_url=_jiji_index(_cat),
        listing_re=JIJI_LISTING_RE,
        extract=jiji_extract,
        robots_note=_ROBOTS_JIJI,
        categories=[_cat],
    )


# ── kupatana.co.tz (LBF cars + SME businesses) ───────────────────────────────
#
# Measured 2026-08-10: 8/8 sampled vehicle listings exposed a seller phone in
# the HTML, against 2/10 on jiji. Its category pages render listings
# server-side at /tz/search/{category}, so links are discoverable without
# driving a browser.

KUPATANA_BASE = "https://kupatana.com"
KUPATANA_LISTING_RE = re.compile(r"/tz/[a-z0-9-]+/p/[a-z0-9-]+/[0-9][a-z0-9]*", re.I)


def kupatana_extract(html: str) -> str:
    """Title, price, location, description and seller phone from a kupatana ad."""
    soup = _soup_text(html)

    title = _meta(soup, "og:title") or (
        soup.title.string.strip() if soup.title and soup.title.string else "")
    description = _meta(soup, "og:description")

    body = soup.find("main") or soup.body or soup
    text = body.get_text("\n", strip=True) if body else ""
    lines = [l for l in text.split("\n") if l.strip()]
    # Keep the head of the page: title, price, attributes and description sit
    # there; the tail is site navigation and "similar ads".
    block = "\n".join(lines[:60])

    price = ""
    m = re.search(r"(?:TSh|TZS)\s?[\d,\.]+", text)
    if m:
        price = m.group(0)

    phone = find_phone(html)

    parts = []
    if title:
        parts.append(f"Title: {title}")
    if price:
        parts.append(f"Price: {price}")
    if phone:
        parts.append(f"Phone: {phone}")
    if description:
        parts.append(f"About\n{description}")
    if block:
        parts.append(block)
    return "\n".join(parts).strip()


def _kupatana_index(cat: str) -> Callable[[int], str]:
    return lambda page: f"{KUPATANA_BASE}/tz/search/{cat}?page={page}"


_ROBOTS_KUPATANA = ("robots.txt checked 2026-08-10: User-agent * disallows only "
                    "/dashboard — search and listing paths permitted")

# Categories whose sellers own a vehicle.
KUPATANA_LBF_CATEGORIES = [
    "vehicles",
    "saloons-mpv-s-4wd-s-pickups",
    "trucks-trailers-buses",
    "three-wheelers",
]

# Categories whose sellers are running a business rather than clearing a shelf:
# commercial supplies, trade equipment, wholesale stock, plant and machinery.
KUPATANA_SME_CATEGORIES = [
    "commercial-appliances-supplies",
    "generators-transformers-compressors",
    "copiers-printers-scanners",
    "office-software-supplies",
    "diy-tools-machines",
    "plumbing-construction",
    "food-products-spices",
    "poultry-animal-breeding",
    "safety-security-equipment",
    "tractors-excavators-graders-etc",
]

for _cat in KUPATANA_LBF_CATEGORIES:
    SOURCES[f"kupatana_{_cat.replace('-', '_')}"] = Source(
        key=f"kupatana_{_cat.replace('-', '_')}",
        label=f"Kupatana — {_cat.replace('-', ' ')}",
        product=LBF,
        base=KUPATANA_BASE,
        index_url=_kupatana_index(_cat),
        listing_re=KUPATANA_LISTING_RE,
        extract=kupatana_extract,
        robots_note=_ROBOTS_KUPATANA,
        categories=[_cat],
    )

for _cat in KUPATANA_SME_CATEGORIES:
    SOURCES[f"kupatana_{_cat.replace('-', '_')}"] = Source(
        key=f"kupatana_{_cat.replace('-', '_')}",
        label=f"Kupatana — {_cat.replace('-', ' ')}",
        product=SME,
        base=KUPATANA_BASE,
        index_url=_kupatana_index(_cat),
        listing_re=KUPATANA_LISTING_RE,
        extract=kupatana_extract,
        robots_note=_ROBOTS_KUPATANA,
        categories=[_cat],
    )


def get(key: str) -> Source | None:
    return SOURCES.get(key)


def for_product(product: str) -> list[Source]:
    """Enabled sources serving a product ('' or 'ALL' means every source)."""
    p = (product or "").upper()
    return [s for s in SOURCES.values()
            if s.enabled and (p in ("", "ALL") or s.product == p)]


def summary() -> list[dict]:
    """Source catalogue for the UI."""
    return [
        {"key": s.key, "label": s.label, "product": s.product,
         "base": s.base, "enabled": s.enabled, "robots": s.robots_note}
        for s in SOURCES.values()
    ]
