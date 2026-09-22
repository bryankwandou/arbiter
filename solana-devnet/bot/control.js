// Operator controls set from the ATLAS-QUANT Trade Bot panel (kill switch,
// risk per trade, daily limits). The panel commits control.json to the repo;
// callers re-read it every cycle so a change takes effect mid-run.
import { readFileSync } from "node:fs";

const CONTROL_API = process.env.CONTROL_URL ||
  "https://api.github.com/repos/bryankwandou/arbiter/contents/solana-devnet/bot/control.json?ref=main";
const DEFAULT = { enabled: true, riskPct: 100, maxDailyLoss: 50, maxTradesPerDay: 500, cooldownSec: 0 };
let control = { ...DEFAULT };

export async function readControl() {
  try {
    const headers = { Accept: "application/vnd.github.raw+json", "Cache-Control": "no-cache" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(CONTROL_API, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    control = { ...DEFAULT, ...(await r.json()) };
  } catch (e) {
    // Remote unreachable: fall back to the checked-out copy, never to "trade freely".
    try { control = { ...DEFAULT, ...JSON.parse(readFileSync(new URL("./control.json", import.meta.url), "utf8")) }; }
    catch { console.log(`   control read failed (${e.message}) — keeping last settings`); }
  }
  return control;
}
