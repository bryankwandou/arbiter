"""Adapter Polymarket -> VenueQuote (membungkus PolymarketReadClient)."""

from __future__ import annotations

from core.data.clob_client import PolymarketReadClient, _yes_token_outcome
from core.venues.base import Venue, VenueQuote


class PolymarketVenue(Venue):
    name = "polymarket"

    def __init__(self, client: PolymarketReadClient | None = None):
        self._client = client or PolymarketReadClient()

    def fetch_political_quotes(self, limit: int = 100) -> list[VenueQuote]:
        quotes: list[VenueQuote] = []
        markets = self._client.fetch_political_markets(limit=limit, paginate=True)
        for m in markets:
            if len(m.tokens) != 2:
                continue
            yes_tid = _yes_token_outcome(m)
            if not yes_tid:
                continue
            try:
                book = self._client.fetch_orderbook(yes_tid)
            except Exception:  # noqa: BLE001
                continue
            price = book.best_ask if book.best_ask is not None else book.mid
            if price is None:
                continue
            quotes.append(VenueQuote(
                venue=self.name, market_id=m.id, question=m.question,
                yes_price=price, liquidity=m.liquidity, end_date=m.end_date,
                url=f"https://polymarket.com/event/{m.slug}", has_orderbook=True,
            ))
        return quotes
