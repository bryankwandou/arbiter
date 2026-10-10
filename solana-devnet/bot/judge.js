// Stop-rule verdict (agreed 2026-10-04): on 2026-10-18 judge mm, xchain and liqbot,
// close any with a negative median. carrybot is reported alongside it.
//
// Each strategy is counted per position, not per log line:
//   mm       logs a running total every 10 min, so one job = one result (its last line per route)
//   xchain   every quote is an independent opportunity, so one line = one result
//   liqbot   an account can be re-logged, so one account = one result (its last line)
//   carrybot one paper position per coin, so the newest line is the result
//
// Usage: gh run download <run id> -R bryankwandou/arbiter -D data -p "edge-mm-*" -p "edge-xchain-*" -p "edge-liqbot-*" -p "edge-carrybot-*"
//        node judge.js data/*/*.jsonl
// One file = one job. The input hash lets anyone re-run this on the same files.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const files = process.argv.slice(2).sort();
if (!files.length) throw new Error("usage: node judge.js <edge-*.jsonl files>");
const hash = createHash("sha256");
const rows = files.flatMap((f) => {
  const txt = readFileSync(f, "utf8");
  hash.update(txt);
  return txt.split("\n").filter(Boolean).map((l) => ({ ...JSON.parse(l), file: f })).filter((r) => r.ok !== false);
});
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const group = (v, key) => { const g = {}; for (const r of v) (g[key(r)] ||= []).push(r); return g; };
const last = (v) => v.reduce((a, b) => (b.t > a.t ? b : a));
const f2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : "–");
const of = (s) => rows.filter((r) => r.strategy === s);
const out = [], verdict = {};
const ts = rows.map((r) => r.t).sort();
out.push(`## Stop-rule verdict`, "", `${files.length} files, ${rows.length} rows, ${ts[0]} → ${ts.at(-1)}`, `input sha256 ${hash.digest("hex")}`, "");

// mm: one result per (job, route) = the job's final running total, gas included, inventory marked to mid.
{
  const res = Object.values(group(of("mm"), (r) => `${r.file}|${r.route}`)).map(last);
  out.push("### mm (paper market maker), one result per job", "", "| route | jobs | median pnl $ | total pnl $ | jobs > 0 |", "|---|---|---|---|---|");
  const routes = Object.entries(group(res, (r) => r.route)).map(([k, v]) => ({ k, n: v.length, m: med(v.map((r) => r.pnl_usd)), sum: v.reduce((a, r) => a + r.pnl_usd, 0), pos: v.filter((r) => r.pnl_usd > 0).length }));
  for (const x of routes.sort((a, b) => b.m - a.m)) out.push(`| ${x.k} | ${x.n} | ${f2(x.m)} | ${f2(x.sum)} | ${x.pos} |`);
  const all = res.map((r) => r.pnl_usd);
  verdict.mm = { results: all.length, median: med(all), pass: all.length >= 3 && med(all) > 0,
    note: "fills use OKX prints as the flow, so even a pass is optimistic" };
}

// xchain: one result per quote pair, bridge + gas charged on every trade (the inventory has to come back).
{
  const res = of("xchain");
  out.push("", "### xchain (Solana vs EVM, deBridge rebalance), one result per quote", "", "| route | $ | quotes | median gross bps | median net bps | net > 0 |", "|---|---|---|---|---|---|");
  const routes = Object.values(group(res, (r) => `${r.route}|${r.usd}`)).map((v) => ({ r: v[0], n: v.length, g: med(v.map((x) => x.gross_bps)), m: med(v.map((x) => x.net_bps)), pos: v.filter((x) => x.net_bps > 0).length }));
  for (const x of routes.sort((a, b) => b.m - a.m)) out.push(`| ${x.r.route} | ${x.r.usd} | ${x.n} | ${f2(x.g)} | ${f2(x.m)} | ${x.pos} |`);
  const all = res.map((r) => r.net_bps);
  verdict.xchain = { results: all.length, median: med(all), pass: all.length >= 30 && med(all) > 0,
    note: "quotes at 0 slippage, no latency; a pass would still need a live fill test" };
}

// liqbot: one result per target account. Targets come from other bots' attempts, so we are always second.
{
  const res = Object.values(group(of("liqbot"), (r) => r.account)).map(last);
  out.push("", "### liqbot (MarginFi receivership, dry run), one result per account", "", "| account | route | repay $ | profit $ | already attempted by |", "|---|---|---|---|---|");
  for (const r of res.sort((a, b) => b.profit_usd - a.profit_usd)) out.push(`| ${r.account.slice(0, 8)}… | ${r.route} | ${f2(r.repay_usd)} | ${f2(r.profit_usd)} | ${r.attempted_by ? r.attempted_by.slice(0, 8) + "…" : "–"} |`);
  const all = res.map((r) => r.profit_usd);
  verdict.liqbot = { results: all.length, median: all.length ? med(all) : NaN, pass: all.length >= 5 && med(all) > 0,
    note: "every target was found after another bot had already tried it" };
}

// carrybot: the newest line per coin at $1000 is the open paper position.
{
  const res = Object.values(group(of("carrybot").filter((r) => r.usd === 1000), (r) => r.route.split(" ")[0])).map(last);
  out.push("", "### carrybot (paper carry since 2026-10-04 05:00Z)", "", "| coin | hours | funding bps | basis bps | net bps after 21 bps fees | as of |", "|---|---|---|---|---|---|");
  for (const r of res) out.push(`| ${r.route.split(" ")[0]} | ${r.hours} | ${f2(r.funding_bps)} | ${f2(r.basis_bps)} | ${f2(r.net_bps)} | ${r.t} |`);
  const all = res.map((r) => r.net_bps);
  verdict.carrybot = { results: all.length, median: all.length ? med(all) : NaN, pass: all.length > 0 && med(all) > 0,
    note: "a real test needs ~$22 (Hyperliquid ~$10 minimum per leg), above the $10 cap" };
}

out.push("", "### Verdict", "", "| strategy | results | median | rule | note |", "|---|---|---|---|---|");
for (const [k, v] of Object.entries(verdict))
  out.push(`| ${k} | ${v.results} | ${f2(v.median)} | ${v.results === 0 ? "NO DATA" : v.pass ? "PASS: may get a ≤ $10 real test" : "CLOSE"} | ${v.note} |`);
console.log(out.join("\n"));
