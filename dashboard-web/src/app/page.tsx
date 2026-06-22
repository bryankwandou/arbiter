import Link from "next/link";
import {
  AnimatedCounter,
  TiltCard,
  ScrollReveal,
  GradientMesh,
  Typewriter,
  FloatingDots,
  LivePulse,
} from "@/components/LandingAnimations";

export const dynamic = "force-dynamic";

// ── SVG Icons (zero emoji) ────────────────────────────────────────────────────
function IconBolt() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function IconGitHub() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
function IconGoogle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    title: "Dutch Book Detection",
    desc: "Scans 200+ Polymarket outcomes per cycle. Flags markets where sum-of-prices < 1.00 — locked arbitrage, mathematically guaranteed profit.",
    gradient: "from-blue-500/10 to-blue-600/5",
    glow: "rgba(59,130,246,0.15)",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
      </svg>
    ),
    title: "Quarter-Kelly Sizing",
    desc: "Position size = 0.25 × Kelly. No single trade exceeds 2% of bankroll. Hard cap enforced at execution, always.",
    gradient: "from-emerald-500/10 to-emerald-600/5",
    glow: "rgba(16,185,129,0.15)",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "10% Kill Switch",
    desc: "Daily loss exceeds 10% — bot halts automatically. No human required. Telegram alert sent. Resets next trading day.",
    gradient: "from-red-500/10 to-red-600/5",
    glow: "rgba(239,68,68,0.1)",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
      </svg>
    ),
    title: "Groq AI Analysis",
    desc: "llama-3.1-70b analyzes each opportunity: risks, confidence, key insight — in plain language. Augments math with narrative.",
    gradient: "from-purple-500/10 to-purple-600/5",
    glow: "rgba(139,92,246,0.15)",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: "24/7 Cloud Execution",
    desc: "GitHub Actions every 5 minutes. Vercel Edge serves fresh data on every request. Zero servers to manage, ever.",
    gradient: "from-cyan-500/10 to-cyan-600/5",
    glow: "rgba(6,182,212,0.12)",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-5" />
      </svg>
    ),
    title: "Walk-Forward Backtest",
    desc: "Monte Carlo ruin probability across 5,000 paths. Sharpe ratio, max drawdown, live-gate assessment. No go-live without proof.",
    gradient: "from-amber-500/10 to-amber-600/5",
    glow: "rgba(245,158,11,0.12)",
  },
];

