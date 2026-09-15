"""Regression tests for the qualifying rules.

The rules in qualify.py were derived by having 300 real adverts read and
scored. That reading is not repeatable on demand, so the cases it settled are
pinned here: each test is a judgement somebody actually made, with the advert
wording that decided it. If a rule change breaks one of these, the change is
undoing a decision rather than refining it.

Run:  python -m pytest scraper/test_qualify.py -q
"""
from __future__ import annotations

import pytest

from .qualify import (SellerIndex, classify, is_part, is_vehicle,
                      name_is_business, vehicle_kind)


def advert(**kw) -> dict:
    base = {"title": "", "description": "", "seller_name": "Juma M.",
            "phone": "255712345678", "price_tzs": 0, "attributes": {},
            "top_category": "", "sub_category": "", "member_since": 2020}
    base.update(kw)
    return base


def lone_seller() -> SellerIndex:
    """An index in which our seller has posted nothing else."""
    return SellerIndex()


# ── the seller index: a dealer posts again and again ─────────────────────────

def test_two_different_vehicles_is_a_dealer():
    idx = SellerIndex()
    for t in ("Toyota Alphard", "Nissan Dualis"):
        idx.add("255753975454", t, True)
    assert idx.is_vehicle_dealer("255753975454")


def test_same_bike_relisted_is_not_a_dealer():
    """89 of 199 two-vehicle sellers were one owner re-posting: "HILUX VIGO"
    and "Hilux vigo" are one pickup, and an exact-match check called them two."""
    idx = SellerIndex()
    idx.add("255714515558", "HILUX VIGO", True)
    idx.add("255714515558", "Hilux vigo", True)
    assert not idx.is_vehicle_dealer("255714515558")
    idx2 = SellerIndex()
    idx2.add("255676141530", "isuzu tipper 250", True)
    idx2.add("255676141530", "isuzu tipper", True)
    assert not idx2.is_vehicle_dealer("255676141530")


def test_dealer_stock_is_never_an_lbf_lead():
    idx = SellerIndex()
    for t in ("Toyota Wish", "Subaru Forester", "Toyota Alphard"):
        idx.add("255753975454", t, True)
    verdict, score, reason = classify(
        advert(title="Toyota Wish", price_tzs=15_000_000, phone="255753975454"), idx)
    assert verdict == "NEITHER" and score == "Cold"
    assert "dealer" in reason


def test_a_vehicle_dealers_other_goods_are_not_sme_either():
    """A car yard is a trader, but ringing them about a shop loan is a waste."""
    idx = SellerIndex()
    for t in ("Toyota Wish", "Subaru Forester"):
        idx.add("255753975454", t, True)
    for t in ("Office chair", "Desk fan", "Kabati", "Sofa", "Carpet"):
        idx.add("255753975454", t, False)
    verdict, _, _ = classify(
        advert(title="Office chair", price_tzs=90_000, phone="255753975454"), idx)
    assert verdict == "NEITHER"


# ── LBF: an individual who owns a whole vehicle ──────────────────────────────

def test_a_motorcycle_is_never_an_lbf_lead():
    """This test used to assert the opposite - that a TZS 1.75M motorcycle was
    the core LBF book. The user overruled it on 2026-09-15, after 1,157
    motorcycle owners had reached the LBF call-centre sheet: LBF is secured on
    a car, and "they should NEVER EVER put data for people with motorcycle at
    all in LBF". The advert below is otherwise perfect - priced, documented,
    a private seller - so it is exactly the case the rule has to refuse."""
    verdict, _score, reason = classify(advert(
        title="TVS CC 125 MPYA KABISA KARIBU", price_tzs=1_750_000,
        description="pkpk haina shida full documents"), lone_seller())
    assert verdict == "NEITHER"
    assert "car only" in reason


def test_owners_own_words_make_it_hot():
    """The owner's own words are still what makes a car Hot - the signal did not
    change, only the collateral. (This read "Bajaj Pulsar 180" until LBF became
    car-only; a bajaji is refused now however well the advert reads.)"""
    verdict, score, reason = classify(advert(
        title="Toyota Premio 2007", price_tzs=13_200_000,
        description="ni yakwangu mm mwenyewe, nmeitunza sana"), lone_seller())
    assert verdict == "LBF" and score == "Hot"


def test_a_bajaji_is_never_an_lbf_lead():
    verdict, _s, reason = classify(advert(
        title="Bajaj Pulsar 180", price_tzs=3_200_000,
        description="ni yakwangu mm mwenyewe, nmeitunza sana"), lone_seller())
    assert verdict == "NEITHER" and "car only" in reason


