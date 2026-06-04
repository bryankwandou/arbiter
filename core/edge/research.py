"""Riset multi-venue + multi-strategi (read-only, no orders).

Menyatukan semua metode baru:
  * tarik quote politik dari venue aktif (Polymarket, Manifold, Kalshi)
  * deteksi cross-venue discrepancy (event sama, harga beda)
  * jalankan strategi directional (longshot-bias, mean-reversion)

    python -m core.edge.research --limit 100

Tidak trade, tidak simpan. Alat eksplorasi edge.
"""

from __future__ import annotations

import argparse
import os

import structlog

from core.config import get_config
from core.data.clob_client import PolymarketReadClient
from core.edge.cross_venue import find_cross_venue_signals
from core.edge.strategies.longshot_bias import LongshotBiasStrategy
from core.edge.strategies.mean_reversion import MeanReversionStrategy
from core.venues.base import VenueQuote
from core.venues.kalshi import KalshiVenue
from core.venues.manifold import ManifoldVenue
from core.venues.polymarket import PolymarketVenue

log = structlog.get_logger()


def gather_quotes(cfg, limit: int) -> list[VenueQuote]:
    venues_cfg = cfg.strategy.get("venues", {})
    quotes: list[VenueQuote] = []
    poly_client: PolymarketReadClient | None = None

    if venues_cfg.get("polymarket", {}).get("enabled"):
        poly_client = PolymarketReadClient()
        try:
            quotes += PolymarketVenue(poly_client).fetch_political_quotes(limit=limit)
        except Exception as e:  # noqa: BLE001
            log.warning("polymarket_fail", err=str(e))
        finally:
            poly_client.close()

    if venues_cfg.get("manifold", {}).get("enabled"):
        mv = ManifoldVenue()
        try:
            quotes += mv.fetch_political_quotes(limit=limit)
        except Exception as e:  # noqa: BLE001
            log.warning("manifold_fail", err=str(e))
        finally:
            mv.close()

    if venues_cfg.get("kalshi", {}).get("enabled"):
        quotes += KalshiVenue(api_key=os.getenv("ATLAS_KALSHI_KEY", "")).fetch_political_quotes(limit=limit)

    return quotes


def main() -> None:
    ap = argparse.ArgumentParser(description="atlas-poly multi-venue research (read-only)")
    ap.add_argument("--limit", type=int, default=100)
    args = ap.parse_args()

    cfg = get_config()
    quotes = gather_quotes(cfg, args.limit)
    by_venue: dict[str, int] = {}
    for q in quotes:
        by_venue[q.venue] = by_venue.get(q.venue, 0) + 1
    print(f"\n=== Quote terkumpul: {len(quotes)} | per venue: {by_venue} ===")

    # cross-venue
    cv = cfg.strategy.get("cross_venue", {})
    if cv.get("enabled"):
        sigs = find_cross_venue_signals(
            quotes, match_threshold=float(cv.get("match_threshold", 0.82)),
            min_discrepancy=float(cv.get("min_discrepancy", 0.05)),
        )
        print(f"\n=== Cross-venue discrepancy: {len(sigs)} ===")
        for s in sigs[:10]:
            print("  •", s.pretty())
        if not sigs:
            print("  (tidak ada — event yang cocok antar-venue + selisih cukup besar belum ketemu)")

    # strategi directional
    scfg = cfg.strategy.get("strategies", {})
    strategies = []
    if scfg.get("longshot_bias", {}).get("enabled"):
        lc = scfg["longshot_bias"]
        strategies.append(LongshotBiasStrategy(lc.get("longshot_cutoff", 0.08),
                                               lc.get("shrink_factor", 0.6)))
    if scfg.get("mean_reversion", {}).get("enabled"):
        mc = scfg["mean_reversion"]
        strategies.append(MeanReversionStrategy(mc.get("lookback", 10),
                                                mc.get("deviation_threshold", 0.06)))

    for strat in strategies:
        signals = strat.generate(quotes)
        print(f"\n=== Sinyal [{strat.name}]: {len(signals)} ===")
        for sig in signals[:10]:
            print(f"  • {sig.side.value} {sig.venue} edge={sig.edge:.3f} "
                  f"@{sig.entry_price:.2f} | {sig.question[:55]!r}")


if __name__ == "__main__":
    main()
