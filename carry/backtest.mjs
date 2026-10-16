// Carry backtest from public Hyperliquid funding history (no key): every hourly start in the last DAYS days,
// hold 7/14/30/60 days, net = funding sum - fees (23 taker, 11 maker bps). Run: node carry/backtest.mjs
const DAYS = 180, now = Date.now(), start = now - DAYS * 864e5;
// Retries when the API rate-limits (HTTP 429, or a null body), e.g. when several scripts run at once.
async function post(b) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const a = r.ok ? await r.json() : null;
    if (Array.isArray(a)) return a;
    if (i === 5) throw new Error(`${b.coin}: HTTP ${r.status} after 6 tries`);
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
}
const out = {};
for (const coin of ['BTC', 'ETH', 'SOL', 'HYPE']) {
  let t = start, rows = [];
  for (;;) {
    const a = await post({ type: 'fundingHistory', coin, startTime: t });
    rows.push(...a);
    if (a.length < 500) break;
    t = a[a.length - 1].time + 1;
  }
  const f = rows.map(x => +x.fundingRate * 1e4);
  const pre = [0]; for (const x of f) pre.push(pre[pre.length - 1] + x);
  const res = { hours: f.length, negHours: f.filter(x => x < 0).length, annGross: (pre.at(-1) / f.length * 8760 / 100).toFixed(1) };
  // monthly gross (30d blocks)
  res.monthly = []; for (let i = 0; i + 720 <= f.length; i += 720) res.monthly.push(+(pre[i + 720] - pre[i]).toFixed(1));
  for (const H of [7, 14, 30, 60]) {
    const h = H * 24, nets = [];
    for (let i = 0; i + h <= f.length; i++) nets.push(pre[i + h] - pre[i]);
    nets.sort((a, b) => a - b);
    const q = p => nets[Math.floor(p * (nets.length - 1))];
    for (const fee of [23, 11]) {
      res[`${H}d_fee${fee}`] = { posPct: (100 * nets.filter(x => x > fee).length / nets.length).toFixed(0), p10: (q(0.1) - fee).toFixed(1), med: (q(0.5) - fee).toFixed(1), p90: (q(0.9) - fee).toFixed(1) };
    }
  }
  out[coin] = res;
}
console.log(JSON.stringify(out, null, 1));
