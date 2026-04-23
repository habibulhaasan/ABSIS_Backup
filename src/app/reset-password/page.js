"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmPasswordReset, verifyPasswordResetCode, getAuth } from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";

// ─────────────────────────────────────────────────────────────────────────────
// Firebase — safely initialise once
// If you already have /lib/firebase.js, replace this block with:
//   import { auth } from "@/lib/firebase";
// ─────────────────────────────────────────────────────────────────────────────
function getFirebaseAuth() {
  try {
    const cfg = {
      apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };
    const app = getApps().length === 0 ? initializeApp(cfg) : getApps()[0];
    return getAuth(app);
  } catch (e) {
    console.error("Firebase init failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function EyeIcon({ open }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function Spinner({ size }) {
  const s = size === "sm" ? 16 : 36;
  const b = size === "sm" ? 2 : 3;
  const color = size === "sm" ? "rgba(255,255,255,0.25)" : "rgba(59,130,246,0.15)";
  const topColor = size === "sm" ? "#fff" : "#3b82f6";
  return (
    <span style={{
      display: "inline-block",
      width: s,
      height: s,
      borderRadius: "50%",
      border: `${b}px solid ${color}`,
      borderTopColor: topColor,
      animation: "absis-spin 0.75s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function getStrength(pw) {
  let score = 0;
  if (pw.length >= 8)           score++;
  if (/[A-Z]/.test(pw))         score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw))  score++;
  const levels = [
    { label: "",       color: "#374151" },
    { label: "Weak",   color: "#ef4444" },
    { label: "Fair",   color: "#f59e0b" },
    { label: "Good",   color: "#3b82f6" },
    { label: "Strong", color: "#10b981" },
  ];
  return { score, ...levels[score] };
}

function iconCircleStyle(bg, border) {
  return {
    width: 56, height: 56, borderRadius: "50%",
    backgroundColor: bg, border: `1.5px solid ${border}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell layout (logo + card + footer)
// ─────────────────────────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <>
      {/* Keyframe injected inline so no global CSS file is needed */}
      <style>{`
        @keyframes absis-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={s.root}>
        <div style={s.bgGrid}   aria-hidden="true" />
        <div style={s.bgBlue}   aria-hidden="true" />
        <div style={s.bgGreen}  aria-hidden="true" />

        <div style={s.card}>
          {/* Logo */}
          <div style={s.logoRow}>
            <div style={s.logoMark}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3"  y="3"  width="7" height="7" rx="1.5" fill="#f8fafc" />
                <rect x="14" y="3"  width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".6" />
                <rect x="3"  y="14" width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".6" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".3" />
              </svg>
            </div>
            <span style={s.logoText}>ABSIS</span>
          </div>

          {children}
        </div>

        <p style={s.footer}>
          © {new Date().getFullYear()} ABSIS Organization Management
        </p>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner page — reads ?oobCode from URL
// ─────────────────────────────────────────────────────────────────────────────
function ResetPasswordInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const oobCode      = searchParams.get("oobCode") || "";

  const [phase,    setPhase]    = useState("verifying"); // verifying|form|success|invalid
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const strength = getStrength(password);

  useEffect(() => {
    if (!oobCode) { setPhase("invalid"); return; }
    const auth = getFirebaseAuth();
    if (!auth)    { setPhase("invalid"); return; }

    verifyPasswordResetCode(auth, oobCode)
      .then((em) => { setEmail(em); setPhase("form"); })
      .catch(()  => setPhase("invalid"));
  }, [oobCode]);

  function validate() {
    if (password.length < 8)  return "Password must be at least 8 characters.";
    if (strength.score < 2)   return "Please choose a stronger password.";
    if (password !== confirm)  return "Passwords do not match.";
    return "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      await confirmPasswordReset(auth, oobCode, password);
      setPhase("success");
    } catch (ex) {
      setError(
        ex.code === "auth/expired-action-code"
          ? "This reset link has expired. Please request a new one."
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Verifying ──────────────────────────────────────────────────────────────
  if (phase === "verifying") {
    return (
      <Shell>
        <div style={s.center}>
          <Spinner />
          <p style={s.muted}>Verifying your reset link…</p>
        </div>
      </Shell>
    );
  }

  // ── Invalid / expired ──────────────────────────────────────────────────────
  if (phase === "invalid") {
    return (
      <Shell>
        <div style={s.center}>
          <div style={iconCircleStyle("rgba(239,68,68,0.1)", "#ef4444")}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9"  x2="9"  y2="15" />
              <line x1="9"  y1="9"  x2="15" y2="15" />
            </svg>
          </div>
          <h2 style={s.heading}>Link Invalid or Expired</h2>
          <p style={s.muted}>
            This password reset link has expired or already been used.
            Please request a new one.
          </p>
          <button style={s.btn} onClick={() => router.push("/forgot-password")}>
            Request New Link
          </button>
        </div>
      </Shell>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (phase === "success") {
    return (
      <Shell>
        <div style={s.center}>
          <div style={iconCircleStyle("rgba(16,185,129,0.1)", "#10b981")}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={s.heading}>Password Updated!</h2>
          <p style={s.muted}>
            Your password has been reset. You can now sign in with your new password.
          </p>
          <button style={s.btn} onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </Shell>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={iconCircleStyle("rgba(29,78,216,0.12)", "#3b82f6")}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 style={s.heading}>Set New Password</h2>
        <p style={s.muted}>
          Resetting password for{" "}
          <span style={{ color: "#93c5fd", fontWeight: 600 }}>{email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} style={s.form} noValidate>

        {/* New password */}
        <div style={s.field}>
          <label style={s.label}>New Password</label>
          <div style={s.inputWrap}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              required
              autoComplete="new-password"
              style={s.input}
            />
            <button type="button" style={s.eyeBtn}
              onClick={() => setShowPw((v) => !v)}
              aria-label="Toggle visibility">
              <EyeIcon open={showPw} />
            </button>
          </div>

          {/* Strength bars */}
          {password.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <div style={{ display: "flex", gap: 4, flex: 1 }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{
                    flex: 1, height: 4, borderRadius: 99,
                    backgroundColor: i <= strength.score ? strength.color : "#1e293b",
                    transition: "background-color 0.25s",
                  }} />
                ))}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: strength.color,
                textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 38 }}>
                {strength.label}
              </span>
            </div>
          )}

          {/* Requirement hints */}
          {password.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
              {[
                { ok: password.length >= 8,          text: "At least 8 characters" },
                { ok: /[A-Z]/.test(password),         text: "One uppercase letter" },
                { ok: /[0-9]/.test(password),         text: "One number" },
                { ok: /[^A-Za-z0-9]/.test(password),  text: "One special character" },
              ].map(({ ok, text }) => (
                <div key={text} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: ok ? "#10b981" : "#334155" }}>
                    {ok ? "✓" : "○"}
                  </span>
                  <span style={{ fontSize: 12, color: ok ? "#94a3b8" : "#475569" }}>
                    {text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div style={s.field}>
          <label style={s.label}>Confirm Password</label>
          <div style={s.inputWrap}>
            <input
              type={showCf ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Re-enter your new password"
              required
              autoComplete="new-password"
              style={{
                ...s.input,
                borderColor: confirm.length > 0
                  ? confirm === password ? "#10b981" : "#ef4444"
                  : "rgba(255,255,255,0.08)",
              }}
            />
            <button type="button" style={s.eyeBtn}
              onClick={() => setShowCf((v) => !v)}
              aria-label="Toggle visibility">
              <EyeIcon open={showCf} />
            </button>
          </div>
          {confirm.length > 0 && confirm !== password && (
            <p style={{ fontSize: 12, color: "#ef4444", margin: "4px 0 0" }}>
              Passwords do not match
            </p>
          )}
          {confirm.length > 0 && confirm === password && (
            <p style={{ fontSize: 12, color: "#10b981", margin: "4px 0 0" }}>
              ✓ Passwords match
            </p>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={s.errorBanner}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8"  x2="12"    y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Submit button */}
        <button type="submit" disabled={loading}
          style={{ ...s.btn, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading
            ? <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <Spinner size="sm" /> Updating Password…
              </span>
            : "Reset Password"
          }
        </button>

        {/* Back link */}
        <button type="button" style={s.backLink} onClick={() => router.push("/login")}>
          ← Back to Login
        </button>
      </form>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page export — Suspense required because of useSearchParams
// ─────────────────────────────────────────────────────────────────────────────
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh", backgroundColor: "#030712",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <style>{`@keyframes absis-spin { to { transform: rotate(360deg); } }`}</style>
        <Spinner />
      </div>
    }>
      <ResetPasswordInner />
    </Suspense>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = {
  root: {
    minHeight: "100vh",
    backgroundColor: "#030712",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "'DM Sans','Segoe UI',sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  bgGrid: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(59,130,246,0.03) 1px,transparent 1px)," +
      "linear-gradient(90deg,rgba(59,130,246,0.03) 1px,transparent 1px)",
    backgroundSize: "40px 40px",
    pointerEvents: "none",
  },
  bgBlue: {
    position: "absolute",
    top: "-20%", right: "-10%",
    width: 500, height: 500,
    borderRadius: "50%",
    background: "radial-gradient(circle,rgba(59,130,246,0.07) 0%,transparent 70%)",
    pointerEvents: "none",
  },
  bgGreen: {
    position: "absolute",
    bottom: "-15%", left: "-10%",
    width: 400, height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle,rgba(16,185,129,0.05) 0%,transparent 70%)",
    pointerEvents: "none",
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "rgba(15,23,42,0.97)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 20,
    padding: "36px 36px 32px",
    boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
    position: "relative",
    zIndex: 1,
  },
  logoRow: {
    display: "flex", alignItems: "center",
    gap: 10, marginBottom: 28,
  },
  logoMark: {
    width: 36, height: 36,
    borderRadius: 9,
    background: "linear-gradient(135deg,#1d4ed8,#1e3a8a)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 12px rgba(29,78,216,0.4)",
  },
  logoText: {
    fontSize: 18, fontWeight: 700,
    color: "#f8fafc", letterSpacing: "0.12em",
  },
  center: {
    display: "flex", flexDirection: "column",
    alignItems: "center", textAlign: "center",
    gap: 14, padding: "8px 0 4px",
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 22, fontWeight: 700,
    color: "#f1f5f9", letterSpacing: "-0.02em",
  },
  muted: {
    margin: 0, fontSize: 14,
    color: "#64748b", lineHeight: 1.6, maxWidth: 320,
  },
  form: {
    display: "flex", flexDirection: "column", gap: 20,
  },
  field: {
    display: "flex", flexDirection: "column", gap: 6,
  },
  label: {
    fontSize: 13, fontWeight: 600,
    color: "#94a3b8", letterSpacing: "0.03em",
  },
  inputWrap: {
    position: "relative", display: "flex", alignItems: "center",
  },
  input: {
    width: "100%",
    padding: "12px 44px 12px 14px",
    backgroundColor: "rgba(15,23,42,0.8)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    color: "#f1f5f9",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  },
  eyeBtn: {
    position: "absolute", right: 12,
    background: "none", border: "none",
    cursor: "pointer", color: "#475569",
    padding: 4, display: "flex", alignItems: "center",
  },
  errorBanner: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "11px 14px",
    backgroundColor: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 10,
    fontSize: 13, color: "#fca5a5",
  },
  btn: {
    width: "100%", padding: "13px",
    background: "linear-gradient(135deg,#1d4ed8,#2563eb)",
    border: "none", borderRadius: 10,
    color: "#fff", fontSize: 14, fontWeight: 600,
    letterSpacing: "0.02em",
    boxShadow: "0 4px 16px rgba(37,99,235,0.35)",
    marginTop: 4,
  },
  backLink: {
    background: "none", border: "none",
    color: "#475569", fontSize: 13,
    cursor: "pointer", textAlign: "center", padding: "4px 0",
  },
  footer: {
    marginTop: 24, fontSize: 12,
    color: "#1e293b", position: "relative", zIndex: 1,
  },
};