def test_a_bicycle_is_not_a_vehicle():
    verdict, _, _ = classify(advert(title="Bicycle", price_tzs=40_000), lone_seller())
    assert verdict == "NEITHER"


def test_a_spare_part_is_not_a_vehicle():
    assert is_part("Mitsubishi 4D32 Engine ya gari")
    verdict, _, _ = classify(advert(
        title="Smart Battery charger", price_tzs=28_000,
        description="Chaji betri ya gari lako"), lone_seller())
    assert verdict == "NEITHER"


def test_car_charger_head_noun_wins():
    """"CAR CHARGER" is a charger; the vehicle word is only a modifier."""
    assert not is_vehicle("CAR CHARGER")


def test_engine_untouched_is_a_whole_motorcycle():
    """"ENGINE HAIJAGUSWA" boasts the engine is untouched — it is a whole bike.
    Blacklisting the bare word "engine" threw away good motorcycles."""
    assert is_vehicle("TVS CC 125 ENGINE HAIJAGUSWA")
    assert not is_vehicle("Injini ya Toyota Wish")


def test_carport_is_not_a_car():
    assert not is_vehicle("Car shade, tent car")


def test_generator_is_not_road_going():
    assert not is_vehicle("GENERATOR ESMA 330 KVA")


def test_motorcycle_below_the_floor_is_rejected():
    verdict, _, reason = classify(advert(
        title="Baik note shefta", price_tzs=380_000), lone_seller())
    assert verdict == "NEITHER"


def test_vehicle_kind_reads_the_title():
    assert vehicle_kind("Bajaj used TVS King") == "bajaji"
    assert vehicle_kind("Pikipiki BMW 1200cc") == "big_bike"
    assert vehicle_kind("Mitsubishi Canter 4d33") == "truck"
    assert vehicle_kind("Toyota Mark X") == "car"


# ── SME: somebody running an ongoing business ────────────────────────────────

def test_first_person_plural_is_a_business():
    """The verb prefix carries the signal: tunauza (we sell) vs nauza (I sell)."""
    verdict, _, _ = classify(advert(
        title="Kontena 20ft", description="Tunauza kontena za aina zote",
        price_tzs=5_000_000), lone_seller())
    assert verdict == "SME"


def test_first_person_singular_one_item_is_not_a_business():
    verdict, _, _ = classify(advert(
        title="Kochi la watu wawili", price_tzs=180_000,
        description="nauza kochi langu, bado lipo kwenye good condition"), lone_seller())
    assert verdict == "NEITHER"


def test_trading_name_is_a_business():
    assert name_is_business("POWERHOUSE INTERNATIONAL")
    assert name_is_business("Pikipikiusedstore")
    assert name_is_business("Dalalitz G.")
    assert name_is_business("MSNesTores™️")
    assert name_is_business("407010")


def test_a_personal_name_is_not_a_business():
    for n in ("Haji a.", "Donny M.", "Kelvin M. U.", "Joseph", "Juma"):
        assert not name_is_business(n), n


def test_job_advert_is_nobody_to_call():
    verdict, _, reason = classify(advert(
        title="Sales Representative wanted",
        attributes={"Application deadline": "30.09.2026",
                    "Salary Range (Tsh)": "500,000"}), lone_seller())
    assert verdict == "NEITHER" and "job" in reason.lower()


def test_a_job_seeker_is_nobody_to_call():
    verdict, _, _ = classify(advert(
        title="workshop", description="am currently looking for job opportunty"),
        lone_seller())
    assert verdict == "NEITHER"


@pytest.mark.parametrize("title,desc,seller", [
    ("NOC ENGINEER",
     "On behalf of our Client, we are looking for a NOC ENGINEER to oversee our "
     "telecommunication Industry", "Blue R."),
    ("CUSTOMER CARE ASSISTANT NEEDED",
     "We are looking for a female customer care representative to join our team. "
     "We are based In Dar es salaam", "Almasishop"),
    ("Chef required",
     "We are looking for Tanzanian chef with great knowledge", "+255623092637"),
    ("Receptionist",
     "We are looking for a Receptionist. Email CV to: iqtechtz@gmail.com", "IQ Tech Ltd"),
])
def test_a_vacancy_is_not_a_business_even_without_the_jobs_form(title, desc, seller):
    """These four reached the SME upload set before the rule was tightened: the
    company IS a business, but the advert offers a job, so the number answers to
    an HR inbox, not to somebody who wants working capital. "We are looking
    for…" had been matching the trade-wording rule through the bare "we are"."""
    verdict, _, reason = classify(
        advert(title=title, description=desc, seller_name=seller), lone_seller())
    assert verdict == "NEITHER", f"{title} -> {reason}"


