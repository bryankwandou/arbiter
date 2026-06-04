"""Penyimpanan snapshot (Fase 1).

Format: JSON Lines (.jsonl) per hari di storage/snapshots/. Satu baris = satu
MarketSnapshot. Dipilih karena: tanpa dependency berat, append-only (aman),
dan mudah di-replay urut waktu saat backtest (Fase 4).

Parquet bisa ditambahkan nanti kalau volume sudah besar.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from core.data.models import MarketSnapshot

STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"
SNAPSHOT_DIR = STORAGE_ROOT / "snapshots"


class SnapshotStore:
    def __init__(self, base_dir: Path = SNAPSHOT_DIR):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _file_for(self, ts: datetime) -> Path:
        return self.base_dir / f"snapshots-{ts.strftime('%Y-%m-%d')}.jsonl"

    def save(self, snap: MarketSnapshot) -> None:
        path = self._file_for(snap.ts)
        with path.open("a", encoding="utf-8") as f:
            f.write(snap.model_dump_json() + "\n")

    def save_many(self, snaps: list[MarketSnapshot]) -> int:
        for s in snaps:
            self.save(s)
        return len(snaps)

    def iter_snapshots(self, day: datetime | None = None) -> Iterator[MarketSnapshot]:
        """Baca snapshot kembali (untuk backtest/analisis)."""
        files = [self._file_for(day)] if day else sorted(self.base_dir.glob("snapshots-*.jsonl"))
        for path in files:
            if not path.exists():
                continue
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        yield MarketSnapshot.model_validate_json(line)

    def count(self) -> int:
        return sum(1 for _ in self.iter_snapshots())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
