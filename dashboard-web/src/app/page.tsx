import { Suspense } from "react";
import nextDynamic from "next/dynamic";
import { fetchDashboard } from "@/lib/api";
import { MetricCard } from "@/components/MetricCard";
import { EquityChart } from "@/components/EquityChart";
import { RecentTrades } from "@/components/RecentTrades";
import { OpportunitiesFeed } from "@/components/OpportunitiesFeed";
import { AutoRefresh } from "@/components/AutoRefresh";

const ActionPanel = nextDynamic(
  () => import("@/components/ActionPanel").then((m) => ({ default: m.ActionPanel })),
  { ssr: false, loading: () => null }
);

export const dynamic = "force-dynamic";

function fmtPnl(n: number) {
  return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2);
}
function fmtPct(n: number) {
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
}
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

async function DashboardContent() {
  const data = await fetchDashboard();
  const { stats, equity_history, recent_trades, opportunities } = data;
  const dataSource = data.data_source;
  const isVercelNative = dataSource === "vercel-live";
  const isLive = dataSource === "live";
  const botConnected = isVercelNative || isLive || (data.bot_connected ?? false);

  const scannerLabel = stats.kill_switch_active
    ? "Kill Switch Active"
    : isVercelNative
    ? "Vercel Edge"
    : isLive
    ? "Railway"
    : "Offline";

  const scannerColor = stats.kill_switch_active
    ? "var(--danger)"
    : botConnected
    ? "var(--success)"
    : "var(--warning)";

  const pnlPositive = stats.realized_pnl_total >= 0;

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── Hero / Masthead ─────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          background: "linear-gradient(135deg, rgba(59,130,246,0.07) 0%, transparent 55%, rgba(16,185,129,0.04) 100%)",
          padding: "28px 32px",
        }}
      >
        {/* Subtle grid background */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            opacity: 0.3,
            pointerEvents: "none",
          }}
        />

        {/* Top row: label + scanner status */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="label" style={{ letterSpacing: "0.1em" }}>Arbiter</span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                backgroundColor: "var(--accent-muted)",
                color: "var(--accent)",
                padding: "2px 8px",
                borderRadius: "99px",
                border: "1px solid rgba(59,130,246,0.15)",
              }}
            >
              {stats.mode.toUpperCase()} MODE
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 14px",
              borderRadius: "99px",
              backgroundColor: botConnected ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${botConnected ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
            }}
          >
            <div
              className={`status-dot${botConnected && !stats.kill_switch_active ? " status-dot-live" : ""}`}
              style={{
                backgroundColor: scannerColor,
                boxShadow: botConnected && !stats.kill_switch_active ? `0 0 6px ${scannerColor}` : undefined,
              }}
            />
            <span style={{ fontSize: "11px", fontWeight: 600, color: scannerColor }}>
              {scannerLabel}
            </span>
          </div>
        </div>

        {/* Main hero numbers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: "32px",
            alignItems: "flex-end",
            position: "relative",
          }}
        >
          {/* Bankroll - big number */}
          <div>
            <div className="label" style={{ marginBottom: "8px" }}>Bankroll</div>
            <div
              className="mono"
              style={{
                fontSize: "52px",
                fontWeight: 800,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                color: "var(--text)",
              }}
            >
              ${stats.bankroll_usd.toFixed(2)}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "8px" }}>
              {stats.open_positions}/{stats.max_open_positions} positions &middot; last scan {timeAgo(stats.last_scan_at)}
            </div>
          </div>

          {/* Divider */}
          <div />

          {/* PnL summary */}
          <div style={{ textAlign: "right" }}>
            <div className="label" style={{ marginBottom: "8px" }}>Total PnL</div>
            <div
              className="mono"
              style={{
                fontSize: "36px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: pnlPositive ? "var(--success)" : "var(--danger)",
              }}
            >
              {fmtPnl(stats.realized_pnl_total)}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-3)", marginTop: "8px" }}>
              Today: <span style={{ color: stats.realized_pnl_today >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtPnl(stats.realized_pnl_today)}</span>
              &ensp;&middot;&ensp;Win rate: <span style={{ color: "var(--text-2)" }}>{fmtPct(stats.win_rate)}</span>
            </div>
          </div>
        </div>

        {/* Action panel — buttons row */}
        <div style={{ marginTop: "24px", position: "relative" }}>
          <ActionPanel
            initialBankroll={stats.bankroll_usd}
            vercelNative={isVercelNative || isLive}
          />
        </div>
      </div>

      {/* Kill switch alert */}
      {stats.kill_switch_active && (
        <div className="alert alert-danger" style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "2px" }}>Kill Switch Active</div>
            <div style={{ fontSize: "11px", opacity: 0.85 }}>Daily loss limit exceeded. Bot halted. Manual reset required.</div>
          </div>
        </div>
      )}

      {/* ── Secondary metrics ──────────────────────────────────────────────── */}
      <div
        className="grid-4"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}
      >
        <MetricCard
          label="Win Rate"
          value={fmtPct(stats.win_rate)}
          subValue={`${stats.trades_today} trades today`}
          highlight={stats.win_rate >= 0.55 ? "success" : stats.trades_today > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Trades Today"
          value={stats.trades_today}
          subValue={`Total: ${stats.opportunities_found_today} signals`}
          highlight={stats.trades_today > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Edge Signals"
          value={stats.opportunities_found_today}
          subValue={`Avg ${fmtPct(stats.avg_edge_pct)}`}
          highlight={stats.opportunities_found_today > 0 ? "success" : "neutral"}
        />
        <MetricCard
          label="Daily Loss"
          value={`${(stats.daily_loss_pct * 100).toFixed(1)}%`}
          subValue="Limit: 10%"
          highlight={stats.daily_loss_pct > 0.08 ? "danger" : stats.daily_loss_pct > 0.05 ? "warning" : "neutral"}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────────── */}
      <div
        className="grid-2"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}
      >
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div className="label">Equity Curve</div>
            {equity_history.length > 1 && (
              <span
                className="mono"
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: equity_history[equity_history.length - 1]?.equity >= equity_history[0]?.equity
                    ? "var(--success)"
                    : "var(--danger)",
                }}
              >
                ${(equity_history[equity_history.length - 1]?.equity ?? 0).toFixed(2)}
              </span>
            )}
          </div>
          <EquityChart data={equity_history} />
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div className="label">Live Opportunities</div>
            {opportunities.length > 0 ? (
              <span className="badge badge-success" style={{ fontSize: "10px" }}>
                {opportunities.length} found
              </span>
            ) : (
              <span style={{ fontSize: "10px", color: "var(--text-4)" }}>Scanning…</span>
            )}
          </div>
          <OpportunitiesFeed
            opportunities={opportunities}
            botConnected={botConnected}
            vercelNative={isVercelNative}
          />
        </div>
      </div>

      {/* ── Recent trades ───────────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div className="label">Recent Trades</div>
          <a
            href="/trades"
            style={{ fontSize: "11px", color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
          >
            View full log
          </a>
        </div>
        <RecentTrades
          trades={recent_trades}
          botConnected={botConnected}
          vercelNative={isVercelNative}
        />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Hero skeleton */}
      <div className="card" style={{ height: "220px", borderRadius: "var(--radius-lg)" }}>
        <div className="skeleton" style={{ height: "10px", width: "80px", marginBottom: "20px", borderRadius: "4px" }} />
        <div className="skeleton" style={{ height: "52px", width: "220px", marginBottom: "12px", borderRadius: "6px" }} />
        <div className="skeleton" style={{ height: "10px", width: "160px", borderRadius: "4px" }} />
        <div style={{ display: "flex", gap: "8px", marginTop: "24px" }}>
          <div className="skeleton" style={{ height: "36px", width: "130px", borderRadius: "6px" }} />
          <div className="skeleton" style={{ height: "36px", width: "130px", borderRadius: "6px" }} />
        </div>
      </div>

      {/* Metric skeletons */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card" style={{ height: "88px" }}>
            <div className="skeleton" style={{ height: "9px", width: "55px", marginBottom: "12px", borderRadius: "4px" }} />
            <div className="skeleton" style={{ height: "24px", width: "70px", borderRadius: "4px" }} />
          </div>
        ))}
      </div>

      {/* Chart skeletons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div className="card skeleton" style={{ height: "280px" }} />
        <div className="card skeleton" style={{ height: "280px" }} />
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <AutoRefresh intervalMs={30_000} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