@pytest.mark.parametrize("title,desc,seller", [
    ("Kontena 20ft", "Tunauza kontena za aina zote", "Juma M."),
    ("Balcony za kisasa", "Balcon zakisasa tunafanya dizaini zote, wasiliana nasi",
     "Bidhaa b. z."),
    ("Generator 330KVA", "We supply generators, brand new with warranty",
     "POWERHOUSE INTERNATIONAL"),
])
def test_the_hiring_rule_does_not_swallow_real_businesses(title, desc, seller):
    verdict, _, _ = classify(
        advert(title=title, description=desc, seller_name=seller, price_tzs=500_000),
        lone_seller())
    assert verdict == "SME"


def test_a_trade_advertising_itself_on_the_jobs_form_is_a_business():
    """A craftsman filed under Jobs with "we do all designs" is selling a
    service, not offering a vacancy — the body overrides the form."""
    verdict, _, _ = classify(advert(
        title="Fundi wa balcony", description="Balcon zakisasa tunafanya dizaini zote",
        attributes={"Business/Employer name": "Fundi"}), lone_seller())
    assert verdict == "SME"


# ── what the first audit of a live upload set caught ─────────────────────────

@pytest.mark.parametrize("title,desc", [
    ("Massey furguson", "massey ferguson small"),
    ("Kubota tractor", ""),
    ("CAT 950H", "Imported from Germany"),
    ("JCB 3CX", "backhoe loader REG Number: DHN"),
    ("Caterpillar Ex 6088", "wheel loader"),
])
def test_farm_and_construction_plant_is_not_a_logbook_asset(title, desc):
    """13 of 17 wrongly-selected LBF leads in the first audit were plant sold
    under a brand name alone — an advert reading "Massey furguson" never says
    the word tractor, so the make has to be matched, not just the noun."""
    verdict, _, _ = classify(
        advert(title=title, description=desc, price_tzs=48_000_000), lone_seller())
    assert verdict != "LBF"


@pytest.mark.parametrize("title,desc", [
    ("Catapiller Olympian GEPX30-1", "Nauza generator yangu Iko kahama"),
    ("Zoomlion RK704", "Trekta ya zoomlion yenye 70hp, 4WD na compressor"),
    ("FORD 4610 +255699877202", "Tractor ni used kutoka canada"),
    ("New Holland FIAT 80-66S (4WD)", "Trekta nzima na inafanya kazi"),
    ("used farm yractor", "imported from Uk"),
    ("Massey Furgoson Tractor", "Tractors Type Massey Ferguson Make 3070"),
    ("Articulated Dump Truck CAT 730", "Articulated Dump Truck CATERPILLAR 730"),
])
def test_plant_hiding_behind_a_model_number(title, desc):
    """Six of 25 LBF leads in one upload set were tractors and generators whose
    TITLE names only a model — the description is what gives them away."""
    assert not is_vehicle(title, desc)


def test_plant_named_only_in_the_attributes():
    """"Hii Wheelie" says nothing; Make=Caterpillar, Model=Ex 6088 says it is a
    140-million-shilling wheel loader. It reached the LBF upload as "private
    car" because only the title and description were being read."""
    assert not is_vehicle("Hii Wheelie", "Imenyooka kabisa haina kipengele",
                          {"Make": "Caterpillar", "Model": "Ex 6088",
                           "Year": "1999", "Mileage": "150000 km",
                           "Transmission": "Automatic"})


def test_a_wanted_advert_is_not_a_seller():
    verdict, _, reason = classify(advert(
        title="piki piki", price_tzs=600_000,
        description="nataka piki piki yakuchaji mwenye nayo anicheki bei"), lone_seller())
    assert verdict == "NEITHER" and "buying" in reason


def test_a_four_year_old_advert_is_not_a_lead():
    verdict, _, reason = classify(advert(
        title="Boxer 150", price_tzs=1_500_000, posted="20.05.2022"), lone_seller())
    assert verdict == "NEITHER" and "old" in reason


def test_a_recent_advert_survives():
    from datetime import date, timedelta
    recent = (date.today() - timedelta(days=30)).strftime("%d.%m.%Y")
    verdict, _, _ = classify(advert(
        title="Toyota IST 2006", price_tzs=13_500_000, posted=recent,
        description="gari langu mwenyewe, full documents"), lone_seller())
    assert verdict == "LBF"


