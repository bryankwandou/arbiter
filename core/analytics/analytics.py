"""Multi-analytics (dashboard backend).

Agregasi untuk dashboard: PnL per strategi, per venue, kurva ekuitas,
distribusi edge, dan kalibrasi (akurasi prediksi vs hasil).
Beroperasi pada JournalEntry — murni, mudah dites.
"""

from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel

from paper.journal import JournalEntry


class GroupStat(BaseModel):
    key: str
    n_trades: int
    total_pnl: float
    win_rate: float
    avg_pnl: float


def _aggregate(entries: list[JournalEntry], keyfn) -> list[GroupStat]:
    buckets: dict[str, list[JournalEntry]] = defaultdict(list)
    for e in entries:
        buckets[keyfn(e)].append(e)
    out = []
    for key, items in buckets.items():
        n = len(items)
        wins = sum(1 for e in items if e.locked_profit > 0)
        total = sum(e.locked_profit for e in items)
        out.append(GroupStat(key=key, n_trades=n, total_pnl=total,
                             win_rate=wins / n if n else 0.0, avg_pnl=total / n if n else 0.0))
    out.sort(key=lambda g: g.total_pnl, reverse=True)
    return out


def per_strategy(entries: list[JournalEntry]) -> list[GroupStat]:
    return _aggregate(entries, lambda e: e.strategy)


def per_venue(entries: list[JournalEntry]) -> list[GroupStat]:
    return _aggregate(entries, lambda e: e.venue)


def equity_series(entries: list[JournalEntry], starting: float = 0.0) -> list[float]:
    eq = [starting]
    for e in sorted(entries, key=lambda x: x.ts):
        eq.append(eq[-1] + e.locked_profit)
    return eq


def edge_distribution(values: list[float]) -> dict[str, float]:
    """Statistik distribusi (mis. edge atau pnl): min/median/max/mean."""
    if not values:
        return {"n": 0, "min": 0.0, "median": 0.0, "max": 0.0, "mean": 0.0}
    s = sorted(values)
    n = len(s)
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    return {"n": n, "min": s[0], "median": median, "max": s[-1], "mean": sum(s) / n}


def calibration_curve(
    predictions: list[tuple[float, bool]], bins: int = 10
) -> list[dict[str, float]]:
    """Kalibrasi: untuk tiap bin probabilitas, bandingkan prob prediksi rata-rata
    vs frekuensi aktual kejadian. predictions = list of (predicted_prob, terjadi?).
    Bot terkalibrasi baik: predicted ~= actual di tiap bin.
    """
    buckets: dict[int, list[tuple[float, bool]]] = defaultdict(list)
    for prob, outcome in predictions:
        idx = min(bins - 1, max(0, int(prob * bins)))
        buckets[idx].append((prob, outcome))
    curve = []
    for idx in sorted(buckets):
        items = buckets[idx]
        avg_pred = sum(p for p, _ in items) / len(items)
        actual = sum(1 for _, o in items if o) / len(items)
        curve.append({"bin": idx / bins, "predicted": avg_pred,
                      "actual": actual, "n": len(items)})
    return curve
