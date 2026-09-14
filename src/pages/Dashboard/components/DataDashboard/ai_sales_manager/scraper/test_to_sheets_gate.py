"""Tests for the gate between the store and the call-centre sheets.

Run:  python -m pytest scraper/test_to_sheets_gate.py -q
"""
from __future__ import annotations

from .to_sheets import _verify


class FakeIndex:
    """The dealer index is checked before _verify, so it is never consulted here."""


def row(**over) -> dict:
    base = {"source": "google_places", "product": "SME", "score": "Warm",
            "reason": "Google Maps listing - hardware store", "raw_data": None,
            "offering": "hardware store, store", "seller_name": "",
            "location": "Arusha"}
    base.update(over)
    return base


# ── Google Places: nothing to re-read, because nothing was ever judged ───────

def test_a_places_listing_is_accepted_without_advert_text():
    """It was built by code from Google's structured fields. Requiring advert
    text here dropped all 141 of the first live sweep at the gate."""
    ok, score, reason, why = _verify(row(), FakeIndex())
    assert ok and score == "Warm" and why == ""


def test_a_places_listing_marked_anything_but_sme_is_refused():
    ok, _s, _r, why = _verify(row(product="LBF"), FakeIndex())
    assert not ok and "not SME" in why


def test_a_places_listing_stripped_of_every_identifying_field_is_refused():
    ok, _s, _r, why = _verify(row(offering="", seller_name="", location=""),
                              FakeIndex())
    assert not ok and "identify" in why


# ── anything with text is re-read, and text is required ─────────────────────

def test_a_classifieds_row_with_no_advert_kept_is_refused():
    """The store must never hand over a lead nobody can check."""
    ok, _s, _r, why = _verify(row(source="kupatana_vehicles", raw_data=""), FakeIndex())
    assert not ok and "cannot be re-read" in why


def test_a_pasted_post_is_refused_until_its_text_is_kept():
    ok, _s, _r, why = _verify(row(source="facebook_paste:Magari", raw_data=None),
                              FakeIndex())
    assert not ok and "cannot be re-read" in why
