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

def test_bodaboda_motorcycle_is_a_core_lbf_lead():
    """A TZS 1.75M motorcycle is the core book, not a small asset."""
    verdict, score, _ = classify(advert(
        title="TVS CC 125 MPYA KABISA KARIBU", price_tzs=1_750_000,
        description="pkpk haina shida full documents"), lone_seller())
    assert verdict == "LBF" and score == "Hot"


def test_owners_own_words_make_it_hot():
    verdict, score, reason = classify(advert(
        title="Bajaj Pulsar 180", price_tzs=3_200_000,
        description="ni yakwangu mm mwenyewe, nmeitunza sana"), lone_seller())
    assert verdict == "LBF" and score == "Hot"


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


def test_a_trade_advertising_itself_on_the_jobs_form_is_a_business():
    """A craftsman filed under Jobs with "we do all designs" is selling a
    service, not offering a vacancy — the body overrides the form."""
    verdict, _, _ = classify(advert(
        title="Fundi wa balcony", description="Balcon zakisasa tunafanya dizaini zote",
        attributes={"Business/Employer name": "Fundi"}), lone_seller())
    assert verdict == "SME"


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
