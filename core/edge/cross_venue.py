"""Cross-venue discrepancy detector (advanced).

Cocokkan market yang merepresentasikan event SAMA di venue berbeda
(mis. "Trump menang 2028" di Polymarket vs Manifold), lalu cari selisih
probabilitas YES. Selisih besar = sinyal: beli di venue murah.

⚠️  BUKAN riskless arbitrage: settlement, waktu resolve, dan definisi market
bisa beda antar-venue. Diperlakukan sebagai SINYAL/ANALITIK, bukan auto-exec.
"""

from __future__ import annotations

from difflib import SequenceMatcher

from pydantic import BaseModel

from core.venues.base import VenueQuote


class CrossVenueSignal(BaseModel):
    question_a: str
    question_b: str
    venue_cheap: str
    venue_expensive: str
    price_cheap: float
    price_expensive: float
    discrepancy: float          # selisih yes_price
    similarity: float           # skor kemiripan pertanyaan (0..1)

    def pretty(self) -> str:
        return (
            f"Δ={self.discrepancy:.3f}  buy YES@{self.venue_cheap}({self.price_cheap:.2f}) "
            f"vs {self.venue_expensive}({self.price_expensive:.2f})  "
            f"sim={self.similarity:.2f}  | {self.question_a[:50]!r}"
        )


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def find_cross_venue_signals(
    quotes: list[VenueQuote], *, match_threshold: float = 0.82, min_discrepancy: float = 0.05
) -> list[CrossVenueSignal]:
    """Bandingkan semua pasangan quote antar-venue berbeda."""
    signals: list[CrossVenueSignal] = []
    n = len(quotes)
    for i in range(n):
        for j in range(i + 1, n):
            qi, qj = quotes[i], quotes[j]
            if qi.venue == qj.venue:
                continue
            sim = _similarity(qi.norm_question, qj.norm_question)
            if sim < match_threshold:
                continue
            disc = abs(qi.yes_price - qj.yes_price)
            if disc < min_discrepancy:
                continue
            cheap, exp = (qi, qj) if qi.yes_price < qj.yes_price else (qj, qi)
            signals.append(CrossVenueSignal(
                question_a=qi.question, question_b=qj.question,
                venue_cheap=cheap.venue, venue_expensive=exp.venue,
                price_cheap=cheap.yes_price, price_expensive=exp.yes_price,
                discrepancy=disc, similarity=sim,
            ))
    signals.sort(key=lambda s: s.discrepancy, reverse=True)
    return signals
