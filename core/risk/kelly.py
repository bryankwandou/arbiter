"""Sizing Kelly fraksional (FASE 3).

Untuk bet directional (mis. fundamental model): seberapa besar fraksi modal.
Untuk arbitrage (near risk-free) sizing dibatasi caps & likuiditas, bukan Kelly —
tapi fungsi ini tetap dipakai kalau bot punya estimasi probabilitas sendiri.

Kontrak biner Polymarket: beli di harga `price`, payout $1 kalau menang.
  net odds b = (1 - price) / price
  Kelly f*  = (b*p - q) / b   dengan q = 1 - p
            = p - q/b = p - (1-p)*price/(1-price)
Kita PAKAI fraksi Kelly (quarter-Kelly default) dan clamp [0, cap].
"""

from __future__ import annotations


def kelly_fraction(p_win: float, price: float) -> float:
    """Fraksi Kelly penuh untuk kontrak biner. 0 kalau tak ada edge.

    p_win: probabilitas menang menurut model kita (0..1)
    price: harga beli kontrak (0..1)
    """
    if not (0.0 < price < 1.0) or not (0.0 <= p_win <= 1.0):
        return 0.0
    b = (1.0 - price) / price  # net odds
    q = 1.0 - p_win
    f = (b * p_win - q) / b
    return max(0.0, f)  # tak pernah short via Kelly negatif di sini


def fractional_kelly(
    p_win: float, price: float, fraction: float = 0.25, hard_cap: float = 0.02
) -> float:
    """Kelly penuh * fraction (quarter-Kelly), lalu di-clamp ke hard_cap.

    hard_cap = batas keras fraksi modal per trade (default 2%), TIDAK bisa
    dilampaui betapapun besar edge-nya.
    """
    full = kelly_fraction(p_win, price)
    sized = full * fraction
    return min(sized, hard_cap)
