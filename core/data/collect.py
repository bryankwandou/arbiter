"""Collector (Fase 1): tarik market politik + orderbook -> simpan snapshot.

Jalankan satu siklus:
    python -m core.data.collect --limit 200 --max-markets 40

Ini fondasi observasi window 14 hari (lihat prompts/01_EDGE_HYPOTHESIS.md).
Read-only, tanpa wallet. Aman dijalankan kapan saja.
"""

from __future__ import annotations

import argparse

import structlog

from core.data.clob_client import PolymarketReadClient
from core.data.models import MarketSnapshot
from core.data.store import SnapshotStore

log = structlog.get_logger()


def collect_once(limit: int = 200, max_markets: int = 40) -> list[MarketSnapshot]:
    """Satu siklus SCAN: ambil market politik teratas + orderbook tiap token."""
    snaps: list[MarketSnapshot] = []
    with PolymarketReadClient() as client:
        markets = client.fetch_political_markets(limit=limit)
        log.info("political_markets_found", count=len(markets))
        for m in markets[:max_markets]:
            snap = MarketSnapshot(market_id=m.id, question=m.question)
            for tok in m.tokens:
                try:
                    snap.books[tok.token_id] = client.fetch_orderbook(tok.token_id)
                except Exception as e:  # noqa: BLE001 — jangan biarkan 1 token gagal merusak siklus
                    log.warning("orderbook_fetch_failed", token=tok.token_id, err=str(e))
            if snap.books:
                snaps.append(snap)
    return snaps


def main() -> None:
    ap = argparse.ArgumentParser(description="atlas-poly data collector (read-only)")
    ap.add_argument("--limit", type=int, default=200, help="market yang ditarik dari Gamma")
    ap.add_argument("--max-markets", type=int, default=40, help="maks market yang di-snapshot")
    ap.add_argument("--dry-run", action="store_true", help="jangan simpan, hanya tampilkan ringkasan")
    args = ap.parse_args()

    snaps = collect_once(limit=args.limit, max_markets=args.max_markets)
    print(f"Snapshot dikumpulkan: {len(snaps)} market")
    for s in snaps[:5]:
        n_tokens = len(s.books)
        print(f"  - {s.question[:70]!r} ({n_tokens} token)")

    if args.dry_run:
        print("[dry-run] tidak disimpan.")
        return

    store = SnapshotStore()
    saved = store.save_many(snaps)
    print(f"Tersimpan {saved} snapshot -> {store.base_dir}")


if __name__ == "__main__":
    main()
