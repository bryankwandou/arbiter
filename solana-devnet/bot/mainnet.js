// Mainnet flash-arbitrage loop: the Pinocchio vault lends USDC, Jupiter routes
// both legs, and the loan is repaid in the same transaction:
//   flash_borrow USDC → Jupiter USDC→X → Jupiter X→USDC → flash_repay
// A leg that comes up short makes the repay fail, so the whole transaction
// reverts; every candidate is simulated first and only sent if it passes.
//
//   node mainnet.js --once              one cycle
//   node mainnet.js --loop 20           forever, every 20 s
//   node mainnet.js --swap-sim          simulate a plain USDC→X→USDC round trip
//                                       from the wallet (no loan; needs no program)
//   node mainnet.js --setup 1000000     init the USDC vault if missing, deposit (base units)
//   node mainnet.js --sweep [min]       send the bot's USDC to PROFIT_SINK now
//   node mainnet.js --force 100000      send one round trip of this size even at a
//                                       small loss (proves the path lands on chain)
//
// Env: SOLANA_RPC_URL, ARBITER_PROGRAM_ID, BOT_KEYPAIR, ARB_MIDS (comma list of
// intermediate mints), LOAN_MAX (base units), MIN_PROFIT_BASE, CONTROL_URL.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  connection, loadBot, flashBorrowIx, flashRepayIx, initVaultIx, depositIx,
  loanFee, tokenBalance, vaultPda, vaultTokensPda, PROGRAM_ID, fmt, RPC,
} from "./common.js";
import { readControl } from "./control.js";

if (!/mainnet/.test(RPC) && !process.env.ALLOW_ANY_RPC) {
  console.error(`refusing to run: SOLANA_RPC_URL is not mainnet (${RPC})`);
  process.exit(2);
}

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MIDS = (process.env.ARB_MIDS || "So11111111111111111111111111111111111111112,Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB,jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL,JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN,4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R,DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263,EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm")
  .split(",").map((s) => s.trim()).filter(Boolean);
const JUP = (process.env.JUP_API || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
const LOAN_MAX = BigInt(process.env.LOAN_MAX || "1000000");        // 1 USDC
const MIN_PROFIT = BigInt(process.env.MIN_PROFIT_BASE || "1000");   // 0.001 USDC
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || "10");
// Profit sink: the bot's USDC account is only a pass-through (flash loans fund
// every trade), so realised profit is swept out to a wallet a human controls.
const PROFIT_SINK = new PublicKey(process.env.PROFIT_SINK || "ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m");
const SWEEP_MIN = BigInt(process.env.SWEEP_MIN_BASE || "10000");    // 0.01 USDC
const PRIORITY_MICROLAMPORTS = Number(process.env.PRIORITY_MICROLAMPORTS || "1000");
const CU_LIMIT = 600_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const num = (name, d) => (flag(name) ? args[args.indexOf(name) + 1] ?? d : undefined);
const loopSec = flag("--loop") ? Number(num("--loop", 20)) : 0;

