"""Tests for reading a pasted Marketplace / group post.

Run:  python -m pytest scraper/test_paste_capture.py -q
"""
from __future__ import annotations

import pytest

from .paste_capture import (extract_location, extract_phones, extract_price,
                            parse_post, split_posts)


# ── phone ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("Piga 0754 123 456", ["255754123456"]),
    ("call +255 713 620 999", ["255713620999"]),
    ("0754123456", ["255754123456"]),
    ("255688772003", ["255688772003"]),
    ("whatsapp 0765-444-555 au 0713.620.111",
     ["255765444555", "255713620111"]),
])
def test_reads_a_number_however_it_is_typed(text, expected):
    assert extract_phones(text) == expected


def test_a_number_inside_a_longer_digit_run_is_not_a_phone():
    """The lesson from market.co.tz: its page carried
    `"latitude":-6.7837340673039135`, and a pattern without the digit guards
    read "0673039135" out of the middle of it and called it a seller."""
    assert extract_phones('"latitude":-6.7837340673039135') == []
    assert extract_phones('"longitude":39.222062571164464') == []
    assert extract_phones("order 120754123456789 shipped") == []


def test_the_platforms_own_switchboard_is_not_a_lead():
    assert extract_phones("contact +255748711238") == []


def test_a_landline_or_short_number_is_not_a_mobile():
    assert extract_phones("0222 123 456") == []      # Dar landline, not 6/7
    assert extract_phones("0754 123") == []


# ── price ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("Bei 13,500,000", 13_500_000),
    ("bei 1.75m", 1_750_000),
    ("35M", 35_000_000),
    ("15 mil", 15_000_000),
    ("TZS 850,000/=", 850_000),
    ("250000", 250_000),
    ("no price here", 0),
])
def test_price_in_the_shapes_people_type(text, expected):
    assert extract_price(text) == expected


def test_a_phone_number_is_never_read_as_a_price():
    """"0754123456" is ten digits and would otherwise price the car at
    754 million shillings."""
    assert extract_price("Toyota IST\n0754123456") == 0
    assert extract_price("bei 13,500,000 piga 0754123456") == 13_500_000


# ── location ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("Ipo Mwenge Dar es Salaam", "Mwenge"),
    ("gari lipo Arusha", "Arusha"),
    ("Ipo Dar", "Dar es Salaam"),
    ("Tupo Kariakoo", "Kariakoo"),
    ("no place named", ""),
])
def test_location(text, expected):
    assert extract_location(text) == expected


# ── posts ────────────────────────────────────────────────────────────────────

def test_posts_split_on_a_blank_line_or_a_rule():
    text = "post one\n0754123456\n\npost two\n0713620111\n---\npost three\n0765444555"
    assert len(split_posts(text)) == 3


def test_a_post_keeps_its_link_and_title():
    post = ("Toyota IST 2006 silver\nBei 13,500,000\nIpo Mwenge\n"
            "0754 123 456\nhttps://www.facebook.com/marketplace/item/123")
    f = parse_post(post, captured_by="asha", group="Magari Tanzania")
    assert f["phone"] == "255754123456"
    assert f["price_tzs"] == 13_500_000
    assert f["location"] == "Mwenge"
    assert f["title"].startswith("Toyota IST 2006")
    assert f["source_url"].endswith("/123")
    assert f["group"] == "Magari Tanzania"


def test_a_seller_name_is_taken_when_the_agent_types_one():
    f = parse_post("Seller: Juma Mwita\nBoxer 150\n0754123456")
    assert f["seller_name"] == "Juma Mwita"


def test_a_post_with_two_numbers_keeps_both():
    f = parse_post("Boxer 150\npiga 0754123456 au 0713620111")
    assert f["phone"] == "255754123456"
    assert f["extra_phones"] == ["255713620111"]
