import { NextResponse } from "next/server";
import { scanPolymarket } from "@/lib/scanner";
import { timingSafeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Vercel Cron invokes this route every 5 minutes.
// CRON_SECRET is REQUIRED — endpoint is disabled (503) if not configured.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;

  // Fail-secure: if CRON_SECRET is not configured, reject all requests
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — endpoint disabled" },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (!timingSafeEqual(token, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const { opportunities, scanned, ts } = await scanPolymarket(200, 0.01);

    return NextResponse.json({
      ok: true,
      ts,
      scanned,
      opportunities_found: opportunities.length,
      top_edge_pct: opportunities[0]?.edge_pct ?? 0,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    // Log internally, return generic error to caller
    console.error("[cron/scan]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { ok: false, error: "Scanner error", elapsed_ms: Date.now() - start },
      { status: 500 }
    );
  }
}
