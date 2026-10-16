// Run: node carry/crash-days.mjs
// How often do crash days happen? Daily candles from Hyperliquid perps (public, no key).
// Crash day = intraday low at least X% under the previous day's close.
const post = b => fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const now = Date.now(), start = Date.parse('2023-06-01T00:00:00Z');
for (const coin of ['SOL', 'BTC', 'ETH']) {
  const a = await post({ type: 'candleSnapshot', req: { coin, interval: '1d', startTime: start, endTime: now } });
  const days = a.length, out = { from: new Date(a[0].t).toISOString().slice(0, 10), days };
  for (const X of [5, 10, 15, 20]) {
    let n = 0; const dates = [];
    for (let i = 1; i < a.length; i++) {
      const drop = (1 - +a[i].l / +a[i - 1].c) * 100;
      if (drop >= X) { n++; dates.push(new Date(a[i].t).toISOString().slice(0, 10)); }
    }
    out[`drop${X}`] = { n, perYear: (n / days * 365).toFixed(1), last: dates.slice(-4) };
  }
  console.log(coin, JSON.stringify(out));
}
