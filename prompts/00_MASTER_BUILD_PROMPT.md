# MASTER BUILD PROMPT — Arbiter: Autonomous Arbitrage Intelligence

> **Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · shadcn/ui · Framer Motion · Groq LLM · GitHub Actions · Vercel

---

## 0. FILOSOFI

1. **No edge, no trade.** Dutch book = matematika murni, bukan feeling.
2. **Backtest dulu, uang belakangan.** Paper → live mikro → scale.
3. **Kelangsungan hidup > profit.** Kill-switch selalu aktif.
4. **AI augments, tidak menggantikan math.** Groq LLM untuk narasi + insight, bukan untuk keputusan sizing.

---

## 1. EDGE YANG DIIMPLEMENTASI

**Strategi utama: Dutch Book / Cross-Market Arbitrage**

Formula: `edge = max(0, 1.0 - sum_of_prices - 0.02)`

Kondisi: sum of all outcome prices < 1.0 (setelah fee 2%).
Jika YES + NO = $0.94 → beli keduanya untuk $0.94, dapat $1.00 saat resolve → +$0.06 locked profit.

**Filter wajib:**
- Min edge: 3%
- Min liquidity: $500 USD
- Resolution buffer: >2 jam dari penutupan market
- Circuit breaker: halt jika 3+ consecutive API failures

---

## 2. ARSITEKTUR LENGKAP

```
arbiter/
├── .github/workflows/
│   └── paper-scan.yml       # GitHub Actions: scan every 5 min (FREE, no browser)
├── scripts/
│   └── paper-scan.mjs       # Paper trading loop (Node.js, zero deps)
├── dashboard-web/           # Next.js 14 App Router
│   ├── src/app/
│   │   ├── page.tsx         # / → Landing page (Silicon Valley, Framer Motion)
│   │   ├── (shell)/
│   │   │   ├── layout.tsx   # Sidebar + TopBar wrapper
│   │   │   ├── dashboard/   # /dashboard → Main trading dashboard
│   │   │   ├── markets/     # /markets → Live Polymarket browser
│   │   │   ├── trades/      # /trades → Full trade log + CSV export
│   │   │   ├── backtest/    # /backtest → Monte Carlo results
│   │   │   └── risk/        # /risk → Risk gauges + limits
│   │   └── api/
│   │       ├── dashboard/   # GET: live scanner + GitHub state merge
│   │       ├── live-markets/# GET: Polymarket Gamma API proxy
│   │       ├── trades/      # GET: trade log from GitHub raw
│   │       ├── opportunities/# GET: live Dutch book scan
│   │       ├── ai/
│   │       │   └── analyze/ # POST: Groq LLM market analysis [NEW]
│   │       └── cron/scan/   # GET: Vercel cron endpoint (daily, hobby plan)
│   ├── src/components/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   ├── MetricCard.tsx
│   │   ├── EquityChart.tsx
│   │   ├── ActionPanel.tsx
│   │   ├── OpportunitiesFeed.tsx
│   │   ├── RecentTrades.tsx
│   │   ├── AutoRefresh.tsx
│   │   ├── AIInsightPanel.tsx    [NEW] Groq LLM insights
│   │   └── AnimatedHero.tsx      [NEW] Framer Motion 3D landing
│   └── src/lib/
│       ├── api.ts           # fetchDashboard, openPosition, etc.
│       └── scanner.ts       # scanPolymarket() — live Dutch book scan
├── runbook.md               # Operational SOP + emergency procedures
└── prompts/
    ├── 00_MASTER_BUILD_PROMPT.md  (this file)
    ├── 01_EDGE_HYPOTHESIS.md
    └── 02_MODAL_20_USD_REALITA.md
```

---

## 3. TECH STACK

| Layer | Tech | Notes |
|-------|------|-------|
| Framework | Next.js 14 App Router | force-dynamic SSR on all API routes |
| UI | shadcn/ui + Tailwind CSS | Dark theme, CSS custom properties |
| Animations | Framer Motion | 3D cards, parallax, smooth transitions |
| AI/LLM | Groq (llama-3.1-70b-versatile) | Market analysis, daily brief |
| Charts | Recharts | Equity curve, PnL |
| Icons | lucide-react | Zero emoji policy |
| Deployment | Vercel (Hobby) | force-dynamic, no Blob store needed |
| State | GitHub Actions + raw.githubusercontent.com | Free persistent state, 5-min cycles |
| Alerts | Telegram Bot API | Optional, kill-switch + trade notifications |

