"""Scanner integrasi (FASE 1+2+3, read-only).

Menjalankan rantai loop SCAN -> DETECT -> VALIDATE -> SIZE pada data LIVE,
TANPA FILL (tidak ada order, tidak ada uang). Ini alat observasi untuk
membuktikan hipotesis edge: berapa sering arbitrage politik benar-benar muncul?

    python -m core.edge.scanner --limit 300 --max-markets 80

Output: daftar peluang yang LOLOS semua filter + sizing yang DISETUJUI risk
manager (pakai modal paper dari settings.yaml). Tidak menyimpan, tidak trade.
"""

from __future__ import annotations

import argparse
from collections import defaultdict

import structlog

from core.config import get_config
from core.data.clob_client import PolymarketReadClient
from core.data.models import Market, OrderBook
from core.edge.arbitrage import (
    ArbOpportunity,
    detect_binary_dutch_book,
    detect_mutually_exclusive,
)
from core.edge.signals import validate_opportunity
from core.risk.limits import RiskManager

log = structlog.get_logger()


def _yes_token(m: Market) -> str | None:
    for t in m.tokens:
        if t.outcome.strip().lower() in ("yes", "ya"):
            return t.token_id
    return m.tokens[0].token_id if m.tokens else None


def scan(limit: int = 300, max_markets: int = 80) -> list[tuple[str, ArbOpportunity]]:
    """Kembalikan daftar (deskripsi, peluang) yang LOLOS validasi."""
    cfg = get_config()
    risk = RiskManager(cfg.risk, bankroll_usd=float(cfg.strategy["paper"]["starting_balance_usd"]))
    min_edge = float(cfg.edge.get("min_edge_threshold", 0.05))
    min_notional = float(cfg.risk.get("min_orderbook_depth_usd", 50.0))

    found: list[tuple[str, ArbOpportunity]] = []
    books: dict[str, OrderBook] = {}
    neg_groups: dict[str, list[Market]] = defaultdict(list)

    with PolymarketReadClient() as client:
        markets = client.fetch_political_markets(limit=limit)[:max_markets]
        log.info("scanning", markets=len(markets))
        for m in markets:
            # tarik orderbook tiap token
            for tok in m.tokens:
                try:
                    books[tok.token_id] = client.fetch_orderbook(tok.token_id)
                except Exception as e:  # noqa: BLE001
                    log.warning("book_fail", token=tok.token_id, err=str(e))

            # (1) binary dutch book intra-market
            if len(m.tokens) == 2:
                b0, b1 = books.get(m.tokens[0].token_id), books.get(m.tokens[1].token_id)
                if b0 and b1:
                    opp = detect_binary_dutch_book(
                        b0, b1, m.tokens[0].outcome, m.tokens[1].outcome
                    )
                    if opp:
                        _consider(found, risk, opp, m.id, f"[BINARY] {m.question[:60]}",
                                  min_edge, min_notional)

            if m.neg_risk_market_id:
                neg_groups[m.neg_risk_market_id].append(m)

        # (2) mutually-exclusive arbitrage across neg-risk groups
        for gid, group in neg_groups.items():
            if len(group) < 2:
                continue
            outcomes = []
            ok = True
            for m in group:
                yt = _yes_token(m)
                if not yt or yt not in books:
                    ok = False
                    break
                outcomes.append((yt, m.question[:30], books[yt]))
            if ok:
                opp = detect_mutually_exclusive(outcomes)
                if opp:
                    _consider(found, risk, opp, gid,
                              f"[GROUP {len(group)}] neg-risk {gid[:10]}", min_edge, min_notional)
    return found


def _consider(found, risk, opp, market_id, desc, min_edge, min_notional) -> None:
    res = validate_opportunity(opp, min_edge_pct=min_edge, min_notional_usd=min_notional)
    if not res.passed:
        return
    sizing = risk.size_arbitrage(opp, market_id)
    if sizing.approved:
        found.append((f"{desc} | edge={opp.edge:.3f}/{opp.edge_pct:.1%} "
                      f"| size={sizing.sets} sets ${sizing.notional_usd:.2f}", opp))


def main() -> None:
    ap = argparse.ArgumentParser(description="atlas-poly arbitrage scanner (read-only, no orders)")
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument("--max-markets", type=int, default=80)
    args = ap.parse_args()

    found = scan(limit=args.limit, max_markets=args.max_markets)
    print(f"\n=== Peluang arbitrage LOLOS filter: {len(found)} ===")
    if not found:
        print("(tidak ada — ini HASIL NORMAL & berharga: pasar efisien saat ini.)")
        print("Hipotesis diuji dengan menjalankan ini berulang selama window 14 hari.")
    for desc, _ in found:
        print(f"  • {desc}")


if __name__ == "__main__":
    main()
