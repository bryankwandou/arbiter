// Dry run, no orders and no signed transactions. Measures the net edge of every
// strategy we can observe with public data. Lines go to $LOG (jsonl).
//
// Round-based (repeated at every size in SIZES):
//   dex    USDC→X→USDC round trips: buy on the cheapest pool, sell on the richest
//   tri    USDC→SOL→X→USDC and USDC→X→SOL→USDC triangles
//   lst    SOL / liquid-staking-token triangles and LST↔LST loops
//   peg    stablecoin round trips (USDT, PYUSD, USDG)
//   wide   dex + tri over the top ~100 traded tokens (sharded: SHARD / NSHARD)
//   cex    CEX book vs best on-chain route (cex-dex) and CEX vs CEX (cex-cex)
//   stock  tokenized stocks (xStocks) vs the underlying share price
//   stat   paper mean-reversion trades on correlated pairs at real quotes
// Watchers (run until killed):
//   fast   event-driven cex-dex: Backpack + OKX WebSocket tops; the moment a
//          book moves MOVE_BPS the chain is quoted (plus an idle baseline/min)
//   titan  the Solana Fall School demo loop: Backpack bookTicker vs Titan
//          (DART) quotes, both directions, slide's COSTS formula
//   launch paper-buy tokens right after they graduate from a launchpad and
//          sell them 30 s … 15 min later, at real quotes
//   liq    every Kamino / MarginFi liquidation on mainnet: winner, profit,
//          failed competing attempts
//   liqbot dry-run MarginFi receivership liquidator on every account someone
//          tried to liquidate: health, repay size, swap quote, net profit
//   carry  funding-rate carry: long spot, short perp (Backpack, Hyperliquid, OKX)
//
// Execution check (SIM=1, default): atomic USDC cycles that quote positive, plus
// a random 1-in-SIM_EVERY baseline, are rebuilt as one real transaction from
// Jupiter's swap instructions and simulated on mainnet (sigVerify off, as a
// large public wallet, output into a fixed account), so "sim-*" rows show what
// would really have come back — or why it would have failed.
//
//   STRATEGY=dex,tri SIZES=10,1000 node edge-watch.js [rounds]
//   node edge-watch.js --summary [file.jsonl ...]
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const LOG = new URL(process.env.LOG || "./edge-watch.jsonl", import.meta.url);
const JUP = "https://lite-api.jup.ag/swap/v1";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
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
const SIZES = (process.env.SIZES || "5,10,100,1000,10000").split(",").map(Number); // USD notional
const TX_USD = Number(process.env.TX_USD || 0.01);      // priority fee + tip per landed tx
const HEDGE_BPS = Number(process.env.HEDGE_BPS || 10);  // broker fee on the stock hedge leg
const RPM = Number(process.env.JUP_RPM || 50);          // Jupiter lite-api budget per runner

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, init) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { ...init, headers: { "user-agent": "Mozilla/5.0 edge-watch", ...init?.headers }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { await sleep(10000); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error("rate limited");
}
const post = (url, body) => get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rpc = async (method, params) => { const j = await post(RPC, { jsonrpc: "2.0", id: 1, method, params }); if (j.error) throw new Error(j.error.message); return j.result; };

// Reserve n Jupiter calls up front so the legs of one cycle are quoted back to
// back; a wait in the middle would let the price drift and fake an edge.
const calls = [];
const prune = () => { const now = Date.now(); while (calls.length && now - calls[0] > 60000) calls.shift(); };
function tryBudget(n) { prune(); if (calls.length + n > RPM) return false; for (let i = 0; i < n; i++) calls.push(Date.now()); return true; }
async function budget(n) { while (!tryBudget(n)) await sleep(60000 - (Date.now() - calls[0]) + 50); }
const quote = (a, b, amount) => get(`${JUP}/quote?inputMint=${T[a][0]}&outputMint=${T[b][0]}&amount=${amount}&slippageBps=0`);
const units = (s, x) => Number(x) / 10 ** T[s][1];
const raw = (s, x) => BigInt(Math.round(x * 10 ** T[s][1]));
const atomic = (usd) => (TX_USD / usd) * 1e4;
function log(strategy, route, usd, grossBps, costBps, extra = {}) {
  const line = { t: new Date().toISOString(), strategy, route, usd, gross_bps: +grossBps.toFixed(2), net_bps: +(grossBps - costBps).toFixed(2), ...extra };
  appendFileSync(LOG, JSON.stringify(line) + "\n");
  console.log(`${line.t} ${strategy.padEnd(9)} ${String(usd).padStart(6)} ${route.padEnd(34)} gross ${String(line.gross_bps).padStart(8)}  net ${String(line.net_bps).padStart(8)} bps${line.net_bps > 0 ? "  <-- EDGE" : ""}`);
  return line.net_bps;
}
function logFail(strategy, route, usd, reason) {
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), strategy, route, usd, ok: false, reason }) + "\n");
  console.log(`${new Date().toISOString()} ${strategy.padEnd(9)} ${String(usd).padStart(6)} ${route.padEnd(34)} FAILED: ${reason}`);
}

