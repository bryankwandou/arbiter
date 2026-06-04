"""Test FASE 1: parsing & storage (offline, tanpa internet)."""

from __future__ import annotations

from datetime import datetime, timezone

from core.data.clob_client import is_political, parse_market, parse_orderbook
from core.data.models import BookLevel, MarketSnapshot, OrderBook
from core.data.store import SnapshotStore

# --- fixtures: bentuk asli respons Gamma/CLOB (string JSON di beberapa field) ---
GAMMA_MARKET = {
    "id": "0x123",
    "question": "Will Candidate A win the 2028 US presidential election?",
    "slug": "candidate-a-2028",
    "clobTokenIds": '["111", "222"]',
    "outcomes": '["Yes", "No"]',
    "active": True,
    "closed": False,
    "volume": "150000.5",
    "liquidity": "8000",
    "tags": [{"label": "Politics"}, {"label": "US Election"}],
}
NON_POLITICAL = {
    "id": "0x999",
    "question": "Will it rain in NYC tomorrow?",
    "clobTokenIds": '["a","b"]',
    "outcomes": '["Yes","No"]',
    "tags": [{"label": "Weather"}],
}
CLOB_BOOK = {
    "bids": [{"price": "0.61", "size": "100"}, {"price": "0.60", "size": "250"}],
    "asks": [{"price": "0.63", "size": "80"}, {"price": "0.64", "size": "300"}],
}


def test_parse_market_handles_json_string_fields():
    m = parse_market(GAMMA_MARKET)
    assert m is not None
    assert m.id == "0x123"
    assert [t.token_id for t in m.tokens] == ["111", "222"]
    assert [t.outcome for t in m.tokens] == ["Yes", "No"]
    assert m.volume == 150000.5


def test_parse_market_rejects_no_tokens():
    assert parse_market({"id": "x", "question": "q"}) is None


def test_is_political_filter():
    assert is_political(parse_market(GAMMA_MARKET)) is True
    assert is_political(parse_market(NON_POLITICAL)) is False


def test_parse_orderbook_and_metrics():
    ob = parse_orderbook("111", CLOB_BOOK)
    assert ob.best_bid == 0.61
    assert ob.best_ask == 0.63
    assert abs(ob.mid - 0.62) < 1e-9
    assert abs(ob.spread - 0.02) < 1e-9
    assert ob.depth_usd("ask") == 0.63 * 80 + 0.64 * 300


def test_snapshot_store_roundtrip(tmp_path):
    store = SnapshotStore(base_dir=tmp_path)
    snap = MarketSnapshot(
        market_id="0x123",
        question="Will Candidate A win?",
        ts=datetime(2026, 6, 4, 12, 0, tzinfo=timezone.utc),
        books={
            "111": OrderBook(token_id="111", bids=[BookLevel(price=0.61, size=100)],
                             asks=[BookLevel(price=0.63, size=80)]),
        },
    )
    store.save(snap)
    loaded = list(store.iter_snapshots())
    assert len(loaded) == 1
    assert loaded[0].market_id == "0x123"
    assert loaded[0].implied_prob("111") == (0.61 + 0.63) / 2
    assert store.count() == 1
