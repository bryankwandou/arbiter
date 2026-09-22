// Autonomous devnet arbitrage loop.
//
// Each cycle: read ATLAS-QUANT's T1MO signal (HTTP GET, read-only), read both
// pools, size the best round trip, and — if it clears the loan fee and a
// minimum profit — send ONE transaction:
//   flash_borrow tUSD → buy tSOL on the cheap pool → sell on the dear pool → flash_repay
// If any leg comes up short the repay fails and the whole transaction reverts.
//
//   node bot.js --once                 one cycle
//   node bot.js --loop 30              forever, every 30 s
//   node bot.js --loop 30 --noise      also push pool 1's price between cycles,
//                                      standing in for other traders (labelled)
//   ATLAS_GATE=1 node bot.js ...       only trade while ATLAS regime is risk-on
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  connection, loadBot, loadState, poolReserves, swapOut, loanFee, tokenBalance,
  flashBorrowIx, flashRepayIx, swapIx, explorer, fmt, LOG_PATH, vaultPda, vaultTokensPda, PROGRAM_ID,
} from "./common.js";

const args = process.argv.slice(2);
const loopSec = args.includes("--loop") ? Number(args[args.indexOf("--loop") + 1] || 30) : 0;
const noise = args.includes("--noise");
const maxCycles = args.includes("--cycles") ? Number(args[args.indexOf("--cycles") + 1]) : Infinity;
const ATLAS_URL = (process.env.ATLAS_QUANT_URL || "https://atlas-quant.vercel.app").replace(/\/$/, "");
const ATLAS_GATE = process.env.ATLAS_GATE === "1";
const MIN_PROFIT = BigInt(process.env.MIN_PROFIT_BASE || "1000000"); // 1 tUSD
const MIN_EDGE_BPS = BigInt(process.env.MIN_EDGE_BPS || "10");        // net ≥ 0.10% of loan

const bot = loadBot();
const st = loadState();
const log = (o) => { appendFileSync(LOG_PATH, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); };

// Public run ledger. trades.jsonl is gitignored (it grows without bound and is
// noisy); this is the small, committed summary the ATLAS-QUANT Risk panel reads
// over HTTP. It holds no keys — only counts, realised profit and signatures
// anyone can open on Solana Explorer.
const LEDGER_PATH = fileURLToPath(new URL("./ledger.json", import.meta.url));

function writeLedger() {
  let prev = { runs: [] };
  try { prev = JSON.parse(readFileSync(LEDGER_PATH, "utf8")); } catch { /* first run */ }
  const run = {
    startedAt: STARTED_AT,
    endedAt: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID || null,
    cycles: stats.cycles,
    sent: stats.sent,
    wins: stats.wins,
    losses: stats.losses,
    skipped: stats.skipped,
    atlasReads: stats.atlasReads,
    profit: fmt(stats.profit),
    winRate: winRate(),
    lastSig: stats.lastSig,
    held: stats.held,
    control,
  };
  const runs = [...(prev.runs || []).filter((r) => !run.runId || r.runId !== run.runId), run].slice(-60);
  const sum = (k) => runs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const sent = sum("sent"), wins = sum("wins");
  const ledger = {
    source: "arbiter/solana-devnet",
    version: 1,
    network: "devnet",
    updatedAt: run.endedAt,
    program: PROGRAM_ID.toBase58(),
    vault: vaultPda(st.mintA).toBase58(),
    wallet: bot.publicKey.toBase58(),
    totals: {
      runs: runs.length,
      cycles: sum("cycles"),
      sent,
      wins,
      losses: sum("losses"),
      skipped: sum("skipped"),
      atlasReads: sum("atlasReads"),
      profit: runs.reduce((a, r) => a + Number(String(r.profit).replace(/,/g, "")), 0).toFixed(4),
      winRate: sent ? `${((100 * wins) / sent).toFixed(1)}%` : "n/a",
    },
    latest: run,
    runs,
  };
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`ledger written: ${LEDGER_PATH}`);
}