// ── execution check ─────────────────────────────────────────────────────────
const SIM = process.env.SIM !== "0";
const SIM_EVERY = Number(process.env.SIM_EVERY || 20);
let web3, SIM_WALLET, SIM_DEST;
const altCache = new Map();
async function simInit() {
  if (web3) return;
  web3 = await import("@solana/web3.js");
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  // Binance's public hot wallet: holds hundreds of millions of USDC, so any leg
  // can be funded. Simulation needs no signature; nothing is ever sent.
  SIM_WALLET = new web3.PublicKey(process.env.SIM_WALLET || "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  // Output lands in an account nobody else writes to (ETcQ's USDC), so its
  // simulated post-balance minus its current balance is exactly what came back.
  SIM_DEST = getAssociatedTokenAddressSync(new web3.PublicKey(T.USDC[0]),
    new web3.PublicKey(process.env.SIM_DEST_OWNER || "ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m"), true);
}
const toIx = (i) => new web3.TransactionInstruction({
  programId: new web3.PublicKey(i.programId),
  keys: i.accounts.map((a) => ({ pubkey: new web3.PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, "base64"),
});
async function lookupTables(addrs) {
  const missing = addrs.filter((a) => !altCache.has(a));
  if (missing.length) {
    const infos = await rpc("getMultipleAccounts", [missing, { encoding: "base64" }]);
    infos.value.forEach((info, i) => {
      if (info) altCache.set(missing[i], new web3.AddressLookupTableAccount({
        key: new web3.PublicKey(missing[i]), state: web3.AddressLookupTableAccount.deserialize(Buffer.from(info.data[0], "base64")),
      }));
    });
  }
  return addrs.map((a) => altCache.get(a)).filter(Boolean);
}
async function simulate(strategy, path, usd, inAmt, qs) {
  const name = `sim-${strategy}`, route = path.join("→");
  try {
    await simInit();
    await budget(qs.length);
    const legs = [];
    for (let i = 0; i < qs.length; i++) {
      const last = i === qs.length - 1;
      legs.push(await post(`${JUP}/swap-instructions`, {
        quoteResponse: qs[i], userPublicKey: SIM_WALLET.toBase58(), wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false,
        ...(last ? { destinationTokenAccount: SIM_DEST.toBase58() } : {}),
      }));
    }
    const ixs = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...legs.flatMap((l) => l.setupInstructions.map(toIx)), ...legs.map((l) => toIx(l.swapInstruction))];
    const alts = await lookupTables([...new Set(legs.flatMap((l) => l.addressLookupTableAddresses))]);
    const { value: { blockhash } } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    let wire;
    try {
      const msg = new web3.TransactionMessage({ payerKey: SIM_WALLET, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts);
      wire = Buffer.from(new web3.VersionedTransaction(msg).serialize()).toString("base64");
    } catch { return logFail(name, route, usd, "tx too large for one transaction"); }
    const pre = BigInt((await rpc("getTokenAccountBalance", [SIM_DEST.toBase58(), { commitment: "confirmed" }])).value.amount);
    const sim = (await rpc("simulateTransaction", [wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true,
      commitment: "confirmed", accounts: { encoding: "base64", addresses: [SIM_DEST.toBase58()] } }])).value;
    if (sim.err) {
      const msg = (sim.logs || []).map((l) => l.match(/Error Message: (.*)/)?.[1]).find(Boolean);
      return logFail(name, route, usd, msg || JSON.stringify(sim.err));
    }
    const out = Buffer.from(sim.accounts[0].data[0], "base64").readBigUInt64LE(64) - pre;
    log(name, route, usd, (Number(out) / Number(inAmt) - 1) * 1e4, atomic(usd), { cu: sim.unitsConsumed });
  } catch (e) { console.log(`${name} ${route} ${usd}: ${e.message}`); }
}

async function cycles(strategy, paths, usd, px = {}) {
  for (const p of paths) {
    try {
      const inAmt = raw(p[0], usd / (p[0] === "USDC" ? 1 : px[p[0]]));
      await budget(p.length - 1);
      const qs = [];
      let x = inAmt;
      for (let i = 0; i < p.length - 1; i++) { const q = await quote(p[i], p[i + 1], x); qs.push(q); x = BigInt(q.outAmount); }
      const net = log(strategy, p.join("→"), usd, (Number(x) / Number(inAmt) - 1) * 1e4, atomic(usd));
      if (SIM && p[0] === "USDC" && (net > 0 || Math.random() < 1 / SIM_EVERY)) await simulate(strategy, p, usd, inAmt, qs);
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
  const px = { SOL: units("USDC", (await quote("SOL", "USDC", raw("SOL", 1))).outAmount) };
  await cycles("lst", [
    ...LST.flatMap((l) => [["USDC", "SOL", l, "USDC"], ["USDC", l, "SOL", "USDC"], ["SOL", l, "SOL"]]),
    ["SOL", "JitoSOL", "jupSOL", "SOL"], ["SOL", "jupSOL", "JitoSOL", "SOL"], ["SOL", "mSOL", "bSOL", "SOL"],
  ], usd, px);
}

// Top traded tokens with real liquidity, refreshed hourly; each shard takes
// every NSHARD-th token so the jobs split the list without talking to each other.
const SHARD = Number(process.env.SHARD || 0), NSHARD = Number(process.env.NSHARD || 1);
const WIDE_MIN_LIQ = Number(process.env.WIDE_MIN_LIQ || 300000);
let universe = { at: 0, syms: [] };
async function wideTokens() {
  if (Date.now() - universe.at < 3600000 && universe.syms.length) return universe.syms;
  const list = new Map();
  for (const e of ["toptraded/24h", "toporganicscore/24h", "toptrending/24h", "toptraded/1h", "toptrending/1h"]) {
    await budget(1);
    for (const t of await get(`https://lite-api.jup.ag/tokens/v2/${e}?limit=100`)) list.set(t.id, t);
  }
  const known = new Set(Object.values(T).map(([m]) => m));
  const picked = [...list.values()].filter((t) => !known.has(t.id) && (t.liquidity || 0) >= WIDE_MIN_LIQ)
    .sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % NSHARD === SHARD);
  universe = { at: Date.now(), syms: picked.map((t) => {
    const key = T[t.symbol] ? `${t.symbol}.${t.id.slice(0, 4)}` : t.symbol;
    T[key] = [t.id, t.decimals];
    return key;
  }) };
  console.log(`wide shard ${SHARD}/${NSHARD}: ${universe.syms.length} tokens: ${universe.syms.join(" ")}`);
  return universe.syms;
}
const wide = async (usd) => cycles("wide", (await wideTokens()).flatMap((x) =>
  [["USDC", x, "USDC"], ["USDC", "SOL", x, "USDC"], ["USDC", x, "SOL", "USDC"]]), usd);

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
      const buyOut = BigInt((await quote("USDC", sym, raw("USDC", usd))).outAmount);
      const base = units(sym, buyOut);
      const sellUsd = units("USDC", (await quote(sym, "USDC", buyOut)).outAmount);
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
// xStocks are Token-2022 mints with a scaled-UI-amount multiplier that grows as
// dividends are paid: one raw token is `multiplier` shares. Without it SPYx
// shows a fake ~57 bps premium. Refreshed every 10 minutes.
const mult = {};
async function multiplier(x) {
  if (mult[x] && Date.now() - mult[x].at < 600000) return mult[x].v;
  const acc = await rpc("getAccountInfo", [T[x][0], { encoding: "jsonParsed" }]);
  const s = acc.value.data.parsed.info.extensions?.find((e) => e.extension === "scaledUiAmountConfig")?.state;
  const v = !s ? 1 : Number(Date.now() / 1000 >= s.newMultiplierEffectiveTimestamp ? s.newMultiplier : s.multiplier);
  mult[x] = { v, at: Date.now() };
  return v;
}
async function stock(usd) {
  for (const [x, sym] of Object.entries(STOCKS)) {
    try {
      const m = await multiplier(x);
      await budget(2);
      const shares = BigInt((await quote("USDC", x, raw("USDC", usd))).outAmount);
      const sellUsd = units("USDC", (await quote(x, "USDC", shares)).outAmount);
      const u = await underlying(sym);
      const n = units(x, shares) * m, live = u.age < 180 ? "live" : "closed";
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
      const aIn = BigInt((await quote("USDC", a, raw("USDC", usd))).outAmount);
      const bOut = BigInt((await quote(a, b, aIn)).outAmount);
      const r = units(b, bOut) / units(a, aIn); // B per A: high means A is rich
      const h = s.hist, mean = h.reduce((m, v) => m + v, 0) / (h.length || 1);
      const sd = Math.sqrt(h.reduce((m, v) => m + (v - mean) ** 2, 0) / (h.length || 1));
      const z = h.length >= WINDOW / 2 && sd > 0 ? (r - mean) / sd : 0;
      if (s.pos) {
        s.pos.age++;
        if (r <= mean || s.pos.age >= MAX_HOLD) {
          const aBack = BigInt((await quote(b, a, s.pos.bHeld)).outAmount);
          log("stat", `${a}→${b}→${a}`, usd, (Number(aBack) / Number(s.pos.aIn) - 1) * 1e4, 2 * atomic(usd), { z: +s.pos.z.toFixed(2), held: s.pos.age });
          s.pos = null;
        }
      } else if (z > ENTRY) s.pos = { aIn, bHeld: bOut, z, age: 0 };
      h.push(r); if (h.length > WINDOW) h.shift();
    } catch (e) { console.log(`stat ${a}/${b} ${usd}: ${e.message}`); }
  }
}

// ── watchers ────────────────────────────────────────────────────────────────
function socket(url, onOpen, onMsg, pingMs = 0) {
  const connect = () => {
    const ws = new WebSocket(url);
    let ping;
    ws.onopen = () => { onOpen(ws); if (pingMs) ping = setInterval(() => ws.send("ping"), pingMs); };
    ws.onmessage = (e) => { try { onMsg(typeof e.data === "string" ? e.data : e.data.toString()); } catch {} };
    ws.onclose = () => { clearInterval(ping); setTimeout(connect, 3000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  connect();
}

// Event-driven cex-dex. A move of MOVE_BPS on a CEX top of book fires a chain
// quote at once; an idle check every minute is the baseline to compare against.
// Uses the top level only, so sizes stay small (FAST_SIZES).
const FAST_SYMS = ["SOL", "JUP", "BONK", "WIF", "JTO"];
async function fast() {
  const MOVE = Number(process.env.MOVE_BPS || 5);
  const FAST_SIZES = (process.env.FAST_SIZES || "10,100").split(",").map(Number);
  const top = {}, ref = {}, busy = new Set();
  async function check(sym, kind) {
    if (busy.has(sym) || !tryBudget(2 * FAST_SIZES.length)) return;
    busy.add(sym);
    try {
      for (const usd of FAST_SIZES) {
        const buy = BigInt((await quote("USDC", sym, raw("USDC", usd))).outAmount);
        const base = units(sym, buy);
        const sellPx = units("USDC", (await quote(sym, "USDC", buy)).outAmount) / base, buyPx = usd / base;
        for (const [k, b] of Object.entries(top)) {
          const [v, s] = k.split(":");
          if (s !== sym) continue;
          const cost = VENUES[v].fee + atomic(usd);
          if (b.aq >= base) log("fast", `${sym} ${v}→chain (${kind})`, usd, (sellPx / b.ask - 1) * 1e4, cost);
          if (b.bq >= base) log("fast", `${sym} chain→${v} (${kind})`, usd, (b.bid / buyPx - 1) * 1e4, cost);
          ref[k] = (b.bid + b.ask) / 2;
        }
      }
    } catch (e) { console.log(`fast ${sym}: ${e.message}`); } finally { busy.delete(sym); }
  }
  const onTop = (v, sym, bid, bq, ask, aq) => {
    const k = `${v}:${sym}`, mid = (bid + ask) / 2;
    top[k] = { bid, bq, ask, aq };
    ref[k] ??= mid;
    if (Math.abs(mid / ref[k] - 1) * 1e4 >= MOVE) check(sym, "move");
  };
  socket("wss://ws.backpack.exchange", (ws) => ws.send(JSON.stringify({ method: "SUBSCRIBE", params: FAST_SYMS.map((s) => `bookTicker.${s}_USDC`) })),
    (d) => { const m = JSON.parse(d).data; if (m?.e === "bookTicker") onTop("backpack", m.s.replace("_USDC", ""), +m.b, +m.B, +m.a, +m.A); });
  socket("wss://ws.okx.com:8443/ws/v5/public", (ws) => ws.send(JSON.stringify({ op: "subscribe", args: FAST_SYMS.map((s) => ({ channel: "bbo-tbt", instId: `${s}-USDC` })) })),
    (d) => { if (d === "pong") return; const m = JSON.parse(d); const b = m.data?.[0]; if (b?.bids?.length && b.asks?.length) onTop("okx", m.arg.instId.split("-")[0], +b.bids[0][0], +b.bids[0][1], +b.asks[0][0], +b.asks[0][1]); }, 20000);
  for (;;) { await sleep(60000); for (const s of FAST_SYMS) await check(s, "idle"); }
}

// The Solana Fall School demo loop ("Titan × Backpack"), as written on the
// slide: Backpack bookTicker vs Titan quotes, both directions, at fixed sizes.
//   edgeA = sellPx / bp.ask - 1 - COSTS   (buy on Backpack, sell on chain)
//   edgeB = bp.bid / buyPx - 1 - COSTS    (buy on chain, sell on Backpack)
//   COSTS = Backpack taker + (priority fee + tip) / notional + safety buffer
// Titan's streaming API needs a key from the Titan team; this uses its free
// public DART endpoint (1 req/s, outAmount already net of pool fees and impact).
const DART = "https://api.titan.exchange/dart";
async function titan() {
  const SAFETY = Number(process.env.SAFETY_BPS || 2), TSIZES = (process.env.TITAN_SIZES || "10,100").split(",").map(Number);
  const USER = process.env.SIM_WALLET || "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
  const dart = async (a, b, amount) => BigInt((await post(`${DART}/swap`, { inputMint: T[a][0], outputMint: T[b][0], amount: String(amount), userPublicKey: USER, slippageBps: 10 })).outputAmount);
  const bp = {};
  socket("wss://ws.backpack.exchange", (ws) => ws.send(JSON.stringify({ method: "SUBSCRIBE", params: ["bookTicker.SOL_USDC"] })),
    (d) => { const m = JSON.parse(d).data; if (m?.e === "bookTicker") Object.assign(bp, { bid: +m.b, bq: +m.B, ask: +m.a, aq: +m.A, at: Date.now() }); });
  for (;;) {
    for (const usd of TSIZES) {
      try {
        if (!bp.at || Date.now() - bp.at > 10000) { await sleep(1100); continue; }
        const sol = usd / ((bp.bid + bp.ask) / 2);
        const sellPx = units("USDC", await dart("SOL", "USDC", raw("SOL", sol))) / sol; await sleep(1500);
        const buyPx = usd / units("SOL", await dart("USDC", "SOL", raw("USDC", usd))); await sleep(1500);
        const cost = VENUES.backpack.fee + atomic(usd) + SAFETY, age = Date.now() - bp.at;
        if (bp.aq >= sol) log("titan", "SOL A: buy Backpack, sell DART", usd, (sellPx / bp.ask - 1) * 1e4, cost, { bp_age_ms: age });
        if (bp.bq >= sol) log("titan", "SOL B: buy DART, sell Backpack", usd, (bp.bid / buyPx - 1) * 1e4, cost, { bp_age_ms: age });
      } catch (e) { console.log(`titan ${usd}: ${e.message}`); await sleep(5000); }
    }
  }
}

// Launchpad graduation: Jupiter's 5-minute trending/traded lists carry
// graduatedAt; a token first seen within GRAD_MAX_AGE s of graduating is paper-
// bought at a real quote and sold at real quotes after each hold time.
async function launch() {
  const MAX_AGE = Number(process.env.GRAD_MAX_AGE || 180), HOLDS = [30, 60, 120, 300, 900], LSIZES = [10, 100];
  const seen = new Set();
  for (;;) {
    for (const e of ["toptrending/5m", "toptraded/5m", "toporganicscore/5m"]) {
      try {
        await budget(1);
        for (const t of await get(`https://lite-api.jup.ag/tokens/v2/${e}?limit=100`)) {
          if (!t.graduatedAt || seen.has(t.id)) continue;
          seen.add(t.id);
          const age = (Date.now() - Date.parse(t.graduatedAt)) / 1000;
          if (age > MAX_AGE) continue;
          const key = `L.${t.id}`; T[key] = [t.id, t.decimals];
          console.log(`graduated ${t.symbol} ${t.launchpad || ""} ${Math.round(age)} s ago`);
          for (const usd of LSIZES) {
            (async () => {
              try {
                await budget(1);
                const held = BigInt((await quote("USDC", key, raw("USDC", usd))).outAmount);
                for (const hold of HOLDS) {
                  await sleep((hold - (hold === HOLDS[0] ? 0 : HOLDS[HOLDS.indexOf(hold) - 1])) * 1000);
                  try {
                    await budget(1);
                    const back = units("USDC", (await quote(key, "USDC", held)).outAmount);
                    log("launch", `buy on graduation, sell +${hold}s`, usd, (back / usd - 1) * 1e4, 2 * atomic(usd), { token: t.symbol, lag_s: Math.round(age) });
                  } catch (err) { logFail("launch", `buy on graduation, sell +${hold}s`, usd, err.message); }
                }
              } catch (err) { logFail("launch", "buy on graduation", usd, err.message); }
            })();
          }
        }
      } catch (err) { console.log(`launch ${e}: ${err.message}`); }
    }
    await sleep(20000);
  }
}

// Liquidations: stream program logs, and for every landed liquidation price the
// fee payer's balance changes (= the liquidator's take). Failed attempts are the
// competition that lost the race.
async function liq() {
  // IDs from Kamino-Finance/klend lib.rs and mrgnlabs/marginfi-v2 Anchor.toml [programs.mainnet].
  const PROGS = { kamino: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD", marginfi: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA" };
  const WS = process.env.SOLANA_WS_URL || RPC.replace(/^http/, "ws");
  const queue = [], seen = {};
  for (const [name, prog] of Object.entries(PROGS)) {
    seen[name] = { msgs: 0, liqs: 0 };
    socket(WS, (ws) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [prog] }, { commitment: "confirmed" }] })),
      (d) => {
        const j = JSON.parse(d);
        if (j.error) return console.log(`liq ${name} subscribe failed: ${j.error.message}`);
        const v = j.params?.result?.value;
        if (v) seen[name].msgs++;
        if (!v || !v.logs.some((l) => /Instruction: (Liquidate|LendingAccountLiquidate|StartLiquidation)/.test(l))) return;
        seen[name].liqs++;
        if (v.err) logFail("liq", name, 0, "competing attempt failed");
        else queue.push({ name, sig: v.signature });
      });
  }
  // Heartbeat: a silent job must read as "stream alive, no liquidations", never as nothing.
  setInterval(() => console.log(`liq heartbeat ${JSON.stringify(seen)}`), Number(process.env.HB_MS || 600000));
  const bucket = (x) => (x < 100 ? 100 : x < 1000 ? 1000 : x < 10000 ? 10000 : 100000);
  for (;;) {
    const job = queue.shift();
    if (!job) { await sleep(2000); continue; }
    try {
      await sleep(1500); // let the transaction reach the RPC's confirmed history
      const tx = await rpc("getTransaction", [job.sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      if (!tx) { queue.push(job); continue; }
      const payer = tx.transaction.message.accountKeys[0].pubkey;
      const delta = { [T.SOL[0]]: (tx.meta.postBalances[0] - tx.meta.preBalances[0]) / 1e9 };
      for (const [list, sign] of [[tx.meta.preTokenBalances, -1], [tx.meta.postTokenBalances, 1]])
        for (const b of list) if (b.owner === payer) delta[b.mint] = (delta[b.mint] || 0) + sign * (b.uiTokenAmount.uiAmount || 0);
      const mints = Object.keys(delta).filter((m) => delta[m]);
      await budget(1);
      const px = await get(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`);
      let profit = 0, outflow = 0;
      for (const m of mints) { const usd = delta[m] * (px[m]?.usdPrice || 0); profit += usd; if (usd < 0) outflow -= usd; }
      log("liq", job.name, bucket(outflow), outflow ? (profit / outflow) * 1e4 : 0, 0,
        { winner: payer, profit_usd: +profit.toFixed(2), sig: job.sig });
    } catch (e) { console.log(`liq ${job.sig}: ${e.message}`); }
  }
}

// Dry-run MarginFi receivership liquidator (start_liquidation → withdraw → swap
// → repay → end_liquidation; needs no capital, only gas). Layouts and rules from
// 0dotxyz/marginfi-v2 type-crate + RECEIVERSHIP_LIQUIDATION.md:
//   seized ≤ repaid × (1 + FeeState.liquidation_max_fee), maint health may not drop,
//   flat fee FeeState.liquidation_flat_sol_fee, a 512-byte liq_record on first use.
// Targets = accounts named in anyone's liquidation attempt (landed or failed),
// re-checked every RECHECK_MS as prices move. Health uses Jupiter prices, not the
// bank oracles, so it is an estimate. Nothing is signed or sent.
async function liqbot() {
  const MFI = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";
  const FEE_STATE = "HoMNdUF3RDZDPKAARYK1mxcPFfUnPjLmpKYibZzAijev"; // PDA ["feestate"]
  const WS = process.env.SOLANA_WS_URL || RPC.replace(/^http/, "ws");
  const RECHECK_MS = Number(process.env.RECHECK_MS || 300000);
  const { createHash } = await import("node:crypto");
  const disc = (n) => createHash("sha256").update(`account:${n}`).digest().subarray(0, 8);
  const D_ACC = disc("MarginfiAccount");
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (buf) => { let n = BigInt("0x" + buf.toString("hex")), s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b) break; s = "1" + s; } return s; };
  const i80 = (buf, o) => Number(buf.readBigInt64LE(o + 8)) * 2 ** 16 + Number(buf.readBigUInt64LE(o)) / 2 ** 48; // WrappedI80F48
  const acct = async (k) => { const v = (await rpc("getAccountInfo", [k, { encoding: "base64" }])).value; return v && Buffer.from(v.data[0], "base64"); };
  const sym = (m) => Object.keys(T).find((s) => T[s][0] === m) || m.slice(0, 4);

  const fs = await acct(FEE_STATE);
  const MAX_FEE = i80(fs, 120), FLAT_SOL = fs.readUInt32LE(208) / 1e9;
  const RECORD_SOL = ((512 + 8 + 128) * 6960) / 1e9; // rent-exempt liq_record, paid once per account
  console.log(`liqbot max_fee ${MAX_FEE.toFixed(4)} flat_fee ${FLAT_SOL} SOL`);

  const banks = new Map(); // bank -> { mint, dec, assetShare, liabShare, aw, lw, at }
  async function bank(k) {
    const c = banks.get(k);
    if (c && Date.now() - c.at < 600000) return c;
    const d = await acct(k);
    const b = { mint: b58(d.subarray(8, 40)), dec: d[40], assetShare: i80(d, 80), liabShare: i80(d, 96), aw: i80(d, 312), lw: i80(d, 344), at: Date.now() };
    banks.set(k, b);
    return b;
  }

  const targets = new Map(), attempts = [], stat = { attempts: 0, checked: 0, unhealthy: 0, logged: 0 };
  socket(WS, (ws) => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [MFI] }, { commitment: "confirmed" }] })),
    (d) => {
      const j = JSON.parse(d);
      if (j.error) return console.log(`liqbot subscribe failed: ${j.error.message}`);
      const v = j.params?.result?.value;
      if (!v || !v.logs.some((l) => /Instruction: (LendingAccountLiquidate|StartLiquidation)/.test(l))) return;
      stat.attempts++;
      if (attempts.length < 50) attempts.push(v.signature);
    });
  setInterval(() => console.log(`liqbot heartbeat ${JSON.stringify({ ...stat, targets: targets.size })}`), Number(process.env.HB_MS || 600000));

  async function discover(sig) {
    const tx = await rpc("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
    if (!tx) return;
    const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable || [])];
    const infos = (await rpc("getMultipleAccounts", [keys, { encoding: "base64", dataSlice: { offset: 0, length: 72 } }])).value;
    keys.forEach((k, i) => {
      const v = infos[i];
      if (v?.owner !== MFI) return;
      const h = Buffer.from(v.data[0], "base64");
      if (!h.subarray(0, 8).equals(D_ACC) || b58(h.subarray(40, 72)) === keys[0]) return; // skip the liquidator's own account
      if (!targets.has(k)) targets.set(k, { by: keys[0], next: 0 });
    });
  }

  async function check(k, t) {
    const a = await acct(k);
    if (!a) return targets.delete(k);
    stat.checked++;
    const pos = [];
    for (let i = 0; i < 16; i++) {
      const o = 72 + i * 104;
      if (!a[o]) continue;
      const b = await bank(b58(a.subarray(o + 1, o + 33)));
      pos.push({ ...b, asset: (i80(a, o + 40) * b.assetShare) / 10 ** b.dec, liab: (i80(a, o + 56) * b.liabShare) / 10 ** b.dec });
    }
    if (!pos.some((p) => p.liab > 0)) return targets.delete(k); // nothing owed: closed out
    await budget(1);
    const px = await get(`https://lite-api.jup.ag/price/v3?ids=${[...new Set([...pos.map((p) => p.mint), T.SOL[0]])].join(",")}`);
    let health = 0;
    for (const p of pos) { p.px = px[p.mint]?.usdPrice || 0; health += p.asset * p.px * p.aw - p.liab * p.px * p.lw; }
    if (health >= 0) return;
    stat.unhealthy++;
    // Largest debt against the largest seizable collateral (weight 0 / no price can't be withdrawn).
    const L = pos.filter((p) => p.liab > 0).sort((x, y) => y.liab * y.px - x.liab * x.px)[0];
    const A = pos.filter((p) => p.asset > 0 && p.aw > 0 && p.px > 0).sort((x, y) => y.asset * y.px - x.asset * x.px)[0];
    const fee = A ? Math.min(MAX_FEE, L.lw / A.aw - 1) : 0; // keep maint health from dropping
    if (!A || !L.px || fee <= 0) return log("liqbot", `${sym(L.mint)} debt, nothing seizable`, 100, 0, 0, { account: k, health: +health.toFixed(4), profit_usd: 0 });
    const repay = Math.min(L.liab * L.px, (A.asset * A.px) / (1 + fee));
    const seize = (repay * (1 + fee)) / A.px; // collateral tokens
    let outUsd = seize * A.px;
    if (A.mint !== L.mint) {
      await budget(1);
      const q = await get(`${JUP}/quote?inputMint=${A.mint}&outputMint=${L.mint}&amount=${Math.floor(seize * 10 ** A.dec)}&slippageBps=50`);
      outUsd = (Number(q.outAmount) / 10 ** L.dec) * L.px;
    }
    const costUsd = TX_USD + (FLAT_SOL + (a.subarray(2224, 2256).some((x) => x) ? 0 : RECORD_SOL)) * (px[T.SOL[0]]?.usdPrice || 0);
    stat.logged++;
    log("liqbot", `${sym(A.mint)}->${sym(L.mint)}`, repay < 100 ? 100 : repay < 1000 ? 1000 : repay < 10000 ? 10000 : 100000,
      ((outUsd - repay) / repay) * 1e4, (costUsd / repay) * 1e4,
      { account: k, health: +health.toFixed(4), repay_usd: +repay.toFixed(4), profit_usd: +(outUsd - repay - costUsd).toFixed(4), attempted_by: t.by });
  }

  for (;;) {
    try {
      const sig = attempts.shift();
      if (sig) await discover(sig);
      const due = [...targets].find(([, t]) => t.next <= Date.now());
      if (due) { due[1].next = Date.now() + RECHECK_MS; await check(...due); }
    } catch (e) { console.log(`liqbot: ${e.message}`); }
    await sleep(2000);
  }
}

// Funding carry: hold spot, short the perp, collect funding. Logged as the
// 30-day carry at the current rate against the one-off cost of opening and
// closing both legs (perp taker twice + an on-chain spot round trip).
async function carry() {
  const SYMS = ["SOL", "BTC", "ETH", "JUP", "WIF", "BONK", "JTO"];
  const TAKER = { backpack: 5, hyperliquid: 4.5, okx: 5 }, SPOT_RT = Number(process.env.SPOT_RT_BPS || 6);
  const out = (v, s, perHour) => log("carry", `${s} ${v} long spot, short perp (30d)`, 1000, perHour * 720 * 1e4, 2 * TAKER[v] + SPOT_RT);
  for (;;) {
    try {
      const bp = await get("https://api.backpack.exchange/api/v1/markPrices"); // funding settles hourly
      for (const s of SYMS) { const m = bp.find((x) => x.symbol === `${s}_USDC_PERP` || x.symbol === `k${s}_USDC_PERP`); if (m) out("backpack", s, +m.fundingRate); }
    } catch (e) { console.log(`carry backpack: ${e.message}`); }
    try {
      const [meta, ctx] = await post("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" }); // hourly
      for (const s of SYMS) { const i = meta.universe.findIndex((u) => u.name === s || u.name === `k${s}`); if (i >= 0) out("hyperliquid", s, +ctx[i].funding); }
    } catch (e) { console.log(`carry hyperliquid: ${e.message}`); }
    for (const s of SYMS) {
      try {
        const d = (await get(`https://www.okx.com/api/v5/public/funding-rate?instId=${s}-USDT-SWAP`)).data?.[0];
        if (!d) continue;
        const hours = d.nextFundingTime && d.fundingTime ? (d.nextFundingTime - d.fundingTime) / 3600000 : 8;
        out("okx", s, +d.fundingRate / (hours || 8));
      } catch (e) { console.log(`carry okx ${s}: ${e.message}`); }
    }
    await sleep(300000);
  }
}

const ROUND = { dex, tri, lst, peg, wide, cex, stock, stat };
const WATCH = { fast, titan, launch, liq, liqbot, carry };

function summary(files) {
  const all = files.filter((f) => existsSync(f)).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  if (!all.length) return console.log("no data");
  all.sort((a, b) => a.t.localeCompare(b.t));
  const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const group = (rows, key) => { const g = {}; for (const r of rows) (g[key(r)] ||= []).push(r); return g; };
  const out = [`## Edge watch: ${all.length} samples, ${all[0].t} → ${all.at(-1).t}`, "",
    "| strategy | samples | failed | net > 0 | share > 0 | best net bps | median net bps | best route |", "|---|---|---|---|---|---|---|---|"];
  for (const [k, v] of Object.entries(group(all, (r) => r.strategy)).sort()) {
    const ok = v.filter((r) => r.ok !== false), pos = ok.filter((r) => r.net_bps > 0).length;
    const best = ok.length ? ok.reduce((m, r) => (r.net_bps > m.net_bps ? r : m)) : null;
    out.push(`| ${k} | ${ok.length} | ${v.length - ok.length} | ${pos} | ${ok.length ? (100 * pos / ok.length).toFixed(1) : 0}% | ${best?.net_bps ?? "–"} | ${ok.length ? med(ok.map((r) => r.net_bps)) : "–"} | ${best ? `${best.route} @ $${best.usd}` : "–"} |`);
  }
  const fails = all.filter((r) => r.ok === false);
  if (fails.length) {
    out.push("", "### Why attempts failed", "", "| strategy | reason | count |", "|---|---|---|");
    for (const [k, v] of Object.entries(group(fails, (r) => `${r.strategy}|${r.reason}`)).sort((a, b) => b[1].length - a[1].length).slice(0, 20))
      out.push(`| ${k.split("|")[0]} | ${k.split("|").slice(1).join("|").slice(0, 90)} | ${v.length} |`);
  }
  const liqs = all.filter((r) => r.strategy === "liq" && r.ok !== false);
  if (liqs.length) {
    out.push("", "### Liquidations", "", "| protocol | landed | failed attempts | winners | top winner share | median profit $ | total profit $ |", "|---|---|---|---|---|---|---|");
    for (const [p, v] of Object.entries(group(liqs, (r) => r.route))) {
      const w = group(v, (r) => r.winner), top = Math.max(...Object.values(w).map((x) => x.length));
      out.push(`| ${p} | ${v.length} | ${fails.filter((r) => r.strategy === "liq" && r.route === p).length} | ${Object.keys(w).length} | ${(100 * top / v.length).toFixed(0)}% | ${med(v.map((r) => r.profit_usd))} | ${v.reduce((m, r) => m + r.profit_usd, 0).toFixed(2)} |`);
    }
  }
  out.push("", "### Routes by median net edge (top 40, at least 3 samples)", "", "| strategy | route | $ | samples | net > 0 | best | median |", "|---|---|---|---|---|---|---|");
  const routes = Object.values(group(all.filter((r) => r.ok !== false && r.strategy !== "liq"), (r) => `${r.strategy}|${r.route}|${r.usd}`))
    .filter((v) => v.length >= 3).map((v) => ({ r: v[0], n: v.length, pos: v.filter((x) => x.net_bps > 0).length,
      best: Math.max(...v.map((x) => x.net_bps)), med: med(v.map((x) => x.net_bps)) }))
    .sort((a, b) => b.med - a.med).slice(0, 40);
  for (const x of routes) out.push(`| ${x.r.strategy} | ${x.r.route} | ${x.r.usd} | ${x.n} | ${x.pos} | ${x.best} | ${x.med} |`);
  console.log(out.join("\n"));
}

if (process.argv[2] === "--summary") summary(process.argv.length > 3 ? process.argv.slice(3) : [LOG]);
else {
  const pick = (process.env.STRATEGY || Object.keys(ROUND).join(",")).split(",");
  for (const s of pick) if (!ROUND[s] && !WATCH[s]) throw new Error(`unknown strategy ${s}`);
  const watchers = pick.filter((s) => WATCH[s]).map((s) => WATCH[s]().catch((e) => console.log(`${s}: ${e.message}`)));
  const rounds = pick.filter((s) => ROUND[s]);
  if (rounds.length) {
    const n = Number(process.argv[2] || Infinity);
    for (let i = 1; i <= n; i++)
      for (const s of rounds) for (const usd of SIZES) {
        try { await ROUND[s](usd); } catch (e) { console.log(`${s} ${usd}: ${e.message}`); }
      }
    if (!watchers.length) process.exit(0);
  }
  await Promise.all(watchers);
}
