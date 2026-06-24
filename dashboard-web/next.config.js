/** @type {import('next').NextConfig} */

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security",    value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options",       value: "nosniff" },
  { key: "X-Frame-Options",              value: "DENY" },
  { key: "X-XSS-Protection",            value: "1; mode=block" },
  { key: "Referrer-Policy",             value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",          value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js requires unsafe-inline for hydration
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://gamma-api.polymarket.com https://api.groq.com",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["fs", "path"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Strip sensitive server-side env vars from client bundle
  env: {},
};

module.exports = nextConfig;
