"""Adapter Kalshi -> VenueQuote (advanced; butuh API key untuk data penuh).

Kalshi = bursa prediksi teregulasi AS (CLOB, harga dalam sen 0..100).
Endpoint market publik makin dibatasi; sebagian butuh auth. Adapter ini
fungsional untuk parsing, tapi fetch live akan diam (return []) kalau API key
tak tersedia atau endpoint memblokir — JUJUR, bukan pura-pura.
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from core.data.clob_client import POLITICS_KEYWORDS
from core.venues.base import Venue, VenueQuote

log = structlog.get_logger()

KALSHI_HOST = "https://api.elections.kalshi.com/trade-api/v2"


def parse_kalshi_market(raw: dict[str, Any]) -> VenueQuote | None:
    """Parse satu market Kalshi. yes_ask dalam sen -> /100."""
    title = str(raw.get("title") or raw.get("subtitle") or "")
    yes_ask = raw.get("yes_ask")
    if yes_ask is None:
        return None
    if not any(kw in title.lower() for kw in POLITICS_KEYWORDS):
        return None
    return VenueQuote(
        venue="kalshi", market_id=str(raw.get("ticker", "")), question=title,
        yes_price=float(yes_ask) / 100.0, liquidity=float(raw.get("liquidity", 0.0) or 0.0),
        url=f"https://kalshi.com/markets/{raw.get('ticker','')}", has_orderbook=True,
    )


class KalshiVenue(Venue):
    name = "kalshi"

    def __init__(self, host: str = KALSHI_HOST, api_key: str = "", timeout: float = 15.0):
        self.host = host.rstrip("/")
        headers = {"User-Agent": "atlas-poly/0.0.1"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.Client(timeout=timeout, headers=headers)

    def fetch_political_quotes(self, limit: int = 100) -> list[VenueQuote]:
        try:
            r = self._client.get(f"{self.host}/markets", params={"limit": limit, "status": "open"})
            r.raise_for_status()
            rows = r.json().get("markets", [])
        except Exception as e:  # noqa: BLE001
            log.warning("kalshi_unavailable", err=str(e),
                        hint="set ATLAS_KALSHI_KEY atau aktifkan venue saat punya akses")
            return []
        out = [q for raw in rows if (q := parse_kalshi_market(raw))]
        log.info("kalshi_quotes", count=len(out))
        return out
