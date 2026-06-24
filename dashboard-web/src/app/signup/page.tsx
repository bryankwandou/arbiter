"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const [username, setUsername]       = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      setError("Username: 3–30 characters, letters/numbers/underscore only");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed");
        setLoading(false);
        return;
      }
      // Auto sign-in after successful registration
      const result = await signIn("credentials", { username, password, redirect: false });
      if (result?.error) {
        setError("Account created — please sign in");
        router.push("/login");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  const card: React.CSSProperties = {
    width: "340px",
    padding: "32px 28px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(22,27,34,0.95)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "#e6edf3",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.08) 0%, #0d1117 60%)",
        padding: "24px",
      }}
    >
      <div style={card}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#3b82f6",
              marginBottom: "8px",
            }}
          >
            ARBITER
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#e6edf3", marginBottom: "4px" }}>
            Create account
          </div>
          <div style={{ fontSize: "12px", color: "#6e7681" }}>
            Join the paper trading network
          </div>
        </div>

        {/* Google — coming soon */}
        <button
          type="button"
          disabled
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "#6e7681",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "20px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" opacity="0.4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" opacity="0.4"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" opacity="0.4"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" opacity="0.4"/>
          </svg>
          Continue with Google — Coming Soon
        </button>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "20px",
            color: "#6e7681",
            fontSize: "11px",
          }}
        >
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
          or
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username (3–30 chars)"
              required
              autoFocus
              autoComplete="username"
              style={input}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 characters)"
              required
              autoComplete="new-password"
              style={input}
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              required
              autoComplete="new-password"
              style={{
                ...input,
                borderColor: confirm && confirm !== password ? "rgba(239,68,68,0.5)" : undefined,
              }}
            />
          </div>

          {error && (
            <div
              style={{
                fontSize: "11px",
                color: "#ef4444",
                marginBottom: "14px",
                padding: "8px 10px",
                borderRadius: "5px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password || !confirm}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: "6px",
              border: "none",
              background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loading || !username || !password || !confirm ? "default" : "pointer",
              opacity: loading || !username || !password || !confirm ? 0.6 : 1,
              transition: "opacity 0.15s",
              boxShadow: "0 2px 8px rgba(16,185,129,0.25)",
            }}
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: "20px", textAlign: "center", fontSize: "12px", color: "#6e7681" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </Link>
        </div>

        {/* Password rules hint */}
        <div
          style={{
            marginTop: "16px",
            padding: "10px 12px",
            borderRadius: "6px",
            background: "rgba(59,130,246,0.05)",
            border: "1px solid rgba(59,130,246,0.1)",
            fontSize: "10px",
            color: "#6e7681",
            lineHeight: 1.6,
          }}
        >
          Username: letters, numbers, underscore · Min 3 chars<br />
          Password: minimum 8 characters
        </div>
      </div>
    </div>
  );
}
