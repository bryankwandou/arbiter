"use client";

import { useEffect, useRef, useState } from "react";

// ── Animated Counter ──────────────────────────────────────────────────────────
export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  duration = 1800,
}: {
  value: string;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState("0");
  const num = parseFloat(value.replace(/[^0-9.]/g, ""));
  const isInt = !value.includes(".");
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isNaN(num)) { setDisplay(value); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const cur = num * ease;
      setDisplay(isInt ? Math.round(cur).toString() : cur.toFixed(1));
      if (p < 1) ref.current = setTimeout(() => tick(performance.now()), 16);
    };
    tick(start);
    return () => { if (ref.current) clearTimeout(ref.current); };
  }, [num, duration, isInt, value]);

  return <span>{prefix}{display}{suffix}</span>;
}

// ── 3D Tilt Card ─────────────────────────────────────────────────────────────
export function TiltCard({
  children,
  style,
  className,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(8px)`;
    card.style.boxShadow = `
      ${-x * 20}px ${-y * 20}px 40px rgba(59,130,246,0.08),
      0 20px 60px rgba(0,0,0,0.4)
    `;
  };

  const onMouseLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transform = "perspective(1000px) rotateY(0deg) rotateX(0deg) translateZ(0px)";
    card.style.boxShadow = "";
    card.style.transition = "transform 0.4s ease, box-shadow 0.4s ease";
  };

  const onMouseEnter = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transition = "none";
  };

  return (
    <div
      ref={cardRef}
      className={className}
      style={{ ...style, willChange: "transform", transformStyle: "preserve-3d" }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </div>
  );
}

// ── Scroll Reveal ─────────────────────────────────────────────────────────────
export function ScrollReveal({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated Gradient Mesh ────────────────────────────────────────────────────
export function GradientMesh({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        ...style,
      }}
    >
      {/* Orb 1 */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "30%",
          width: "600px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)",
          animation: "float-orb-1 8s ease-in-out infinite",
        }}
      />
      {/* Orb 2 */}
      <div
        style={{
          position: "absolute",
          top: "30%",
          right: "-10%",
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)",
          animation: "float-orb-2 10s ease-in-out infinite",
        }}
      />
      {/* Grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />
      <style>{`
        @keyframes float-orb-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-30px, 30px) scale(1.05); }
          66% { transform: translate(20px, -20px) scale(0.95); }
        }
        @keyframes float-orb-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -40px) scale(1.1); }
        }
      `}</style>
    </div>
  );
}

// ── Typewriter ────────────────────────────────────────────────────────────────
export function Typewriter({ words, speed = 80 }: { words: string[]; speed?: number }) {
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [display, setDisplay] = useState("");

  useEffect(() => {
    const word = words[wordIdx % words.length];
    const delay = deleting ? speed / 2 : speed;

    const t = setTimeout(() => {
      if (!deleting) {
        setDisplay(word.slice(0, charIdx + 1));
        setCharIdx((c) => c + 1);
        if (charIdx + 1 === word.length) {
          setTimeout(() => setDeleting(true), 2000);
        }
      } else {
        setDisplay(word.slice(0, charIdx - 1));
        setCharIdx((c) => c - 1);
        if (charIdx - 1 === 0) {
          setDeleting(false);
          setWordIdx((w) => (w + 1) % words.length);
        }
      }
    }, delay);

    return () => clearTimeout(t);
  }, [charIdx, deleting, wordIdx, words, speed]);

  return (
    <span>
      {display}
      <span
        style={{
          display: "inline-block",
          width: "2px",
          height: "1em",
          backgroundColor: "#3b82f6",
          marginLeft: "2px",
          verticalAlign: "text-bottom",
          animation: "blink 1s step-end infinite",
        }}
      />
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
    </span>
  );
}

// Deterministic pseudo-random from seed (avoids SSR hydration mismatch)
function seededRand(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// ── Particle Dots ─────────────────────────────────────────────────────────────
export function FloatingDots({ count = 20 }: { count?: number }) {
  const dots = Array.from({ length: count }, (_, i) => ({
    id: i,
    x: seededRand(i * 7) * 100,
    y: seededRand(i * 13) * 100,
    size: seededRand(i * 3) * 2 + 1,
    duration: seededRand(i * 5) * 10 + 8,
    delay: seededRand(i * 11) * 5,
    dx: (seededRand(i * 17) * 40 - 20).toFixed(1),
    dy: (seededRand(i * 19) * 40 - 20).toFixed(1),
  }));

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {dots.map((d) => (
        <div
          key={d.id}
          style={{
            position: "absolute",
            left: `${d.x.toFixed(1)}%`,
            top: `${d.y.toFixed(1)}%`,
            width: `${d.size.toFixed(1)}px`,
            height: `${d.size.toFixed(1)}px`,
            borderRadius: "50%",
            backgroundColor: "rgba(59,130,246,0.4)",
            animation: `float-dot-${d.id} ${d.duration.toFixed(1)}s ${d.delay.toFixed(1)}s ease-in-out infinite alternate`,
          }}
        />
      ))}
      <style>{dots.map((d) => `
        @keyframes float-dot-${d.id} {
          0% { transform: translate(0, 0); opacity: 0.3; }
          100% { transform: translate(${d.dx}px, ${d.dy}px); opacity: 0.8; }
        }
      `).join("")}</style>
    </div>
  );
}

// ── Live Ticker ───────────────────────────────────────────────────────────────
export function LivePulse({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "7px",
        padding: "5px 14px",
        borderRadius: "99px",
        backgroundColor: "rgba(16,185,129,0.08)",
        border: "1px solid rgba(16,185,129,0.2)",
      }}
    >
      <div
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          backgroundColor: "#10b981",
          boxShadow: "0 0 8px #10b981",
          animation: "live-pulse 2s ease-in-out infinite",
        }}
      />
      <span style={{ fontSize: "11px", fontWeight: 600, color: "#10b981", letterSpacing: "0.03em" }}>
        {label}
      </span>
      <style>{`
        @keyframes live-pulse {
          0%, 100% { box-shadow: 0 0 4px #10b981; }
          50% { box-shadow: 0 0 12px #10b981, 0 0 20px rgba(16,185,129,0.3); }
        }
      `}</style>
    </div>
  );
}
