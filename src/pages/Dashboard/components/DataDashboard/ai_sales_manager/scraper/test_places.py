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
    review is one that trades."""
    assert to_lead(place(userRatingCount=reviews), "butchery", "Dodoma")["flag"] == flag


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
