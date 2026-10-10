// Hyperliquid funding carry: long spot + short perp of the same size, collect funding.
// Both legs on Hyperliquid, so every fill and funding payment is public and anyone can
// re-check the result from the account address alone (no key needed for plan/status).
//
//   node carry-hl.js plan     [--coin HYPE] [--usd 11] [--lev 1]  orders it would place, cost, break-even
//   node carry-hl.js status   <0xaccount> [--since 2026-10-18T00:00:00Z]  real PnL from public fills + funding
//   node carry-hl.js open     [--live]   maker-first entry; without --live it only prints the actions
//   node carry-hl.js close    [--live]
//   node carry-hl.js watch    [--live]   every 10 min: status, and close both legs before the short nears liquidation
//   node carry-hl.js selftest            signs an order with a throwaway key; checks the signer the API recovers
//
// Live needs HL_ACCOUNT (the master address) and HL_AGENT_KEY (an API wallet approved in the
// Hyperliquid app; it can trade but cannot withdraw). Both can sit in carry/.env (git-ignored).
// CARRY_MAX_USD caps the spot buy (default 13).
import { appendFileSync, readFileSync } from "node:fs";
try { process.loadEnvFile(new URL("./.env", import.meta.url)); } catch { /* no .env: flags and shell env only */ }

const API = "https://api.hyperliquid.xyz";
const FEE = { perp: { taker: 4.5, maker: 1.5 }, spot: { taker: 7, maker: 4 } }; // bps, base tier (docs: trading/fees)
const MIN_USD = 10; // API: "Order must have minimum value of $10"
const args = process.argv.slice(2), cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const COIN = opt("coin", process.env.CARRY_COIN || "HYPE");
const USD = Number(opt("usd", process.env.CARRY_USD || 12));
const LEV = Number(opt("lev", process.env.CARRY_LEV || 1));
const MAX_USD = Number(process.env.CARRY_MAX_USD || 13);
const LIVE = args.includes("--live");
const TRIES = 6, WAIT_MS = 20000, SLIP = 0.002; // maker requotes, wait per quote, IOC fallback slippage
const LEDGER = new URL("./carry-ledger.jsonl", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (o) => appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");

async function info(body) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${API}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i >= 3) throw e; await sleep(2000 * (i + 1)); }
  }
}

// Perp + spot legs for a coin. Non-HYPE spot on Hyperliquid is Unit-bridged (UBTC, UETH, USOL).
async function market(coin) {
  const [[pm, pctx], [sm, sctx]] = await Promise.all([info({ type: "metaAndAssetCtxs" }), info({ type: "spotMetaAndAssetCtxs" })]);
  const pi = pm.universe.findIndex((u) => u.name === coin && !u.isDelisted);
  if (pi < 0) throw new Error(`no perp market for ${coin}`);
  const tok = (i) => sm.tokens.find((t) => t.index === i), want = coin === "HYPE" ? "HYPE" : `U${coin}`;
  const s = sm.universe.find((u) => tok(u.tokens[0]).name === want && tok(u.tokens[1]).name === "USDC");
  if (!s) throw new Error(`no ${want}/USDC spot market`);
  return {
    perp: { asset: pi, book: coin, szDec: pm.universe[pi].szDecimals, maxLev: pm.universe[pi].maxLeverage, spot: false, ctx: pctx[pi] },
    spot: { asset: 10000 + s.index, book: s.name, token: want, szDec: tok(s.tokens[0]).szDecimals, spot: true, ctx: sctx.find((c) => c.coin === s.name) },
  };
}

const top = async (book) => { const b = await info({ type: "l2Book", coin: book }); return { bid: b.levels[0][0].px, ask: b.levels[1][0].px }; };
const wire = (x, d) => String(Number(Number(x).toFixed(d))); // no trailing zeros, as the signer hashes it
const fmtPx = (px, leg) => wire(Number(px).toPrecision(5), (leg.spot ? 8 : 6) - leg.szDec); // 5 sig figs, max decimals
const floorSz = (x, d) => Math.floor(x * 10 ** d + 1e-9) / 10 ** d;

