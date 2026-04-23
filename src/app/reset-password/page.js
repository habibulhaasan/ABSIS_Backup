"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  confirmPasswordReset,
  verifyPasswordResetCode,
  getAuth,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";

// ── Firebase init (replace with your actual config or import from lib/firebase) ──
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

// ── Eye icon ────────────────────────────────────────────────────────────────────
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ── Strength bar ────────────────────────────────────────────────────────────────
function getStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label: "", color: "#374151" },
    { label: "Weak", color: "#ef4444" },
    { label: "Fair", color: "#f59e0b" },
    { label: "Good", color: "#3b82f6" },
    { label: "Strong", color: "#10b981" },
  ];
  return { score, ...levels[score] };
}

// ── Main inner component (uses useSearchParams) ─────────────────────────────────
function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode") ?? "";

  const [phase, setPhase] = useState<"verifying" | "form" | "success" | "invalid">("verifying");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showCf, setShowCf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const strength = getStrength(password);

  // Verify the oobCode on mount
  useEffect(() => {
    if (!oobCode) { setPhase("invalid"); return; }
    verifyPasswordResetCode(auth, oobCode)
      .then((em) => { setEmail(em); setPhase("form"); })
      .catch(() => setPhase("invalid"));
  }, [oobCode]);

  const validate = () => {
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (strength.score < 2) return "Please choose a stronger password.";
    if (password !== confirm) return "Passwords do not match.";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setPhase("success");
    } catch (e: any) {
      setError(
        e.code === "auth/expired-action-code"
          ? "This reset link has expired. Please request a new one."
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Shared page shell ─────────────────────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div style={styles.root}>
      {/* Geometric background */}
      <div style={styles.bgGrid} aria-hidden />
      <div style={styles.bgAccent1} aria-hidden />
      <div style={styles.bgAccent2} aria-hidden />

      <div style={styles.card}>
        {/* Logo / wordmark */}
        <div style={styles.logoRow}>
          <div style={styles.logoMark}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="#f8fafc" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".6" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".6" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="#f8fafc" opacity=".3" />
            </svg>
          </div>
          <span style={styles.logoText}>ABSIS</span>
        </div>
        {children}
      </div>

      <p style={styles.footer}>
        © {new Date().getFullYear()} ABSIS Organization Management
      </p>
    </div>
  );

  // ── VERIFYING ─────────────────────────────────────────────────────────────────
  if (phase === "verifying") {
    return (
      <Shell>
        <div style={styles.centerContent}>
          <div style={styles.spinner} />
          <p style={styles.mutedText}>Verifying your reset link…</p>
        </div>
      </Shell>
    );
  }

  // ── INVALID ───────────────────────────────────────────────────────────────────
  if (phase === "invalid") {
    return (
      <Shell>
        <div style={styles.centerContent}>
          <div style={styles.iconCircle("#ef444422", "#ef4444")}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 style={styles.heading}>Link Invalid or Expired</h2>
          <p style={styles.mutedText}>
            This password reset link has expired or already been used. Please
            request a new one.
          </p>
          <button
            style={styles.btn}
            onClick={() => router.push("/forgot-password")}
          >
            Request New Link
          </button>
        </div>
      </Shell>
    );
  }

  // ── SUCCESS ───────────────────────────────────────────────────────────────────
  if (phase === "success") {
    return (
      <Shell>
        <div style={styles.centerContent}>
          <div style={styles.iconCircle("#10b98122", "#10b981")}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={styles.heading}>Password Updated!</h2>
          <p style={styles.mutedText}>
            Your password has been reset successfully. You can now sign in with
            your new password.
          </p>
          <button style={styles.btn} onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </Shell>
    );
  }

  // ── FORM ──────────────────────────────────────────────────────────────────────
  return (
    <Shell>
      <div style={styles.formTop}>
        <div style={styles.iconCircle("#1e40af22", "#3b82f6")}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 style={styles.heading}>Set New Password</h2>
        <p style={styles.mutedText}>
          Creating a new password for{" "}
          <span style={{ color: "#93c5fd", fontWeight: 600 }}>{email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form} noValidate>
        {/* New Password */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>New Password</label>
          <div style={styles.inputWrap}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              required
              style={styles.input}
              autoComplete="new-password"
            />
            <button
              type="button"
              style={styles.eyeBtn}
              onClick={() => setShowPw((v) => !v)}
              aria-label="Toggle password visibility"
            >
              <EyeIcon open={showPw} />
            </button>
          </div>

          {/* Strength meter */}
          {password.length > 0 && (
            <div style={styles.strengthWrap}>
              <div style={styles.strengthTrack}>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.strengthBar,
                      backgroundColor: i <= strength.score ? strength.color : "#1e293b",
                      transition: "background-color 0.3s ease",
                    }}
                  />
                ))}
              </div>
              <span style={{ ...styles.strengthLabel, color: strength.color }}>
                {strength.label}
              </span>
            </div>
          )}

          {password.length > 0 && (
            <div style={styles.hints}>
              {[
                { ok: password.length >= 8, text: "At least 8 characters" },
                { ok: /[A-Z]/.test(password), text: "One uppercase letter" },
                { ok: /[0-9]/.test(password), text: "One number" },
                { ok: /[^A-Za-z0-9]/.test(password), text: "One special character" },
              ].map(({ ok, text }) => (
                <div key={text} style={styles.hintRow}>
                  <span style={{ color: ok ? "#10b981" : "#475569", fontSize: 13 }}>
                    {ok ? "✓" : "○"}
                  </span>
                  <span style={{ color: ok ? "#94a3b8" : "#475569", fontSize: 12 }}>
                    {text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Confirm Password</label>
          <div style={styles.inputWrap}>
            <input
              type={showCf ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Re-enter your new password"
              required
              style={{
                ...styles.input,
                borderColor:
                  confirm.length > 0
                    ? confirm === password
                      ? "#10b981"
                      : "#ef4444"
                    : "rgba(255,255,255,0.08)",
              }}
              autoComplete="new-password"
            />
            <button
              type="button"
              style={styles.eyeBtn}
              onClick={() => setShowCf((v) => !v)}
              aria-label="Toggle confirm password visibility"
            >
              <EyeIcon open={showCf} />
            </button>
          </div>
          {confirm.length > 0 && confirm !== password && (
            <p style={styles.matchError}>Passwords do not match</p>
          )}
          {confirm.length > 0 && confirm === password && (
            <p style={{ ...styles.matchError, color: "#10b981" }}>✓ Passwords match</p>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={styles.errorBanner}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            ...styles.btn,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <span style={styles.spinnerSmall} />
              Updating Password…
            </span>
          ) : (
            "Reset Password"
          )}
        </button>

        <button
          type="button"
          style={styles.backLink}
          onClick={() => router.push("/login")}
        >
          ← Back to Login
        </button>
      </form>
    </Shell>
  );
}

// ── Page export (wrapped in Suspense for useSearchParams) ───────────────────────
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ ...styles.root, justifyContent: "center", alignItems: "center" }}>
        <div style={styles.spinner} />
      </div>
    }>
      <ResetPasswordInner />
    </Suspense>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    backgroundColor: "#030712",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  bgGrid: {
    position: "absolute",
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    pointerEvents: "none",
  },
  bgAccent1: {
    position: "absolute",
    top: "-20%",
    right: "-10%",
    width: 500,
    height: 500,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  bgAccent2: {
    position: "absolute",
    bottom: "-15%",
    left: "-10%",
    width: 400,
    height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(16,185,129,0.05) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 20,
    padding: "36px 36px 32px",
    backdropFilter: "blur(16px)",
    boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.05)",
    position: "relative",
    zIndex: 1,
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "linear-gradient(135deg, #1d4ed8, #1e3a8a)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(29,78,216,0.4)",
  },
  logoText: {
    fontSize: 18,
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "0.12em",
  },
  centerContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 16,
    padding: "8px 0 4px",
  },
  formTop: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 28,
  },
  heading: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-0.02em",
  },
  mutedText: {
    margin: 0,
    fontSize: 14,
    color: "#64748b",
    lineHeight: 1.6,
    maxWidth: 320,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#94a3b8",
    letterSpacing: "0.03em",
  },
  inputWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
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
    transition: "border-color 0.2s",
  },
  eyeBtn: {
    position: "absolute",
    right: 12,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#475569",
    padding: 4,
    display: "flex",
    alignItems: "center",
  },
  strengthWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  strengthTrack: {
    display: "flex",
    gap: 4,
    flex: 1,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 99,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 40,
    textAlign: "right",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  hints: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginTop: 4,
  },
  hintRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  matchError: {
    fontSize: 12,
    color: "#ef4444",
    margin: "2px 0 0",
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "11px 14px",
    backgroundColor: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 10,
    fontSize: 13,
    color: "#fca5a5",
  },
  btn: {
    width: "100%",
    padding: "13px",
    background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
    border: "none",
    borderRadius: 10,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
    boxShadow: "0 4px 16px rgba(37,99,235,0.35)",
    transition: "opacity 0.2s, transform 0.1s",
    marginTop: 4,
  },
  backLink: {
    background: "none",
    border: "none",
    color: "#475569",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "center",
    padding: "4px 0",
    transition: "color 0.2s",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid rgba(59,130,246,0.15)",
    borderTopColor: "#3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  spinnerSmall: {
    width: 16,
    height: 16,
    border: "2px solid rgba(255,255,255,0.2)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.8s linear infinite",
  },
  footer: {
    marginTop: 24,
    fontSize: 12,
    color: "#1e293b",
    position: "relative",
    zIndex: 1,
  },
  iconCircle: (bg: string, border: string): React.CSSProperties => ({
    width: 56,
    height: 56,
    borderRadius: "50%",
    backgroundColor: bg,
    border: `1.5px solid ${border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  }),
};
