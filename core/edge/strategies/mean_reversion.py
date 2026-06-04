"""Strategi mean-reversion (stale pricing / overreaction).

Hipotesis: setelah lonjakan harga jangka pendek tanpa berita fundamental,
harga cenderung kembali ke baseline. Butuh RIWAYAT harga (dari snapshot).

baseline = rata-rata `lookback` harga terakhir.
  current >> baseline (naik tajam)  -> FADE YES (harga turun balik)
  current << baseline (turun tajam) -> BACK YES (harga naik balik)
model_prob = baseline (estimasi "harga wajar").
"""

from __future__ import annotations

from core.edge.strategies.base import Signal, SignalSide, Strategy
from core.venues.base import VenueQuote


class MeanReversionStrategy(Strategy):
    name = "mean_reversion"

    def __init__(self, lookback: int = 10, deviation_threshold: float = 0.06):
        self.lookback = lookback
        self.threshold = deviation_threshold
        self._history: dict[str, list[float]] = {}

    def update_history(self, quotes: list[VenueQuote]) -> None:
        for q in quotes:
            hist = self._history.setdefault(q.market_id, [])
            hist.append(q.yes_price)
            if len(hist) > self.lookback * 3:
                del hist[0]

    def generate(self, quotes: list[VenueQuote]) -> list[Signal]:
        self.update_history(quotes)
        out: list[Signal] = []
        for q in quotes:
            hist = self._history.get(q.market_id, [])
            if len(hist) < self.lookback:
                continue  # baseline belum cukup data
            baseline = sum(hist[-self.lookback:]) / self.lookback
            cur = q.yes_price
            dev = cur - baseline
            if abs(dev) < self.threshold or not (0 < baseline < 1):
                continue

            if dev > 0:  # harga naik tajam -> FADE YES (beli NO)
                no_price = 1.0 - cur
                model_no = 1.0 - baseline
                edge = model_no - no_price
                side, entry, mp = SignalSide.FADE_YES, no_price, model_no
            else:        # harga turun tajam -> BACK YES
                edge = baseline - cur
                side, entry, mp = SignalSide.BACK_YES, cur, baseline

            if edge > 0:
                out.append(Signal(
                    strategy=self.name, venue=q.venue, market_id=q.market_id,
                    question=q.question, side=side, entry_price=entry,
                    model_prob=mp, edge=edge,
                    rationale=f"dev={dev:+.3f} vs baseline={baseline:.3f}",
                ))
        return out
