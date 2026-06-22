# Arbiter — Operational Runbook

**Default mode: PAPER. Live requires explicit config + funding.**

## Architecture

```
GitHub Actions (every 5 min)
  └─ scripts/paper-scan.mjs
       ├─ Polymarket Gamma API → Dutch book detection
       ├─ Liquidity gate ($500+) + Resolution buffer (2h+)
       ├─ Quarter-Kelly sizing → paper trade
       ├─ Commit to repo [skip vercel]
       └─ Telegram alert on trade / kill-switch

Vercel (always on, zero config)
  └─ dashboard-web (Next.js 14, force-dynamic)
       ├─ / → public landing page
       ├─ /dashboard → live stats (GitHub state + on-demand scan)
       ├─ /markets → Polymarket live browser
       ├─ /trades → full trade log
       ├─ /backtest → backtest results
       └─ /risk → risk monitor + gauges
```

---

## Status — Fase build

- [x] FASE 0 — Setup & hipotesis: struktur, config, edge hypothesis
- [x] FASE 1 — Data ingestion: Polymarket Gamma API (read-only, no key)
- [x] FASE 2 — Edge engine: Dutch book detection, mutually-exclusive scanner
- [x] FASE 3 — Risk module: ¼ Kelly, per-trade cap, kill-switch, position limits
- [x] FASE 4 — Backtest: walk-forward gate, Monte Carlo scaffold (awaits historical data)
- [x] FASE 5 — Paper trading: GitHub Actions loop, live prices, paper PnL, equity curve
- [ ] FASE 6 — Live mikro: gated behind POLYMARKET_PRIVATE_KEY (env var on Vercel)
- [x] FASE 7 — Monitoring: Telegram alerts, dashboard, kill-switch, circuit breaker

---

## Daily operations

Scanner runs automatically via GitHub Actions. No manual intervention needed.

**Check scanner alive:**
```bash
curl -s https://raw.githubusercontent.com/nayrbryanGaming/arbiter/main/dashboard-web/public/data/stats.json | python3 -c "import sys,json; s=json.load(sys.stdin); print('Last scan:', s['last_scan_at'], '| Bankroll:', s['bankroll_usd'])"
```

**Manual scan trigger (no browser):**
```bash
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/nayrbryanGaming/arbiter/actions/workflows/paper-scan.yml/dispatches \
  -d '{"ref":"main"}'
```

---

## Kill switch

**Trigger:** Daily loss >= 10% of $1,000 initial bankroll.

**Effect:** `kill_switch_active: true` in stats.json. Scanner exits on next run. Telegram alert sent.

**Reset (CLI):**
```bash
git pull origin main
node -e "
const fs = require('fs');
const f = 'dashboard-web/public/data/stats.json';
const s = JSON.parse(fs.readFileSync(f));
s.kill_switch_active = false;
s.daily_loss_pct = 0;
s.realized_pnl_today = 0;
fs.writeFileSync(f, JSON.stringify(s, null, 2));
console.log('Reset. Bankroll:', s.bankroll_usd);
"
git add dashboard-web/public/data/stats.json
git commit -m "ops: manual kill switch reset [skip vercel]"
git push origin main
```

---

## Circuit breaker

**Trigger:** 3 consecutive Gamma API failures.

**Reset:** Set `consecutive_api_failures: 0` in stats.json using same process above.

---

## Telegram alerts (optional)

1. Create bot via @BotFather → /newbot → copy token
2. Get chat ID: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'`
3. Add to GitHub → Settings → Secrets and variables → Actions:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. Add to `.github/workflows/paper-scan.yml` under `env:`:
   ```yaml
   TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
   TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
   ```
   (requires GitHub token with `workflow` scope)

---

## Risk limits

| Parameter | Value | Location |
|-----------|-------|----------|
| Kelly fraction | 0.25 (¼ Kelly) | scripts/paper-scan.mjs |
| Max per trade | 2% of bankroll | paper-scan.mjs |
| Max per market | 5% of bankroll | paper-scan.mjs |
| Max open positions | 5 | paper-scan.mjs |
| Daily loss kill-switch | 10% | paper-scan.mjs |
| Min edge threshold | 3% | paper-scan.mjs |
| Min market liquidity | $500 USD | paper-scan.mjs |
| Resolution buffer | 2 hours | paper-scan.mjs |

---

## Enable live trading (FASE 6 — only after paper PnL positive 2-4 weeks)

1. Create dedicated wallet — NOT main wallet
2. Fund with USDC on Polygon + MATIC for gas
3. `vercel env add POLYMARKET_PRIVATE_KEY` (stays server-side, never in browser)
4. Dashboard Market Access card shows "LIVE" mode
5. Monitor closely for first 48 hours

---

## Emergency procedures

**Bot trading erratically:**
Manually set kill switch: edit stats.json, set `kill_switch_active: true`, push.

**Vercel dashboard error:**
```bash
cd dashboard-web && npx vercel --prod --yes
```

**Full state reset:**
```bash
cat > dashboard-web/public/data/stats.json << 'EOF'
{"mode":"paper","bankroll_usd":1000,"realized_pnl_total":0,"realized_pnl_today":0,"win_rate":0,"kill_switch_active":false,"daily_loss_pct":0,"scan_count":0,"started_at":"NOW","last_scan_at":"NOW","opportunities_found_today":0,"trades_today":0,"open_positions":0,"max_open_positions":5,"uptime_hours":0,"avg_edge_pct":0,"consecutive_api_failures":0}
EOF
echo '[]' > dashboard-web/public/data/trades.json
echo '[]' > dashboard-web/public/data/equity.json
echo '[]' > dashboard-web/public/data/opportunities.json
git add dashboard-web/public/data/
git commit -m "ops: state reset [skip vercel]"
git push origin main
```

---

## Rules that cannot be overridden

1. Default mode is PAPER. Live requires `POLYMARKET_PRIVATE_KEY` env var.
2. Private key never in code, never in git, never in browser — Vercel env only.
3. Do not go live before paper trading shows consistent positive PnL.
4. Kill-switch cannot be disabled mid-day — wait for daily reset.
