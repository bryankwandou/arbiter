"""Strategi favorite-longshot bias.

Bias terdokumentasi di pasar taruhan/prediksi: longshot (peluang kecil)
SISTEMATIS overpriced, favorit sedikit underpriced. Strategi:
  * yes_price <= cutoff (longshot)  -> FADE YES (beli NO), model_prob NO tinggi
  * yes_price >= 1-cutoff (favorit) -> BACK YES, model_prob > price

`shrink_factor`: seberapa kuat kita yakin longshot overpriced. model_prob_yes
untuk longshot = price * shrink (< price). Edge muncul di sisi NO.
"""

from __future__ import annotations

from core.edge.strategies.base import Signal, SignalSide, Strategy
from core.venues.base import VenueQuote


class LongshotBiasStrategy(Strategy):
    name = "longshot_bias"

    def __init__(self, longshot_cutoff: float = 0.08, shrink_factor: float = 0.6):
        self.cutoff = longshot_cutoff
        self.shrink = shrink_factor

    def generate(self, quotes: list[VenueQuote]) -> list[Signal]:
        out: list[Signal] = []
        for q in quotes:
            p = q.yes_price
            if not (0 < p < 1):
                continue

            # Longshot overpriced -> FADE YES (beli NO @ 1-p)
            if p <= self.cutoff:
                model_yes = p * self.shrink          # model: YES lebih kecil dari harga
                no_price = 1.0 - p
                model_no = 1.0 - model_yes
                edge = model_no - no_price           # = p - model_yes
                if edge > 0:
                    out.append(Signal(
                        strategy=self.name, venue=q.venue, market_id=q.market_id,
                        question=q.question, side=SignalSide.FADE_YES,
                        entry_price=no_price, model_prob=model_no, edge=edge,
                        rationale=f"longshot p={p:.3f}<=cutoff, shrink={self.shrink}",
                    ))

            # Favorit underpriced -> BACK YES
            elif p >= 1.0 - self.cutoff:
                model_yes = p + (1.0 - p) * (1.0 - self.shrink)  # dorong ke atas sedikit
                edge = model_yes - p
                if edge > 0:
                    out.append(Signal(
                        strategy=self.name, venue=q.venue, market_id=q.market_id,
                        question=q.question, side=SignalSide.BACK_YES,
                        entry_price=p, model_prob=model_yes, edge=edge,
                        rationale=f"favorite p={p:.3f}>=1-cutoff",
                    ))
        return out
