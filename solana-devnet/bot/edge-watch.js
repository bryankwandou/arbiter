// Dry run, no orders or transactions. Measures, round after round, the net edge
// of every strategy we can observe with public data and no capital:
//   cex-dex   Backpack SOL_USDC book vs best on-chain route (both directions)
//   lst-tri   USDC→SOL→LST→USDC and USDC→LST→SOL→USDC (JitoSOL, mSOL, bSOL, jupSOL)
//   peg       USDC→stable→USDC round trips (USDT, PYUSD)
// Net = gross minus the costs that strategy really pays. Lines go to edge-watch.jsonl.
//   node edge-watch.js [rounds]      (default: forever)
//   node edge-watch.js --summary     (aggregate edge-watch.jsonl)
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const LOG = new URL("./edge-watch.jsonl", import.meta.url);
const JUP = "https://lite-api.jup.ag/swap/v1";
const BP = "https://api.backpack.exchange/api/v1";
const M = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", SOL: "So11111111111111111111111111111111111111112",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  JitoSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", mSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  bSOL: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", jupSOL: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
};
const DEC = { USDC: 6, USDT: 6, PYUSD: 6, SOL: 9, JitoSOL: 9, mSOL: 9, bSOL: 9, jupSOL: 9 };
const USD = Number(process.env.SIZE_USD || 1000);         // notional per test
const TAKER_BPS = Number(process.env.TAKER_BPS || 10);    // Backpack taker
const TX_USD = Number(process.env.TX_USD || 0.01);        // priority fee + tip, atomic strategies
const GAP = Number(process.env.QUOTE_GAP_MS || 1500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.status === 429) { await sleep(10000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error("rate limited");
}
// Legs of one cycle are quoted back to back (LEG_GAP) so the price cannot drift
// between them and fake an edge; the rate-limit pause goes between cycles.
const LEG_GAP = Number(process.env.LEG_GAP_MS || 150);
async function quote(a, b, raw) {
  await sleep(LEG_GAP);
  const j = await get(`${JUP}/quote?inputMint=${M[a]}&outputMint=${M[b]}&amount=${raw}&slippageBps=0`);
  return BigInt(j.outAmount);
}
async function cycle(path) { // path starts and ends at USDC; returns USDC out
  await sleep(GAP * (path.length - 1));
  let x = BigInt(USD * 10 ** DEC.USDC);
  for (let i = 0; i < path.length - 1; i++) x = await quote(path[i], path[i + 1], x);
  return Number(x) / 10 ** DEC.USDC;
}
function walk(levels, size) {
  let left = size, cost = 0;
  for (const [p, q] of levels) { const t = Math.min(left, q); cost += t * p; left -= t; if (left <= 0) return cost / size; }
  return NaN;
}
function log(strategy, route, grossBps, costBps) {
  const line = { t: new Date().toISOString(), strategy, route, usd: USD, gross_bps: +grossBps.toFixed(2), net_bps: +(grossBps - costBps).toFixed(2) };
  appendFileSync(LOG, JSON.stringify(line) + "\n");
  console.log(`${line.t} ${strategy.padEnd(8)} ${route.padEnd(28)} gross ${String(line.gross_bps).padStart(7)}  net ${String(line.net_bps).padStart(7)} bps${line.net_bps > 0 ? "  <-- EDGE" : ""}`);
}
const atomicCost = () => (TX_USD / USD) * 1e4; // flash loan via MarginFi: 0 fee

async function cexDex() {
  await sleep(GAP * 2);
  const d = await get(`${BP}/depth?symbol=SOL_USDC`);
  const lv = (a) => a.map(([p, q]) => [Number(p), Number(q)]);
  const asks = lv(d.asks).sort((a, b) => a[0] - b[0]), bids = lv(d.bids).sort((a, b) => b[0] - a[0]);
  const sol = USD / asks[0][0];
  const ask = walk(asks, sol), bid = walk(bids, sol);
  const sellPx = Number(await quote("SOL", "USDC", BigInt(Math.round(sol * 1e9)))) / 1e6 / sol;
  const buyPx = USD / (Number(await quote("USDC", "SOL", BigInt(USD * 1e6))) / 1e9);
  const cost = TAKER_BPS + atomicCost();
  log("cex-dex", "buy BP, sell chain", (sellPx / ask - 1) * 1e4, cost);
  log("cex-dex", "buy chain, sell BP", (bid / buyPx - 1) * 1e4, cost);
}
async function routes(strategy, paths) {
  for (const p of paths) {
    try { log(strategy, p.join("→"), ((await cycle(p)) / USD - 1) * 1e4, atomicCost()); }
    catch (e) { console.log(`${strategy} ${p.join("→")}: ${e.message}`); }
  }
}
const LST = ["JitoSOL", "mSOL", "bSOL", "jupSOL"];
const LST_PATHS = LST.flatMap((l) => [["USDC", "SOL", l, "USDC"], ["USDC", l, "SOL", "USDC"]]);
const PEG_PATHS = ["USDT", "PYUSD"].map((s) => ["USDC", s, "USDC"]);

function summary() {
  if (!existsSync(LOG)) return console.log("no data");
  const rows = readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const by = {};
  for (const r of rows) (by[`${r.strategy} | ${r.route}`] ||= []).push(r.net_bps);
  const out = ["| strategy \\| route | samples | edges > 0 | best net bps | median net bps |", "|---|---|---|---|---|"];
  for (const [k, v] of Object.entries(by).sort()) {
    const s = [...v].sort((a, b) => a - b);
    out.push(`| ${k} | ${v.length} | ${v.filter((x) => x > 0).length} | ${s.at(-1)} | ${s[s.length >> 1]} |`);
  }
  console.log(`Edge watch: ${rows.length} samples, ${rows[0].t} → ${rows.at(-1).t}, $${rows[0].usd} notional\n\n${out.join("\n")}`);
}

if (process.argv[2] === "--summary") summary();
else {
  const rounds = Number(process.argv[2] || Infinity);
  for (let n = 1; n <= rounds; n++) {
    try { await cexDex(); } catch (e) { console.log(`cex-dex: ${e.message}`); }
    await routes("lst-tri", LST_PATHS);
    await routes("peg", PEG_PATHS);
  }
}
