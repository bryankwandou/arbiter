"""Test multi-venue: normalisasi, parsing Kalshi, cross-venue discrepancy."""

from __future__ import annotations

from core.edge.cross_venue import find_cross_venue_signals
from core.venues.base import VenueQuote, normalize_question
from core.venues.kalshi import parse_kalshi_market


def test_normalize_question_strips_noise():
    a = normalize_question("Will Donald Trump win the 2028 election?")
    b = normalize_question("donald trump win 2028 election")
    assert a == b


def test_parse_kalshi_political():
    q = parse_kalshi_market({"ticker": "PREZ-28", "title": "Will X win the presidential election?",
                             "yes_ask": 47, "liquidity": 1000})
    assert q is not None
    assert q.venue == "kalshi"
    assert abs(q.yes_price - 0.47) < 1e-9


def test_parse_kalshi_rejects_nonpolitical():
    assert parse_kalshi_market({"ticker": "X", "title": "Weather tomorrow", "yes_ask": 50}) is None


def test_cross_venue_detects_discrepancy():
    quotes = [
        VenueQuote(venue="polymarket", market_id="p1",
                   question="Will Trump win the 2028 election?", yes_price=0.55),
        VenueQuote(venue="manifold", market_id="m1",
                   question="Will Trump win 2028 election?", yes_price=0.45),
    ]
    sigs = find_cross_venue_signals(quotes, match_threshold=0.6, min_discrepancy=0.05)
    assert len(sigs) == 1
    assert sigs[0].venue_cheap == "manifold"
    assert abs(sigs[0].discrepancy - 0.10) < 1e-9


def test_cross_venue_ignores_same_venue_and_small_gap():
    quotes = [
        VenueQuote(venue="polymarket", market_id="a", question="Same event happens?", yes_price=0.50),
        VenueQuote(venue="polymarket", market_id="b", question="Same event happens?", yes_price=0.30),
        VenueQuote(venue="manifold", market_id="c", question="Same event happens?", yes_price=0.51),
    ]
    # poly-vs-poly diabaikan; semua pasangan cross-venue gap < min (a-c=0.01) KECUALI
    # b-c=0.21 yang valid -> harus tepat 1 sinyal (membuktikan same-venue di-skip).
    sigs = find_cross_venue_signals(quotes, match_threshold=0.6, min_discrepancy=0.05)
    assert len(sigs) == 1
    assert {sigs[0].venue_cheap, sigs[0].venue_expensive} == {"polymarket", "manifold"}
