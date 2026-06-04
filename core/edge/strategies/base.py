"""Framework strategi directional (multi-method).

Berbeda dari arbitrage (profit terkunci), strategi directional bertaruh bahwa
HARGA PASAR SALAH menurut model kita. Tiap strategi menghasilkan `Signal`
yang lalu disizing via Kelly fraksional + lewat hard limits yang sama.

⚠️  Strategi directional HANYA tervalidasi kalau diuji vs HASIL RESOLVE
(apakah prediksi 60% kita benar 60% kali — kalibrasi). Snapshot saat ini belum
menyimpan hasil resolve, jadi strategi ini diproduksi + disizing + dites unit,
tapi VERDICT edge-nya menunggu data resolusi (pekerjaan lanjutan, jujur).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum

from pydantic import BaseModel

from core.venues.base import VenueQuote


class SignalSide(str, Enum):
    BACK_YES = "back_yes"   # beli YES (model bilang underpriced)
    FADE_YES = "fade_yes"   # jual/lawan YES = beli NO (model bilang overpriced)


class Signal(BaseModel):
    strategy: str
    venue: str
    market_id: str
    question: str
    side: SignalSide
    entry_price: float       # harga sisi yang dibeli (YES utk BACK, NO utk FADE)
    model_prob: float        # P(menang) sisi yang dibeli, menurut model
    edge: float              # model_prob - entry_price (harus > 0)
    rationale: str = ""

    @property
    def valid(self) -> bool:
        return self.edge > 0 and 0 < self.entry_price < 1


class Strategy(ABC):
    name: str = "base"

    @abstractmethod
    def generate(self, quotes: list[VenueQuote]) -> list[Signal]:
        ...
