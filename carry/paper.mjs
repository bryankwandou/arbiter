// Paper carry: long spot + short perp of equal size, opened at CARRY_PAPER_SINCE, valued as if closed now.
// Net = funding received + basis gain (perp-spot gap at entry minus gap now) - one round trip of fees.
// Fees: taker 23 bps (perp 4.5 + spot 7, each way) and maker 11 bps (perp 1.5 + spot 4), Hyperliquid base tier.
// Reads only public Hyperliquid data; needs no key and places no order.
//   node paper.mjs                 BTC ETH SOL HYPE since 2026-10-04T05:00:00Z
//   CARRY_PAPER_SINCE=... CARRY_PAPER_COINS=HYPE node paper.mjs
import { appendFileSync } from 'node:fs';

const SINCE = process.env.CARRY_PAPER_SINCE || '2026-10-04T05:00:00Z';
const COINS = (process.env.CARRY_PAPER_COINS || 'BTC,ETH,SOL,HYPE').split(',');
const SPOT = { HYPE: '@107', BTC: '@142', ETH: '@151', SOL: '@156' }; // HYPE/USDC, UBTC/USDC, UETH/USDC, USOL/USDC
const FEES = { taker: 2 * 4.5 + 2 * 7, maker: 2 * 1.5 + 2 * 4 }; // bps
const start = Date.parse(SINCE), now = Date.now(), hours = (now - start) / 36e5;

// Retries when the API rate-limits (HTTP 429, or a null body).
async function post(body) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const a = r.ok ? await r.json() : null;
    if (Array.isArray(a)) return a;
    if (i === 5) throw new Error(`${body.coin || body.req?.coin}: HTTP ${r.status} after 6 tries`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}

async function funding(coin) {
  let t = start, sum = 0, n = 0, neg = 0;
  for (;;) {
    const a = await post({ type: 'fundingHistory', coin, startTime: t });
    for (const x of a) { sum += +x.fundingRate; n++; if (+x.fundingRate < 0) neg++; }
    if (a.length < 500) break;
    t = a[a.length - 1].time + 1;
  }
  return { bps: sum * 1e4, n, neg };
}

// Close of the first 1h candle at or after t, and of the latest 1m candle.
const closeAt = async (coin, t) => +(await post({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: t, endTime: t + 36e5 } }))[0].c;
const closeNow = async (coin) => +(await post({ type: 'candleSnapshot', req: { coin, interval: '1m', startTime: now - 5 * 6e4, endTime: now } })).at(-1).c;
const gap = (perp, spot) => (perp - spot) / spot * 1e4;

const rows = [];
for (const coin of COINS) {
  const f = await funding(coin);
  const g0 = gap(await closeAt(coin, start), await closeAt(SPOT[coin], start));
  const g1 = gap(await closeNow(coin), await closeNow(SPOT[coin]));
  const gross = f.bps + (g0 - g1);
  const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  rows.push(`| ${coin} | ${f.n} | ${f.neg} | ${f.bps.toFixed(2)} | ${fmt(g0 - g1)} | ${fmt(gross - FEES.taker)} | ${fmt(gross - FEES.maker)} | ${fmt((gross - FEES.taker) / 10)} |`);
}

const out = [
  `## Paper carry since ${SINCE} (${hours.toFixed(0)} h), valued as if closed now`,
  '',
  '| coin | funding hours | negative hours | funding bps | basis gain bps | net bps, taker 23 | net bps, maker 11 | net USD per $1000, taker |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  'Basis gain uses hourly candle closes at entry and the latest 1m close now (last trades, not bid/ask).',
  '',
].join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
