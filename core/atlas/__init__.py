"""ATLAS-QUANT bridge — read-only consumer of the T1MO signal feed.

Arbiter only *reads* from ATLAS-QUANT (`GET /api/arbiter/signal`). Nothing in
the ATLAS-QUANT project is modified or written to by this package.
"""

__all__ = ["AtlasSignal", "AtlasClient", "fetch_signals"]
