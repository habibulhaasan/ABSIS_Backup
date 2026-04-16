'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { useAuth } from '@/context/AuthContext';

const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];

// Field component defined OUTSIDE to avoid remounting on re-render
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

function JoinPageInner() {
  const params      = useSearchParams();
  const token       = params.get('token');
  const { user }    = useAuth();

  const [invite, setInvite]   = useState(null);
  const [org, setOrg]         = useState(null);
  const [inviteStatus, setInviteStatus] = useState('loading'); // loading|ready|expired|error

  // flow: 'preview' | 'login' | 'register' | 'joining' | 'joined'
  const [flow, setFlow]   = useState('preview');
  const [regStep, setRegStep] = useState(1);

  const [form, setForm] = useState({
    nameEnglish:'', nameBengali:'', fatherName:'', motherName:'',
    dob:'', bloodGroup:'', occupation:'', address:'', nid:'',
    phone:'', email:'', password:'', confirmPassword:'',
  });
  const [authError, setAuthError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = useCallback((key, val) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  // Load invite
  useEffect(() => {
    if (!token) { setInviteStatus('error'); return; }
    (async () => {
      try {
        const invSnap = await getDoc(doc(db, 'invites', token));
        if (!invSnap.exists()) { setInviteStatus('expired'); return; }
        const inv = invSnap.data();
        if (inv.expiresAt?.seconds && inv.expiresAt.seconds < Date.now() / 1000) {
          setInviteStatus('expired'); return;
        }
        setInvite(inv);
        const orgBase = {
          id:          inv.orgId,
          name:        inv.orgName        || 'Organization',
          type:        inv.orgType        || '',
          description: inv.orgDescription || '',
          settings:    inv.orgSettings    || {},
          // Check invite doc first (logoURL or orgLogoURL) — readable without auth.
          // If absent, attempt org doc fetch and swallow permission-denied silently.
          logoURL:     inv.logoURL || inv.orgLogoURL || null,
        };
        if (!orgBase.logoURL) {
          try {
            const orgSnap = await getDoc(doc(db, 'organizations', inv.orgId));
            if (orgSnap.exists()) orgBase.logoURL = orgSnap.data().logoURL || null;
          } catch (e) {
            if (e?.code !== 'permission-denied') console.warn('Org logo fetch failed:', e);
          }
        }
        setOrg(orgBase);
        setInviteStatus('ready');
      } catch (e) {
        console.error(e);
        setInviteStatus('error');
      }
    })();
  }, [token]);

  // If user is already logged in and invite is ready, go straight to joining
  useEffect(() => {
    if (user && inviteStatus === 'ready' && flow === 'preview') {
      setFlow('joining');
    }
  }, [user, inviteStatus, flow]);

  // Complete join after auth — profileData is optional (provided on new registration)
  const completeJoin = async (uid, profileData = null) => {
    try {
      const memberPayload = {
        approved: false, role: 'member', joinedAt: serverTimestamp(),
      };
      // If profile data was collected during registration, persist it to the member doc
      // using the same field names the profile page expects
      if (profileData) {
        Object.assign(memberPayload, profileData);
      }
      await setDoc(doc(db, 'organizations', invite.orgId, 'members', uid), memberPayload, { merge: true });
      const uSnap   = await getDoc(doc(db, 'users', uid));
      const existing = uSnap.data()?.orgIds || [];
      if (!existing.includes(invite.orgId)) {
        await updateDoc(doc(db, 'users', uid), { orgIds: [...existing, invite.orgId] });
      }
      setFlow('joined');
    } catch (e) {
      setAuthError('Error joining: ' + e.message);
      setFlow('preview');
    }
  };

  // Already logged in — join directly
  useEffect(() => {
    if (flow === 'joining' && user && invite) {
      setSubmitting(true);
      completeJoin(user.uid, null).finally(() => setSubmitting(false));
    }
  }, [flow, user, invite]);

  // Sign in then join
  const handleSignIn = async (e) => {
    e.preventDefault();
    setAuthError(''); setSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
      await completeJoin(cred.user.uid);
    } catch (e) {
      setAuthError(e.message.includes('invalid-credential') || e.message.includes('wrong-password')
        ? 'Incorrect email or password.' : e.message.replace('Firebase: ', ''));
    }
    setSubmitting(false);
  };

  // Register then join
  const handleRegisterStep1 = (e) => {
    e.preventDefault();
    if (!form.nameEnglish.trim()) { setAuthError('Full name is required.'); return; }
    setAuthError('');
    setRegStep(2);
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!form.phone.trim() || !form.email.trim()) { setAuthError('Phone and email are required.'); return; }
    if (form.password !== form.confirmPassword)    { setAuthError("Passwords don't match."); return; }
    if (form.password.length < 6)                 { setAuthError('Password must be at least 6 characters.'); return; }
    setAuthError(''); setSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);

      // Map join-form fields → profile-page field names so profile page pre-populates correctly
      const profileFields = {
        nameEnglish:      form.nameEnglish,
        nameBengali:      form.nameBengali,
        fatherNameEn:     form.fatherName,
        fatherNameBn:     '',
        motherNameEn:     form.motherName,
        motherNameBn:     '',
        dob:              form.dob,
        bloodGroup:       form.bloodGroup,
        occupation:       form.occupation,
        nid:              form.nid,
        presentAddressEn: form.address,
        presentAddressBn: '',
        phone:            form.phone,
        email:            form.email,
      };

      // Save to users doc (top-level auth profile)
      await setDoc(doc(db, 'users', cred.user.uid), {
        ...profileFields,
        idNo: '', role: 'member', createdAt: new Date().toISOString(),
      });

      // Pass same profileFields into completeJoin so they land on the member doc too
      await completeJoin(cred.user.uid, profileFields);
    } catch (e) {
      setAuthError(e.message.includes('email-already-in-use')
        ? 'This email is already registered. Please sign in instead.'
        : e.message.replace('Firebase: ', ''));
    }
    setSubmitting(false);
  };

  // ── Invite info card shown at top of all flows ──────────────────────────
  const OrgCard = () => !org ? null : (
    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:12, padding:'16px 18px', marginBottom:20 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
        <div style={{ width:48, height:48, borderRadius:12, background:'#2563eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:700, color:'#fff', flexShrink:0, overflow:'hidden', border:'2px solid #bfdbfe' }}>
          {org.logoURL
            ? <img src={org.logoURL} alt={org.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { e.currentTarget.style.display='none'; e.currentTarget.parentElement.textContent=(org.name?.[0]||'O').toUpperCase(); }} />
            : (org.name?.[0] || 'O').toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>{org.name}</div>
          <div style={{ fontSize:12, color:'#3b82f6' }}>{org.type}</div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        <div style={{ background:'#fff', borderRadius:8, padding:'10px 12px' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Monthly Donation</div>
          <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>
            ৳{(org.settings?.baseAmount || 0).toLocaleString()}
          </div>
        </div>
        <div style={{ background:'#fff', borderRadius:8, padding:'10px 12px' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Due By</div>
          <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>
            {org.settings?.dueDate ? `${org.settings.dueDate}th` : '—'}
          </div>
        </div>
      </div>
    </div>
  );

  // ── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, background:'#f8fafc' }}>
      <div style={{ width:'100%', maxWidth: flow === 'register' ? 560 : 420 }}>

        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ width:40, height:40, borderRadius:10, background:'#2563eb', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <div style={{ fontSize:11, color:'#94a3b8' }}>ABSIS Capital Sync</div>
        </div>

        {/* Loading */}
        {inviteStatus === 'loading' && (
          <div style={{ textAlign:'center', color:'#94a3b8' }}>Checking invite…</div>
        )}

        {/* Expired */}
        {inviteStatus === 'expired' && (
          <div className="card" style={{ textAlign:'center' }}>
            <div className="alert alert-error">This invite link has expired.</div>
            <a href="/select-org" className="btn-ghost">← Go Back</a>
          </div>
        )}

        {/* Error */}
        {inviteStatus === 'error' && (
          <div className="card" style={{ textAlign:'center' }}>
            <div className="alert alert-error">Invalid invite link. Please check the URL.</div>
            <a href="/select-org" className="btn-ghost">← Go Back</a>
          </div>
        )}

        {/* Joining (already logged in) */}
        {inviteStatus === 'ready' && flow === 'joining' && (
          <div className="card" style={{ textAlign:'center' }}>
            <div style={{ color:'#94a3b8', marginBottom:8 }}>Joining organization…</div>
            <div style={{ width:24, height:24, border:'2px solid #bfdbfe', borderTopColor:'#2563eb', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto' }} />
            <style>{`@keyframes spin { to { transform:rotate(360deg); }}`}</style>
          </div>
        )}

        {/* Joined */}
        {flow === 'joined' && (
          <div className="card" style={{ textAlign:'center' }}>
            <OrgCard />
            <div className="alert alert-success" style={{ marginBottom:16 }}>
              ✓ Request submitted! Awaiting admin approval.
            </div>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:20 }}>
              You'll be notified when your membership is approved.
            </p>
            <a href="/select-org" className="btn-primary" style={{ display:'inline-flex', textDecoration:'none' }}>
              Go to My Organizations →
            </a>
          </div>
        )}

        {/* Preview — choose login or register */}
        {inviteStatus === 'ready' && flow === 'preview' && (
          <div className="card">
            <OrgCard />
            <div className="alert alert-info" style={{ fontSize:12, marginBottom:20 }}>
              You'll need an account to join. Your membership will need admin approval.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <button onClick={() => { setFlow('register'); setRegStep(1); }} className="btn-primary" style={{ justifyContent:'center' }}>
                Create New Account & Join
              </button>
              <button onClick={() => setFlow('login')} className="btn-ghost" style={{ justifyContent:'center' }}>
                I Already Have an Account
              </button>
            </div>
          </div>
        )}

        {/* Login flow */}
        {flow === 'login' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <button onClick={() => { setFlow('preview'); setAuthError(''); }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18, padding:0, lineHeight:1 }}>←</button>
              <div style={{ fontWeight:700, fontSize:16, color:'#0f172a' }}>Sign In to Join</div>
            </div>
            <OrgCard />
            {authError && <div className="alert alert-error">{authError}</div>}
            <form onSubmit={handleSignIn}>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input type="email" required placeholder="you@example.com"
                  value={form.email} onChange={e => handleChange('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input type="password" required placeholder="Your password"
                  value={form.password} onChange={e => handleChange('password', e.target.value)} />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary" style={{ width:'100%', justifyContent:'center' }}>
                {submitting ? 'Signing in…' : 'Sign In & Join'}
              </button>
            </form>
            <p style={{ textAlign:'center', fontSize:13, color:'#64748b', marginTop:14 }}>
              No account?{' '}
              <button onClick={() => { setFlow('register'); setRegStep(1); setAuthError(''); }}
                style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                Create one instead
              </button>
            </p>
          </div>
        )}

        {/* Register flow */}
        {flow === 'register' && (
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
              <button onClick={() => { if(regStep === 2) { setRegStep(1); setAuthError(''); } else { setFlow('preview'); setAuthError(''); } }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18, padding:0, lineHeight:1 }}>←</button>
              <div style={{ fontWeight:700, fontSize:16, color:'#0f172a' }}>Create Account & Join</div>
            </div>

            {/* Step indicator */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, paddingLeft:2 }}>
              <p style={{ fontSize:13, color:'#64748b', margin:0 }}>Step {regStep} of 2</p>
              <div style={{ flex:1, height:3, background:'#e2e8f0', borderRadius:2 }}>
                <div style={{ width: regStep === 1 ? '50%' : '100%', height:'100%', background:'#2563eb', borderRadius:2, transition:'width 0.3s' }} />
              </div>
            </div>

            <OrgCard />

            {authError && <div className="alert alert-error">{authError}</div>}

            {regStep === 1 ? (
              <form onSubmit={handleRegisterStep1}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 14px' }}>
                  <Field label="Full Name (English)" name="nameEnglish" placeholder="John Doe"    required value={form.nameEnglish} onChange={handleChange} />
                  <Field label="Full Name (Bengali)"  name="nameBengali" placeholder="জন ডো"              value={form.nameBengali} onChange={handleChange} />
                  <Field label="Father's Name (English)"        name="fatherName"  placeholder="Father"              value={form.fatherName}  onChange={handleChange} />
                  <Field label="Mother's Name (English)"        name="motherName"  placeholder="Mother"              value={form.motherName}  onChange={handleChange} />
                  <Field label="Date of Birth"        name="dob"         type="date"                       value={form.dob}         onChange={handleChange} />
                  <Field label="Blood Group"          name="bloodGroup"  options={BLOOD_GROUPS}            value={form.bloodGroup}  onChange={handleChange} />
                  <Field label="Occupation"           name="occupation"  placeholder="e.g. Teacher"        value={form.occupation}  onChange={handleChange} />
                  <Field label="NID Number"           name="nid"         placeholder="NID"                 value={form.nid}         onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label className="form-label">Address (English)</label>
                  <textarea rows={2} placeholder="Full address (English)" value={form.address}
                    onChange={e => handleChange('address', e.target.value)} style={{ resize:'vertical' }} />
                </div>
                <button type="submit" className="btn-primary" style={{ width:'100%', justifyContent:'center' }}>
                  Next →
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit}>
                <Field label="Phone Number"     name="phone"           type="tel"      placeholder="+8801XXXXXXXXX"   required value={form.phone}           onChange={handleChange} />
                <Field label="Email"            name="email"           type="email"    placeholder="you@example.com"  required value={form.email}           onChange={handleChange} />
                <Field label="Password"         name="password"        type="password" placeholder="Min 6 characters" required value={form.password}        onChange={handleChange} />
                <Field label="Confirm Password" name="confirmPassword" type="password" placeholder="Repeat password"  required value={form.confirmPassword} onChange={handleChange} />
                <button type="submit" disabled={submitting} className="btn-primary" style={{ width:'100%', justifyContent:'center' }}>
                  {submitting ? 'Creating account…' : 'Create Account & Join'}
                </button>
              </form>
            )}

            <p style={{ textAlign:'center', fontSize:13, color:'#64748b', marginTop:14 }}>
              Already have an account?{' '}
              <button onClick={() => { setFlow('login'); setAuthError(''); }}
                style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                Sign in instead
              </button>
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

// Wrap in Suspense because useSearchParams needs it
export default function JoinOrg() {
  return (
    <Suspense fallback={<div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading…</div>}>
      <JoinPageInner />
    </Suspense>
  );
}