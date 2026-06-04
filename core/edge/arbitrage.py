"""Edge engine (FASE 2): deteksi cross-market arbitrage di market politik.

Dua bentuk arbitrage yang kita cari (keduanya = pelanggaran no-arbitrage,
profit terkunci kalau bisa dieksekusi):

1. BINARY DUTCH BOOK (dalam 1 market YES/NO)
   Beli 1 YES + 1 NO selalu menebus $1 saat resolve.
   Kalau ask(YES) + ask(NO) < 1 - biaya  ->  profit terkunci.

2. MUTUALLY-EXCLUSIVE SET (mis. semua kandidat 1 pemilu / neg-risk group)
   Tepat satu outcome resolve YES. Beli YES semua kandidat seharga
   sum(ask_YES). Kalau sum < 1 - biaya -> profit terkunci.

Penting: edge dihitung SETELAH biaya, dan ukuran dibatasi likuiditas tertipis
(size yang benar-benar bisa dieksekusi), bukan size teoretis.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from core.data.models import OrderBook


class ArbType(str, Enum):
    BINARY_DUTCH_BOOK = "binary_dutch_book"
    MUTUALLY_EXCLUSIVE = "mutually_exclusive"


class ArbLeg(BaseModel):
    token_id: str
    label: str
    side: str  # "buy"
    price: float  # harga ask yang dieksekusi
    max_size: float  # size tersedia di best ask


class ArbOpportunity(BaseModel):
    type: ArbType
    legs: list[ArbLeg]
    cost_per_set: float  # total harga beli 1 "set" (sebelum biaya tx)
    edge: float = Field(..., description="profit terkunci per set SETELAH biaya (USD)")
    executable_sets: float  # jumlah set yang bisa dieksekusi (dibatasi leg tertipis)

    @property
    def edge_pct(self) -> float:
        """Edge sebagai % dari modal yang dipakai."""
        return self.edge / self.cost_per_set if self.cost_per_set > 0 else 0.0

    @property
    def total_profit(self) -> float:
        return self.edge * self.executable_sets

    @property
    def required_capital(self) -> float:
        return self.cost_per_set * self.executable_sets


def _best_ask_with_size(book: OrderBook) -> tuple[float, float] | None:
    """(harga, size) di best ask, atau None kalau kosong."""
    if not book.asks:
        return None
    best = min(book.asks, key=lambda lvl: lvl.price)
    return best.price, best.size


def detect_binary_dutch_book(
    yes: OrderBook, no: OrderBook, yes_label: str = "YES", no_label: str = "NO", cost: float = 0.0
) -> ArbOpportunity | None:
    """Cek arbitrage YES+NO dalam satu market biner."""
    a_yes = _best_ask_with_size(yes)
    a_no = _best_ask_with_size(no)
    if a_yes is None or a_no is None:
        return None
    cost_per_set = a_yes[0] + a_no[0]
    edge = (1.0 - cost_per_set) - cost
    if edge <= 0:
        return None
    executable = min(a_yes[1], a_no[1])  # dibatasi leg tertipis
    return ArbOpportunity(
        type=ArbType.BINARY_DUTCH_BOOK,
        legs=[
            ArbLeg(token_id=yes.token_id, label=yes_label, side="buy", price=a_yes[0], max_size=a_yes[1]),
            ArbLeg(token_id=no.token_id, label=no_label, side="buy", price=a_no[0], max_size=a_no[1]),
        ],
        cost_per_set=cost_per_set,
        edge=edge,
        executable_sets=executable,
    )


def detect_mutually_exclusive(
    outcomes: list[tuple[str, str, OrderBook]],
    cost: float = 0.0,
    min_completeness_sum: float = 0.90,
) -> ArbOpportunity | None:
    """Cek arbitrage di set saling-eksklusif-dan-MENYELURUH.

    `outcomes`: list of (token_id, label, orderbook) untuk sisi YES tiap kandidat.
    Asumsi KRITIS: set LENGKAP — tepat satu resolve YES (mis. SEMUA kandidat 1 pemilu).

    ⚠️  GUARD KELENGKAPAN: kalau kita hanya menangkap SEBAGIAN kandidat, jumlah harga
    YES bisa jauh < 1 dan tampak seperti "uang gratis" — PADAHAL kandidat yang tak
    tertangkap bisa menang (tidak ada jaminan payout). Ini false-positive berbahaya.
    Maka: tolak kalau cost_per_set < min_completeness_sum (set kemungkinan tak lengkap).
    Arb sejati di set lengkap punya jumlah harga MENDEKATI 1 (edge kecil, beberapa %).
    """
    if len(outcomes) < 2:
        return None
    legs: list[ArbLeg] = []
    cost_per_set = 0.0
    min_size = float("inf")
    for token_id, label, book in outcomes:
        ba = _best_ask_with_size(book)
        if ba is None:
            return None  # ada leg tanpa ask -> tak bisa kunci arb
        price, size = ba
        cost_per_set += price
        min_size = min(min_size, size)
        legs.append(ArbLeg(token_id=token_id, label=label, side="buy", price=price, max_size=size))

    # Guard kelengkapan: jumlah harga terlalu rendah => set tak lengkap => BUKAN arb.
    # Toleransi epsilon untuk hindari penolakan akibat galat floating point di batas.
    if cost_per_set < min_completeness_sum - 1e-9:
        return None

    edge = (1.0 - cost_per_set) - cost
    if edge <= 0:
        return None
    return ArbOpportunity(
        type=ArbType.MUTUALLY_EXCLUSIVE,
        legs=legs,
        cost_per_set=cost_per_set,
        edge=edge,
        executable_sets=min_size,
    )