// hedge: the perp short, and exactly what close sells back on spot. The spot buy fee is taken
// in the coin, so buying hedge + one spot lot leaves at least `hedge` to sell.
function sizes(m, px) {
  const hedge = floorSz(USD / px, Math.min(m.spot.szDec, m.perp.szDec)), buy = +(hedge + 10 ** -m.spot.szDec).toFixed(m.spot.szDec);
  if (hedge * px < MIN_USD * 1.05) throw new Error(`$${(hedge * px).toFixed(2)} hedge is too close to the $${MIN_USD} minimum; raise --usd`);
  return { hedge, buy };
}

async function fundingSince(coin, start) {
  const rows = [];
  for (let t = start; ;) { const r = await info({ type: "fundingHistory", coin, startTime: t }); rows.push(...r); if (r.length < 500) break; t = r.at(-1).time + 1; }
  return rows;
}

async function plan() {
  const m = await market(COIN), [sp, pp] = await Promise.all([top(m.spot.book), top(m.perp.book)]);
  const { hedge, buy } = sizes(m, +sp.ask);
  const week = await fundingSince(COIN, Date.now() - 7 * 864e5);
  const perHour = (week.reduce((a, r) => a + +r.fundingRate, 0) / week.length) * 1e4;
  const cost = { maker: 2 * FEE.perp.maker + 2 * FEE.spot.maker, taker: 2 * FEE.perp.taker + 2 * FEE.spot.taker };
  const basis = (+pp.ask / +sp.bid - 1) * 1e4; // entry: short perp above spot gains this if the gap closes
  const liq = +pp.ask * (1 + 1 / LEV) / (1 + 1 / (2 * m.perp.maxLev)); // isolated short, maintenance = 1/(2*maxLev)
  const notional = hedge * +sp.ask, spotUsd = buy * +sp.ask;
  console.log(`## Carry plan ${COIN}: buy ${buy} ${m.spot.token} spot, short ${hedge} ${COIN} perp (~$${notional.toFixed(2)} hedged)\n`);
  console.log(`spot ${m.spot.book} bid ${sp.bid} ask ${sp.ask} | perp bid ${pp.bid} ask ${pp.ask} | entry gap perp-spot ${basis.toFixed(2)} bps`);
  console.log(`funding last 7d: ${perHour.toFixed(4)} bps/hour = ${(perHour * 24).toFixed(2)} bps/day, ${week.filter((r) => +r.fundingRate < 0).length}/${week.length} hours negative`);
  console.log(`round-trip fees: maker ${cost.maker} bps, taker ${cost.taker} bps -> break-even ${(cost.maker / perHour / 24).toFixed(1)} days maker, ${(cost.taker / perHour / 24).toFixed(1)} days taker`);
  console.log(`expected per 30 days at that rate, after maker fees: ${((perHour * 720 - cost.maker) * notional / 1e4).toFixed(4)} USD on $${notional.toFixed(2)}`);
  console.log(`capital: $${spotUsd.toFixed(2)} spot + $${(notional / LEV).toFixed(2)} perp margin at ${LEV}x = $${(spotUsd + notional / LEV).toFixed(2)}; short liquidates near ${liq.toFixed(3)} (+${((liq / +pp.ask - 1) * 100).toFixed(0)}%)`);
  console.log(`close needs the spot sale to stay >= $${MIN_USD}: ${COIN} must be above ${(MIN_USD / hedge).toFixed(3)} (${((MIN_USD / hedge / +sp.bid - 1) * 100).toFixed(0)}% from now) to exit`);
  console.log("\norders (post-only at the touch):");
  console.log(JSON.stringify({ a: m.spot.asset, b: true, p: sp.bid, s: wire(buy, m.spot.szDec), r: false, t: { limit: { tif: "Alo" } } }));
  console.log(JSON.stringify({ a: m.perp.asset, b: false, p: pp.ask, s: wire(hedge, m.perp.szDec), r: false, t: { limit: { tif: "Alo" } } }));
  if (spotUsd > MAX_USD) console.log(`\nNOTE: $${spotUsd.toFixed(2)} spot buy is above CARRY_MAX_USD=${MAX_USD}; open will refuse.`);
}

