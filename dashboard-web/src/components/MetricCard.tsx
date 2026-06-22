interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  highlight?: "success" | "danger" | "warning" | "neutral";
}

const COLORS: Record<string, { text: string; top: string; glow: string; bg: string }> = {
  success: { text: "var(--success)", top: "#10b981", glow: "rgba(16,185,129,0.15)", bg: "rgba(16,185,129,0.03)" },
  danger:  { text: "var(--danger)",  top: "#ef4444", glow: "rgba(239,68,68,0.15)",  bg: "rgba(239,68,68,0.03)"  },
  warning: { text: "var(--warning)", top: "#f59e0b", glow: "rgba(245,158,11,0.15)", bg: "rgba(245,158,11,0.03)" },
  neutral: { text: "var(--text)",    top: "transparent", glow: "transparent", bg: "transparent" },
};

export function MetricCard({ label, value, subValue, highlight = "neutral" }: MetricCardProps) {
  const c = COLORS[highlight];
  return (
    <div
      style={{
        backgroundColor: "var(--card)",
        backgroundImage: c.bg !== "transparent"
          ? `linear-gradient(160deg, ${c.bg} 0%, transparent 60%)`
          : undefined,
        border: "1px solid var(--border)",
        borderTop: `2px solid ${c.top}`,
        borderRadius: "var(--radius)",
        padding: "16px 18px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "7px",
        transition: "border-color 0.2s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {c.glow !== "transparent" && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "40px",
            background: `linear-gradient(180deg, ${c.glow} 0%, transparent 100%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div className="label">{label}</div>
      <div
        className="mono"
        style={{
          fontSize: "22px",
          fontWeight: 800,
          color: c.text,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          position: "relative",
        }}
      >
        {value}
      </div>
      {subValue && (
        <div style={{ fontSize: "11px", color: "var(--text-3)", position: "relative" }}>
          {subValue}
        </div>
      )}
    </div>
  );
}
