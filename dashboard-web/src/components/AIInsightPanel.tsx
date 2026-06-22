"use client";

import { useState } from "react";
import type { MarketOpportunity, BotStats } from "@/types";

type AIResult = {
  summary: string;
  risks: string[];
  confidence: "high" | "medium" | "low";
  recommendation: string;
  key_insight?: string;
  unavailable?: boolean;
  model?: string;
};

function IconSpark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

const CONFIDENCE_COLORS = {
  high:   { color: "var(--success)", bg: "var(--success-muted)", border: "rgba(16,185,129,0.2)" },
  medium: { color: "var(--warning)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
  low:    { color: "var(--text-3)", bg: "rgba(255,255,255,0.03)", border: "var(--border)" },
};

export function AIInsightPanel({
  opportunity,
  stats,
}: {
  opportunity: MarketOpportunity | null;
  stats: BotStats;
}) {
  const [result, setResult] = useState<AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analyzed, setAnalyzed] = useState<string | null>(null);

  const analyze = async () => {
    if (!opportunity) return;
    if (analyzed === opportunity.market_id && result) {
      setExpanded((e) => !e);
      return;
    }
    setLoading(true);
    setExpanded(true);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity, stats }),
      });
      const data: AIResult = await res.json();
      setResult(data);
      setAnalyzed(opportunity.market_id);
    } catch {
      setResult({
        summary: "Failed to connect to AI analysis service.",
        risks: ["Check network connection"],
        confidence: "low",
        recommendation: "paper",
        unavailable: true,
      });
    }
    setLoading(false);
  };

  if (!opportunity) return null;

  const conf = result ? CONFIDENCE_COLORS[result.confidence] ?? CONFIDENCE_COLORS.low : null;

  return (
    <div
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        backgroundColor: "var(--card)",
        overflow: "hidden",
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={analyze}
        disabled={loading}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: loading ? "wait" : "pointer",
          textAlign: "left",
          color: "var(--text)",
          transition: "background-color 0.15s",
        }}
        onMouseEnter={(e) => !loading && ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(59,130,246,0.04)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent")}
      >
        {/* Icon */}
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "7px",
            background: loading
              ? "rgba(59,130,246,0.06)"
              : "linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(16,185,129,0.1) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            flexShrink: 0,
            transition: "background 0.2s",
          }}
        >
          {loading ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <IconSpark />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)", marginBottom: "1px" }}>
            {loading ? "Analyzing with Groq AI…" : result ? "AI Analysis" : "Analyze with Groq AI"}
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {loading
              ? `llama-3.1-70b — scanning "${opportunity.question.slice(0, 40)}…"`
              : result
              ? result.summary.slice(0, 60) + (result.summary.length > 60 ? "…" : "")
              : `Click to analyze: "${opportunity.question.slice(0, 40)}…"`}
          </div>
        </div>

        {/* Confidence badge */}
        {result && conf && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "99px",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              backgroundColor: conf.bg,
              color: conf.color,
              border: `1px solid ${conf.border}`,
              flexShrink: 0,
              textTransform: "uppercase",
            }}
          >
            {result.confidence}
          </span>
        )}

        <IconChevron open={expanded && !!result} />
      </button>

      {/* Expanded result */}
      {expanded && result && (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            animation: "fade-in 0.2s ease",
          }}
        >
          {/* Summary */}
          <div style={{ fontSize: "12px", color: "var(--text-2)", lineHeight: 1.6 }}>
            {result.summary}
          </div>

          {/* Key insight */}
          {result.key_insight && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(59,130,246,0.05)",
                border: "1px solid rgba(59,130,246,0.12)",
                fontSize: "11px",
                color: "var(--accent)",
                lineHeight: 1.6,
                display: "flex",
                gap: "8px",
              }}
            >
              <IconSpark />
              <span>{result.key_insight}</span>
            </div>
          )}

          {/* Risks */}
          {result.risks.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--text-4)",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                }}
              >
                Key Risks
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {result.risks.map((risk, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "6px",
                      fontSize: "11px",
                      color: "var(--text-3)",
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ color: "var(--warning)", flexShrink: 0, marginTop: "1px" }}>
                      <IconAlert />
                    </div>
                    {risk}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: "8px",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ fontSize: "9px", color: "var(--text-4)" }}>
              {result.model ?? "Groq LLM"} · Not financial advice
            </div>
            {result.unavailable && (
              <div style={{ fontSize: "9px", color: "var(--text-4)" }}>
                Set GROQ_API_KEY to enable
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
