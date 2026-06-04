"""Abstraksi multi-venue (advanced).

Tiap venue (Polymarket, Manifold, Kalshi, ...) mengekspos `VenueQuote` yang
seragam: probabilitas YES + likuiditas + metadata. Ini memungkinkan:
  * analitik lintas-venue
  * cross-venue arbitrage (event sama, harga beda antar bursa)

Mekanisme tiap venue beda (CLOB vs CFMM), jadi kita unifikasi di level
PROBABILITAS, bukan orderbook. yes_price ~= biaya beli 1 share YES (~prob).
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel, Field


class VenueQuote(BaseModel):
    venue: str
    market_id: str
    question: str
    yes_price: float                 # ~prob YES (0..1); biaya beli YES
    liquidity: float = 0.0
    end_date: datetime | None = None
    url: str = ""
    has_orderbook: bool = False      # True utk CLOB (Polymarket/Kalshi), False utk CFMM (Manifold)

    @property
    def norm_question(self) -> str:
        return normalize_question(self.question)


def normalize_question(q: str) -> str:
    """Normalisasi untuk pencocokan lintas-venue: lowercase, buang tanda baca & kata umum."""
    q = q.lower()
    q = re.sub(r"[^a-z0-9 ]", " ", q)
    stop = {"will", "the", "a", "an", "be", "to", "in", "of", "by", "on", "is", "are"}
    tokens = [t for t in q.split() if t and t not in stop]
    return " ".join(tokens)


class Venue(ABC):
    """Interface venue read-only."""

    name: str = "base"

    @abstractmethod
    def fetch_political_quotes(self, limit: int = 100) -> list[VenueQuote]:
        ...