// Real PnL from public data: fills since `since`, funding paid since `since`, legs marked at mid.
async function status(user, since) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(user || "")) throw new Error("usage: status <0xaccount> [--since ISO]");
  const m = await market(COIN), mids = await info({ type: "allMids" }), all = await info({ type: "userFillsByTime", user, startTime: since });
  if (all.length >= 2000) console.log("WARNING: 2000 fills returned, the API cap; older fills in the window are missing\n");
  const fills = all.filter((f) => f.coin === m.spot.book || f.coin === m.perp.book).sort((a, b) => a.time - b.time);
  const szi = +((await info({ type: "clearinghouseState", user })).assetPositions.find((p) => p.position.coin === COIN)?.position.szi || 0);
  const funding = (await info({ type: "userFunding", user, startTime: since })).filter((f) => f.delta.coin === COIN);
  const legs = {};
  for (const [name, leg] of [["spot", m.spot], ["perp", m.perp]]) {
    const fs = fills.filter((f) => f.coin === leg.book), mid = +mids[leg.book];
    const qty = fs.reduce((a, f) => a + (f.side === "B" ? +f.sz : -f.sz), 0);
    const cash = fs.reduce((a, f) => a + (f.side === "B" ? -1 : 1) * f.px * f.sz, 0);
    const fees = fs.reduce((a, f) => a + (f.feeToken === "USDC" ? +f.fee : f.fee * f.px), 0);
    legs[name] = { fills: fs.length, qty: +qty.toFixed(8), mid, price_pnl: cash + qty * mid, fees, maker_fills: fs.filter((f) => !f.crossed).length };
  }
  const fund = funding.reduce((a, f) => a + +f.delta.usdc, 0), fees = legs.spot.fees + legs.perp.fees;
  // bps against the largest short held: the live position, or the peak reached by fills (after a close)
  let run = 0, peak = Math.abs(szi);
  for (const f of fills.filter((f) => f.coin === m.perp.book)) { run += f.side === "B" ? +f.sz : -f.sz; peak = Math.max(peak, Math.abs(run)); }
  const net = legs.spot.price_pnl + legs.perp.price_pnl + fund - fees, notional = peak * legs.perp.mid;
  const out = { coin: COIN, user, since: new Date(since).toISOString(), funding_usd: fund, funding_payments: funding.length, fees_usd: fees,
    spot_price_pnl: legs.spot.price_pnl, perp_price_pnl: legs.perp.price_pnl, net_usd: net, net_bps: notional ? (net / notional) * 1e4 : null,
    spot_qty: legs.spot.qty, perp_qty: legs.perp.qty, fills: legs.spot.fills + legs.perp.fills, maker_fills: legs.spot.maker_fills + legs.perp.maker_fills };
  const r = (x) => (x == null ? "–" : x.toFixed(6));
  console.log(`## Carry status ${COIN} for ${user} since ${out.since}\n`);
  console.log(`| item | USD |\n|---|---|\n| funding received (${funding.length} payments) | ${r(fund)} |\n| fees paid | ${r(-fees)} |\n| spot leg price change | ${r(legs.spot.price_pnl)} |\n| perp leg price change | ${r(legs.perp.price_pnl)} |\n| **net** | **${r(net)}** (${out.net_bps == null ? "–" : out.net_bps.toFixed(2)} bps) |\n`);
  console.log(`traded in window: spot ${legs.spot.qty} ${m.spot.token} (before in-kind fees), perp ${legs.perp.qty} ${COIN}; live perp position ${szi}; ${out.fills} fills, ${out.maker_fills} maker`);
  if (Math.abs(szi - legs.perp.qty) > 10 ** -m.perp.szDec) console.log("NOTE: the perp position predates --since, so price change covers only trades in the window while funding covers the whole position");
  console.log(`verify: https://app.hyperliquid.xyz/explorer/address/${user}`);
  record({ kind: "status", ...out });
  return out;
}

