// Run: node carry/basis.mjs  (public candles, no key; 180 days)
// Basis = (perp - spot) / spot in bps, from hourly candle closes. Long spot + short perp gains basis_entry - basis_exit.
const post = b => fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const now = Date.now(), start = now - 180 * 864e5;
const pairs = { HYPE: '@107' };
const meta = await post({ type: 'spotMeta' });
const byIdx = new Map(meta.tokens.map(t => [t.index, t.name]));
const name = i => byIdx.get(i);
for (const u of meta.universe) {
  const [b, q] = u.tokens.map(name);
  if (q === 'USDC' && ['UBTC', 'UETH', 'USOL'].includes(b)) pairs[b.slice(1)] = u.name;
}
console.log('pairs', pairs);
const candles = async coin => {
  const a = await post({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: start, endTime: now } });
  return new Map(a.map(c => [c.t, +c.c]));
};
for (const [perp, spot] of Object.entries(pairs)) {
  const P = await candles(perp), S = await candles(spot);
  const ts = [...P.keys()].filter(t => S.has(t)).sort((a, b) => a - b);
  const basis = ts.map(t => (P.get(t) - S.get(t)) / S.get(t) * 1e4);
  const s = [...basis].sort((a, b) => a - b), q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
  const r = { hours: ts.length, basisMed: q(s, .5).toFixed(1), basisP10: q(s, .1).toFixed(1), basisP90: q(s, .9).toFixed(1) };
  for (const H of [7, 30]) {
    const g = []; for (let i = 0; i + H * 24 < basis.length; i++) g.push(basis[i] - basis[i + H * 24]);
    g.sort((a, b) => a - b);
    r[`gain${H}d`] = { p10: q(g, .1).toFixed(1), med: q(g, .5).toFixed(1), p90: q(g, .9).toFixed(1) };
  }
  console.log(perp, spot, JSON.stringify(r));
}
