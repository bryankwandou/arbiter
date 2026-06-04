"""Test FASE 3: Kelly, kill-switch, dan hard limits."""

from __future__ import annotations

from core.data.models import BookLevel, OrderBook
from core.edge.arbitrage import detect_binary_dutch_book, detect_mutually_exclusive
from core.risk.killswitch import KillSwitch
from core.risk.kelly import fractional_kelly, kelly_fraction
from core.risk.limits import RiskManager

RISK_CFG = {
    "max_per_trade_pct": 0.02,
    "max_per_market_pct": 0.05,
    "max_open_positions": 5,
    "min_orderbook_depth_usd": 10.0,
    "daily_loss_limit_pct": 0.10,
}


def book(ask: float, size: float) -> OrderBook:
    return OrderBook(token_id=f"t{ask}", bids=[BookLevel(price=ask - 0.02, size=size)],
                     asks=[BookLevel(price=ask, size=size)])


# --- Kelly ---
def test_kelly_zero_when_no_edge():
    # harga 0.5, model juga 0.5 -> tak ada edge
    assert kelly_fraction(0.5, 0.5) == 0.0


def test_kelly_positive_with_edge():
    # model 0.6 menang, harga 0.5 -> ada edge, Kelly > 0
    assert kelly_fraction(0.6, 0.5) > 0


def test_fractional_kelly_respects_hard_cap():
    # edge sangat besar, tapi hard_cap 2% tidak boleh dilampaui
    f = fractional_kelly(0.99, 0.5, fraction=0.25, hard_cap=0.02)
    assert f <= 0.02


# --- KillSwitch ---
def test_killswitch_trips_on_daily_loss():
    ks = KillSwitch(daily_loss_limit_pct=0.10)
    ks.start_day(bankroll=1000)
    ks.record_pnl(-50)   # -5%
    assert not ks.tripped
    ks.record_pnl(-60)   # total -11% -> trip
    assert ks.tripped
    assert "daily loss" in ks.reason


def test_killswitch_trips_on_consecutive_errors():
    ks = KillSwitch(daily_loss_limit_pct=0.10, max_consecutive_errors=3)
    ks.record_error(); ks.record_error()
    assert not ks.tripped
    ks.record_error()
    assert ks.tripped
    ks.reset()
    assert not ks.tripped


def test_killswitch_success_resets_error_count():
    ks = KillSwitch(daily_loss_limit_pct=0.10, max_consecutive_errors=3)
    ks.record_error(); ks.record_error()
    ks.record_success()
    ks.record_error(); ks.record_error()
    assert not ks.tripped  # tidak pernah 3 beruntun


# --- RiskManager: caps tidak bisa ditembus ---
def test_sizing_capped_by_per_trade_limit():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    # arb murah & likuiditas besar -> harusnya dibatasi cap modal, bukan likuiditas
    opp = detect_mutually_exclusive(
        [("a", "A", book(0.30, 100000)), ("b", "B", book(0.30, 100000)),
         ("c", "C", book(0.30, 100000))]
    )
    d = rm.size_arbitrage(opp, market_id="m1")
    assert d.approved
    # per_trade cap = 2% * 1000 = $20 ; notional tidak boleh > itu
    assert d.notional_usd <= 20.0 + 1e-6
    assert any("cap modal" in r for r in d.reasons)


def test_sizing_blocked_by_killswitch():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    rm.killswitch.trip("test")
    opp = detect_binary_dutch_book(book(0.45, 1000), book(0.50, 1000))
    d = rm.size_arbitrage(opp, "m1")
    assert not d.approved
    assert any("kill-switch" in r for r in d.reasons)


def test_sizing_blocked_when_max_positions_reached():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    for i in range(5):
        rm.register_open(f"m{i}", 5.0)
    opp = detect_binary_dutch_book(book(0.45, 1000), book(0.50, 1000))
    d = rm.size_arbitrage(opp, "m_new")
    assert not d.approved
    assert any("max_open_positions" in r for r in d.reasons)


def test_per_market_cap_accumulates():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    # market cap = 5% * 1000 = $50. Buka $48 dulu.
    rm.register_open("m1", 48.0)
    opp = detect_mutually_exclusive(
        [("a", "A", book(0.30, 100000)), ("b", "B", book(0.30, 100000)),
         ("c", "C", book(0.30, 100000))]
    )
    d = rm.size_arbitrage(opp, "m1")
    # sisa ruang market hanya $2 -> di bawah liquidity gate $10 -> ditolak
    assert not d.approved
