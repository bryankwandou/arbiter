"""Test analytics + dashboard HTML generation."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.analytics.analytics import (
    calibration_curve,
    edge_distribution,
    equity_series,
    per_strategy,
    per_venue,
)
from dashboard.html import build_dashboard
from paper.journal import JournalEntry, TradeJournal


def _entries():
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    return [
        JournalEntry(ts=base, market_id="a", desc="x", filled_sets=1, locked_profit=5.0,
                     fully_filled=True, strategy="arbitrage", venue="polymarket"),
        JournalEntry(ts=base + timedelta(hours=1), market_id="b", desc="y", filled_sets=1,
                     locked_profit=-2.0, fully_filled=True, strategy="longshot_bias", venue="manifold"),
        JournalEntry(ts=base + timedelta(hours=2), market_id="c", desc="z", filled_sets=1,
                     locked_profit=3.0, fully_filled=True, strategy="arbitrage", venue="polymarket"),
    ]


def test_per_strategy_aggregation():
    stats = per_strategy(_entries())
    arb = next(s for s in stats if s.key == "arbitrage")
    assert arb.n_trades == 2
    assert arb.total_pnl == 8.0


def test_per_venue_aggregation():
    stats = per_venue(_entries())
    assert {s.key for s in stats} == {"polymarket", "manifold"}


def test_equity_series_cumulative():
    eq = equity_series(_entries(), starting=100.0)
    assert eq[0] == 100.0
    assert eq[-1] == 100.0 + 6.0


def test_edge_distribution():
    d = edge_distribution([1.0, 2.0, 3.0])
    assert d["median"] == 2.0
    assert d["mean"] == 2.0


def test_calibration_curve():
    preds = [(0.1, False), (0.1, False), (0.9, True), (0.9, True)]
    curve = calibration_curve(preds, bins=10)
    assert len(curve) == 2
    low = next(c for c in curve if c["bin"] == 0.1)
    assert low["actual"] == 0.0


def test_dashboard_html_writes_file(tmp_path):
    journal = TradeJournal(path=tmp_path / "j.jsonl")
    for e in _entries():
        with journal.path.open("a", encoding="utf-8") as f:
            f.write(e.model_dump_json() + "\n")
    out = build_dashboard(journal, out=tmp_path / "dash.html")
    assert out.exists()
    txt = out.read_text(encoding="utf-8")
    assert "atlas-poly" in txt
    assert "Kurva Ekuitas" in txt