const ADDR = /^0x[0-9a-fA-F]{40}$/, KEY = /^0x[0-9a-fA-F]{64}$/;
async function exchange() {
  if (!ADDR.test(process.env.HL_ACCOUNT || "")) throw new Error("HL_ACCOUNT is not a 0x address (40 hex chars); fill it in carry/.env");
  if (!KEY.test(process.env.HL_AGENT_KEY || "")) throw new Error("HL_AGENT_KEY is not a 0x private key (64 hex chars); fill it in carry/.env");
  const { ExchangeClient, HttpTransport } = await import("@nktkas/hyperliquid");
  const { privateKeyToAccount } = await import("viem/accounts");
  return new ExchangeClient({ transport: new HttpTransport(), wallet: privateKeyToAccount(process.env.HL_AGENT_KEY) });
}

// Rest a post-only order at the touch; requote while nothing fills; cross the rest with IOC so a
// leg is never left unhedged for long. Orders under $10 are refused, so a partial fill whose
// remainder is below that is stopped and reported, not chased.
async function work(ex, user, leg, isBuy, size, reduceOnly) {
  let left = size, filled = 0;
  const fillsOf = async (oid, t0) => { await sleep(1500); return (await info({ type: "userFillsByTime", user, startTime: t0 })).filter((f) => f.oid === oid).reduce((a, f) => a + +f.sz, 0); };
  for (let i = 0; i <= TRIES && left > 0; i++) {
    const t = await top(leg.book), taker = i === TRIES, px = isBuy ? (taker ? +t.ask * (1 + SLIP) : t.bid) : (taker ? +t.bid * (1 - SLIP) : t.ask);
    if (left * +px < MIN_USD && !reduceOnly) { console.log(`  remainder ${left} is under $${MIN_USD}; stopping this leg`); break; }
    const o = { a: leg.asset, b: isBuy, p: taker ? fmtPx(px, leg) : px, s: wire(left, leg.szDec), r: reduceOnly, t: { limit: { tif: taker ? "Ioc" : "Alo" } } }, t0 = Date.now();
    let st;
    try { st = (await ex.order({ orders: [o], grouping: "na" })).response.data.statuses[0]; }
    catch (e) { console.log(`  ${taker ? "IOC" : "ALO"} ${o.p} refused: ${e.message}`); record({ kind: "order_refused", order: o, error: e.message }); continue; }
    let got = 0;
    if (st.filled) got = +st.filled.totalSz;
    else if (st.resting) {
      await sleep(WAIT_MS);
      try { await ex.cancel({ cancels: [{ a: leg.asset, o: st.resting.oid }] }); } catch { /* filled before the cancel */ }
      got = await fillsOf(st.resting.oid, t0);
    }
    left = floorSz(left - got, leg.szDec); filled += got;
    console.log(`  ${leg.book} ${isBuy ? "buy" : "sell"} ${o.s} @ ${o.p} ${o.t.limit.tif}: filled ${got}, left ${left}`);
    record({ kind: "order", order: o, filled: got, left });
  }
  return filled;
}

async function preflight(m) {
  const user = process.env.HL_ACCOUNT;
  if (!user || user === "0x") return console.log("(set HL_ACCOUNT to check balances)");
  if (!ADDR.test(user)) throw new Error("HL_ACCOUNT is not a 0x address (40 hex chars); fill it in carry/.env");
  const [spot, perp] = await Promise.all([info({ type: "spotClearinghouseState", user }), info({ type: "clearinghouseState", user })]);
  const usdc = spot.balances.find((b) => b.coin === "USDC"), base = spot.balances.find((b) => b.coin === m.spot.token);
  const pos = perp.assetPositions.find((p) => p.position.coin === COIN)?.position;
  const st = { spot_usdc_free: usdc ? +usdc.total - +usdc.hold : 0, spot_base: base ? +base.total - +base.hold : 0, perp_withdrawable: +perp.withdrawable, perp_szi: pos ? +pos.szi : 0 };
  console.log(`account ${user}: spot USDC free ${st.spot_usdc_free}, ${m.spot.token} ${st.spot_base}, perp withdrawable ${st.perp_withdrawable}, ${COIN} perp position ${st.perp_szi}`);
  return st;
}

