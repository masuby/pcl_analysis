"""Deciding who is actually a prospect — the judgement half of the clean step.

parse_kupatana.py reads the advert; this file decides what it is worth. The
rules below were not invented: 300 real adverts were read and scored by six
independent reviewers, and what follows is what they agreed on, with their
wording kept so the basis stays checkable.

Four findings drive everything here.

1. THE SAME SELLER POSTS AGAIN AND AGAIN. One phone number on this site carries
   530 adverts, another 358, a third 304. A private owner sells one vehicle;
   somebody with five cars is a dealer, and a dealer does not want a loan
   against stock they are trying to clear. Counting adverts per phone across
   the whole database separates the two better than any wording rule, and it is
   the first thing applied. 2,811 of 3,992 phone numbers have exactly one
   advert — those are the people worth calling.

2. THE CATEGORY IS NOISE. Kupatana's own filing is wrong often enough to invert
   the answer: a Mercedes C-Class under "Plumbing & construction", a 360KVA
   generator under "Food products & spices", houses and wardrobes and a carport
   all under the same plumbing bucket. Nothing here branches on category, and
   the crawl's own LBF/SME label is treated as provenance only — the product is
   re-derived from what the advert actually describes, because roughly one
   advert in eight was crawled under the wrong one.

3. SWAHILI GRAMMAR CARRIES THE SIGNAL. The verb prefix says who is speaking:
   `tunauza` (we sell) is a business, `nauza` (I sell) is a person. `tupo
   Ubungo` (we are at Ubungo) is a premises. That one distinction is the
   cleanest business marker in the data.

4. WHAT LOOKS LIKE A SIGNAL AND IS NOT: emoji, ALL CAPS, the word "mpya"
   (new), description length, location, and price on its own. Each was tested
   and each cuts both ways — see the note at the foot of this file, so nobody
   re-adds them later.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from difflib import SequenceMatcher


def _title_key(title: str) -> str:
    """Lower-case, punctuation-free form used to recognise a re-listed item."""
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", (title or "").lower()).split())


def is_redacted_name(name: str) -> bool:
    """Kupatana hides some sellers behind the literal text "[email protected]".

    It is a redaction token, not a person and not a company: 88 different phone
    numbers carry it. Four of them reached the first upload set as "trading
    name", one selling a single used office chair. Note the token does not
    always contain a literal "@", so the bracket form has to be matched too.
    """
    n = (name or "").strip().lower()
    return "@" in n or n.startswith("[email") or n.endswith("protected]")


def name_key(name: str) -> str:
    """A seller name reduced so "Donny M." and "Donny" collide — but ONLY when
    the name is distinctive enough that a collision means the same seller.

    Grouping on a bare given name is worthless and dangerous: measured on the
    corpus, "yusuph" spans 46 different phone numbers, "joseph" 21 and "james"
    20. Those are unrelated people, and treating them as one dealer would throw
    away genuine private sellers by the dozen. So a key is only issued for a
    trading name, or for a name with two real words in it.
    """
    n = re.sub(r"\s+", " ", (name or "").strip())
    n = re.sub(r"(\s+[A-Za-z]\.?)+$", "", n).strip()
    if len(n) < 5 or is_redacted_name(n):
        return ""
    words = [w for w in n.split() if len(w) >= 3]
    if len(words) >= 2 or name_is_business(n):
        return n.lower()
    return ""


def _same_item(a: str, b: str) -> bool:
    """Two titles describing the same thing, allowing for a re-typed re-listing."""
    if not a or not b:
        return a == b
    if a == b or a in b or b in a:
        return True
    return SequenceMatcher(None, a, b).ratio() > 0.6


# ── 1. the seller index ──────────────────────────────────────────────────────

class SellerIndex:
    """How many adverts each phone number has posted, across everything held.

    Built once per run and consulted per advert. The count is what separates a
    dealer from an owner, so it must be taken over the WHOLE corpus, not the
    batch being cleaned — a dealer whose other 40 adverts were crawled last
    month would otherwise look like a private seller today.
    """

    # A person clearing out their life might post two or three things. Five
    # separate adverts from one number is a trading operation. The threshold is
    # deliberately generous to the lead: at 5+ the reviewers agreed every case
    # was a trader.
    TRADER_ADVERTS = 5
    # Vehicles are different: nobody owns five cars privately. Two whole
    # vehicles from one number was unanimous among the reviewers.
    VEHICLE_TRADER_ADVERTS = 2

    # A dealer who buys a new SIM is still the same dealer. "Donny" trades
    # under 255753975454 and 255754975454 — one digit apart — and "Ramadhan"
    # sold the same motorcycle model under three consecutive numbers. Where one
    # trading name spans this many numbers AND sells vehicles, it is a yard.
    NAME_PHONES_FOR_DEALER = 2

    def __init__(self) -> None:
        self.adverts: dict[str, int] = defaultdict(int)
        self.vehicles: dict[str, int] = defaultdict(int)
        self.titles: dict[str, set[str]] = defaultdict(set)
        self.name_phones: dict[str, set[str]] = defaultdict(set)
        self.name_vehicles: dict[str, int] = defaultdict(int)
        self._phone_name: dict[str, str] = {}

    def add(self, phone: str, title: str, is_vehicle: bool,
            seller_name: str = "") -> None:
        if not phone:
            return
        key = phone[-9:]
        t = _title_key(title)
        # The same item must not count twice, and people re-list constantly:
        # "HILUX VIGO" and "Hilux vigo", "isuzu tipper 250" and "isuzu tipper"
        # are one pickup advertised twice, not a dealer with two. Measured on
        # the corpus, 89 of the 199 sellers holding exactly two vehicle adverts
        # were a single owner re-posting — an exact-match check called every one
        # of them a dealer and threw the lead away.
        if t and any(_same_item(t, seen) for seen in self.titles[key]):
            return
        self.titles[key].add(t)
        self.adverts[key] += 1
        if is_vehicle:
            self.vehicles[key] += 1
        nk = name_key(seller_name)
        if nk:
            self._phone_name[key] = nk
            self.name_phones[nk].add(key)
            if is_vehicle:
                self.name_vehicles[nk] += 1

    def count(self, phone: str) -> int:
        return self.adverts.get((phone or "")[-9:], 0)

    def vehicle_count(self, phone: str) -> int:
        return self.vehicles.get((phone or "")[-9:], 0)

    def is_trader(self, phone: str) -> bool:
        return self.count(phone) >= self.TRADER_ADVERTS

    def is_vehicle_dealer(self, phone: str) -> bool:
        if self.vehicle_count(phone) >= self.VEHICLE_TRADER_ADVERTS:
            return True
        nk = self._phone_name.get((phone or "")[-9:], "")
        return bool(nk
                    and len(self.name_phones[nk]) >= self.NAME_PHONES_FOR_DEALER
                    and self.name_vehicles[nk] >= self.VEHICLE_TRADER_ADVERTS)


# ── 2. seller names ──────────────────────────────────────────────────────────

# A trading name. Whole-word where a fragment would over-match: "auto" must not
# fire on "Automatic", "co" must not fire on every name containing it.
_TRADE_NAME = re.compile(
    r"(stores?|shops?|duka|dukani|supp?ly|supplies|suppliers?|enterprises?|"
    r"compan(y|ies)|\bco\b|&co|\bltd\b|limited|international|services?|agenc(y|ies)|"
    r"investments?|traders?|trading|dealers?|motors?|autos?\b|hardware|group|"
    r"\bsales\b|point|centre|center|dalali|dalalitz|broker|real estate|"
    r"biashara|bidhaa|nyumba|wakala|mradi|online|\.com|\.co\.tz)", re.I)

# Branding marks a person never puts in their own name.
_BRAND_GLYPH = re.compile(r"[™®©]|[\U0001F300-\U0001FAFF]")

# Kupatana shows a private seller as "Firstname X." or "Firstname X. Y." — a
# given name plus initials. Anything else is, in the reviewers' sample, a
# business about four times in five.
_PERSON_SHAPE = re.compile(r"^[A-Za-z][\w'’-]*(\s+[A-Za-z]\.?){0,3}\s*$")


def name_is_business(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    if is_redacted_name(n):
        return False
    if _TRADE_NAME.search(n) or _BRAND_GLYPH.search(n):
        return True
    if n.isdigit():                      # a bare account number, e.g. "407010"
        return True
    # "Pikipikiusedstore", "KhaliNation", "OfficialTk" — run-together words with
    # internal capitals and no initial. A person is "Haji a.", not "AjStore".
    if not _PERSON_SHAPE.match(n) and len(n) > 6 and " " not in n:
        return True
    return False


# ── 3. what the advert is selling ────────────────────────────────────────────

_VEHICLE_NOUN = re.compile(
    r"\b(pikipiki|pikipik|pkpk|pikpk|pikpiki|piki|boda\s?boda|boda|bajaji|bajaj|"
    r"motor\s?bike|motorbike|motorcycle|motobike|scooter|skuta|gari|magari|"
    r"lori|canter|tipper|truck|toyota|nissan|mitsubishi|suzuki|subaru|isuzu|"
    r"mercedes|benz|land\s?rover|defender|boxer|boxre|boxar|boexr|boxa|"
    r"tvs\d*|honda|fekon|sanlg|baiskeli|bicycle|kliki|"
    r"san\s?lg|haojue|sky\s?go|jincheng|hino|fuso|dyna|vario|pulsar|\bbmw\b|"
    r"harrier|prado|hilux|coaster|crown|\bist\b|wish|noah|ractis|kluger|passo|"
    r"vitz|alphard|forester|dualis|spacio|funcargo|patrol|click|guta|wanhoo)\b",
    re.I)

# Engine displacement — the strongest confirmation that a whole machine is meant.
_CC_RE = re.compile(r"\b(?:cc\s?\d{2,4}|\d{2,4}\s?cc)\b", re.I)

# A part, an accessory, or a consumable. Never a logbook asset.
#
# "engine" is deliberately NOT here: in these adverts "ENGINE HAIJAGUSWA"
# ("engine untouched") is a condition boast about a WHOLE motorcycle, and
# blacklisting the bare word threw away good bikes. Only the possessive forms
# "injini ya" / "engine ya" ("engine OF a …") actually mean a part.
_PART_NOUN = re.compile(
    r"\b(spare\s?parts?|spares?|vipuri|spea|gear\s?box|gia|tyres?|tires?|tairi|"
    r"taya|matairi|rims?|rimu|bumper|mirror|kioo|seat\s?cover|helmets?|kofia|"
    r"batter(y|ies)|betri|charger|chaji|carburet\w*|chain|mnyororo|sprocket|"
    r"body\s?kit|windscreen|shade|tent|carport|banda|silencer|exhaust|clutch|"
    r"brakes?|breki|disc|oil\s?filter|filters?|shocks?|toner|cartridge|\bink\b|"
    r"baiskeli|bicycle|\bbmx\b)\b", re.I)
_PART_OF = re.compile(r"\b(injini|engine|body|chasis|chassis)\s+ya\b", re.I)

# Plant that is valuable but cannot carry a logbook — an SME asset, never LBF.
#
# The MAKES matter as much as the nouns: an advert reading "Massey furguson" or
# "CAT 950H" never says the word tractor, and 13 of 17 wrongly-selected LBF
# leads in the first audit were farm and construction plant sold under a brand
# name alone, each stamped "private car".
_NOT_ROAD_GOING = re.compile(
    r"\b(generator|genset|\bkva\b|alternator|compressor|welding|incubator|"
    r"tractors?|yractor|trekta|plough|plow|harrow|excavator|grader|bulldozer|"
    r"dozer|forklift|backhoe|wheel\s?loader|loader|crusher|roller|kijiko|"
    r"articulated\s?dump|\badt\b|crane|"
    # The makes matter as much as the nouns, and the spelling is unreliable:
    # "Massey Furgoson", "Catapiller", "used farm yractor" all appeared.
    r"massey|fergu?son|furgu?oson|furguson|kubota|\bjcb\b|cat[ae]rpill?ar|"
    r"catapiller|\bcat\s?\d|komatsu|shantui|\bsdlg\b|bobcat|powerscreen|"
    r"tatahitachi|hitachi|zoomlion|new\s?holland|olympian|landini|sonalika)\b",
    re.I)

# Somebody asking to BUY, not offering to sell. "nataka piki piki yakuchaji …
# mwenye nayo anicheki bei" — I want a charging motorcycle, whoever has one
# should quote me. They own nothing.
_WANTED_AD = re.compile(
    r"\b(nataka|natafuta|nahitaji|ninahitaji|nataka\s?kununua|"
    r"wanted|looking\s?to\s?buy|i\s?want\s?to\s?buy|mwenye\s?nayo|mwenyew?\s?nayo)\b",
    re.I)


def is_part(text: str) -> bool:
    return bool(_PART_NOUN.search(text) or _PART_OF.search(text))


def is_vehicle(title: str, description: str = "", attributes: dict | None = None) -> bool:
    """A whole, road-going vehicle — QUALIFIED on the title, DISQUALIFIED on either.

    The description must not qualify an advert on its own: "chaji betri ya gari
    lako" ("charge your car's battery") contains the word for car and is a
    TZS 28,000 charger.

    Disqualifying, though, reads both. A title of "Catapiller Olympian
    GEPX30-1" or "Zoomlion RK704" names no machine class at all; it is the
    description that says "Nauza generator yangu" and "Trekta ya zoomlion".
    Six of 25 leads in one upload set were plant hiding behind a model number.
    """
    t = title or ""
    attrs = attributes or {}
    # The make and model are where plant gives itself away when the title is
    # only a nickname: "Hii Wheelie" carries Make=Caterpillar, Model=Ex 6088,
    # and it is a 140-million-shilling wheel loader, not a car.
    attr_text = " ".join(str(v) for v in attrs.values())
    if is_part(t) or _NOT_ROAD_GOING.search(f"{t} {description or ''} {attr_text}"):
        return False
    if _VEHICLE_NOUN.search(t) or _CC_RE.search(t):
        return True
    # Site-enforced vehicle attributes are trustworthy where free text is not.
    if any(k in attrs for k in ("Mileage", "Transmission")):
        return not is_part(f"{t} {description}")
    return False


# The papers a logbook loan needs. Necessary, not sufficient — dealers say it too.
_HAS_PAPERS = re.compile(
    r"(full\s?documents?|ful\s?documents?|hati\s?(zote)?|vibali|cards?|"
    r"registered|namba\s+[A-Z]{2,3}|piki\s?nzima)", re.I)


# ── 4. how the advert speaks ─────────────────────────────────────────────────

# First person PLURAL, and other trade talk. The `tu-` prefix is the marker.
_BUSINESS_TALK = re.compile(
    r"(tunauza|tunapatikana|tunafanya|tunatoa|tunatengeneza|tunasambaza|"
    r"tunanunua|tunakopesha|tunajenga|tuna\s?jenga|tunasafirisha|tuta\w+|"
    r"tuna\s|tupo\s|wateja\s?wetu|karibuni\s?wateja|karibu\s?dukani|"
    r"karibu\s?ujipatie|kwetu\s?upate|njoo\s?ofisini|huduma\s?zetu|"
    r"wasiliana\s?nasi|tumeshusha\s?bei|punguzo|zipo\s?nyingi|vipo\s?vingi|"
    r"bei\s?ya\s?jumla|\bjumla\b|reja\s?reja|rejareja|mteja\s?wangu|"
    r"dalali\s?\d+\s?%|brokerage\s?\d+\s?%|\bwholesale\b|\bretail\b|"
    r"we\s(sell|supply|offer|provide|deliver|install|have|stock|import)\b|"
    r"our\s(shop|company|customers|products?|services?)|"
    r"in\s?stock|available\s?in\s?stock|order\s?now|free\s?delivery|"
    r"delivery\s?(bure|countrywide|popote)|warrant(y|ies)|dhamana|"
    r"\bvat\b|\befd\b|\btin\b|per\s?piece|kwa\s?kipande|kila\s?kimoja)", re.I)

# First person SINGULAR ownership, and used-item apology. A person, not a shop.
_PRIVATE_TALK = re.compile(
    r"(ni\s?ya\s?kwangu|ni\s?yangu\s?mwenyewe|yangu\s?mwenyewe|mtu\s?binafsi|"
    r"nimeitunza|nmeitunza|imetunzwa|limetumika|imetumika|zimetumika|"
    r"bado\s?(jipya|mpya|nzuri|lipo|iko|ipo|zipo)|kama\s?mpya|kama\s?jipya|"
    r"haina\s?tatizo|haina\s?shida|good\s?condition|hali\s?nzuri|"
    r"sina\s?matumizi|ruksa\s?kuja\s?na\s?fundi|"
    r"naomba|bei\s?ya\s?haraka|wahi\s?chap)", re.I)

# Somebody asking FOR work, as against a trade advertising its services.
_JOB_SEEKER = re.compile(
    r"(looking\s?for\s?(a\s?)?job|naomba\s?kazi|nahitaji\s?kazi|nitafute\s?kazi|"
    r"job\s?opport\w*|seeking\s?employment|my\s?cv|natafuta\s?kazi)", re.I)

# A job advert. The attribute keys are site-enforced and were 100% reliable.
_JOB_ATTRS = ("Application deadline", "Salary Range (Tsh)", "Salary Range",
              "Job level", "Business/Employer name")
_JOB_TALK = re.compile(
    r"(send\s?your\s?cv|sent\s?your\s?cvs?|email\s?(your\s?)?cv|cv\s?to\b|"
    r"\bapply\b|application\s?deadline|vacanc(y|ies)|nafasi\s?za?\s?kazi|"
    r"\bajira\b|recruitment|job\s?level|\bjob\s?in\b|"
    # An advert SEEKING A PERSON. "We are looking for a Receptionist" is a
    # vacancy, and "we are" alone had been reading as trade wording — which put
    # 46 job adverts into the SME upload before this was caught.
    r"(we\s?are|tunahitaji|tunatafuta)\s?(currently\s?)?(looking|seeking|in\s?need|hiring)|"
    r"looking\s?for\s?(a|an|\d+)?\s?[\w\s]{0,24}\bto\s?join\b|join\s?our\s?team|"
    r"\b(needed|required|wanted|hiring)\b\s*$|"
    r"^[\w\s/&-]{0,40}\b(needed|required|wanted)\b)", re.I | re.M)


def is_job_advert(f: dict) -> bool:
    """A vacancy or a job seeker — neither is a borrower.

    The body overrides the form. A craftsman advertising on the Jobs form
    ("tunafanya dizaini zote" — we do all designs, with the employer field
    filled in as "Fundi") is a business selling its services, and the same form
    also carries people asking for work. Both were in the reviewed sample.
    """
    blob = f"{f.get('title','')} {f.get('description','')}"
    if _JOB_SEEKER.search(blob):
        return True
    on_job_form = any(k in (f.get("attributes") or {}) for k in _JOB_ATTRS)
    if on_job_form and _BUSINESS_TALK.search(blob):
        return False                      # a trade advertising itself, not a vacancy
    return bool(on_job_form or _JOB_TALK.search(blob))


# ── 5. price ─────────────────────────────────────────────────────────────────

# Below this the figure is a placeholder, not a price: adverts carry "TZS 1"
# and "TZS 32" (meaning 32 million, typed lazily). Treat as unknown.
PRICE_UNKNOWN_BELOW = 1_000

# The floor at which each asset is worth securing a loan against, in TZS.
# These are the reviewers' bands, which agreed closely with each other.
FLOORS = {
    "motorcycle": 900_000,     # a real bodaboda is 1.0M-2.5M
    "big_bike": 5_000_000,     # 600cc and up
    "bajaji": 2_500_000,
    "car": 4_000_000,
    "truck": 15_000_000,
}
# A motorcycle advertised above this is a typo, not a superbike — accept the
# asset, distrust the figure, and let the call centre confirm.
IMPLAUSIBLE = {"motorcycle": 4_500_000, "bajaji": 8_000_000}

# How old an advert may be and still be worth a call. Kupatana never expires a
# listing, so the corpus reaches back to 2018 and 4,254 of the adverts held were
# posted in 2022 — ringing somebody about a motorcycle they sold four years ago
# wastes the call and annoys the person.
#
# The two products age differently, so they get different floors. An LBF lead
# is about ONE SPECIFIC VEHICLE: once it is sold the lead is worthless, so the
# window is short. An SME lead is about a GOING CONCERN — a hardware shop that
# advertised stock two years ago is very likely still trading, and the pitch is
# working capital rather than that particular item.
STALE_AFTER_DAYS = 548           # 18 months — a vehicle, and the default
STALE_AFTER_DAYS_BUSINESS = 1095  # 3 years — a business outlives its advert


def advert_age_days(f: dict) -> int | None:
    """Days since the advert was posted, or None when the date is unreadable."""
    posted = (f.get("posted") or "").strip()
    if not posted:
        return None
    try:
        d = date(int(posted[6:10]), int(posted[3:5]), int(posted[0:2]))
    except (ValueError, IndexError):
        return None
    return (date.today() - d).days


_BIG_BIKE = re.compile(r"\b([6-9]\d{2}|1\d{3})\s?cc\b", re.I)
_BAJAJI = re.compile(r"\b(bajaji|bajaj|three\s?wheel|tuk\s?tuk|\bking\b)\b", re.I)
_TRUCK = re.compile(r"\b(canter|lori|truck|tipper|fuso|hino|dyna|coaster|bus)\b", re.I)
# Anything on two or three wheels. Spelt loosely on purpose: these are the
# forms real sellers type, and under a car-only LBF a missed spelling is a
# motorcycle owner reaching the call centre.
_BIKE = re.compile(
    r"\b(pikipiki|pikipik|pkpk|pikpk|pikpiki|piki|boda|motor\s?bike|motorbike|motorcycle|"
    r"motobike|scooter|skuta|boxer|boxre|boxar|boexr|boxa|tvs|haojue|fekon|"
    r"sanlg|jincheng|sky\s?go|vario|pulsar|click|kliki|guta|baiskeli|"
    r"bicycle|electric\s?bike)\b|\btvs\d", re.I)


def vehicle_kind(title: str, description: str = "", attributes: dict | None = None) -> str:
    """What sort of vehicle this is. Reads the description and the attributes as
    well as the title, because the title often just says "Boxer 2021" while the
    make sits in an attribute - the same hole that let a Caterpillar through
    is_vehicle when that only read the title.

    Ambiguity resolves AWAY from "car": LBF is secured on a car, so a listing
    that mentions a motorcycle anywhere must not be handed over as one.
    """
    t = " ".join([title or "", description or "",
                  " ".join(str(v) for v in (attributes or {}).values())])
    if _TRUCK.search(t):
        return "truck"
    if _BAJAJI.search(t):
        return "bajaji"
    if _BIG_BIKE.search(t):
        return "big_bike"
    if _BIKE.search(t) or _CC_RE.search(t):
        return "motorcycle"
    return "car"


# ── 6. the verdict ───────────────────────────────────────────────────────────

def classify(f: dict, index: SellerIndex, crawl_product: str = "") -> tuple[str, str, str]:
    """Return (product, score, reason).

    product is LBF, SME or NEITHER — derived from the advert, not from the
    crawl that found it, because the crawl label was wrong in both directions
    on roughly one advert in eight.
    """
    title = f.get("title", "") or ""
    desc = f.get("description", "") or ""
    name = f.get("seller_name", "") or ""
    phone = f.get("phone", "") or ""
    blob = f"{title} {desc}"
    price = f.get("price_tzs", 0) or 0
    if price < PRICE_UNKNOWN_BELOW:
        price = 0

    if not phone:
        return "NEITHER", "Cold", "no phone number — nobody to call"

    # The poster typed their own name into the title: a junk record.
    if title and name and title.strip().lower().startswith(name.strip().lower().rstrip(".")[:12].lower()) \
            and len(title) < 30 and not desc:
        return "NEITHER", "Cold", "title is the seller's own name — empty listing"

    if is_job_advert(f):
        return "NEITHER", "Cold", "job advert — a recruiter's inbox, not a borrower"

    if _WANTED_AD.search(blob) and not _BUSINESS_TALK.search(blob):
        return "NEITHER", "Cold", "a wanted advert — this person is buying, not selling"

    # An advert has to be recent enough to be worth acting on. The floor that
    # applies depends on what is being sold, so it is checked inside each
    # branch below; this is only the outer bound that nothing survives.
    age = advert_age_days(f)
    if age is not None and age > max(STALE_AFTER_DAYS, STALE_AFTER_DAYS_BUSINESS):
        return "NEITHER", "Cold", \
            f"advert is {age // 365} year(s) old — posted {f.get('posted','')}"

    business_talk = bool(_BUSINESS_TALK.search(blob))
    private_talk = bool(_PRIVATE_TALK.search(blob))
    business_name = name_is_business(name)
    repeat = index.count(phone)

    # ---- LBF: an individual who owns a whole, road-going vehicle ----
    if is_vehicle(title, desc, f.get("attributes")):
        kind = vehicle_kind(title, desc, f.get("attributes"))

        # LBF is a loan secured on a CAR. A motorcycle, a bajaji, a big bike or
        # a lorry is not collateral this product takes, whatever else the advert
        # has going for it. Confirmed by the user on 2026-09-15 after 1,157
        # motorcycle owners reached the LBF call-centre sheet: "they should
        # NEVER EVER put data for people with motorcycle at all in LBF".
        if kind != "car":
            return "NEITHER", "Cold",                 f"a {kind.replace('_', ' ')} - LBF is secured on a car only"

        floor = FLOORS[kind]

        # The lead IS this vehicle; once it is sold there is nothing to secure.
        if age is not None and age > STALE_AFTER_DAYS:
            return "NEITHER", "Cold", \
                f"vehicle advertised {age // 30} months ago — probably long sold"

        if index.is_vehicle_dealer(phone):
            n = index.vehicle_count(phone)
            return "NEITHER", "Cold", \
                f"{n} vehicles from this number — a dealer, not the owner"
        if business_name:
            return "NEITHER", "Cold", f"seller {name!r} is a trading name, not an owner"
        if repeat >= SellerIndex.TRADER_ADVERTS:
            return "NEITHER", "Cold", f"{repeat} adverts from this number — a trader"

        if price and price < floor:
            return "NEITHER", "Cold", \
                f"TZS {price:,} is below the {kind.replace('_',' ')} floor of TZS {floor:,}"

        papers = bool(_HAS_PAPERS.search(blob))
        bits = []
        if papers:
            bits.append("papers stated")
        if private_talk:
            bits.append("owner's own words")
        if price:
            bits.append(f"TZS {price:,}")

        if price and (papers or private_talk):
            score = "Hot"
        elif price and price >= floor * 1.5:
            score = "Hot"
        elif price or papers:
            score = "Warm"
        else:
            score = "Warm"
        # A figure far outside the band is a typo; keep the lead, drop the confidence.
        cap = IMPLAUSIBLE.get(kind)
        if cap and price > cap:
            score = "Warm"
            bits.append("price looks mistyped")
        return "LBF", score, f"private {kind.replace('_',' ')}, " + ", ".join(bits or ["no detail"])

    # ---- SME: somebody running an ongoing business ----
    # A vehicle dealer is a trader, but not a working-capital prospect: the call
    # centre would be ringing a car yard about a shop loan. Their non-vehicle
    # adverts must not slip back in through the repeat-advert signal.
    if index.is_vehicle_dealer(phone):
        return "NEITHER", "Cold", \
            f"{index.vehicle_count(phone)} vehicles from this number — a vehicle dealer"

    signals = []
    if business_name:
        signals.append("trading name")
    if business_talk:
        signals.append("trade wording")
    if repeat >= SellerIndex.TRADER_ADVERTS:
        signals.append(f"{repeat} adverts from this number")
    if _NOT_ROAD_GOING.search(blob) and price >= 5_000_000:
        signals.append("business-grade plant")
    # Letting terms are the site's own field, and mean a property being RENTED
    # OUT rather than sold once — a landlord with recurring income.
    if (f.get("attributes") or {}).get("Terms") and repeat >= 2:
        signals.append("letting terms on repeat listings — a landlord")

    if signals:
        # Two independent signals is a business; one is worth a call but not a promise.
        score = "Hot" if len(signals) >= 2 else "Warm"
        return "SME", score, "; ".join(signals)

    if private_talk:
        return "NEITHER", "Cold", "one-off private sale in the seller's own words"
    if is_part(blob):
        return "NEITHER", "Cold", "a part or accessory, not an asset or a business"
    return "NEITHER", "Cold", "reads as a one-off private sale"


# ── what was tested and rejected ─────────────────────────────────────────────
#
# Do not re-add these; each was checked against the 300 reviewed adverts and
# each cuts both ways:
#
#   category / sub-category  wrong often enough to invert the answer
#   the crawl's LBF|SME label wrong on about one advert in eight
#   ALL CAPS                 used by dealers and private sellers alike
#   emoji                    tracks marketing effort, not who is selling
#   "mpya" / "brand new"     on private furniture and shop stock equally
#   description length       several of the best LBF leads have none at all
#   location                 40 of 50 adverts say "Dar es Salaam"
#   price alone              a job advert carried "TZS 10,000,000"; the best
#                            SME lead in one batch was priced at TZS 600
#   "inauzwa" / "nauzwa"     ("it is being sold") neutral, used by both
#   "member since"           everybody has been a member for years
#   attributes on property   "565 acreas" for a two-bedroom flat; "Mileage" is
#                            sometimes the literal string "null"
