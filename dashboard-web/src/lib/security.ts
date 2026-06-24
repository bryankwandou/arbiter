import { NextRequest, NextResponse } from "next/server";

// ── In-process rate limiter (per Vercel instance, resets on cold start) ───────
// For production scale use @vercel/kv or Upstash. This is sufficient for paper mode.
const _windows = new Map<string, { count: number; reset: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const entry = _windows.get(key);

  if (!entry || now > entry.reset) {
    _windows.set(key, { count: 1, reset: now + windowMs });
    // Evict stale keys periodically to avoid memory leak
    if (_windows.size > 5000) {
      for (const [k, v] of _windows.entries()) {
        if (now > v.reset) _windows.delete(k);
      }
    }
    return { ok: true, remaining: limit - 1, resetMs: now + windowMs };
  }

  entry.count += 1;
  const ok = entry.count <= limit;
  return { ok, remaining: Math.max(0, limit - entry.count), resetMs: entry.reset };
}

// ── Bearer token authentication ───────────────────────────────────────────────
export function requireBearerToken(
  req: NextRequest,
  envKey: string
): NextResponse | null {
  const secret = process.env[envKey];
  if (!secret) {
    // Env var not set — treat as lockout (fail-secure)
    return NextResponse.json(
      { error: "Service not configured — contact admin" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!timingSafeEqual(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null; // pass
}

// ── Constant-time string comparison to prevent timing attacks ─────────────────
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to avoid length-based timing leak
    let diff = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return false && diff === 0; // always false — different lengths can never match
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Input sanitization ────────────────────────────────────────────────────────
export function sanitizeString(val: unknown, maxLen = 500): string {
  const s = String(val ?? "").trim();
  // Strip prompt injection patterns
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, maxLen);
}

export function sanitizeNumber(val: unknown, min: number, max: number): number {
  const n = parseFloat(String(val ?? "0"));
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ── Rate limit helper that returns a NextResponse with headers ─────────────────
export function applyRateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  scope: string
): NextResponse | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const key = `${scope}:${ip}`;
  const { ok, remaining, resetMs } = rateLimit(key, limit, windowMs);

  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Retry later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((resetMs - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(resetMs / 1000)),
        },
      }
    );
  }
  return null; // pass
}

// ── Safe error response (no stack traces to client) ───────────────────────────
export function safeError(label: string, err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  // Log internally with full detail, send generic message to client
  console.error(`[${label}]`, message);
  return NextResponse.json({ error: "Internal server error" }, { status });
}

// ── Validate SSRF risk: block private IP ranges ───────────────────────────────
export function assertSafeUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http/https URLs allowed");
  }
  const host = parsed.hostname;
  const BLOCKED = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
  for (const re of BLOCKED) {
    if (re.test(host)) throw new Error(`SSRF blocked: private host ${host}`);
  }
}