async function open() {
  const m = await market(COIN), t = await top(m.spot.book), sz = sizes(m, +t.ask);
  const spotUsd = sz.buy * +t.ask, margin = (sz.hedge * +t.ask) / LEV;
  if (spotUsd > MAX_USD) throw new Error(`$${spotUsd.toFixed(2)} spot buy is above CARRY_MAX_USD=${MAX_USD}`);
  const st = await preflight(m);
  console.log(`open: buy ${sz.buy} ${m.spot.token} spot (~$${spotUsd.toFixed(2)}), then short ${sz.hedge} ${COIN} perp at ${LEV}x isolated (~$${margin.toFixed(2)} margin)`);
  if (!LIVE) return console.log("dry run: add --live to send orders");
  if (!st) throw new Error("live needs HL_ACCOUNT");
  if (st.spot_usdc_free < spotUsd * 1.01) throw new Error(`spot USDC ${st.spot_usdc_free} < ${(spotUsd * 1.01).toFixed(2)} needed`);
  if (st.perp_withdrawable < margin * 1.05) throw new Error(`perp margin ${st.perp_withdrawable} < ${(margin * 1.05).toFixed(2)}; move USDC spot -> perp in the app`);
  if (st.perp_szi !== 0) throw new Error(`a ${COIN} perp position already exists (${st.perp_szi}); close it first`);
  const ex = await exchange(), user = process.env.HL_ACCOUNT;
  record({ kind: "open_start", coin: COIN, ...sz, lev: LEV, user });
  const bought = await work(ex, user, m.spot, true, sz.buy, false);
  if (!bought) return console.log("spot leg did not fill; nothing open");
  await ex.updateLeverage({ asset: m.perp.asset, isCross: false, leverage: LEV });
  const hedge = Math.min(sz.hedge, floorSz(bought * (1 - FEE.spot.taker / 1e4), m.perp.szDec)); // what the account holds after the in-kind fee
  const sold = await work(ex, user, m.perp, false, hedge, false);
  const gap = (hedge - sold) * +t.ask;
  record({ kind: "open_done", bought, sold, unhedged_usd: gap });
  console.log(`open done: spot +${bought}, perp -${sold}${Math.abs(gap) > 0.5 ? `; UNHEDGED $${gap.toFixed(2)}` : ""}`);
}

async function close() {
  const m = await market(COIN), st = await preflight(m);
  if (!st) return;
  // Sell back only the hedged amount, so other coins the account already held are left alone.
  const perpQty = Math.abs(st.perp_szi), spotQty = Math.min(floorSz(st.spot_base, m.spot.szDec), floorSz(perpQty, m.spot.szDec));
  const bid = +(await top(m.spot.book)).bid;
  console.log(`close: buy back ${perpQty} ${COIN} perp (reduce-only), sell ${spotQty} ${m.spot.token} spot (~$${(spotQty * bid).toFixed(2)})`);
  if (spotQty && spotQty * bid < MIN_USD) throw new Error(`spot sale $${(spotQty * bid).toFixed(2)} is under the $${MIN_USD} minimum; closing the perp alone would leave the spot unhedged, so nothing was sent`);
  if (!LIVE) return console.log("dry run: add --live to send orders");
  const ex = await exchange(), user = process.env.HL_ACCOUNT;
  record({ kind: "close_start", perpQty, spotQty, user });
  const bought = perpQty ? await work(ex, user, m.perp, true, perpQty, true) : 0;
  const sold = spotQty ? await work(ex, user, m.spot, false, spotQty, false) : 0;
  record({ kind: "close_done", bought, sold });
  console.log(`close done: perp bought back ${bought}, spot sold ${sold}`);
}

