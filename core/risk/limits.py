"""RiskManager (FASE 3): penegak hard limits.

Semua keputusan ukuran posisi WAJIB lewat sini. Strategi tidak bisa
meng-override. Limit (dari config/settings.yaml):
  * max_per_trade_pct   — maks modal per satu trade
  * max_per_market_pct  — maks modal terakumulasi per market
  * max_open_positions  — maks jumlah posisi terbuka
  * daily_loss_limit    — kill-switch (via KillSwitch)
  * min_orderbook_depth — liquidity gate (via signals, dicek juga di sini)
"""

from __future__ import annotations

import math

from pydantic import BaseModel

from core.edge.arbitrage import ArbOpportunity
from core.edge.strategies.base import Signal
from core.risk.kelly import fractional_kelly
from core.risk.killswitch import KillSwitch


class SizingDecision(BaseModel):
    approved: bool
    sets: float = 0.0          # jumlah "set" arbitrage yang disetujui
    notional_usd: float = 0.0  # modal yang dipakai
    reasons: list[str] = []    # kenapa ditolak / dibatasi (audit trail)


class RiskManager:
    def __init__(self, risk_cfg: dict, bankroll_usd: float):
        self.bankroll = bankroll_usd
        self.max_per_trade_pct = float(risk_cfg.get("max_per_trade_pct", 0.02))
        self.max_per_market_pct = float(risk_cfg.get("max_per_market_pct", 0.05))
        self.max_open_positions = int(risk_cfg.get("max_open_positions", 5))
        self.min_depth_usd = float(risk_cfg.get("min_orderbook_depth_usd", 50.0))
        self.kelly_fraction = float(risk_cfg.get("kelly_fraction", 0.25))
        self.killswitch = KillSwitch(float(risk_cfg.get("daily_loss_limit_pct", 0.10)))
        self.killswitch.start_day(bankroll_usd)
        self._open: dict[str, float] = {}  # market_id -> notional terbuka

    # --- room calc ---
    def _market_room(self, market_id: str) -> float:
        cap = self.bankroll * self.max_per_market_pct
        used = self._open.get(market_id, 0.0)
        return max(0.0, cap - used)

    def size_arbitrage(self, opp: ArbOpportunity, market_id: str) -> SizingDecision:
        """Tentukan berapa set arbitrage yang boleh dieksekusi (terkecil dari semua batas)."""
        reasons: list[str] = []

        if self.killswitch.tripped:
            return SizingDecision(approved=False, reasons=[f"kill-switch aktif: {self.killswitch.reason}"])

        if market_id not in self._open and len(self._open) >= self.max_open_positions:
            return SizingDecision(approved=False, reasons=["max_open_positions tercapai"])

        if opp.cost_per_set <= 0:
            return SizingDecision(approved=False, reasons=["cost_per_set<=0 invalid"])

        # Batas-batas notional (USD):
        per_trade_cap = self.bankroll * self.max_per_trade_pct
        per_market_cap = self._market_room(market_id)
        notional_cap = min(per_trade_cap, per_market_cap)
        if notional_cap <= 0:
            return SizingDecision(approved=False, reasons=["tidak ada ruang (cap market/trade habis)"])

        # Konversi ke jumlah set, lalu batasi juga oleh likuiditas (executable_sets).
        sets_by_cap = notional_cap / opp.cost_per_set
        sets = min(sets_by_cap, opp.executable_sets)
        sets = math.floor(sets * 100) / 100  # bulatkan ke bawah, hindari over-fill

        if sets <= 0:
            return SizingDecision(approved=False, reasons=["ukuran tersizing < 1 set"])

        notional = sets * opp.cost_per_set
        if notional < self.min_depth_usd:
            reasons.append(f"notional ${notional:.2f} < liquidity gate ${self.min_depth_usd}")
            return SizingDecision(approved=False, reasons=reasons)

        if sets < opp.executable_sets:
            reasons.append("dibatasi oleh cap modal (bukan likuiditas)")

        return SizingDecision(approved=True, sets=sets, notional_usd=notional, reasons=reasons)

    def size_signal(self, signal: Signal, market_id: str) -> SizingDecision:
        """Sizing bet directional via fractional Kelly + hard caps."""
        if self.killswitch.tripped:
            return SizingDecision(approved=False, reasons=[f"kill-switch: {self.killswitch.reason}"])
        if market_id not in self._open and len(self._open) >= self.max_open_positions:
            return SizingDecision(approved=False, reasons=["max_open_positions tercapai"])
        if not signal.valid:
            return SizingDecision(approved=False, reasons=["signal tidak valid (edge<=0)"])

        # Kelly fraction (sudah di-clamp ke per_trade cap)
        frac = fractional_kelly(signal.model_prob, signal.entry_price,
                                fraction=self.kelly_fraction, hard_cap=self.max_per_trade_pct)
        if frac <= 0:
            return SizingDecision(approved=False, reasons=["Kelly=0 (tak ada edge bisa di-size)"])

        notional = min(self.bankroll * frac, self._market_room(market_id))
        if notional < self.min_depth_usd:
            return SizingDecision(approved=False,
                                  reasons=[f"notional ${notional:.2f} < gate ${self.min_depth_usd}"])
        sets = notional / signal.entry_price if signal.entry_price > 0 else 0.0
        return SizingDecision(approved=True, sets=round(sets, 2), notional_usd=notional)

    # --- pencatatan posisi & PnL ---
    def register_open(self, market_id: str, notional: float) -> None:
        self._open[market_id] = self._open.get(market_id, 0.0) + notional

    def register_close(self, market_id: str, realized_pnl: float) -> None:
        self._open.pop(market_id, None)
        self.bankroll += realized_pnl
        self.killswitch.record_pnl(realized_pnl)

    @property
    def open_count(self) -> int:
        return len(self._open)
