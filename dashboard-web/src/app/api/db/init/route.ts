import { NextRequest, NextResponse } from "next/server";
import { initSchema } from "@/lib/db";
import { timingSafeEqual } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/db/init
// Run once after first deploy to create Neon tables.
// Requires x-init-key header matching DB_INIT_KEY env var (fail-secure if not set).
export async function GET(req: NextRequest) {
  const initKey = process.env.DB_INIT_KEY;
  if (!initKey) {
    return NextResponse.json(
      { ok: false, error: "DB_INIT_KEY not configured — endpoint disabled" },
      { status: 503 }
    );
  }

  const provided = req.headers.get("x-init-key") ?? "";
  if (!timingSafeEqual(provided, initKey)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    await initSchema();
    return NextResponse.json({ ok: true, message: "Schema initialized" });
  } catch (err) {
    console.error("[db/init] Schema error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: "Schema initialization failed" }, { status: 500 });
  }
}
