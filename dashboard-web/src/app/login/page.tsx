"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", { password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Incorrect password");
      setPassword("");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg-2, #0d1117)",
      }}
    >
      <div
        className="card"
        style={{ width: "320px", padding: "28px" }}
      >
        <div style={{ marginBottom: "22px" }}>
          <div
            className="label"
            style={{ fontSize: "14px", letterSpacing: "0.08em", marginBottom: "4px" }}
          >
            Arbiter
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-3)" }}>
            Enter dashboard password to continue
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "14px" }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "var(--radius-sm, 6px)",
                border: `1px solid ${error ? "var(--danger, #ef4444)" : "var(--border, rgba(255,255,255,0.08))"}`,
                background: "var(--bg, #161b22)",
                color: "var(--text, #e6edf3)",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {error && (
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--danger, #ef4444)",
                  marginTop: "6px",
                }}
              >
                {error}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: "var(--radius-sm, 6px)",
              border: "none",
              background: "var(--accent, #3b82f6)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loading || !password ? "default" : "pointer",
              opacity: loading || !password ? 0.65 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
