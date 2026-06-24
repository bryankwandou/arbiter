import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit, sanitizeString, sanitizeNumber } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-70b-versatile";

export async function POST(req: NextRequest) {
  // ── Rate limiting: 20/min per IP ─────────────────────────────────────────
  const rl = applyRateLimit(req, 20, 60_000, "ai-analyze");
  if (rl) return rl;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      summary: "AI analysis unavailable — GROQ_API_KEY not configured.",
      risks: ["Set GROQ_API_KEY via: vercel env add GROQ_API_KEY"],
      confidence: "low" as const,
      recommendation: "paper",
      unavailable: true,
    });
  }

  const rawBody = await req.json().catch(() => ({}));
  const { opportunity, stats } = rawBody as {
    opportunity?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  };

  if (!opportunity || typeof opportunity !== "object") {
    return NextResponse.json({ error: "opportunity object required" }, { status: 400 });
  }

  // ── Sanitize all user-provided values before inserting into LLM prompt ───
  const question   = sanitizeString(opportunity.question, 300);
  const strategy   = sanitizeString(opportunity.strategy, 50);
  const edgePct    = sanitizeNumber(opportunity.edge_pct, 0, 1);
  const depthUsd   = sanitizeNumber(opportunity.depth_usd, 0, 10_000_000);
  const venue      = sanitizeString(opportunity.venue, 50);
  const bankroll   = stats ? sanitizeNumber(stats.bankroll_usd, 0, 10_000_000) : null;
  const winRate    = stats ? sanitizeNumber(stats.win_rate, 0, 1) : null;

  if (!question) {
    return NextResponse.json({ error: "opportunity.question is required" }, { status: 400 });
  }

  // ── Build prompt with sanitized values (no raw user input) ───────────────
  const prompt = `You are a quantitative risk analyst specializing in prediction market arbitrage.

Analyze this Dutch book arbitrage opportunity:
- Market: ${JSON.stringify(question)}
- Strategy: ${JSON.stringify(strategy)}
- Edge: +${(edgePct * 100).toFixed(2)}% after 2% fee buffer
- Liquidity: $${depthUsd.toFixed(0)} USD
- Venue: ${JSON.stringify(venue)}
${bankroll !== null ? `- Current bankroll: $${bankroll.toFixed(2)}\n- Win rate: ${((winRate ?? 0) * 100).toFixed(1)}%` : ""}

Respond in JSON only (no markdown):
{
  "summary": "<one sentence: what this opportunity is and why the edge exists>",
  "risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "confidence": "high|medium|low",
  "recommendation": "paper|pass",
  "key_insight": "<one surprising or non-obvious observation>"
}

Confidence: high if edge >5% and liquidity >$2000, medium if edge 3-5% or liquidity $500-2000, low otherwise.
Recommendation: always "paper" in paper mode unless liquidity critically thin (<$200) or market closes in <1 hour.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // Don't leak full Groq error to client
      console.error("[ai/analyze] Groq HTTP", res.status);
      return NextResponse.json({
        summary: "AI analysis temporarily unavailable.",
        risks: ["Groq API error — scanner is running normally"],
        confidence: "low" as const,
        recommendation: "paper",
        unavailable: true,
      });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content); } catch { /* use defaults */ }

    return NextResponse.json(
      {
        summary:       sanitizeString(parsed.summary as string ?? "Analysis complete.", 500),
        risks:         Array.isArray(parsed.risks) ? (parsed.risks as unknown[]).slice(0, 3).map(r => sanitizeString(r, 200)) : [],
        confidence:    ["high", "medium", "low"].includes(String(parsed.confidence)) ? parsed.confidence : "medium",
        recommendation:["paper", "pass"].includes(String(parsed.recommendation)) ? parsed.recommendation : "paper",
        key_insight:   sanitizeString(parsed.key_insight as string ?? "", 300),
        model:         MODEL,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({
      summary: "AI analysis timed out. Scanner is running normally.",
      risks: ["Network timeout — Groq API unreachable"],
      confidence: "low" as const,
      recommendation: "paper",
      unavailable: true,
    });
  }
}
