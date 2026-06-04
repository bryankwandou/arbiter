"""Kill-switch & circuit breaker (FASE 3).

Dua mekanisme penghenti otomatis:
  * DAILY LOSS LIMIT: kalau rugi terealisasi hari ini > limit% modal -> trip.
  * ERROR CIRCUIT BREAKER: kalau error beruntun (API/data) >= ambang -> trip.

Saat tripped, bot TIDAK boleh buka posisi baru. Reset hanya MANUAL (sengaja —
supaya manusia mengevaluasi dulu sebelum lanjut). Ini mengimplementasikan
Hukum #3 master prompt: kelangsungan hidup > profit.
"""

from __future__ import annotations

from datetime import date


class KillSwitch:
    def __init__(self, daily_loss_limit_pct: float, max_consecutive_errors: int = 5):
        self.daily_loss_limit_pct = daily_loss_limit_pct
        self.max_consecutive_errors = max_consecutive_errors
        self._tripped = False
        self._trip_reason: str | None = None
        self._consecutive_errors = 0
        self._day = date.today()
        self._day_start_bankroll: float | None = None
        self._realized_pnl_today = 0.0

    # --- siklus harian ---
    def start_day(self, bankroll: float, today: date | None = None) -> None:
        self._day = today or date.today()
        self._day_start_bankroll = bankroll
        self._realized_pnl_today = 0.0

    def record_pnl(self, realized: float) -> None:
        """Catat PnL terealisasi; otomatis trip kalau lewat limit harian."""
        self._realized_pnl_today += realized
        if self._day_start_bankroll and self._day_start_bankroll > 0:
            loss_pct = -self._realized_pnl_today / self._day_start_bankroll
            if loss_pct >= self.daily_loss_limit_pct:
                self.trip(f"daily loss {loss_pct:.1%} >= limit {self.daily_loss_limit_pct:.1%}")

    # --- circuit breaker error ---
    def record_error(self) -> None:
        self._consecutive_errors += 1
        if self._consecutive_errors >= self.max_consecutive_errors:
            self.trip(f"{self._consecutive_errors} error beruntun")

    def record_success(self) -> None:
        self._consecutive_errors = 0

    # --- state ---
    def trip(self, reason: str) -> None:
        self._tripped = True
        self._trip_reason = reason

    @property
    def tripped(self) -> bool:
        return self._tripped

    @property
    def reason(self) -> str | None:
        return self._trip_reason

    def reset(self) -> None:
        """Reset MANUAL — panggil hanya setelah manusia mengevaluasi."""
        self._tripped = False
        self._trip_reason = None
        self._consecutive_errors = 0
