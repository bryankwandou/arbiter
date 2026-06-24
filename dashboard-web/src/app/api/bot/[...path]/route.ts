import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit, assertSafeUrl, safeError } from "@/lib/security";

export const dynamic = "force-dynamic";

// Whitelist of allowed bot API paths and their permitted methods.
// Prevents path traversal and restricts write access to explicit paths.
const ALLOWED: Record<string, string[]> = {
  "status":             ["GET"],
  "health":             ["GET"],
  "positions":          ["GET"],
  "markets/scan":       ["GET"],
  "funds":              ["POST"],
  "positions/open":     ["POST"],
};

function matchAllowed(pathSegments: string[]): string[] | null {
  const joined = pathSegments.join("/");
  // Exact match first
  if (ALLOWED[joined]) return ALLOWED[joined];
  // Prefix match for positions/:id patterns
  if (joined.startsWith("positions/") && pathSegments.length === 2) return ["GET", "DELETE"];
  return null;
}

const BOT_URL = process.env.BOT_API_URL ?? "http://localhost:8001";

async function proxy(req: NextRequest, path: string[]) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const rl = applyRateLimit(req, isWrite ? 5 : 30, 60_000, `bot:${req.method}`);
  if (rl) return rl;

  // ── Path whitelist ────────────────────────────────────────────────────────
  const allowedMethods = matchAllowed(path);
  if (!allowedMethods) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }
  if (!allowedMethods.includes(req.method)) {
    return NextResponse.json({ error: `Method ${req.method} not allowed on this path` }, { status: 405 });
  }

  // ── SSRF guard ────────────────────────────────────────────────────────────
  // Block if BOT_URL points to a private/localhost host (unless explicitly local)
  const isLocalDev = process.env.NODE_ENV !== "production" && BOT_URL.includes("localhost");
  if (!isLocalDev) {
    try {
      assertSafeUrl(BOT_URL);
    } catch (e) {
      return NextResponse.json({ error: "Bot URL configuration error" }, { status: 503 });
    }
  }

  const target = `${BOT_URL}/${path.join("/")}${req.nextUrl.search}`;

  try {
    const body = isWrite ? await req.text() : undefined;
    const res = await fetch(target, {
      method: req.method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        error: "Bot API offline.",
        hint: "Deploy to Railway for 24/7, or run locally: uvicorn api.server:app --host 0.0.0.0 --port 8001",
      },
      { status: 503 }
    );
  }
}

type Ctx = { params: { path: string[] } };

export async function GET(req: NextRequest, { params }: Ctx)    { return proxy(req, params.path); }
export async function POST(req: NextRequest, { params }: Ctx)   { return proxy(req, params.path); }
export async function DELETE(req: NextRequest, { params }: Ctx) { return proxy(req, params.path); }
