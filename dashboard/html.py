"""Dashboard HTML (FASE 7+).

Generate satu file HTML mandiri (storage/dashboard.html) dari trade journal:
ringkasan, PnL per-strategi, per-venue, kurva ekuitas (SVG inline), distribusi.
Buka di browser. Tanpa server, tanpa dependency frontend.

    python -m dashboard.html        # tulis & cetak path
"""

from __future__ import annotations

import html
from pathlib import Path

from core.analytics.analytics import (
    GroupStat,
    edge_distribution,
    equity_series,
    per_strategy,
    per_venue,
)
from paper.journal import TradeJournal

OUT_PATH = Path(__file__).resolve().parent.parent / "storage" / "dashboard.html"


def _sparkline(values: list[float], w: int = 600, h: int = 120) -> str:
    if len(values) < 2:
        return '<p style="color:#888">Belum ada data ekuitas.</p>'
    lo, hi = min(values), max(values)
    rng = (hi - lo) or 1.0
    pts = []
    for i, v in enumerate(values):
        x = i / (len(values) - 1) * w
        y = h - (v - lo) / rng * h
        pts.append(f"{x:.1f},{y:.1f}")
    color = "#16c784" if values[-1] >= values[0] else "#ea3943"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{" ".join(pts)}"/>'
            f'</svg>')


def _table(title: str, stats: list[GroupStat]) -> str:
    rows = "".join(
        f"<tr><td>{html.escape(s.key)}</td><td>{s.n_trades}</td>"
        f"<td>${s.total_pnl:.2f}</td><td>{s.win_rate:.0%}</td><td>${s.avg_pnl:.3f}</td></tr>"
        for s in stats
    ) or '<tr><td colspan="5" style="color:#888">tidak ada data</td></tr>'
    return (f"<h2>{title}</h2><table><thead><tr><th>{title.split()[-1]}</th>"
            f"<th>trades</th><th>PnL</th><th>win%</th><th>avg</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>")


def build_dashboard(journal: TradeJournal | None = None, out: Path = OUT_PATH) -> Path:
    journal = journal or TradeJournal()
    entries = journal.entries()
    total = sum(e.locked_profit for e in entries)
    eq = equity_series(entries, starting=0.0)
    dist = edge_distribution([e.locked_profit for e in entries])

    body = f"""<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>atlas-poly dashboard</title>
<style>
 body{{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:24px}}
 h1{{margin:0 0 4px}} .sub{{color:#8b949e;margin-bottom:24px}}
 .cards{{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}}
 .card{{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 20px;min-width:140px}}
 .card .v{{font-size:24px;font-weight:700}} .card .k{{color:#8b949e;font-size:12px;text-transform:uppercase}}
 table{{border-collapse:collapse;width:100%;margin:8px 0 24px;background:#161b22;border-radius:8px;overflow:hidden}}
 th,td{{text-align:left;padding:8px 12px;border-bottom:1px solid #30363d;font-size:14px}}
 th{{color:#8b949e;font-weight:600}} h2{{font-size:16px;margin:24px 0 8px}}
 .pos{{color:#16c784}} .neg{{color:#ea3943}}
</style></head><body>
<h1>atlas-poly</h1>
<div class="sub">Polymarket + multi-venue quant bot · mode PAPER · proses dulu, profit belakangan</div>
<div class="cards">
 <div class="card"><div class="k">Total Trades</div><div class="v">{len(entries)}</div></div>
 <div class="card"><div class="k">Total PnL</div>
   <div class="v {'pos' if total>=0 else 'neg'}">${total:.2f}</div></div>
 <div class="card"><div class="k">Median PnL</div><div class="v">${dist['median']:.3f}</div></div>
 <div class="card"><div class="k">Strategi</div><div class="v">{len(per_strategy(entries))}</div></div>
 <div class="card"><div class="k">Venue</div><div class="v">{len(per_venue(entries))}</div></div>
</div>
<h2>Kurva Ekuitas (PnL kumulatif)</h2>{_sparkline(eq)}
{_table("PnL per Strategi", per_strategy(entries))}
{_table("PnL per Venue", per_venue(entries))}
<p class="sub">Dibuat dari storage/paper_journal.jsonl · refresh: jalankan ulang python -m dashboard.html</p>
</body></html>"""

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    return out


def main() -> None:
    path = build_dashboard()
    print(f"Dashboard ditulis -> {path}")
    print("Buka di browser (file://) untuk melihat.")


if __name__ == "__main__":
    main()
