'use client';
import { useState, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import Link from 'next/link';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import PlatformGate from '@/components/PlatformGate';

const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

const Field = ({ label, name, type, placeholder, required, value, onChange, options }) => (
  <div className="form-group">
    <label className="form-label">{label}{required && <span style={{color:'#dc2626'}}> *</span>}</label>
    {options ? (
      <select value={value} onChange={e => onChange(name, e.target.value)}>
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input type={type || 'text'} required={required} placeholder={placeholder}
        value={value} onChange={e => onChange(name, e.target.value)} />
    )}
  </div>
);

export default function Register() {
  const { settings, loading: settingsLoading } = usePlatformSettings();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nameEnglish:'', nameBengali:'', fatherName:'', motherName:'',
    dob:'', bloodGroup:'', occupation:'', address:'', nid:'',
    phone:'', email:'', password:'', confirmPassword:''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleChange = useCallback((key, val) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  const goStep2 = (e) => {
    e.preventDefault();
    if (!form.nameEnglish.trim()) { setError('Full name is required.'); return; }
    setError(''); setStep(2);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!form.phone.trim() || !form.email.trim()) { setError('Phone and email are required.'); return; }
    if (form.password !== form.confirmPassword) { setError("Passwords don't match."); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError('');
    try {
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      const { password, confirmPassword, ...profile } = form;
      await setDoc(doc(db, 'users', res.user.uid), {
        ...profile, idNo:'', role:'member', createdAt: new Date().toISOString(),
      });
      window.location.href = '/select-org';
    } catch (err) {
      setError(err.message.includes('email-already-in-use')
        ? 'This email is already registered.'
        : err.message.replace('Firebase: ', ''));
    } finally { setLoading(false); }
  };

  // ── Maintenance check (highest priority) ──────────────────────────────────
  if (!settingsLoading && settings.maintenanceMode) {
    return <PlatformGate type="maintenance" settings={settings} loading={false}><></></PlatformGate>;
  }

  // ── Registration disabled check ────────────────────────────────────────────
  if (!settingsLoading && !settings.allowNewRegistrations) {
    return <PlatformGate type="registration" settings={settings} loading={false}><></></PlatformGate>;
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, background:'#f8fafc' }}>
      <div style={{ width:'100%', maxWidth:560 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#0f172a', marginBottom:4 }}>Create your account</h1>
          <p style={{ fontSize:14, color:'#64748b' }}>Step {step} of 2 — {step===1 ? 'Personal Information' : 'Account Credentials'}</p>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:28, justifyContent:'center' }}>
          {[1,2].map(s => (
            <div key={s} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, background: step>=s?'#2563eb':'#e2e8f0', color: step>=s?'#fff':'#94a3b8', transition:'all 0.2s' }}>{s}</div>
              {s < 2 && <div style={{ width:60, height:2, background: step>1?'#2563eb':'#e2e8f0', borderRadius:2, transition:'all 0.2s' }} />}
            </div>
          ))}
        </div>

        <div className="card">
          {error && <div className="alert alert-error">{error}</div>}

          {step === 1 ? (
            <form onSubmit={goStep2}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                <Field label="Full Name (English)" name="nameEnglish" placeholder="John Doe"       required value={form.nameEnglish} onChange={handleChange} />
                <Field label="Full Name (Bengali)"  name="nameBengali" placeholder="জন ডো"                  value={form.nameBengali} onChange={handleChange} />
                <Field label="Father's Name"        name="fatherName"  placeholder="Father's name"           value={form.fatherName}  onChange={handleChange} />
                <Field label="Mother's Name"        name="motherName"  placeholder="Mother's name"           value={form.motherName}  onChange={handleChange} />
                <Field label="Date of Birth"        name="dob"         type="date"                           value={form.dob}         onChange={handleChange} />
                <Field label="Blood Group"          name="bloodGroup"  options={BLOOD_GROUPS}                value={form.bloodGroup}  onChange={handleChange} />
                <Field label="Occupation"           name="occupation"  placeholder="e.g. Teacher"            value={form.occupation}  onChange={handleChange} />
                <Field label="NID Number"           name="nid"         placeholder="NID"                     value={form.nid}         onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label">Address</label>
                <textarea rows={2} placeholder="Full address" value={form.address}
                  onChange={e => handleChange('address', e.target.value)} style={{ resize:'vertical' }} />
              </div>
              <button type="submit" className="btn-primary" style={{ width:'100%', justifyContent:'center' }}>Next →</button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <Field label="Phone Number"     name="phone"           type="tel"      placeholder="+8801XXXXXXXXX"  required value={form.phone}           onChange={handleChange} />
              <Field label="Email"            name="email"           type="email"    placeholder="you@example.com" required value={form.email}           onChange={handleChange} />
              <Field label="Password"         name="password"        type="password" placeholder="Min 6 characters" required value={form.password}        onChange={handleChange} />
              <Field label="Confirm Password" name="confirmPassword" type="password" placeholder="Repeat password"  required value={form.confirmPassword} onChange={handleChange} />
              <div style={{ display:'flex', gap:10, marginTop:4 }}>
                <button type="button" onClick={() => { setStep(1); setError(''); }} className="btn-ghost" style={{ flex:1 }}>← Back</button>
                <button type="submit" disabled={loading} className="btn-primary" style={{ flex:2, justifyContent:'center' }}>
                  {loading ? 'Creating account…' : 'Create Account'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p style={{ textAlign:'center', fontSize:14, color:'#64748b', marginTop:20 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color:'#2563eb', fontWeight:600, textDecoration:'none' }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}