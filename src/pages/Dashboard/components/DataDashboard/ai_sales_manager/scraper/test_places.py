"""Tests for turning a Google Places listing into an SME lead.

Run:  python -m pytest scraper/test_places.py -q
"""
from __future__ import annotations

import pytest

from .places import _KEY_FAULTS, estimate, to_lead


def place(**over) -> dict:
    base = {
        "id": "ChIJabc",
        "displayName": {"text": "Mwenge Hardware"},
        "nationalPhoneNumber": "0754 123 456",
        "formattedAddress": "Mwenge, Dar es Salaam",
        "primaryType": "hardware_store",
        "types": ["hardware_store", "store"],
        "googleMapsUri": "https://maps.google.com/?cid=1",
        "rating": 4.4,
        "userRatingCount": 25,
        "businessStatus": "OPERATIONAL",
    }
    base.update(over)
    return base


# ── who becomes a lead ───────────────────────────────────────────────────────

def test_a_listed_business_with_a_mobile_becomes_an_sme_lead():
    lead = to_lead(place(), "hardware shop", "Ilala, Dar es Salaam")
    assert lead["product"] == "SME"
    assert lead["phone"] == "255754123456"
    assert lead["phone_norm"] == "754123456"
    assert lead["business_name"] == "Mwenge Hardware"
    assert lead["location"] == "Ilala"
    assert lead["has_shopfront"] == "yes"


def test_a_landline_is_not_a_lead():
    """Places lists plenty of 022 numbers. A call centre dialling a landline
    reaches a switchboard, not the owner who would take the loan."""
    assert to_lead(place(nationalPhoneNumber="022 212 3456"), "pharmacy", "Arusha") is None


def test_a_listing_with_no_number_is_not_a_lead():
    p = place()
    del p["nationalPhoneNumber"]
    assert to_lead(p, "pharmacy", "Arusha") is None


def test_an_international_number_is_accepted_when_there_is_no_national_one():
    p = place()
    del p["nationalPhoneNumber"]
    p["internationalPhoneNumber"] = "+255 713 620 999"
    assert to_lead(p, "bakery", "Mbeya")["phone"] == "255713620999"


@pytest.mark.parametrize("status", ["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"])
def test_a_closed_business_is_not_a_lead(status):
    assert to_lead(place(businessStatus=status), "bar", "Mwanza") is None


# ── how warm ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("reviews,flag", [(0, "Cold"), (2, "Cold"), (3, "Warm"),
                                          (19, "Warm"), (20, "Hot"), (140, "Hot")])
def test_reviews_set_the_temperature(reviews, flag):
    """Reviews are the only activity signal Places gives us: a business people
    review is one that trades. The word goes in `score`, which is what the
    upload gate filters on - not in `flag`, which says whether it is new."""
    lead = to_lead(place(userRatingCount=reviews), "butchery", "Dodoma")
    assert lead["score"] == flag
    assert lead["flag"] == "NEW DATA"


def test_the_reason_says_where_the_lead_came_from():
    lead = to_lead(place(), "hardware shop", "Arusha")
    assert "Google Maps listing" in lead["reason"]
    assert "4.4" in lead["reason"]


def test_attribution_points_at_the_listing():
    assert to_lead(place(), "bakery", "Tanga")["source_url"].startswith("https://maps.google.com")


# ── the bill ─────────────────────────────────────────────────────────────────

def test_a_sweep_inside_the_free_allowance_costs_nothing():
    assert estimate(100, max_requests=300)["max_usd"] == 0.0


def test_the_full_national_sweep_is_quoted_at_the_enterprise_rate():
    """1,150 queries x 3 pages = 3,450 requests; 1,000 free, 2,450 at $35/1,000.
    Every request carries nationalPhoneNumber, which is an Enterprise field, so
    there is no cheaper tier available to this source."""
    e = estimate(1150)
    assert e["max_requests"] == 3450
    assert e["billable_requests"] == 2450
    assert e["max_usd"] == 85.75


def test_the_cap_lowers_the_quote():
    assert estimate(1150, max_requests=800)["max_requests"] == 800


# ── the three gates ──────────────────────────────────────────────────────────

def test_every_known_403_reason_names_a_fix():
    """A 403 from Google says which of the three gates shut; guessing between
    them cost a session, so each one carries the exact thing to change."""
    for reason, (problem, fix) in _KEY_FAULTS.items():
        assert problem and fix, reason


# ── who is not a prospect ────────────────────────────────────────────────────

def test_a_bank_is_not_a_lead():
    assert to_lead(place(primaryType="bank"), "wholesale shop", "Temeke") is None


@pytest.mark.parametrize("name", [
    "Sai Office Supplis - Head Office",
    "Spanish Tiles & Sanitary Ware Head Office",
    "Meela General supply-Arusha Head office",
    "Sachques Cosmetic headquarters",
])
def test_a_tanzanian_trader_calling_their_shop_a_head_office_is_still_a_lead(name):
    """A rule that refused these read as sensible and was wrong: it deleted four
    good SMEs out of the six listings it caught. A trader names their own shop
    a head office; exclusion goes by Google's type, never by a word in a name."""
    assert to_lead(place(displayName={"text": name}), "hardware shop", "Temeke") is not None


@pytest.mark.parametrize("name", [
    "Tigo Pesa Wakala Sky Beauty Salon", "Wakala Wa Tigo Pesa",
    "Airtel Shop Mlimani City", "SUNBANK MABATI ARUSHA",
])
def test_an_outlet_or_agent_is_still_a_lead(name):
    """A mobile money agent is precisely PCL's customer."""
    assert to_lead(place(displayName={"text": name}), "mobile money agent", "Ilala") is not None


# ── what the sheet says about a row ──────────────────────────────────────────
#
# The call-centre sheet has no score column, so the Comments text is the only
# thing telling an agent how solid a lead is. It must never be silent about
# weak evidence: "hardware store" alone read exactly like a full-strength lead.

def test_an_unreviewed_listing_says_so():
    p = place(userRatingCount=0)
    p.pop("rating", None)
    assert "not yet reviewed on Google" in to_lead(p, "hardware shop", "Ilala")["reason"]


def test_a_reviewed_listing_gives_the_rating_and_the_count():
    r = to_lead(place(rating=4.8, userRatingCount=83), "hardware shop", "Ilala")["reason"]
    assert "4.8" in r and "83 reviews" in r


def test_a_single_review_is_not_called_reviews():
    r = to_lead(place(rating=5.0, userRatingCount=1), "hardware shop", "Ilala")["reason"]
    assert "1 review;" in r and "1 reviews" not in r


def test_every_row_says_the_business_is_trading_with_a_published_number():
    """Why a lead with no reviews is still worth a call."""
    for n in (0, 1, 40):
        p = place(userRatingCount=n)
        if not n:
            p.pop("rating", None)
        assert "listed as trading" in to_lead(p, "bakery", "Temeke")["reason"]
