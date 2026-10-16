// Paper carry: long spot + short perp of equal size, opened at CARRY_PAPER_SINCE, never closed.
// Net = funding received since then minus one taker round trip (perp 4.5 + spot 7 bps, each way).
// Reads only public Hyperliquid funding history; needs no key and places no order.
//   node paper.mjs                 BTC ETH SOL HYPE since 2026-10-04T05:00:00Z
//   CARRY_PAPER_SINCE=... CARRY_PAPER_COINS=HYPE node paper.mjs
import { appendFileSync } from 'node:fs';

const SINCE = process.env.CARRY_PAPER_SINCE || '2026-10-04T05:00:00Z';
const COINS = (process.env.CARRY_PAPER_COINS || 'BTC,ETH,SOL,HYPE').split(',');
const FEES = 2 * 4.5 + 2 * 7; // bps, Hyperliquid base tier taker
const start = Date.parse(SINCE), now = Date.now(), hours = (now - start) / 36e5;

async function funding(coin) {
  let t = start, sum = 0, n = 0, neg = 0;
  for (;;) {
    const r = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'fundingHistory', coin, startTime: t }),
    });
    if (!r.ok) throw new Error(`${coin}: HTTP ${r.status}`);
    const a = await r.json();
    for (const x of a) { sum += +x.fundingRate; n++; if (+x.fundingRate < 0) neg++; }
    if (a.length < 500) break;
    t = a[a.length - 1].time + 1;
  }
  return { bps: sum * 1e4, n, neg };
}

const rows = [];
for (const coin of COINS) {
  const f = await funding(coin);
  const net = f.bps - FEES;
  rows.push(`| ${coin} | ${f.n} | ${f.neg} | ${f.bps.toFixed(2)} | ${net.toFixed(2)} | ${(net / 10).toFixed(2)} | ${(f.bps / hours * 8760 / 100).toFixed(1)}% |`);
}

const out = [
  `## Paper carry since ${SINCE} (${hours.toFixed(0)} h), fees ${FEES} bps round trip`,
  '',
  '| coin | funding hours | negative hours | funding bps | net bps | net USD per $1000 | gross per year |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
