import { NextRequest, NextResponse } from "next/server";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function middleware(req: NextRequest) {
  const rid = requestId();
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const pw = process.env.DASHBOARD_PASSWORD;

  // Optional HTTP Basic Auth on non-API routes (dashboard pages only)
  if (pw && !isApi) {
    const auth = req.headers.get("authorization") ?? "";
    let pass = false;

    if (auth.startsWith("Basic ")) {
      try {
        const decoded = atob(auth.slice(6));
        const colonIdx = decoded.indexOf(":");
        const supplied = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
        pass = timingSafeEqual(supplied, pw);
      } catch {
        pass = false;
      }
    }

    if (!pass) {
      return new NextResponse("Unauthorized — provide password", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Arbiter"' },
      });
    }
  }

  // Propagate x-request-id through to route handlers and response
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-request-id", rid);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("x-request-id", rid);
  return res;
}

export const config = {
  // Apply to all routes except Next.js internals + favicon
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
