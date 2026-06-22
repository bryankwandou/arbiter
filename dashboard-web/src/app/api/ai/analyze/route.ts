import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-70b-versatile";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        summary: "AI analysis unavailable — GROQ_API_KEY not configured.",
        risks: ["Set GROQ_API_KEY via: vercel env add GROQ_API_KEY"],
        confidence: "low" as const,
        recommendation: "paper",
        unavailable: true,
      },
      { status: 200 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { opportunity, stats } = body as {
    opportunity?: {
      question: string;
      edge_pct: number;
      depth_usd: number;
      strategy: string;
      venue: string;
    };
    stats?: {
      bankroll_usd: number;
      win_rate: number;
      realized_pnl_total: number;
    };
  };

  if (!opportunity) {
    return NextResponse.json({ error: "opportunity required" }, { status: 400 });
  }

  const prompt = `You are a quantitative risk analyst specializing in prediction market arbitrage.

Analyze this Dutch book arbitrage opportunity:
- Market: "${opportunity.question}"
- Strategy: ${opportunity.strategy}
- Edge: +${(opportunity.edge_pct * 100).toFixed(2)}% after 2% fee buffer
- Liquidity: $${opportunity.depth_usd.toFixed(0)} USD
- Venue: ${opportunity.venue}
${stats ? `- Current bankroll: $${stats.bankroll_usd.toFixed(2)}\n- Win rate: ${(stats.win_rate * 100).toFixed(1)}%` : ""}

Respond in JSON only (no markdown):
{
  "summary": "<one sentence: what this opportunity is and why the edge exists>",
  "risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "confidence": "high|medium|low",
  "recommendation": "paper|pass",
  "key_insight": "<one surprising or non-obvious observation>"
}

Confidence: high if edge >5% and liquidity >$2000, medium if edge 3-5% or liquidity $500-2000, low otherwise.
Recommendation: always "paper" in paper mode unless liquidity is critically thin (<$200) or market closes in <1 hour.`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20_000);

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
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        {
          summary: "AI analysis failed — Groq API error.",
          risks: [`HTTP ${res.status}: ${err.slice(0, 100)}`],
          confidence: "low" as const,
          recommendation: "paper",
          unavailable: true,
        },
        { status: 200 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);

    return NextResponse.json(
      {
        summary: parsed.summary ?? "Analysis complete.",
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3) : [],
        confidence: parsed.confidence ?? "medium",
        recommendation: parsed.recommendation ?? "paper",
        key_insight: parsed.key_insight,
        model: MODEL,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        summary: "AI analysis timed out. The market scanner is still running normally.",
        risks: ["Network timeout connecting to Groq API"],
        confidence: "low" as const,
        recommendation: "paper",
        unavailable: true,
      },
      { status: 200 }
    );
  }
}
