"""Filter VALIDATE (FASE 2): tahap setelah DETECT, sebelum SIZE.

Sebuah peluang arbitrage hanya layak ditindaklanjuti kalau lolos SEMUA filter.
Tujuannya menyaring peluang yang secara teori ada tapi tidak bisa dieksekusi
secara menguntungkan (likuiditas tipis, edge terlalu kecil, market mau resolve).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from core.edge.arbitrage import ArbOpportunity


class ValidationResult(BaseModel):
    passed: bool
    reasons: list[str] = []  # alasan GAGAL (kosong kalau lolos) -> audit trail

    @classmethod
    def ok(cls) -> "ValidationResult":
        return cls(passed=True)

    @classmethod
    def fail(cls, *reasons: str) -> "ValidationResult":
        return cls(passed=False, reasons=list(reasons))


def validate_opportunity(
    opp: ArbOpportunity,
    *,
    min_edge_pct: float = 0.05,
    min_notional_usd: float = 50.0,
    end_date: datetime | None = None,
    resolution_buffer_minutes: int = 30,
    now: datetime | None = None,
) -> ValidationResult:
    reasons: list[str] = []

    # 1. Edge harus positif (sudah net biaya di detector) DAN cukup besar.
    if opp.edge <= 0:
        reasons.append("edge<=0 setelah biaya")
    if opp.edge_pct < min_edge_pct:
        reasons.append(f"edge_pct {opp.edge_pct:.3f} < min {min_edge_pct}")

    # 2. Liquidity gate: notional yang bisa dieksekusi harus layak (biaya gas worth it).
    if opp.required_capital < min_notional_usd:
        reasons.append(f"notional ${opp.required_capital:.2f} < min ${min_notional_usd}")

    # 3. Resolution buffer: jangan masuk kalau market hampir resolve.
    if end_date is not None:
        now = now or datetime.now(timezone.utc)
        if end_date <= now + timedelta(minutes=resolution_buffer_minutes):
            reasons.append("terlalu dekat waktu resolve")

    # 4. Sanity: tiap leg punya size > 0.
    if any(leg.max_size <= 0 for leg in opp.legs):
        reasons.append("ada leg dengan size 0")

    return ValidationResult.ok() if not reasons else ValidationResult.fail(*reasons)