const STATS = [
  { label: "Markets Scanned", value: "200", suffix: "+" },
  { label: "Scan Interval", value: "5", suffix: " min" },
  { label: "Min Edge", value: "3", suffix: "%" },
  { label: "Kelly Factor", value: "0.25", suffix: "×" },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#04060d",
        color: "#f1f5f9",
        fontFamily: "var(--font-inter, Inter, system-ui, sans-serif)",
        overflowX: "hidden",
      }}
    >
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          height: "62px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          backgroundColor: "rgba(4,6,13,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9px",
              background: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 0 24px rgba(37,99,235,0.5)",
            }}
          >
            <IconBolt />
          </div>
          <span style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.04em", color: "#f8fafc" }}>
            Arbiter
          </span>
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              backgroundColor: "rgba(59,130,246,0.1)",
              color: "#60a5fa",
              padding: "2px 7px",
              borderRadius: "4px",
              border: "1px solid rgba(59,130,246,0.2)",
            }}
          >
            PAPER
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Google Auth — Coming Soon */}
          <div style={{ position: "relative" }}>
            <button
              disabled
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                padding: "7px 14px",
                borderRadius: "7px",
                fontSize: "12px",
                fontWeight: 500,
                color: "rgba(241,245,249,0.4)",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                cursor: "not-allowed",
                fontFamily: "inherit",
              }}
            >
              <IconGoogle /> Sign in
            </button>
            <span
              style={{
                position: "absolute",
                top: "-8px",
                right: "-8px",
                fontSize: "8px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                backgroundColor: "#f59e0b",
                color: "#000",
                padding: "1px 5px",
                borderRadius: "99px",
                whiteSpace: "nowrap",
              }}
            >
              SOON
            </span>
          </div>

          <a
            href="https://github.com/nayrbryanGaming/arbiter"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "7px",
              fontSize: "12px",
              fontWeight: 500,
              color: "rgba(241,245,249,0.6)",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <IconGitHub /> GitHub
          </a>

          <Link
            href="/dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "8px 18px",
              borderRadius: "7px",
              fontSize: "12px",
              fontWeight: 700,
              color: "#fff",
              textDecoration: "none",
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              boxShadow: "0 0 20px rgba(59,130,246,0.4)",
              letterSpacing: "-0.01em",
            }}
          >
            Dashboard <IconArrow />
          </Link>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section
        style={{
          position: "relative",
          minHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 48px 60px",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        <GradientMesh />
        <FloatingDots count={24} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "820px" }}>
          {/* Live badge */}
          <div style={{ marginBottom: "32px" }}>
            <LivePulse label="Scanner active — scanning every 5 minutes" />
          </div>

          {/* Headline */}
          <h1
            style={{
              fontSize: "clamp(44px, 7vw, 80px)",
              fontWeight: 800,
              letterSpacing: "-0.05em",
              lineHeight: 1.03,
              color: "#f8fafc",
              marginBottom: "8px",
            }}
          >
            Autonomous
          </h1>
          <h1
            style={{
              fontSize: "clamp(44px, 7vw, 80px)",
              fontWeight: 800,
              letterSpacing: "-0.05em",
              lineHeight: 1.03,
              marginBottom: "28px",
              background: "linear-gradient(135deg, #60a5fa 0%, #34d399 60%, #60a5fa 100%)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "gradient-shift 4s linear infinite",
            }}
          >
            <Typewriter words={["Arbitrage", "Intelligence", "Precision", "Edge"]} speed={90} />
          </h1>

          {/* Subheadline */}
          <p
            style={{
              fontSize: "clamp(15px, 2.2vw, 19px)",
              color: "rgba(241,245,249,0.5)",
              lineHeight: 1.7,
              maxWidth: "540px",
              margin: "0 auto 48px",
            }}
          >
            Detect Dutch-book inefficiencies on Polymarket in real time.
            Quarter-Kelly sizing, 10% kill switch, Groq AI analysis — zero human intervention.
          </p>

          {/* CTA buttons */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "9px",
                padding: "15px 32px",
                borderRadius: "9px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
                textDecoration: "none",
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                boxShadow: "0 0 40px rgba(59,130,246,0.45), 0 8px 32px rgba(0,0,0,0.4)",
                letterSpacing: "-0.01em",
              }}
            >
              Open Dashboard <IconArrow />
            </Link>
            <a
              href="https://github.com/nayrbryanGaming/arbiter"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "9px",
                padding: "15px 32px",
                borderRadius: "9px",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(241,245,249,0.75)",
                textDecoration: "none",
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                letterSpacing: "-0.01em",
              }}
            >
              <IconGitHub /> View Source
            </a>
          </div>
        </div>

        {/* Scroll hint */}
        <div
          style={{
            position: "absolute",
            bottom: "32px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
            animation: "float-hint 2s ease-in-out infinite",
          }}
        >
          <div style={{ fontSize: "10px", color: "rgba(241,245,249,0.2)", letterSpacing: "0.1em" }}>SCROLL</div>
          <div style={{ width: "1px", height: "32px", background: "linear-gradient(to bottom, rgba(59,130,246,0.4), transparent)" }} />
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────────────────────────────────── */}
      <section
        style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          backgroundColor: "rgba(255,255,255,0.015)",
        }}
      >
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: `repeat(${STATS.length}, 1fr)`,
          }}
        >
          {STATS.map(({ label, value, suffix }, i) => (
            <ScrollReveal key={label} delay={i * 80}>
              <div
                style={{
                  padding: "32px 24px",
                  textAlign: "center",
                  borderRight: i < STATS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: "clamp(28px, 3.5vw, 40px)",
                    fontWeight: 800,
                    letterSpacing: "-0.04em",
                    color: "#f1f5f9",
                    marginBottom: "6px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <AnimatedCounter value={value} suffix={suffix} />
                </div>
                <div style={{ fontSize: "11px", color: "rgba(241,245,249,0.35)", fontWeight: 500, letterSpacing: "0.05em" }}>
                  {label}
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: "96px 48px", maxWidth: "1200px", margin: "0 auto" }}>
        <ScrollReveal style={{ textAlign: "center", marginBottom: "64px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "#3b82f6",
              textTransform: "uppercase",
              marginBottom: "14px",
            }}
          >
            System Design
          </div>
          <h2
            style={{
              fontSize: "clamp(28px, 4.5vw, 48px)",
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: "#f8fafc",
              lineHeight: 1.1,
              marginBottom: "16px",
            }}
          >
            Built for edge,
            <span
              style={{
                background: "linear-gradient(135deg, #60a5fa, #34d399)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {" "}not excitement
            </span>
          </h2>
          <p style={{ fontSize: "15px", color: "rgba(241,245,249,0.4)", maxWidth: "500px", margin: "0 auto", lineHeight: 1.7 }}>
            Every component designed around one constraint: never lose more than you can afford, automatically.
          </p>
        </ScrollReveal>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "16px",
          }}
        >
          {FEATURES.map(({ icon, title, desc, glow }, i) => (
            <ScrollReveal key={title} delay={i * 60}>
              <TiltCard
                style={{
                  padding: "28px",
                  borderRadius: "14px",
                  backgroundColor: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  height: "100%",
                  cursor: "default",
                }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "11px",
                    backgroundColor: `${glow}`,
                    border: `1px solid ${glow}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#60a5fa",
                    marginBottom: "18px",
                  }}
                >
                  {icon}
                </div>
                <h3
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#f1f5f9",
                    marginBottom: "10px",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {title}
                </h3>
                <p style={{ fontSize: "13px", color: "rgba(241,245,249,0.45)", lineHeight: 1.7, margin: 0 }}>
                  {desc}
                </p>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      <section
        style={{
          padding: "96px 48px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          backgroundColor: "rgba(255,255,255,0.01)",
        }}
      >
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <ScrollReveal style={{ textAlign: "center", marginBottom: "56px" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.18em", color: "#10b981", textTransform: "uppercase", marginBottom: "14px" }}>
              Execution Loop
            </div>
            <h2 style={{ fontSize: "clamp(24px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.04em", color: "#f8fafc" }}>
              Fully autonomous, top to bottom
            </h2>
          </ScrollReveal>

          <div>
            {[
              { step: "01", title: "GitHub Actions triggers every 5 min", desc: "Scheduled workflow fetches Polymarket Gamma API — 200+ active markets ingested per cycle. Zero server cost." },
              { step: "02", title: "Dutch book scan across all markets", desc: "Sum all outcome prices. If sum < 0.98: edge = 1.0 - sum - 0.02 (2% fee buffer). Only edges ≥3% pass." },
              { step: "03", title: "Liquidity + resolution gating", desc: "Markets below $500 liquidity or within 2 hours of resolution are excluded. Slippage and oracle risk eliminated." },
              { step: "04", title: "Quarter-Kelly position sizing", desc: "Bet size = bankroll × edge × 0.25. Hard cap at 2% per trade regardless of Kelly output." },
              { step: "05", title: "Groq AI narrates the opportunity", desc: "llama-3.1-70b analyzes each edge: summary, 3 key risks, confidence level. Math decides, AI explains." },
              { step: "06", title: "Paper trade logged to GitHub", desc: "Trade committed with [skip vercel] — Vercel dashboard reads raw.githubusercontent.com on every request." },
            ].map(({ step, title, desc }, i) => (
              <ScrollReveal key={step} delay={i * 50}>
                <div
                  style={{
                    display: "flex",
                    gap: "24px",
                    padding: "28px 0",
                    borderBottom: i < 5 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#3b82f6",
                      opacity: 0.6,
                      flexShrink: 0,
                      paddingTop: "2px",
                      minWidth: "28px",
                    }}
                  >
                    {step}
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "#f1f5f9", marginBottom: "8px", letterSpacing: "-0.01em" }}>
                      {title}
                    </div>
                    <div style={{ fontSize: "13px", color: "rgba(241,245,249,0.4)", lineHeight: 1.7 }}>{desc}</div>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "112px 48px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <GradientMesh />
        <ScrollReveal style={{ position: "relative", zIndex: 1 }}>
          <TiltCard
            style={{
              maxWidth: "580px",
              margin: "0 auto",
              padding: "60px 48px",
              borderRadius: "18px",
              backgroundColor: "rgba(59,130,246,0.05)",
              border: "1px solid rgba(59,130,246,0.12)",
            }}
          >
            <h2
              style={{
                fontSize: "clamp(24px, 3.5vw, 36px)",
                fontWeight: 800,
                letterSpacing: "-0.04em",
                color: "#f8fafc",
                marginBottom: "16px",
              }}
            >
              Ready to see live data?
            </h2>
            <p style={{ fontSize: "14px", color: "rgba(241,245,249,0.45)", lineHeight: 1.75, marginBottom: "36px", maxWidth: "400px", margin: "0 auto 36px" }}>
              Real-time Polymarket scans, equity curve, AI analysis, risk gauges — updated every 30 seconds automatically.
            </p>
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "9px",
                padding: "15px 36px",
                borderRadius: "9px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
                textDecoration: "none",
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                boxShadow: "0 0 40px rgba(59,130,246,0.5), 0 8px 24px rgba(0,0,0,0.3)",
              }}
            >
              Open Dashboard <IconArrow />
            </Link>
          </TiltCard>
        </ScrollReveal>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          padding: "28px 48px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              background: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <IconBolt />
          </div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "rgba(241,245,249,0.5)", letterSpacing: "-0.02em" }}>Arbiter</span>
          <span style={{ fontSize: "11px", color: "rgba(241,245,249,0.2)" }}>Paper mode · Not financial advice</span>
        </div>
        <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          <a href="https://github.com/nayrbryanGaming/arbiter" target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "rgba(241,245,249,0.3)", textDecoration: "none" }}>GitHub</a>
          <Link href="/dashboard" style={{ fontSize: "12px", color: "rgba(241,245,249,0.3)", textDecoration: "none" }}>Dashboard</Link>
          <Link href="/risk" style={{ fontSize: "12px", color: "rgba(241,245,249,0.3)", textDecoration: "none" }}>Risk</Link>
          <Link href="/backtest" style={{ fontSize: "12px", color: "rgba(241,245,249,0.3)", textDecoration: "none" }}>Backtest</Link>
        </div>
      </footer>

      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        @keyframes float-hint {
          0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.4; }
          50% { transform: translateX(-50%) translateY(6px); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