async function atlas() {
  try {
    const r = await fetch(`${ATLAS_URL}/api/arbiter/signal?symbols=SOLUSDT,BTCUSDT,ETHUSDT&tf=1h`, {
      headers: process.env.ATLAS_QUANT_KEY ? { "x-arbiter-key": process.env.ATLAS_QUANT_KEY } : {},
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const sigs = ((await r.json()).signals || []).filter((s) => !s.error);
    const sol = sigs.find((s) => s.symbol === "SOLUSDT");
    // Same rule as core/atlas/client.py: BUY with bull probability ≥ 58.
    const riskOn = !!sol && sol.action === "BUY" && Number(sol.bullProb) >= 58;
    return { riskOn, signals: sigs.map((s) => `${s.symbol}=${s.action}(${s.bullProb}) ${s.badge}`) };
  } catch (e) {
    return { riskOn: false, error: String(e.message || e) };
  }
}

// Best input size for: A →(cheap pool) B →(dear pool) A, net of the loan fee.
function bestTrade(cheap, dear, cap) {
  const profit = (x) => {
    const b = swapOut(x, cheap.a, cheap.b);
    const back = swapOut(b, dear.b, dear.a);
    return { x, b, back, fee: loanFee(x), net: back - x - loanFee(x) };
  };
  let lo = 1n, hi = cheap.a / 4n; // ternary search on a concave curve
  if (cap !== undefined && cap > 1n && cap < hi) hi = cap; // panel "risk per trade" ceiling
  for (let i = 0; i < 80 && hi - lo > 2n; i++) {
    const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n;
    if (profit(m1).net < profit(m2).net) lo = m1; else hi = m2;
  }
  return profit((lo + hi) / 2n);
}

async function pushNoise() {
  // Stand-in for other market participants: sell some tSOL into pool 1 or buy
  // from pool 0 so a gap reopens. Clearly a simulation, logged as such.
  // Selling tSOL every time drained the wallet (runs failed with "insufficient
  // funds" from 2026-09-17 on), so once tSOL runs short, buy it back from pool 1
  // with tUSD instead — that also widens the gap, and refills the tSOL side.
  const amt = BigInt(20 + Math.floor(Math.random() * 60)) * 1_000_000n; // 20–80 tSOL
  if ((await tokenBalance(st.botB)) >= amt) {
    const sig = await sendAndConfirmTransaction(connection,
      new Transaction().add(swapIx(bot.publicKey, st.botA, st.botB, 0, false, amt, 1n)), [bot]);
    console.log(`  [simulated market flow] sold ${fmt(amt)} tSOL into pool 0 → ${explorer(sig)}`);
    return log({ kind: "noise", pool: 0, sold_tsol: fmt(amt), sig });
  }
  const usd = amt * 16n;
  if ((await tokenBalance(st.botA)) < usd) throw new Error("wallet short of both tSOL and tUSD for simulated flow");
  const sig = await sendAndConfirmTransaction(connection,
    new Transaction().add(swapIx(bot.publicKey, st.botA, st.botB, 1, true, usd, 1n)), [bot]);
  console.log(`  [simulated market flow] bought tSOL with ${fmt(usd)} tUSD from pool 1 → ${explorer(sig)}`);
  log({ kind: "noise", pool: 1, spent_tusd: fmt(usd), sig });
}

// Operator controls, set from the ATLAS-QUANT Trade Bot panel. The panel
// commits control.json to this repo; the bot re-reads it every cycle so a
// kill switch or a new limit takes effect mid-run, not at the next run.
const CONTROL_API = process.env.CONTROL_URL ||
  "https://api.github.com/repos/bryankwandou/arbiter/contents/solana-devnet/bot/control.json?ref=main";
const CONTROL_DEFAULT = { enabled: true, riskPct: 100, maxDailyLoss: 50, maxTradesPerDay: 500, cooldownSec: 0 };
let control = { ...CONTROL_DEFAULT };
async function readControl() {
  try {
    const headers = { Accept: "application/vnd.github.raw+json", "Cache-Control": "no-cache" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(CONTROL_API, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    control = { ...CONTROL_DEFAULT, ...(await r.json()) };
  } catch (e) {
    // Remote unreachable: fall back to the checked-out copy, never to "trade freely".
    try { control = { ...CONTROL_DEFAULT, ...JSON.parse(readFileSync(new URL("./control.json", import.meta.url), "utf8")) }; }
    catch { console.log(`   control read failed (${e.message}) — keeping last settings`); }
  }
  return control;
}

// Today's totals from earlier runs, so daily limits span runs, not one run.
const TODAY = new Date().toISOString().slice(0, 10);
const earlierToday = (() => {
  try {
    const runs = JSON.parse(readFileSync(LEDGER_PATH, "utf8")).runs || [];
    return runs.filter((r) => String(r.startedAt || "").startsWith(TODAY))
      .reduce((a, r) => ({ sent: a.sent + (r.sent || 0), profit: a.profit + (Number(String(r.profit || 0).replace(/,/g, "")) || 0) }), { sent: 0, profit: 0 });
  } catch { return { sent: 0, profit: 0 }; }
})();
let lastLossAt = 0;

async function cycle(n) {
  stats.cycles++;
  const c = await readControl();
  const hold = (why, action) => { stats.held++; console.log(`\n#${n} ⛔ ${why} — holding`); log({ kind: "cycle", n, action, control: c }); };
  if (!c.enabled) return hold("KILL SWITCH ON (ATLAS-QUANT panel)", "held_by_kill_switch");
  const dayPnl = earlierToday.profit + Number(stats.profit) / 1e6;
  if (dayPnl <= -Math.abs(Number(c.maxDailyLoss))) return hold(`max daily loss hit (${dayPnl.toFixed(4)} tUSD)`, "held_by_daily_loss");
  if (earlierToday.sent + stats.sent >= Number(c.maxTradesPerDay)) return hold(`max trades/day reached (${c.maxTradesPerDay})`, "held_by_trade_cap");
  if (lastLossAt && Date.now() - lastLossAt < Number(c.cooldownSec) * 1000) return hold(`cooldown after loss (${c.cooldownSec}s)`, "held_by_cooldown");
  const regime = await atlas();
  if (!regime.error) stats.atlasReads++;
  const [p0, p1] = await Promise.all([poolReserves(0), poolReserves(1)]);
  const price = (p) => Number(p.a) / Number(p.b);
  const [cheapId, dearId] = price(p0) <= price(p1) ? [0, 1] : [1, 0];
  const riskPct = Math.min(100, Math.max(1, Number(c.riskPct) || 100));
  const cap = (vaultLiquidity * BigInt(Math.round(riskPct * 100))) / 10_000n;
  const t = bestTrade(cheapId === 0 ? p0 : p1, cheapId === 0 ? p1 : p0, cap);
  console.log(`\n#${n} ${new Date().toISOString()}  ATLAS risk_on=${regime.riskOn} ${regime.error ? "ERR " + regime.error : regime.signals.join(" | ")}`);
  console.log(`   pool0 ${price(p0).toFixed(4)}  pool1 ${price(p1).toFixed(4)}  best: borrow ${fmt(t.x)} tUSD → net ${fmt(t.net)} tUSD`);

  const base = { kind: "cycle", n, atlas: regime, price0: price(p0), price1: price(p1), size: fmt(t.x), expected_net: fmt(t.net) };
  // Margin: a thin edge is the one most likely to vanish between quote and
  // landing, so demand both an absolute floor and MIN_EDGE_BPS of the size.
  if (t.net < MIN_PROFIT || t.net * 10_000n < t.x * MIN_EDGE_BPS) {
    console.log("   no arb above margin"); log({ ...base, action: "none" }); return;
  }
  if (ATLAS_GATE && !regime.riskOn) { console.log("   ⛔ ATLAS gate: risk-off — holding"); log({ ...base, action: "held_by_atlas" }); return; }

  const before = await tokenBalance(st.botA);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    flashBorrowIx(bot.publicKey, st.botA, st.mintA, t.x),
    swapIx(bot.publicKey, st.botA, st.botB, cheapId, true, t.x, t.b),
    swapIx(bot.publicKey, st.botA, st.botB, dearId, false, t.b, t.back),
    flashRepayIx(bot.publicKey, st.botA, st.mintA, t.x),
  );
  tx.feePayer = bot.publicKey;

  // Dry-run the exact transaction first. A trade that would fail is dropped
  // here for free instead of landing on chain and burning a fee.
  try {
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    const sim = await connection.simulateTransaction(tx, [bot]);
    if (sim.value.err) {
      stats.skipped++;
      console.log(`   ⏭  simulation says it would fail — not sent (${JSON.stringify(sim.value.err)})`);
      log({ ...base, action: "skipped_simulation", error: sim.value.err });
      return;
    }
  } catch (e) {
    stats.skipped++;
    console.log(`   ⏭  could not simulate — not sent (${String(e.message).slice(0, 100)})`);
    log({ ...base, action: "skipped_simulation", error: String(e.message).slice(0, 300) });
    return;
  }

  stats.sent++;
  try {
    // Public devnet RPC occasionally loses the blockhash between fetch and send;
    // that transaction never reached the chain, so one fresh attempt is safe.
    const sig = await sendAndConfirmTransaction(connection, tx, [bot]).catch((e) => {
      if (!/Blockhash not found/i.test(String(e.message))) throw e;
      tx.recentBlockhash = undefined;
      return sendAndConfirmTransaction(connection, tx, [bot]);
    });
    const realised = (await tokenBalance(st.botA)) - before;
    if (realised > 0n) stats.wins++; else { stats.losses++; lastLossAt = Date.now(); }
    stats.profit += realised;
    console.log(`   ${realised > 0n ? "✅" : "⚠️"} flash arb executed: realised ${realised >= 0n ? "+" : ""}${fmt(realised)} tUSD  ${explorer(sig)}`);
    stats.lastSig = sig;
    log({ ...base, action: "executed", realised: fmt(realised), loan_fee: fmt(t.fee), sig });
  } catch (e) {
    stats.losses++; lastLossAt = Date.now();
    console.log(`   ❌ reverted: ${String(e.message || e).slice(0, 160)}`);
    log({ ...base, action: "reverted", error: String(e.message || e).slice(0, 300) });
  }
  console.log(`   win rate ${winRate()}  (wins ${stats.wins} / sent ${stats.sent}, skipped before sending ${stats.skipped}, profit ${fmt(stats.profit)} tUSD)`);
}

const STARTED_AT = new Date().toISOString();
const stats = { cycles: 0, sent: 0, wins: 0, losses: 0, skipped: 0, atlasReads: 0, profit: 0n, lastSig: null, held: 0 };
const winRate = () => (stats.sent ? `${((100 * stats.wins) / stats.sent).toFixed(1)}%` : "n/a");

console.log(`Arbiter Solana devnet bot  wallet=${bot.publicKey.toBase58()}  vault=${vaultPda(st.mintA).toBase58()}  gate=${ATLAS_GATE}`);
const vaultLiquidity = await tokenBalance(vaultTokensPda(vaultPda(st.mintA)));
console.log(`vault liquidity: ${fmt(vaultLiquidity)} tUSD`);
console.log(`control (from ATLAS-QUANT panel): ${JSON.stringify(await readControl())}`);
for (let n = 1; n <= maxCycles; n++) {
  try { await cycle(n); } catch (e) { console.log(`   cycle error: ${e.message}`); log({ kind: "error", n, error: String(e.message) }); }
  if (!loopSec) break;
  if (noise && n < maxCycles) { try { await pushNoise(); } catch (e) { console.log(`   noise error: ${e.message}`); } }
  if (n < maxCycles) await new Promise((r) => setTimeout(r, loopSec * 1000));
}
console.log(`\nFINAL win rate ${winRate()}  wins=${stats.wins} losses=${stats.losses} sent=${stats.sent} skipped_before_send=${stats.skipped} profit=${fmt(stats.profit)} tUSD`);
log({ kind: "final", ...stats, profit: fmt(stats.profit), win_rate: winRate() });
try { writeLedger(); } catch (e) { console.log(`ledger write failed: ${e.message}`); }
if (stats.sent >= 5 && stats.wins * 100 < stats.sent * 91) process.exitCode = 1; // below target → red run
