"""Test FASE 2: deteksi arbitrage + validasi sinyal."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.data.models import BookLevel, OrderBook
from core.edge.arbitrage import (
    ArbType,
    detect_binary_dutch_book,
    detect_mutually_exclusive,
)
from core.edge.signals import validate_opportunity


def book(ask_price: float, ask_size: float = 100.0) -> OrderBook:
    return OrderBook(
        token_id=f"t{ask_price}",
        bids=[BookLevel(price=ask_price - 0.02, size=ask_size)],
        asks=[BookLevel(price=ask_price, size=ask_size)],
    )


# --- binary dutch book ---
def test_binary_arb_detected_when_sum_below_one():
    opp = detect_binary_dutch_book(book(0.45, 80), book(0.50, 120))
    assert opp is not None
    assert opp.type == ArbType.BINARY_DUTCH_BOOK
    assert abs(opp.cost_per_set - 0.95) < 1e-9
    assert abs(opp.edge - 0.05) < 1e-9
    assert opp.executable_sets == 80  # leg tertipis


def test_binary_no_arb_when_sum_at_or_above_one():
    assert detect_binary_dutch_book(book(0.55), book(0.50)) is None  # sum 1.05
    assert detect_binary_dutch_book(book(0.50), book(0.50)) is None  # sum 1.00 (no edge)


def test_binary_arb_killed_by_costs():
    # sum 0.98 -> raw edge 0.02; biaya 0.03 -> tak ada arb
    assert detect_binary_dutch_book(book(0.49), book(0.49), cost=0.03) is None


# --- mutually exclusive set ---
def test_mutually_exclusive_arb_detected():
    outcomes = [
        ("a", "Cand A", book(0.30, 50)),
        ("b", "Cand B", book(0.30, 90)),
        ("c", "Cand C", book(0.30, 70)),
    ]  # sum 0.90 -> edge 0.10
    opp = detect_mutually_exclusive(outcomes)
    assert opp is not None
    assert abs(opp.edge - 0.10) < 1e-9
    assert opp.executable_sets == 50
    assert len(opp.legs) == 3


def test_mutually_exclusive_no_arb_when_overpriced():
    outcomes = [("a", "A", book(0.40)), ("b", "B", book(0.65))]  # sum 1.05
    assert detect_mutually_exclusive(outcomes) is None


def test_mutually_exclusive_needs_complete_set():
    empty = OrderBook(token_id="x")  # no asks
    assert detect_mutually_exclusive([("a", "A", book(0.30)), ("b", "B", empty)]) is None


# --- validation ---
def test_validation_passes_good_opportunity():
    opp = detect_mutually_exclusive(
        [("a", "A", book(0.30, 500)), ("b", "B", book(0.30, 500)), ("c", "C", book(0.30, 500))]
    )
    res = validate_opportunity(opp, min_edge_pct=0.05, min_notional_usd=50)
    assert res.passed, res.reasons


def test_validation_rejects_thin_liquidity():
    opp = detect_binary_dutch_book(book(0.45, 1), book(0.50, 1))  # notional ~0.95
    res = validate_opportunity(opp, min_notional_usd=50)
    assert not res.passed
    assert any("notional" in r for r in res.reasons)


def test_validation_rejects_near_resolution():
    opp = detect_binary_dutch_book(book(0.45, 500), book(0.50, 500))
    soon = datetime.now(timezone.utc) + timedelta(minutes=5)
    res = validate_opportunity(opp, min_notional_usd=1, end_date=soon, resolution_buffer_minutes=30)
    assert not res.passed
    assert any("resolve" in r for r in res.reasons)
