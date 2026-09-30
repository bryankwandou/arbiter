// Dry run, no orders or transactions. Measures, round after round and at several
// sizes, the net edge of every strategy we can observe with public data:
//   dex    USDC→X→USDC round trips: buy on the cheapest pool, sell on the richest
//   tri    USDC→SOL→X→USDC and USDC→X→SOL→USDC triangles
//   lst    SOL / liquid-staking-token triangles and LST↔LST loops
//   peg    stablecoin round trips (USDT, PYUSD, USDG)
//   cex    CEX book vs best on-chain route (cex-dex) and CEX vs CEX (cex-cex):
//          Backpack, OKX, Coinbase, Kraken
//   stock  tokenized stocks (xStocks) vs the underlying share price
//   stat   paper mean-reversion trades on correlated pairs, entered and exited
//          at real quotes, so every closed trade is a realistic P&L
// Net = gross minus the costs that strategy really pays. Lines go to $LOG.
//   STRATEGY=dex,tri SIZES=100,1000 node edge-watch.js [rounds]   (default: all, forever)
//   node edge-watch.js --summary [file.jsonl ...]
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const LOG = new URL(process.env.LOG || "./edge-watch.jsonl", import.meta.url);
const JUP = "https://lite-api.jup.ag/swap/v1";
const T = { // symbol: [mint, decimals]
  USDC: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6], SOL: ["So11111111111111111111111111111111111111112", 9],
  USDT: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6], PYUSD: ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", 6],
  USDG: ["2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", 6],
  JitoSOL: ["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", 9], mSOL: ["mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", 9],
  bSOL: ["bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", 9], jupSOL: ["jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", 9],
  JUP: ["JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", 6], JTO: ["jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", 9],
  RAY: ["4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", 6], BONK: ["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", 5],
  WIF: ["EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", 6],
  TSLAx: ["XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", 8], NVDAx: ["Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", 8],
  AAPLx: ["XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", 8], SPYx: ["XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", 8],
  MSTRx: ["XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", 8], COINx: ["Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", 8],
};
const SIZES = (process.env.SIZES || "100,1000,10000").split(",").map(Number); // USD notional
const TX_USD = Number(process.env.TX_USD || 0.01);      // priority fee + tip per landed tx
const HEDGE_BPS = Number(process.env.HEDGE_BPS || 10);  // broker fee on the stock hedge leg
const RPM = Number(process.env.JUP_RPM || 50);          // Jupiter lite-api budget per runner

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 edge-watch" } });
    if (r.status === 429) { await sleep(10000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error("rate limited");
}
// Reserve n Jupiter calls up front so the legs of one cycle are quoted back to
// back; a wait in the middle would let the price drift and fake an edge.
const calls = [];
async function budget(n) {
  for (;;) {
    const now = Date.now();
    while (calls.length && now - calls[0] > 60000) calls.shift();
    if (calls.length + n <= RPM) { for (let i = 0; i < n; i++) calls.push(now); return; }
    await sleep(60000 - (now - calls[0]) + 50);
  }
}
async function quote(a, b, amount) {
  const j = await get(`${JUP}/quote?inputMint=${T[a][0]}&outputMint=${T[b][0]}&amount=${amount}&slippageBps=0`);
  return BigInt(j.outAmount);
}
const units = (s, x) => Number(x) / 10 ** T[s][1];
const raw = (s, x) => BigInt(Math.round(x * 10 ** T[s][1]));
const atomic = (usd) => (TX_USD / usd) * 1e4;
function log(strategy, route, usd, grossBps, costBps) {
  const line = { t: new Date().toISOString(), strategy, route, usd, gross_bps: +grossBps.toFixed(2), net_bps: +(grossBps - costBps).toFixed(2) };
  appendFileSync(LOG, JSON.stringify(line) + "\n");
  console.log(`${line.t} ${strategy.padEnd(7)} ${String(usd).padStart(5)} ${route.padEnd(30)} gross ${String(line.gross_bps).padStart(8)}  net ${String(line.net_bps).padStart(8)} bps${line.net_bps > 0 ? "  <-- EDGE" : ""}`);
}

async function cycles(strategy, paths, usd, px = {}) {
  for (const p of paths) {
    try {
      const inAmt = raw(p[0], usd / (p[0] === "USDC" ? 1 : px[p[0]]));
      await budget(p.length - 1);
      let x = inAmt;
      for (let i = 0; i < p.length - 1; i++) x = await quote(p[i], p[i + 1], x);
      log(strategy, p.join("→"), usd, (Number(x) / Number(inAmt) - 1) * 1e4, atomic(usd));
    } catch (e) { console.log(`${strategy} ${p.join("→")} ${usd}: ${e.message}`); }
  }
}

const ALTS = ["JUP", "JTO", "RAY", "BONK", "WIF"];
const LST = ["JitoSOL", "mSOL", "bSOL", "jupSOL"];
const dex = (usd) => cycles("dex", ["SOL", "USDT", ...ALTS, "JitoSOL"].map((x) => ["USDC", x, "USDC"]), usd);
const tri = (usd) => cycles("tri", ALTS.flatMap((x) => [["USDC", "SOL", x, "USDC"], ["USDC", x, "SOL", "USDC"]]), usd);
const peg = (usd) => cycles("peg", [["USDC", "USDT", "USDC"], ["USDC", "PYUSD", "USDC"], ["USDC", "USDG", "USDC"],
  ["USDC", "USDT", "PYUSD", "USDC"], ["USDC", "USDG", "USDT", "USDC"]], usd);
async function lst(usd) {
  await budget(1);
  const px = { SOL: units("USDC", await quote("SOL", "USDC", raw("SOL", 1))) };
  await cycles("lst", [
    ...LST.flatMap((l) => [["USDC", "SOL", l, "USDC"], ["USDC", l, "SOL", "USDC"], ["SOL", l, "SOL"]]),
    ["SOL", "JitoSOL", "jupSOL", "SOL"], ["SOL", "jupSOL", "JitoSOL", "SOL"], ["SOL", "mSOL", "bSOL", "SOL"],
  ], usd, px);
}

// Taker fees at the entry tier (assumed; a real account may pay less with volume).
const VENUES = {
  backpack: { fee: 10, book: async (s) => { const d = await get(`https://api.backpack.exchange/api/v1/depth?symbol=${s}_USDC`); return [d.asks, d.bids]; } },
  okx: { fee: 10, book: async (s) => { const d = (await get(`https://www.okx.com/api/v5/market/books?instId=${s}-USDC&sz=200`)).data[0]; return [d.asks, d.bids]; } },
  coinbase: { fee: 60, book: async (s) => { const d = await get(`https://api.exchange.coinbase.com/products/${s}-USD/book?level=2`); return [d.asks, d.bids]; } },
  kraken: { fee: 40, book: async (s) => { const d = Object.values((await get(`https://api.kraken.com/0/public/Depth?pair=${s}USD&count=200`)).result)[0]; return [d.asks, d.bids]; } },
};
const CEX_SYMS = ["SOL", "JUP", "JTO", "BONK", "WIF", "RAY", "USDT"];
const dead = new Set(); // venue:symbol markets that do not exist
function walk(levels, size) {
  let left = size, cost = 0;
  for (const [p, q] of levels) { const t = Math.min(left, q); cost += t * p; left -= t; if (left <= 0) return cost / size; }
  return NaN; // book too thin for this size
}
async function books(sym) {
  const out = {};
  await Promise.all(Object.entries(VENUES).map(async ([v, { book }]) => {
    if (dead.has(`${v}:${sym}`)) return;
    try {
      const [a, b] = await book(sym);
      const lv = (x) => x.map((l) => [Number(l[0]), Number(l[1])]);
      out[v] = { asks: lv(a).sort((x, y) => x[0] - y[0]), bids: lv(b).sort((x, y) => y[0] - x[0]) };
      if (!out[v].asks.length || !out[v].bids.length) throw new Error("empty book");
    } catch (e) { delete out[v]; if (/HTTP 4|empty|undefined|Cannot/.test(e.message)) dead.add(`${v}:${sym}`); }
  }));
  return out;
}
async function cex(usd) {
  for (const sym of CEX_SYMS) {
    try {
      // chain quotes and books back to back, so both describe the same moment
      await budget(2);
      const buyOut = await quote("USDC", sym, raw("USDC", usd));
      const base = units(sym, buyOut);
      const sellUsd = units("USDC", await quote(sym, "USDC", buyOut));
      const bk = await books(sym);
      const buyPx = usd / base, sellPx = sellUsd / base;
      for (const [v, { asks, bids }] of Object.entries(bk)) {
        const ask = walk(asks, base), bid = walk(bids, base), fee = VENUES[v].fee;
        if (!isNaN(ask)) log("cex-dex", `${sym} ${v}→chain`, usd, (sellPx / ask - 1) * 1e4, fee + atomic(usd));
        if (!isNaN(bid)) log("cex-dex", `${sym} chain→${v}`, usd, (bid / buyPx - 1) * 1e4, fee + atomic(usd));
        for (const [w, o] of Object.entries(bk)) {
          if (w === v) continue;
          const bid2 = walk(o.bids, base);
          if (!isNaN(ask) && !isNaN(bid2)) log("cex-cex", `${sym} ${v}→${w}`, usd, (bid2 / ask - 1) * 1e4, fee + VENUES[w].fee);
        }
      }
    } catch (e) { console.log(`cex ${sym} ${usd}: ${e.message}`); }
  }
}

const STOCKS = { TSLAx: "TSLA", NVDAx: "NVDA", AAPLx: "AAPL", SPYx: "SPY", MSTRx: "MSTR", COINx: "COIN" };
async function underlying(sym) { // last 1-minute print incl. pre/post market, and its age
  const r = (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=true`)).chart.result[0];
  const ts = r.timestamp || [], c = r.indicators?.quote?.[0]?.close || [];
  for (let i = ts.length - 1; i >= 0; i--) if (c[i] != null) return { px: c[i], age: Date.now() / 1000 - ts[i] };
  return { px: r.meta.regularMarketPrice, age: Date.now() / 1000 - r.meta.regularMarketTime };
}
async function stock(usd) {
  for (const [x, sym] of Object.entries(STOCKS)) {
    try {
      await budget(2);
      const shares = await quote("USDC", x, raw("USDC", usd));
      const sellUsd = units("USDC", await quote(x, "USDC", shares));
      const u = await underlying(sym);
      const n = units(x, shares), live = u.age < 180 ? "live" : "closed";
      // closed = no hedge venue open: the position carries gap risk until the next open
      log("stock", `${x} sell chain, buy ${sym} (${live})`, usd, (sellUsd / n / u.px - 1) * 1e4, HEDGE_BPS + atomic(usd));
      log("stock", `${x} buy chain, sell ${sym} (${live})`, usd, (u.px / (usd / n) - 1) * 1e4, HEDGE_BPS + atomic(usd));
    } catch (e) { console.log(`stock ${x} ${usd}: ${e.message}`); }
  }
}

// Paper stat-arb: when A is rich against B (z > ENTRY), swap A→B at a real quote;
// swap back at a real quote when the ratio returns to its mean (or after MAX_HOLD
// observations). Only closed trades are logged; their P&L includes every pool fee.
const PAIRS = [["JitoSOL", "mSOL"], ["mSOL", "JitoSOL"], ["jupSOL", "JitoSOL"], ["JitoSOL", "jupSOL"],
  ["BONK", "WIF"], ["WIF", "BONK"], ["JUP", "JTO"], ["JTO", "JUP"]];
const WINDOW = 60, ENTRY = 2, MAX_HOLD = 120, st = {};
async function stat(usd) {
  for (const [a, b] of PAIRS) {
    const s = (st[`${a}/${b}@${usd}`] ||= { hist: [], pos: null });
    try {
      await budget(s.pos ? 3 : 2);
      const aIn = await quote("USDC", a, raw("USDC", usd));
      const bOut = await quote(a, b, aIn);
      const r = units(b, bOut) / units(a, aIn); // B per A: high means A is rich
      const h = s.hist, mean = h.reduce((m, v) => m + v, 0) / (h.length || 1);
      const sd = Math.sqrt(h.reduce((m, v) => m + (v - mean) ** 2, 0) / (h.length || 1));
      const z = h.length >= WINDOW / 2 && sd > 0 ? (r - mean) / sd : 0;
      if (s.pos) {
        s.pos.age++;
        if (r <= mean || s.pos.age >= MAX_HOLD) {
          const aBack = await quote(b, a, s.pos.bHeld);
          log("stat", `${a}→${b}→${a} z${s.pos.z.toFixed(1)} held ${s.pos.age}`, usd,
            (Number(aBack) / Number(s.pos.aIn) - 1) * 1e4, 2 * atomic(usd));
          s.pos = null;
        }
      } else if (z > ENTRY) s.pos = { aIn, bHeld: bOut, z, age: 0 };
      h.push(r); if (h.length > WINDOW) h.shift();
    } catch (e) { console.log(`stat ${a}/${b} ${usd}: ${e.message}`); }
  }
}

const STRATS = { dex, tri, lst, peg, cex, stock, stat };

function summary(files) {
  const rows = files.filter((f) => existsSync(f)).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  if (!rows.length) return console.log("no data");
  rows.sort((a, b) => a.t.localeCompare(b.t));
  const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const group = (key) => { const g = {}; for (const r of rows) (g[key(r)] ||= []).push(r); return g; };
  const out = [`## Edge watch: ${rows.length} samples, ${rows[0].t} → ${rows.at(-1).t}`, "",
    "| strategy | samples | net > 0 | share > 0 | best net bps | median net bps | best route |", "|---|---|---|---|---|---|---|"];
  for (const [k, v] of Object.entries(group((r) => r.strategy)).sort()) {
    const best = v.reduce((m, r) => (r.net_bps > m.net_bps ? r : m));
    const pos = v.filter((r) => r.net_bps > 0).length;
    out.push(`| ${k} | ${v.length} | ${pos} | ${(100 * pos / v.length).toFixed(1)}% | ${best.net_bps} | ${med(v.map((r) => r.net_bps))} | ${best.route} @ $${best.usd} |`);
  }
  out.push("", "### Routes by best net edge (top 40)", "", "| strategy | route | $ | samples | net > 0 | best | median |", "|---|---|---|---|---|---|---|");
  const routes = Object.values(group((r) => `${r.strategy}|${r.route}|${r.usd}`)).map((v) => ({
    r: v[0], n: v.length, pos: v.filter((x) => x.net_bps > 0).length, best: Math.max(...v.map((x) => x.net_bps)), med: med(v.map((x) => x.net_bps)),
  })).sort((a, b) => b.best - a.best).slice(0, 40);
  for (const x of routes) out.push(`| ${x.r.strategy} | ${x.r.route} | ${x.r.usd} | ${x.n} | ${x.pos} | ${x.best} | ${x.med} |`);
  console.log(out.join("\n"));
}

if (process.argv[2] === "--summary") summary(process.argv.length > 3 ? process.argv.slice(3) : [LOG]);
else {
  const pick = (process.env.STRATEGY || Object.keys(STRATS).join(",")).split(",");
  for (const s of pick) if (!STRATS[s]) throw new Error(`unknown strategy ${s}`);
  const rounds = Number(process.argv[2] || Infinity);
  for (let n = 1; n <= rounds; n++)
    for (const s of pick) for (const usd of SIZES) {
      try { await STRATS[s](usd); } catch (e) { console.log(`${s} ${usd}: ${e.message}`); }
    }
}
