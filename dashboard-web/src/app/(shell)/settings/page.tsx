export const dynamic = "force-dynamic";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "2px" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: "11px", color: "var(--text-4)", lineHeight: 1.5 }}>{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function EnvRow({ name, description, example, set }: { name: string; description: string; example: string; set: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        backgroundColor: "var(--bg)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          marginTop: "4px",
          flexShrink: 0,
          backgroundColor: set ? "var(--success)" : "var(--text-4)",
          boxShadow: set ? "0 0 5px var(--success)" : undefined,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
          <code className="mono" style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>
            {name}
          </code>
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: set ? "var(--success)" : "var(--text-4)",
              backgroundColor: set ? "var(--success-muted)" : "rgba(255,255,255,0.04)",
              padding: "1px 7px",
              borderRadius: "99px",
              border: `1px solid ${set ? "rgba(16,185,129,0.2)" : "var(--border)"}`,
            }}
          >
            {set ? "SET" : "NOT SET"}
          </span>
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-3)", marginBottom: "4px", lineHeight: 1.5 }}>{description}</div>
        <code className="mono" style={{ fontSize: "10px", color: "var(--text-4)" }}>{example}</code>
      </div>
    </div>
  );
}

function RiskRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "11px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text)", marginBottom: "1px" }}>{label}</div>
        {note && <div style={{ fontSize: "10px", color: "var(--text-4)" }}>{note}</div>}
      </div>
      <code className="mono" style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent)" }}>{value}</code>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "720px" }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 800,
            letterSpacing: "-0.04em",
            color: "var(--text)",
            marginBottom: "4px",
          }}
        >
          Settings
        </h1>
        <p style={{ fontSize: "13px", color: "var(--text-3)", lineHeight: 1.6 }}>
          Environment variables, risk limits, and integration status. Configure via Vercel dashboard or CLI.
        </p>
      </div>

      {/* Environment variables */}
      <Section
        title="Environment Variables"
        subtitle="Set on Vercel — never exposed to browser. CLI: vercel env add NAME"
      >
        <EnvRow
          name="GROQ_API_KEY"
          description="Enables AI market analysis via llama-3.1-70b-versatile. Free tier available at console.groq.com."
          example="vercel env add GROQ_API_KEY"
          set={false}
        />
        <EnvRow
          name="TELEGRAM_BOT_TOKEN"
          description="Telegram bot token for kill-switch and trade alerts. Create via @BotFather."
          example="vercel env add TELEGRAM_BOT_TOKEN"
          set={false}
        />
        <EnvRow
          name="TELEGRAM_CHAT_ID"
          description="Your Telegram user/group chat ID. Bot will send alerts here."
          example="vercel env add TELEGRAM_CHAT_ID"
          set={false}
        />
        <EnvRow
          name="POLYMARKET_PRIVATE_KEY"
          description="Polygon private key for live trading. Enables real-money execution. Default: paper mode."
          example="vercel env add POLYMARKET_PRIVATE_KEY"
          set={false}
        />
        <EnvRow
          name="GITHUB_PAT"
          description="GitHub personal access token for reading scanner state (raw.githubusercontent.com is public — optional)."
          example="vercel env add GITHUB_PAT"
          set={false}
        />
      </Section>

      {/* Risk limits (read-only) */}
      <Section
        title="Risk Limits"
        subtitle="Hardcoded in paper-scan.mjs — cannot be overridden without code change."
      >
        <div>
          <RiskRow label="Kelly fraction" value="0.25×" note="Quarter-Kelly — conservative by design" />
          <RiskRow label="Per-trade cap" value="2%" note="Max 2% of bankroll per single trade" />
          <RiskRow label="Per-market cap" value="5%" note="Max 5% of bankroll across same market" />
          <RiskRow label="Max open positions" value="5" note="Prevents over-concentration" />
          <RiskRow label="Daily kill switch" value="10%" note="Halt if daily loss exceeds 10% of bankroll" />
          <RiskRow label="Min edge (after fees)" value="3%" note="2% fee buffer already subtracted" />
          <RiskRow label="Min liquidity" value="$500" note="Below this: skip — slippage too high" />
          <RiskRow label="Resolution buffer" value="2 hours" note="Markets closing within 2h are excluded" />
          <RiskRow label="Circuit breaker" value="3 failures" note="Halt if 3 consecutive API failures" />
        </div>
      </Section>

      {/* Telegram setup guide */}
      <Section
        title="Telegram Alert Setup"
        subtitle="Optional. Bot will run normally without Telegram — alerts are gracefully skipped."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[
            { step: "1", text: "Message @BotFather on Telegram → /newbot → copy the HTTP API token" },
            { step: "2", text: "Message your new bot once (say anything), then visit: api.telegram.org/bot<TOKEN>/getUpdates to find your chat_id" },
            { step: "3", text: 'vercel env add TELEGRAM_BOT_TOKEN → paste token' },
            { step: "4", text: 'vercel env add TELEGRAM_CHAT_ID → paste chat_id number' },
            { step: "5", text: "Add same secrets to GitHub: Settings → Secrets → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID" },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(59,130,246,0.1)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "9px",
                  fontWeight: 700,
                  color: "var(--accent)",
                }}
              >
                {step}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-3)", lineHeight: 1.6, paddingTop: "1px" }}>{text}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* System info */}
      <Section title="System">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {[
            { label: "Framework", value: "Next.js 14 App Router" },
            { label: "Deployment", value: "Vercel Hobby" },
            { label: "Scanner", value: "GitHub Actions (5 min)" },
            { label: "State", value: "raw.githubusercontent.com" },
            { label: "AI", value: "Groq llama-3.1-70b" },
            { label: "Network", value: "Polygon (MATIC)" },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: "10px", color: "var(--text-4)", marginBottom: "3px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>{value}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