def test_a_redacted_email_is_not_a_trading_name():
    """Kupatana redacts some sellers to "[email protected]"; four reached the
    first upload set as businesses, one selling a single used office chair."""
    assert not name_is_business("[email protected]")
    verdict, _, _ = classify(advert(
        title="kiti cha ofisini kilichotumika", price_tzs=100_000,
        seller_name="[email protected]"), lone_seller())
    assert verdict == "NEITHER"


def test_no_phone_is_no_lead():
    verdict, _, reason = classify(advert(title="Toyota Wish", phone=""), lone_seller())
    assert verdict == "NEITHER" and "phone" in reason


@pytest.mark.parametrize("signals_desc,expected", [
    ("Tunauza kwa bei ya jumla", "Hot"),    # trading name + trade wording
    ("", "Warm"),                            # trading name alone
])
def test_two_signals_make_it_hot_one_makes_it_warm(signals_desc, expected):
    verdict, score, _ = classify(advert(
        title="Vifaa vya ujenzi", seller_name="Ajstore",
        description=signals_desc, price_tzs=200_000), lone_seller())
    assert verdict == "SME" and score == expected


# ── LBF is a car and nothing else ────────────────────────────────────────────
#
# Set on 2026-09-15. Ambiguity resolves AWAY from "car": a listing that mentions
# a motorcycle anywhere must not be handed to the call centre as one.

@pytest.mark.parametrize("title,desc", [
    ("Boxer 150", "pkpk full documents"),
    ("TVS King", "bajaji nzuri"),
    ("Pikipiki BMW 1200cc", "big bike"),
    ("Haojue scooter", "skuta safi"),
    ("Mitsubishi Canter 4d33", "lori zuri"),
    ("Sanlg three wheeler", "tuk tuk"),
])
def test_nothing_but_a_car_reaches_lbf(title, desc):
    verdict, _s, reason = classify(
        advert(title=title, description=desc, price_tzs=2_000_000), lone_seller())
    assert verdict != "LBF", reason


def test_a_motorcycle_named_only_in_the_description_is_still_refused():
    """The title often says nothing useful. Reading only it is how a Caterpillar
    once passed as a private car."""
    verdict, _s, _r = classify(advert(
        title="Nauza kwa bei nzuri 2021", price_tzs=1_800_000,
        description="pikipiki boxer mpya, mwenyewe"), lone_seller())
    assert verdict != "LBF"


def test_a_motorcycle_named_only_in_an_attribute_is_still_refused():
    verdict, _s, _r = classify(advert(
        title="Nauza 2021 nzuri sana", price_tzs=1_800_000,
        description="mwenyewe, haina shida",
        attributes={"Make": "Boxer", "Condition": "Used"}), lone_seller())
    assert verdict != "LBF"


def test_a_car_still_gets_through():
    verdict, _s, _r = classify(advert(
        title="Toyota Harrier 2010", price_tzs=22_000_000,
        description="gari langu mwenyewe, full documents"), lone_seller())
    assert verdict == "LBF"


# ── a yard touting in the title ──────────────────────────────────────────────

@pytest.mark.parametrize("title", [
    "Xhwary motorz@0792 405060",
    "Photidas 0753931379",
])
def test_a_title_that_is_a_name_and_a_number_is_a_tout(title):
    # The description has to read as a car, or is_vehicle never lets the advert
    # into the LBF branch and this rule is not the one that turns it away - the
    # first draft of this test passed for the wrong reason.
    verdict, _s, reason = classify(
        advert(title=title, description="Gari kali", price_tzs=9_000_000,
               attributes={"Make": "Toyota", "Model": "Vts old manual",
                           "Year": "2002", "Transmission": "Manual"}),
        lone_seller())
    assert verdict == "NEITHER" and "touting" in reason


@pytest.mark.parametrize("title", [
    "Subaru Legacy 2.5GT Limited 2010 Black",
    "Toyota RAV4 Limited 2008 Black",
    "Subaru Forester Limited AWD 2020 White",
])
def test_limited_is_a_trim_level_not_a_company(title):
    """The wider rule — any trading word in the title — was measured first and
    rejected. It caught these six private owners to catch one dealer."""
    verdict, _s, _r = classify(
        advert(title=title, description="gari langu mwenyewe, full documents",
               price_tzs=20_000_000), lone_seller())
    assert verdict == "LBF"
