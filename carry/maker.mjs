// Run: node carry/maker.mjs  (public 1m candles, no key; last ~3.4 days, the API's 5000-candle limit)
// Would a post-only order fill? A spot buy resting at minute t's close counts as filled once a later
// 1m low trades strictly below it; a perp sell once a later high trades strictly above it. Strictly
// through the price means the queue ahead of us was cleared. Both legs must fill for the hedge.
const post = b => fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const now = Date.now(), start = now - 5000 * 6e4;
const PAIRS = { HYPE: '@107', BTC: '@142', ETH: '@151', SOL: '@156' };
const WIN = [1, 5, 15, 60];
const get = coin => post({ type: 'candleSnapshot', req: { coin, interval: '1m', startTime: start, endTime: now } });
for (const [perp, spot] of Object.entries(PAIRS)) {
  const [P, S] = await Promise.all([get(perp), get(spot)]);
  const sm = new Map(S.map(c => [c.t, c])), pm = new Map(P.map(c => [c.t, c]));
  const ts = P.map(c => c.t).filter(t => sm.has(t));
  const fillAt = (m, t, px, side, max) => {
    for (let k = 1; k <= max; k++) {
      const c = m.get(t + k * 6e4); if (!c) continue;
      if (side === 'buy' ? +c.l < px : +c.h > px) return k;
    }
    return Infinity;
  };
  const res = { minutes: ts.length, spotUsdPerMin: 0, perpUsdPerMin: 0 };
  let sv = 0, pv = 0;
  for (const t of ts) { sv += +sm.get(t).v * +sm.get(t).c; pv += +pm.get(t).v * +pm.get(t).c; }
  res.spotUsdPerMin = Math.round(sv / ts.length); res.perpUsdPerMin = Math.round(pv / ts.length);
  const n = ts.length - 60, cnt = Object.fromEntries(WIN.map(w => [w, { spot: 0, perp: 0, both: 0 }]));
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    const fs = fillAt(sm, t, +sm.get(t).c, 'buy', 60), fp = fillAt(pm, t, +pm.get(t).c, 'sell', 60);
    for (const w of WIN) { if (fs <= w) cnt[w].spot++; if (fp <= w) cnt[w].perp++; if (fs <= w && fp <= w) cnt[w].both++; }
  }
  for (const w of WIN) res[`${w}m`] = Object.fromEntries(Object.entries(cnt[w]).map(([k, v]) => [k, (100 * v / n).toFixed(0) + '%']));
  console.log(perp, spot, JSON.stringify(res));
}