const bot = loadBot();
const userUsdc = getAssociatedTokenAddressSync(USDC, bot.publicKey);
const vault = vaultPda(USDC);
const vaultTokens = vaultTokensPda(vault);
const sinkUsdc = getAssociatedTokenAddressSync(USDC, PROFIT_SINK, true);
const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const LOG_PATH = here("./trades-mainnet.jsonl");
const LEDGER_PATH = here("./ledger-mainnet.json");
const log = (o) => appendFileSync(LOG_PATH, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
const tx = (sig) => `https://explorer.solana.com/tx/${sig}`;

// ── Jupiter ─────────────────────────────────────────────────────────────────
async function jup(path, body) {
  const r = await fetch(`${JUP}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`jupiter ${path.split("?")[0]}: ${j.error || r.status}`);
  return j;
}
const quote = (inMint, outMint, amount, slip = SLIPPAGE_BPS) =>
  jup(`/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=${slip}&maxAccounts=24`);

const toIx = (i) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, "base64"),
});
// Wrapped SOL stays wrapped between the legs (no native unwrap mid-route);
// Jupiter's setup instructions create any missing token account idempotently.
const legIxs = (q) => jup("/swap-instructions", {
  quoteResponse: q, userPublicKey: bot.publicKey.toBase58(), wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false,
});

const altCache = new Map();
async function lookupTables(addrs) {
  const missing = addrs.filter((a) => !altCache.has(a));
  if (missing.length) {
    const infos = await connection.getMultipleAccountsInfo(missing.map((a) => new PublicKey(a)));
    infos.forEach((info, i) => {
      if (info) altCache.set(missing[i], new AddressLookupTableAccount({
        key: new PublicKey(missing[i]), state: AddressLookupTableAccount.deserialize(info.data),
      }));
    });
  }
  return addrs.map((a) => altCache.get(a)).filter(Boolean);
}

// Best round trip USDC → mid → USDC for `amount`, by quoted output.
const QUOTE_GAP_MS = Number(process.env.QUOTE_GAP_MS || "2500");
async function bestRoute(amount) {
  let best = null;
  for (const mid of MIDS) {
    await new Promise((ok) => setTimeout(ok, QUOTE_GAP_MS)); // free Jupiter tier: stay under its rate limit
    try {
      const q1 = await quote(USDC.toBase58(), mid, amount);
      // Leg 2 spends leg 1's worst-case output, so it cannot overspend.
      let q2 = await quote(mid, USDC.toBase58(), q1.otherAmountThreshold);
      // Judge on the expected output: a losing fill cannot cost us anything,
      // because leg 2's floor is re-set below to loan + fee + MIN_PROFIT.
      const expected = BigInt(q2.outAmount);
      const net = expected - amount - loanFee(amount);
      if (net >= MIN_PROFIT) {
        const floor = amount + loanFee(amount) + MIN_PROFIT;
        const slip = Number(((expected - floor) * 10000n) / expected);
        q2 = await quote(mid, USDC.toBase58(), q1.otherAmountThreshold, Math.max(0, Math.min(slip, SLIPPAGE_BPS)));
        if (BigInt(q2.otherAmountThreshold) < floor) continue; // price moved between quotes
      }
      if (!best || net > best.net) best = { mid, q1, q2, back: expected, net };
    } catch (e) {
      console.log(`   quote ${mid.slice(0, 4)}… failed: ${e.message}`);
    }
  }
  return best;
}

async function buildTx({ q1, q2 }, amount, withLoan) {
  const [l1, l2] = await Promise.all([legIxs(q1), legIxs(q2)]);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ...[...l1.setupInstructions, ...l2.setupInstructions].map(toIx),
  ];
  if (withLoan) ixs.push(flashBorrowIx(bot.publicKey, userUsdc, USDC, amount));
  ixs.push(toIx(l1.swapInstruction), toIx(l2.swapInstruction));
  if (withLoan) ixs.push(flashRepayIx(bot.publicKey, userUsdc, USDC, amount));
  if (l2.cleanupInstruction) ixs.push(toIx(l2.cleanupInstruction));
  const alts = await lookupTables([...new Set([...l1.addressLookupTableAddresses, ...l2.addressLookupTableAddresses])]);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: bot.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts);
  const vtx = new VersionedTransaction(msg);
  vtx.sign([bot]);
  return vtx;
}

async function simulate(vtx, watch) {
  const opts = { sigVerify: false, replaceRecentBlockhash: false };
  if (watch) opts.accounts = { encoding: "base64", addresses: [watch.toBase58()] };
  const sim = await connection.simulateTransaction(vtx, opts);
  return sim.value;
}

// SPL token amount (u64 LE at offset 64) of a simulated post-state account.
const simAmount = (acc) => acc ? Buffer.from(acc.data[0], "base64").readBigUInt64LE(64) : 0n;

async function send(vtx) {
  const sig = await connection.sendTransaction(vtx, { skipPreflight: true, maxRetries: 3 });
  const bh = await connection.getLatestBlockhash("confirmed");
  const res = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (res.value.err) throw Object.assign(new Error(`reverted ${JSON.stringify(res.value.err)}`), { sig });
  return sig;
}

// ── setup / checks ──────────────────────────────────────────────────────────
async function setup(depositAmount) {
  if (!(await connection.getAccountInfo(PROGRAM_ID))) throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed here`);
  const ixs = [];
  if (!(await connection.getAccountInfo(vault))) ixs.push(initVaultIx(bot.publicKey, USDC, 9));
  if (depositAmount > 0n) ixs.push(depositIx(bot.publicKey, userUsdc, USDC, depositAmount));
  if (!ixs.length) return console.log("vault exists, nothing to deposit");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const vtx = new VersionedTransaction(new TransactionMessage({ payerKey: bot.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  vtx.sign([bot]);
  const sim = await simulate(vtx);
  if (sim.err) throw new Error(`setup simulation failed ${JSON.stringify(sim.err)} ${sim.logs?.slice(-4).join(" | ")}`);
  const sig = await send(vtx);
  console.log(`setup done: vault ${vault.toBase58()} ${tx(sig)}`);
}

// ── the loop ────────────────────────────────────────────────────────────────
const STARTED_AT = new Date().toISOString();
const stats = { cycles: 0, sent: 0, wins: 0, losses: 0, skipped: 0, held: 0, profit: 0n, lastSig: null };
const winRate = () => (stats.sent ? `${((100 * stats.wins) / stats.sent).toFixed(1)}%` : "n/a");
let lastLossAt = 0;

async function cycle(n, forceAmount) {
  stats.cycles++;
  const c = await readControl();
  const hold = (why, action) => { stats.held++; console.log(`#${n} ⛔ ${why} — holding`); log({ kind: "cycle", n, action, control: c }); };
  if (!c.enabled && !forceAmount) return hold("KILL SWITCH ON (ATLAS-QUANT panel)", "held_by_kill_switch");
  if (Number(stats.profit) / 1e6 <= -Math.abs(Number(c.maxDailyLoss))) return hold("max daily loss hit", "held_by_daily_loss");
  if (stats.sent >= Number(c.maxTradesPerDay)) return hold("max trades/day reached", "held_by_trade_cap");
  if (lastLossAt && Date.now() - lastLossAt < Number(c.cooldownSec) * 1000) return hold("cooldown after loss", "held_by_cooldown");

  const liquidity = await tokenBalance(vaultTokens);
  const riskPct = Math.min(100, Math.max(1, Number(c.riskPct) || 100));
  let amount = (liquidity * BigInt(Math.round(riskPct * 100))) / 10_000n;
  if (amount > LOAN_MAX) amount = LOAN_MAX;
  if (forceAmount) amount = forceAmount < liquidity ? forceAmount : liquidity;
  if (amount <= 0n) return hold("vault is empty", "held_empty_vault");

  const r = await bestRoute(amount);
  if (!r) { stats.skipped++; return console.log(`#${n} no quotes`); }
  const base = { kind: "cycle", n, mid: r.mid, size: fmt(amount), expected_net: fmt(r.net) };
  console.log(`#${n} ${new Date().toISOString()} loan ${fmt(amount)} USDC via ${r.mid.slice(0, 4)}… → back ${fmt(r.back)}  net ${fmt(r.net)} USDC`);
  if (!forceAmount && r.net < MIN_PROFIT) { log({ ...base, action: "none" }); return console.log("   no arb above margin"); }

  let vtx;
  try {
    vtx = await buildTx(r, amount, true);
    const pre = await tokenBalance(userUsdc);
    const sim = await simulate(vtx, userUsdc);
    if (!sim.err && !forceAmount && simAmount(sim.accounts?.[0]) - pre < MIN_PROFIT) sim.err = "simulated_gain_below_margin";
    if (sim.err) {
      stats.skipped++;
      console.log(`   ⏭  simulation fails — not sent: ${JSON.stringify(sim.err)} ${(sim.logs || []).filter((l) => /error|failed/i.test(l)).slice(-2).join(" | ")}`);
      return log({ ...base, action: "skipped_simulation", error: sim.err });
    }
    console.log(`   simulation ok (${sim.unitsConsumed} CU, ${vtx.serialize().length} bytes)`);
  } catch (e) {
    stats.skipped++;
    console.log(`   ⏭  could not build/simulate: ${String(e.message).slice(0, 160)}`);
    return log({ ...base, action: "skipped_simulation", error: String(e.message).slice(0, 300) });
  }

  const before = await tokenBalance(userUsdc);
  stats.sent++;
  try {
    const sig = await send(vtx);
    const realised = (await tokenBalance(userUsdc)) - before;
    if (realised > 0n) stats.wins++; else { stats.losses++; lastLossAt = Date.now(); }
    stats.profit += realised;
    stats.lastSig = sig;
    console.log(`   ${realised > 0n ? "✅" : "⚠️"} landed: realised ${fmt(realised)} USDC ${tx(sig)}`);
    log({ ...base, action: forceAmount ? "executed_forced" : "executed", realised: fmt(realised), sig });
    if (realised > 0n) await sweep().catch((e) => console.log(`   ⚠️ sweep failed: ${String(e.message).slice(0, 160)}`));
  } catch (e) {
    stats.losses++; lastLossAt = Date.now();
    console.log(`   ❌ ${String(e.message).slice(0, 160)} ${e.sig ? tx(e.sig) : ""}`);
    log({ ...base, action: "reverted", error: String(e.message).slice(0, 300), sig: e.sig });
  }
}

// Move whatever USDC sits in the bot account out to PROFIT_SINK. Nothing is
// kept back: the vault, not this account, funds the trades.
async function sweep(minimum = SWEEP_MIN) {
  const onHand = await tokenBalance(userUsdc);
  // SWEEP_MAX_BASE caps a single sweep; unset it and the whole balance goes.
  const cap = process.env.SWEEP_MAX_BASE ? BigInt(process.env.SWEEP_MAX_BASE) : null;
  const amount = cap && onHand > cap ? cap : onHand;
  if (amount < minimum) {
    console.log(`   sweep: ${fmt(amount)} USDC on hand, below ${fmt(minimum)} — left in place`);
    return null;
  }
  const ixs = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    createAssociatedTokenAccountIdempotentInstruction(bot.publicKey, sinkUsdc, PROFIT_SINK, USDC),
    createTransferInstruction(userUsdc, sinkUsdc, bot.publicKey, amount),
  ];
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const vtx = new VersionedTransaction(new TransactionMessage({
    payerKey: bot.publicKey, recentBlockhash: blockhash, instructions: ixs,
  }).compileToV0Message());
  vtx.sign([bot]);
  const sim = await simulate(vtx);
  if (sim.err) {
    console.log(`   ⚠️ sweep simulation failed: ${JSON.stringify(sim.err)} — profit stays in the bot account`);
    return log({ kind: "sweep", action: "skipped_simulation", error: sim.err });
  }
  const sig = await send(vtx);
  console.log(`   💸 swept ${fmt(amount)} USDC → ${PROFIT_SINK.toBase58()} ${tx(sig)}`);
  log({ kind: "sweep", action: "swept", amount: fmt(amount), to: PROFIT_SINK.toBase58(), sig });
  return sig;
}

function writeLedger() {
  let prev = { runs: [] };
  try { prev = JSON.parse(readFileSync(LEDGER_PATH, "utf8")); } catch { /* first run */ }
  const run = { startedAt: STARTED_AT, endedAt: new Date().toISOString(), ...stats, profit: fmt(stats.profit), winRate: winRate() };
  const runs = [...(prev.runs || []), run].slice(-60);
  const sum = (k) => runs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  writeFileSync(LEDGER_PATH, JSON.stringify({
    source: "arbiter/solana-mainnet", version: 1, network: "mainnet-beta", updatedAt: run.endedAt,
    program: PROGRAM_ID.toBase58(), vault: vault.toBase58(), wallet: bot.publicKey.toBase58(),
    totals: { runs: runs.length, sent: sum("sent"), wins: sum("wins"), losses: sum("losses"), skipped: sum("skipped"),
      profit: runs.reduce((a, x) => a + Number(x.profit), 0).toFixed(6),
      winRate: sum("sent") ? `${((100 * sum("wins")) / sum("sent")).toFixed(1)}%` : "n/a" },
    latest: run, runs,
  }, null, 2) + "\n");
}

console.log(`Arbiter mainnet bot wallet=${bot.publicKey.toBase58()} program=${PROGRAM_ID.toBase58()} vault=${vault.toBase58()}`);
if (flag("--swap-sim")) {
  const amount = BigInt(num("--swap-sim", "1000000") ?? "1000000");
  const r = await bestRoute(amount);
  if (!r) throw new Error("no quotes");
  const sim = await simulate(await buildTx(r, amount, false));
  console.log(`round trip ${fmt(amount)} USDC via ${r.mid} → quoted back ${fmt(r.back)}; simulation ${sim.err ? "FAILED " + JSON.stringify(sim.err) : "ok"} (${sim.unitsConsumed} CU)`);
  if (sim.err) console.log((sim.logs || []).slice(-6).join("\n"));
} else if (flag("--sweep")) {
  await sweep(BigInt(num("--sweep", "1") ?? "1"));
} else if (flag("--setup")) {
  await setup(BigInt(num("--setup", "0") ?? "0"));
} else {
  const force = flag("--force") ? BigInt(num("--force", "100000")) : undefined;
  for (let n = 1; ; n++) {
    try { await cycle(n, force); } catch (e) { console.log(`   cycle error: ${e.message}`); log({ kind: "error", n, error: String(e.message) }); }
    if (!loopSec || force) break;
    await new Promise((res) => setTimeout(res, loopSec * 1000));
  }
  console.log(`win rate ${winRate()} wins=${stats.wins} losses=${stats.losses} sent=${stats.sent} skipped=${stats.skipped} profit=${fmt(stats.profit)} USDC`);
  writeLedger();
}