// Every CARRY_EVERY ms: check how far the short is from its liquidation price; once per hour also
// record status. When the room drops under CARRY_GUARD (default 8%), close both legs (with --live)
// so the hedge is unwound at market instead of liquidated with Hyperliquid's liquidation fee.
async function watch() {
  const user = process.env.HL_ACCOUNT, guard = Number(process.env.CARRY_GUARD || 0.08), every = Number(process.env.CARRY_EVERY || 600000);
  if (!ADDR.test(user || "")) throw new Error("watch needs HL_ACCOUNT (a 0x address) in carry/.env");
  for (let n = 0; ; n++) {
    try {
      if (n % Math.max(1, Math.round(3600000 / every)) === 0) await status(user, since);
      const pos = (await info({ type: "clearinghouseState", user })).assetPositions.find((p) => p.position.coin === COIN)?.position;
      if (!pos || +pos.szi >= 0) { console.log(`${new Date().toISOString()} no ${COIN} short open`); }
      else if (pos.liquidationPx) {
        const mid = +(await info({ type: "allMids" }))[COIN], liq = +pos.liquidationPx, room = liq / mid - 1;
        console.log(`${new Date().toISOString()} ${COIN} ${mid}, liquidation ${liq}, room ${(room * 100).toFixed(1)}%`);
        if (room < guard) {
          record({ kind: "guard", mid, liq, room });
          console.log(`room under ${guard * 100}%: closing both legs${LIVE ? "" : " (dry run: add --live to act)"}`);
          if (LIVE) { await close(); return; }
        }
      }
    } catch (e) { console.log(`watch: ${e.message}`); }
    await sleep(every);
  }
}

// Free check that signing is right: an order signed by a fresh key comes back as
// "User or API Wallet 0x... does not exist", naming the address the API recovered.
async function selftest() {
  const { ExchangeClient, HttpTransport } = await import("@nktkas/hyperliquid");
  const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
  const wallet = privateKeyToAccount(generatePrivateKey()), m = await market(COIN), t = await top(m.perp.book);
  const px = fmtPx(+t.bid * 0.5, m.perp), sz = wire(Math.ceil((12 / +px) * 10 ** m.perp.szDec) / 10 ** m.perp.szDec, m.perp.szDec);
  try {
    await new ExchangeClient({ transport: new HttpTransport(), wallet }).order({ orders: [{ a: m.perp.asset, b: true, p: px, s: sz, r: false, t: { limit: { tif: "Alo" } } }], grouping: "na" });
    console.log("unexpected: order accepted");
  } catch (e) {
    const ok = e.message.toLowerCase().includes(wallet.address.toLowerCase());
    console.log(`signer ${wallet.address}\nAPI said: ${e.message}\nsignature ${ok ? "OK: the API recovered our address" : "MISMATCH: the API recovered a different address"}`);
    process.exitCode = ok ? 0 : 1;
  }
}

// Window for status: --since / CARRY_SINCE, else a minute before the last open in the ledger, else 30 days.
const lastOpen = () => { try { return readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "open_start").at(-1)?.t; } catch { return undefined; } };
const sinceArg = opt("since", process.env.CARRY_SINCE), opened = lastOpen();
const since = sinceArg ? Date.parse(sinceArg) : opened ? Date.parse(opened) - 60000 : Date.now() - 30 * 864e5;
const run = { plan, status: () => status(args[1] || process.env.HL_ACCOUNT, since), open, close, watch, selftest }[cmd];
if (!run) { console.log("usage: node carry-hl.js plan|status [0xaccount]|open [--live]|close [--live]|watch [--live]|selftest"); process.exit(1); }
run().catch((e) => { console.error(`error: ${e.message}`); process.exitCode = 1; });