---

## 4. RISK MANAGEMENT (HARDCODED — tidak bisa di-override)

| Parameter | Value |
|-----------|-------|
| Kelly fraction | 0.25 (quarter-Kelly) |
| Per-trade cap | 2% bankroll |
| Per-market cap | 5% bankroll |
| Max positions | 5 |
| Daily kill-switch | 10% loss |
| Min edge | 3% |
| Min liquidity | $500 |
| Resolution buffer | 2 hours |

---

## 5. FEATURE STATUS — MVP CHECKLIST

### Selesai ✅
- [x] Dutch book scanner (GitHub Actions, every 5 min, 24/7)
- [x] Paper trading loop dengan Kelly sizing
- [x] Kill switch (10% daily loss)
- [x] Circuit breaker (3x API failure)
- [x] Liquidity gate + resolution buffer
- [x] Silicon Valley landing page (/)
- [x] Trading dashboard (/dashboard)
- [x] Market browser (/markets)
- [x] Trade log + CSV export (/trades)
- [x] Backtest gate assessment (/backtest)
- [x] Risk monitor + gauges (/risk)
- [x] Market Access card (paper/live mode, wallet config)
- [x] Telegram alerts (kill-switch + trade)
- [x] runbook.md (emergency procedures)
- [x] Auto-refresh every 30s
- [x] Equity curve (Recharts)
- [x] Vercel deploy (arbiterbot.vercel.app)

### Selesai ✅ (tambahan)
- [x] **Groq AI Market Analysis** (`/api/ai/analyze`) — llama-3.1-70b, graceful fallback
- [x] **AI Insight Panel** — expandable card on dashboard, confidence badge, key risks
- [x] **Silicon Valley landing page** — 3D tilt cards, animated counters, typewriter, floating dots, gradient mesh
- [x] **Google OAuth Coming Soon** — disabled button with "SOON" badge in nav
- [x] **Settings page** (`/settings`) — env vars status, risk limits, Telegram setup guide

### In Progress / Next
- [ ] **Notification center** — in-app alerts for kill-switch events
- [ ] **Historical data ingestion** — Parquet for real backtest (Fase 4)
- [ ] **Live trading gate** — requires POLYMARKET_PRIVATE_KEY (Fase 6)

---

## 6. AI / GROQ INTEGRATION

**Endpoint:** `POST /api/ai/analyze`

```typescript
// Request
{ opportunity: MarketOpportunity, context: DashboardStats }

// Response
{
  summary: string;        // 1-sentence opportunity summary
  risks: string[];        // 3 key risks
  confidence: "high" | "medium" | "low";
  recommendation: string; // paper / pass
}
```

**Model:** `llama-3.1-70b-versatile` via Groq (fastest, free tier available)

**Use cases:**
1. Analyze top opportunity in the scanner
2. Daily portfolio brief
3. Risk assessment for a specific market

**Setup:** `vercel env add GROQ_API_KEY`

---

## 7. ANIMATION SYSTEM (Framer Motion)

Landing page animations:
- Hero text: staggered word reveal
- Stats counter: animated number roll
- Feature cards: 3D perspective tilt on hover
- Scroll reveal: fade-up with stagger
- Background: animated gradient mesh

Dashboard animations:
- Metric cards: slide-in on load, number counter animation
- Opportunities: staggered list reveal
- Charts: draw animation on mount

---

## 8. GOOGLE AUTH (Coming Soon)

UI: Button "Sign in with Google" with "Coming Soon" badge.
Backend: NextAuth.js with Google provider — add when needed.

---

## 9. DEPLOYMENT (100% programmatic, no browser)

```bash
# Deploy
cd dashboard-web && npx vercel --prod --yes

# Set env vars
vercel env add GROQ_API_KEY
vercel env add TELEGRAM_BOT_TOKEN
vercel env add TELEGRAM_CHAT_ID
vercel env add POLYMARKET_PRIVATE_KEY  # only for live trading

# GitHub Actions: Telegram secrets
# GitHub → Settings → Secrets → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
```

---

## 10. DEFINITION OF DONE

A feature is DONE only when:
- No TypeScript errors
- No unhandled UI states (loading, error, empty)
- No console errors in production
- Works 24/7 without laptop
- Deployed to arbiterbot.vercel.app
