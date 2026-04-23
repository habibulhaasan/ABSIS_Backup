'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Link from 'next/link';

// ── Password strength helper ──────────────────────────────────────────────────
function getStrength(pw) {
  var score = 0;
  if (pw.length >= 8)          score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  var levels = [
    { label: '',       color: '#e2e8f0' },
    { label: 'Weak',   color: '#ef4444' },
    { label: 'Fair',   color: '#f59e0b' },
    { label: 'Good',   color: '#3b82f6' },
    { label: 'Strong', color: '#22c55e' },
  ];
  return Object.assign({ score }, levels[score]);
}

// ── Shared page wrapper — defined OUTSIDE ResetPasswordInner so its identity
//    is stable across re-renders and React never unmounts/remounts it ──────────
function PageWrap({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f8fafc' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Header — same logo style as login */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
            Reset your password
          </h1>
          <p style={{ fontSize: 14, color: '#64748b' }}>ABSIS Capital Sync</p>
        </div>

        {children}
      </div>
    </div>
  );
}

// ── Inner component (needs useSearchParams → must be inside Suspense) ─────────
function ResetPasswordInner() {
  var router       = useRouter();
  var searchParams = useSearchParams();
  var oobCode      = searchParams.get('oobCode') || '';

  var [phase,    setPhase]    = useState('verifying'); // verifying | form | success | invalid
  var [email,    setEmail]    = useState('');
  var [password, setPassword] = useState('');
  var [confirm,  setConfirm]  = useState('');
  var [showPw,   setShowPw]   = useState(false);
  var [showCf,   setShowCf]   = useState(false);
  var [loading,  setLoading]  = useState(false);
  var [error,    setError]    = useState('');

  var strength = getStrength(password);

  useEffect(function () {
    if (!oobCode) { setPhase('invalid'); return; }
    verifyPasswordResetCode(auth, oobCode)
      .then(function (em) { setEmail(em); setPhase('form'); })
      .catch(function ()  { setPhase('invalid'); });
  }, [oobCode]);

  function validate() {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (strength.score < 2)  return 'Please choose a stronger password.';
    if (password !== confirm) return 'Passwords do not match.';
    return '';
  }

  function handleSubmit(e) {
    e.preventDefault();
    var err = validate();
    if (err) { setError(err); return; }
    setError('');
    setLoading(true);
    confirmPasswordReset(auth, oobCode, password)
      .then(function ()    { setPhase('success'); })
      .catch(function (ex) {
        setError(
          ex.code === 'auth/expired-action-code'
            ? 'This reset link has expired. Please request a new one.'
            : 'Something went wrong. Please try again.'
        );
      })
      .finally(function () { setLoading(false); });
  }

  // ── VERIFYING ───────────────────────────────────────────────────────────────
  if (phase === 'verifying') {
    return (
      <PageWrap>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ width: 32, height: 32, border: '3px solid #bfdbfe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: 14, color: '#64748b' }}>Verifying your reset link…</p>
        </div>
      </PageWrap>
    );
  }

  // ── INVALID / EXPIRED ───────────────────────────────────────────────────────
  if (phase === 'invalid') {
    return (
      <PageWrap>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9"  y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            Link Invalid or Expired
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            This password reset link has expired or already been used. Please request a new one.
          </p>
          <Link href="/forgot-password" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Request New Link
          </Link>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#64748b', marginTop: 16 }}>
            <Link href="/login" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
              Back to login
            </Link>
          </p>
        </div>
      </PageWrap>
    );
  }

  // ── SUCCESS ─────────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <PageWrap>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            Password Updated!
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <Link href="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Go to Login
          </Link>
        </div>
      </PageWrap>
    );
  }

  // ── FORM ────────────────────────────────────────────────────────────────────
  return (
    <PageWrap>
      <div className="card">

        {/* Resetting for email */}
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20, textAlign: 'center' }}>
          {'Setting new password for '}
          <span style={{ color: '#2563eb', fontWeight: 600 }}>{email}</span>
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>

          {/* New Password */}
          <div className="form-group">
            <label className="form-label">New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                required
                placeholder="Minimum 8 characters"
                value={password}
                onChange={function (e) { setPassword(e.target.value); setError(''); }}
                autoComplete="new-password"
                style={{ paddingRight: 52 }}
              />
              <button
                type="button"
                onClick={function () { setShowPw(function (v) { return !v; }); }}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13 }}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>

            {/* Strength meter */}
            {password.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3, 4].map(function (i) {
                    return (
                      <div key={i} style={{
                        flex: 1, height: 4, borderRadius: 99,
                        backgroundColor: i <= strength.score ? strength.color : '#e2e8f0',
                        transition: 'background-color 0.25s',
                      }} />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[
                      { ok: password.length >= 8,          text: '8+ characters' },
                      { ok: /[A-Z]/.test(password),         text: 'Uppercase letter' },
                      { ok: /[0-9]/.test(password),         text: 'Number' },
                      { ok: /[^A-Za-z0-9]/.test(password),  text: 'Special character' },
                    ].map(function (item) {
                      return (
                        <span key={item.text} style={{ fontSize: 11, color: item.ok ? '#22c55e' : '#94a3b8' }}>
                          {item.ok ? '✓' : '○'} {item.text}
                        </span>
                      );
                    })}
                  </div>
                  {strength.label && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: strength.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {strength.label}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showCf ? 'text' : 'password'}
                required
                placeholder="Re-enter your new password"
                value={confirm}
                onChange={function (e) { setConfirm(e.target.value); setError(''); }}
                autoComplete="new-password"
                style={{
                  paddingRight: 52,
                  borderColor: confirm.length > 0
                    ? confirm === password ? '#22c55e' : '#ef4444'
                    : '',
                }}
              />
              <button
                type="button"
                onClick={function () { setShowCf(function (v) { return !v; }); }}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13 }}>
                {showCf ? 'Hide' : 'Show'}
              </button>
            </div>
            {confirm.length > 0 && confirm !== password && (
              <p style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Passwords do not match</p>
            )}
            {confirm.length > 0 && confirm === password && (
              <p style={{ fontSize: 12, color: '#22c55e', marginTop: 4 }}>✓ Passwords match</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Updating Password…' : 'Reset Password'}
          </button>
        </form>
      </div>

      {/* Back to login — same as login page footer */}
      <p style={{ textAlign: 'center', fontSize: 14, color: '#64748b', marginTop: 20 }}>
        {'Remember your password? '}
        <Link href="/login" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
          Sign in
        </Link>
      </p>
    </PageWrap>
  );
}

// ── Page export — Suspense required for useSearchParams ───────────────────────
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #bfdbfe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <ResetPasswordInner />
    </Suspense>
  );
}
