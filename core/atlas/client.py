"""Client for the ATLAS-QUANT arbiter bridge (read-only).

The bridge exposes the same T1MO classifier the ATLAS-QUANT chart uses:

    GET {ATLAS_QUANT_URL}/api/arbiter/signal?symbols=BTCUSDT,ETHUSDT&tf=1h

Auth is optional on the ATLAS side; when ARBITER_API_KEY is set there, send the
same value here via ATLAS_QUANT_KEY and it goes out as `x-arbiter-key`.

Self-test (prints live signals):
    python -m core.atlas.client
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx

ATLAS_URL = os.getenv("ATLAS_QUANT_URL", "https://atlas-quant.vercel.app").rstrip("/")
ATLAS_KEY = os.getenv("ATLAS_QUANT_KEY", "")

# Symbols the flash-arb bot cares about, mapped to the Base tokens it trades.
SYMBOL_TO_TOKEN = {
    "ETHUSDT":  "WETH",
    "BTCUSDT":  "cbBTC",
    "CBETHUSDT": "cbETH",
}

DEFAULT_SYMBOLS = ("BTCUSDT", "ETHUSDT")


@dataclass
class AtlasSignal:
    symbol: str
    action: str          # BUY | SELL | HOLD
    badge: str           # Hawk1 Detected / Green Bull / Spec Buy / Short Setup / NEUTRAL
    bull_prob: float     # 0..100
    confidence: float    # 0..1
    price: float
    timeframe: str
    plan: Optional[dict]

    @property
    def token(self) -> Optional[str]:
        return SYMBOL_TO_TOKEN.get(self.symbol)

    @property
    def risk_on(self) -> bool:
        """True when ATLAS says the market regime favours taking size."""
        return self.action == "BUY" and self.bull_prob >= 58

    @classmethod
    def parse(cls, raw: dict) -> Optional["AtlasSignal"]:
        if raw.get("error"):
            return None
        return cls(
            symbol=raw["symbol"],
            action=raw.get("action", "HOLD"),
            badge=raw.get("badge", "NEUTRAL"),
            bull_prob=float(raw.get("bullProb", 50)),
            confidence=float(raw.get("confidence", 0.0)),
            price=float(raw.get("price", 0.0)),
            timeframe=raw.get("timeframe", "1h"),
            plan=raw.get("plan"),
        )


class AtlasClient:
    def __init__(self, url: str = ATLAS_URL, key: str = ATLAS_KEY, timeout: float = 25.0) -> None:
        self._url = url.rstrip("/")
        self._headers = {"x-arbiter-key": key} if key else {}
        self._timeout = timeout

    async def signals(
        self,
        symbols: tuple[str, ...] = DEFAULT_SYMBOLS,
        tf: str = "1h",
    ) -> list[AtlasSignal]:
        params = {"symbols": ",".join(symbols), "tf": tf}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._url}/api/arbiter/signal", params=params, headers=self._headers
            )
            resp.raise_for_status()
            payload = resp.json()
        parsed = (AtlasSignal.parse(s) for s in payload.get("signals", []))
        return [s for s in parsed if s is not None]


async def fetch_signals(
    symbols: tuple[str, ...] = DEFAULT_SYMBOLS, tf: str = "1h"
) -> list[AtlasSignal]:
    return await AtlasClient().signals(symbols, tf)


if __name__ == "__main__":
    import asyncio

    async def _main() -> None:
        print(f"ATLAS-QUANT bridge: {ATLAS_URL}  (key={'set' if ATLAS_KEY else 'none'})")
        sigs = await fetch_signals(("BTCUSDT", "ETHUSDT", "BNBUSDT"))
        if not sigs:
            print("no signals returned")
            return
        for s in sigs:
            print(
                f"  {s.symbol:10} {s.action:4} {s.badge:16} "
                f"bullProb={s.bull_prob:5.1f} conf={s.confidence:.2f} "
                f"px={s.price:<12,.2f} risk_on={s.risk_on}"
            )

    asyncio.run(_main())
