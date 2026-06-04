"""Test strategi directional + sizing Kelly untuk sinyal."""

from __future__ import annotations

from core.edge.strategies.base import SignalSide
from core.edge.strategies.longshot_bias import LongshotBiasStrategy
from core.edge.strategies.mean_reversion import MeanReversionStrategy
from core.risk.limits import RiskManager
from core.venues.base import VenueQuote

RISK_CFG = {"max_per_trade_pct": 0.02, "max_per_market_pct": 0.05, "max_open_positions": 5,
            "min_orderbook_depth_usd": 1.0, "daily_loss_limit_pct": 0.10, "kelly_fraction": 0.25}


def q(price: float, mid: str = "m1") -> VenueQuote:
    return VenueQuote(venue="manifold", market_id=mid, question="Will X win?", yes_price=price)


def test_longshot_fades_overpriced_longshot():
    sigs = LongshotBiasStrategy(longshot_cutoff=0.08, shrink_factor=0.5).generate([q(0.05)])
    assert len(sigs) == 1
    assert sigs[0].side == SignalSide.FADE_YES
    assert sigs[0].edge > 0


def test_longshot_backs_favorite():
    sigs = LongshotBiasStrategy(longshot_cutoff=0.08, shrink_factor=0.5).generate([q(0.95)])
    assert len(sigs) == 1
    assert sigs[0].side == SignalSide.BACK_YES


def test_longshot_ignores_midrange():
    assert LongshotBiasStrategy().generate([q(0.50)]) == []


def test_mean_reversion_needs_history_then_fires():
    strat = MeanReversionStrategy(lookback=5, deviation_threshold=0.05)
    # bangun baseline ~0.50
    for _ in range(5):
        assert strat.generate([q(0.50)]) == []  # belum cukup / tak ada deviasi
    # lonjakan ke 0.70 -> fade
    sigs = strat.generate([q(0.70)])
    assert len(sigs) == 1
    assert sigs[0].side == SignalSide.FADE_YES


def test_size_signal_respects_kelly_and_caps():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    sig = LongshotBiasStrategy(longshot_cutoff=0.08, shrink_factor=0.5).generate([q(0.05)])[0]
    d = rm.size_signal(sig, "m1")
    if d.approved:
        # tak boleh melebihi per_trade cap 2% * 1000 = $20
        assert d.notional_usd <= 20.0 + 1e-6


def test_size_signal_blocked_by_killswitch():
    rm = RiskManager(RISK_CFG, bankroll_usd=1000)
    rm.killswitch.trip("test")
    sig = LongshotBiasStrategy().generate([q(0.95)])[0]
    assert rm.size_signal(sig, "m1").approved is False
