"""Adapter Manifold Markets -> VenueQuote.

API publik gratis (tanpa auth untuk read): https://api.manifold.markets/v0/markets
Manifold = CFMM (bukan CLOB), jadi `probability` langsung = harga YES implisit.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import structlog

from core.data.clob_client import POLITICS_KEYWORDS
from core.venues.base import Venue, VenueQuote

log = structlog.get_logger()

MANIFOLD_HOST = "https://api.manifold.markets"


def _is_political(question: str) -> bool:
    q = question.lower()
    return any(kw in q for kw in POLITICS_KEYWORDS)


class ManifoldVenue(Venue):
    name = "manifold"

    def __init__(self, host: str = MANIFOLD_HOST, timeout: float = 15.0):
        self.host = host.rstrip("/")
        self._client = httpx.Client(timeout=timeout, headers={"User-Agent": "atlas-poly/0.0.1"})

    def close(self) -> None:
        self._client.close()

    def fetch_political_quotes(self, limit: int = 100) -> list[VenueQuote]:
        # Manifold mengembalikan banyak market; tarik lalu filter binary + politik.
        r = self._client.get(f"{self.host}/v0/markets", params={"limit": min(limit * 5, 1000)})
        r.raise_for_status()
        rows = r.json()
        quotes: list[VenueQuote] = []
        for m in rows:
            if m.get("outcomeType") != "BINARY" or m.get("isResolved"):
                continue
            q = str(m.get("question", ""))
            if not _is_political(q):
                continue
            prob = m.get("probability")
            if prob is None:
                continue
            close_ms = m.get("closeTime")
            end = (
                datetime.fromtimestamp(close_ms / 1000, tz=timezone.utc)
                if isinstance(close_ms, (int, float)) else None
            )
            quotes.append(VenueQuote(
                venue=self.name, market_id=str(m.get("id", "")), question=q,
                yes_price=float(prob), liquidity=float(m.get("volume", 0.0) or 0.0),
                end_date=end, url=str(m.get("url", "")), has_orderbook=False,
            ))
            if len(quotes) >= limit:
                break
        log.info("manifold_quotes", count=len(quotes))
        return quotes
