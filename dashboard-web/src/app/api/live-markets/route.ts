import { NextResponse } from "next/server";
import type { LiveMarket } from "@/types";
import { applyRateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

const GAMMA = "https://gamma-api.polymarket.com";

const POLITICS_KW = [
  "politic", "election", "president", "senate", "congress", "governor",
  "primary", "parliament", "vote", "ballot", "trump", "biden", "harris",
  "democrat", "republican", "minister", "cabinet", "prime minister",
  "referendum", "campaign", "candidate", "party", "legislation",
];

// Whitelist of allowed limit values to prevent URL parameter injection
const ALLOWED_LIMITS = new Set([50, 100, 150, 200, 300]);

function isPolitical(question: string, tags: string[]): boolean {
  const hay = [question, ...tags].join(" ").toLowerCase();
  return POLITICS_KW.some((kw) => hay.includes(kw));
}

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch { return []; }
  }
  return [];
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

export async function GET(req: Request) {
  // ── Rate limiting: max 15 calls/min per IP ────────────────────────────────
  const rl = applyRateLimit(req as Parameters<typeof applyRateLimit>[0], 15, 60_000, "live-markets");
  if (rl) return rl;

  const { searchParams } = new URL(req.url);

  // Whitelist-based limit (not raw user input) to prevent URL injection
  const rawLimit = parseInt(searchParams.get("limit") ?? "150");
  const limit = ALLOWED_LIMITS.has(rawLimit) ? rawLimit : 150;
  const showAll = searchParams.get("all") === "1";

  try {
    // Build URL with URLSearchParams to prevent injection
    const apiUrl = new URL(`${GAMMA}/markets`);
    apiUrl.searchParams.set("active", "true");
    apiUrl.searchParams.set("closed", "false");
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("order", "volume");
    apiUrl.searchParams.set("ascending", "false");

    const res = await fetch(apiUrl.toString(), {
      headers: { "User-Agent": "arbiter-dashboard/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data) && !Array.isArray((data as { data?: unknown[] }).data)) {
      throw new Error("Unexpected response shape from Gamma API");
    }
    const rows: unknown[] = Array.isArray(data) ? data : (data as { data?: unknown[] }).data ?? [];

    const markets: LiveMarket[] = [];

    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      const question = String(r.question ?? "").trim().slice(0, 500);
      if (!question) continue;

      const tagsRaw = parseList(r.tags ?? []);
      const tags = tagsRaw.map((t) => {
        try { return String((JSON.parse(t) as { label?: string }).label ?? t); }
        catch { return t; }
      });

      if (!showAll && !isPolitical(question, tags)) continue;

      const outcomes = parseList(r.outcomes ?? []);
      const prices   = parseList(r.outcomePrices ?? []).map(toNum);
      const tokenIds = parseList(r.clobTokenIds ?? []);

      if (outcomes.length < 2 || prices.length < 2 || tokenIds.length < 2) continue;

      // Validate prices are in range [0, 1]
      if (prices.some(p => p < 0 || p > 1)) continue;

      const sumPrices = prices.reduce((a, b) => a + b, 0);
      const potEdge   = +(Math.max(0, 1.0 - sumPrices - 0.02)).toFixed(4);
      const hasArb    = potEdge > 0.01;

      markets.push({
        market_id:      String(r.id ?? "").slice(0, 255),
        question,
        outcomes:       outcomes.slice(0, 20).map(o => String(o).slice(0, 200)),
        prices:         prices.slice(0, 20),
        token_ids:      tokenIds.slice(0, 20),
        volume:         Math.max(0, toNum(r.volume)),
        liquidity:      Math.max(0, toNum(r.liquidity)),
        end_date:       r.endDate ? String(r.endDate).slice(0, 50) : null,
        sum_prices:     +sumPrices.toFixed(4),
        potential_edge: potEdge,
        has_arb:        hasArb,
        strategy:       outcomes.length === 2 ? "binary_dutch_book" : "mutually_exclusive",
        venue:          "polymarket",
      });
    }

    markets.sort((a, b) => {
      if (a.has_arb !== b.has_arb) return a.has_arb ? -1 : 1;
      return b.volume - a.volume;
    });

    return NextResponse.json({ markets, count: markets.length, ts: new Date().toISOString() });
  } catch (e) {
    console.error("[live-markets]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ markets: [], count: 0, error: "Market data temporarily unavailable" }, { status: 500 });
  }
}
