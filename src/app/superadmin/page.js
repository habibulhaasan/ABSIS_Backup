'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function SuperAdminDashboard() {
  const { user, userData, loading, isSuperAdmin } = useAuth();

  const [orgs, setOrgs]           = useState([]);
  const [totals, setTotals]       = useState({ members:0, funds:0 });
  const [dataLoading, setDataLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const [permError, setPermError] = useState('');

  // Bootstrap: allow the user on THIS page to make themselves superadmin
  // (only works if no superadmin exists yet - enforced by rule check)
  const makeMeSuperAdmin = async () => {
    if (!user) return;
    setBootstrapping(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { role: 'superadmin' }, { merge: true });
      setBootstrapDone(true);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setPermError('Could not set superadmin role: ' + e.message);
    }
    setBootstrapping(false);
  };

  useEffect(() => {
    if (!isSuperAdmin) return;

    setDataLoading(true);
    let cancelled = false;

    const unsub = onSnapshot(
      collection(db, 'organizations'),
      async snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!cancelled) setOrgs(list);

        let totalM = 0, totalF = 0;
        const results = await Promise.allSettled(
          list.map(async org => {
            try {
              const [ms, inv] = await Promise.all([
                getDocs(collection(db, 'organizations', org.id, 'members')),
                getDocs(collection(db, 'organizations', org.id, 'investments')),
              ]);
              return {
                m: ms.size,
                f: inv.docs.reduce((s, d) => d.data().status === 'verified' ? s + (d.data().amount || 0) : s, 0),
              };
            } catch { return { m: 0, f: 0 }; }
          })
        );
        results.forEach(r => { if (r.status === 'fulfilled') { totalM += r.value.m; totalF += r.value.f; } });
        if (!cancelled) { setTotals({ members: totalM, funds: totalF }); setDataLoading(false); }
      },
      err => {
        if (!cancelled) {
          setPermError(err.message);
          setDataLoading(false);
        }
      }
    );
    return () => { cancelled = true; unsub(); };
  }, [isSuperAdmin]);

  if (loading) return null;

  // Not a superadmin — show bootstrap UI
  if (!isSuperAdmin) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', padding:24 }}>
        <div style={{ maxWidth:480, width:'100%' }}>
          <div className="card">
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🔐</div>
              <div style={{ fontSize:20, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Superadmin Setup</div>
              <p style={{ fontSize:14, color:'#64748b', lineHeight:1.6 }}>
                Your account (<strong>{userData?.email || user?.email}</strong>) is not marked as superadmin yet.
                If you are the platform owner, click below to grant yourself superadmin access.
              </p>
            </div>

            {permError && (
              <div className="alert alert-error" style={{ marginBottom:16 }}>
                {permError}
                <br />
                <small>You may need to set <code>role: "superadmin"</code> directly in Firebase Console → Firestore → users → your UID.</small>
              </div>
            )}

            {bootstrapDone ? (
              <div className="alert alert-success">✅ Superadmin role set! Reloading…</div>
            ) : (
              <>
                <button onClick={makeMeSuperAdmin} disabled={bootstrapping}
                  className="btn-primary"
                  style={{ width:'100%', justifyContent:'center', padding:'13px', fontSize:15 }}>
                  {bootstrapping ? 'Setting up…' : '🚀 Make Me Superadmin'}
                </button>
                <div style={{ marginTop:20, padding:'14px 16px', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10 }}>
                  <div style={{ fontWeight:600, fontSize:13, color:'#92400e', marginBottom:8 }}>If the button above doesn't work:</div>
                  <div style={{ fontSize:12, color:'#78350f', lineHeight:1.8 }}>
                    1. Go to <strong>Firebase Console</strong> → your project<br />
                    2. Open <strong>Firestore Database</strong> → <code>users</code> collection<br />
                    3. Find your UID: <code style={{ fontFamily:'monospace', background:'#fef3c7', padding:'1px 4px', borderRadius:4 }}>{user?.uid}</code><br />
                    4. Add/edit field: <code style={{ fontFamily:'monospace', background:'#fef3c7', padding:'1px 4px', borderRadius:4 }}>role = "superadmin"</code><br />
                    5. Also deploy Firestore rules: <code style={{ fontFamily:'monospace', background:'#fef3c7', padding:'1px 4px', borderRadius:4 }}>firebase deploy --only firestore:rules</code>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const active  = orgs.filter(o => (o.status || 'active') === 'active').length;
  const pending = orgs.filter(o => o.status === 'pending');

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{ fontSize:11, fontWeight:700, color:'#2563eb', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:6 }}>Super Admin</div>
        <div className="page-title">Platform Overview</div>
        <div className="page-subtitle">Manage all organizations and members</div>
      </div>

      {permError && (
        <div className="alert alert-error" style={{ marginBottom:16 }}>
          ⚠️ Firestore permission error: {permError}
          <br /><small>Make sure your Firestore rules are deployed: <code>firebase deploy --only firestore:rules</code></small>
        </div>
      )}

      {dataLoading ? (
        <div style={{ textAlign:'center', padding:'80px 0' }}>
          <div style={{ width:28, height:28, border:'3px solid #bfdbfe', borderTopColor:'#2563eb', borderRadius:'50%', margin:'0 auto 12px', animation:'spin .7s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{ color:'#94a3b8', fontSize:13 }}>Loading platform data…</div>
        </div>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px,1fr))', gap:12, marginBottom:20 }}>
            {[
              ['Organizations', orgs.length,         '#0f172a', `${pending.length} pending`],
              ['Active Orgs',   active,               '#16a34a', null],
              ['Total Members', totals.members,       '#2563eb', null],
              ['Funds Tracked', `৳${totals.funds.toLocaleString()}`, '#0f172a', null],
            ].map(([l, v, c, sub]) => (
              <div key={l} className="stat-card">
                <div className="stat-label">{l}</div>
                <div className="stat-value" style={{ color: c }}>{v}</div>
                {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>{sub}</div>}
              </div>
            ))}
          </div>

          {pending.length > 0 && (
            <Link href="/superadmin/orgs"
              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderRadius:10, border:'1px solid #fcd34d', background:'#fffbeb', marginBottom:20, textDecoration:'none', gap:10, flexWrap:'wrap' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:14, color:'#92400e' }}>
                  ⏳ {pending.length} organization{pending.length > 1 ? 's' : ''} awaiting approval
                </div>
                <div style={{ fontSize:12, color:'#b45309', marginTop:2 }}>Tap to review and approve →</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {pending.slice(0, 3).map(o => (
                  <span key={o.id} style={{ fontSize:12, fontWeight:600, color:'#92400e' }}>• {o.name}</span>
                ))}
              </div>
            </Link>
          )}

          <div className="table-wrap">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 18px', borderBottom:'1px solid #e2e8f0' }}>
              <span style={{ fontWeight:700, fontSize:14 }}>All Organizations ({orgs.length})</span>
              <Link href="/superadmin/orgs" style={{ fontSize:13, color:'#2563eb', textDecoration:'none', fontWeight:500 }}>Manage all →</Link>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Name</th><th>Type</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {orgs.slice(0, 15).map(o => (
                    <tr key={o.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:30, height:30, borderRadius:8, background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#2563eb', fontSize:13, flexShrink:0, overflow:'hidden' }}>
                            {o.logoURL ? <img src={o.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : (o.name?.[0] || '?')}
                          </div>
                          <span style={{ fontWeight:500, fontSize:13 }}>{o.name}</span>
                        </div>
                      </td>
                      <td style={{ fontSize:12, color:'#64748b' }}>{o.type || '—'}</td>
                      <td>
                        <span className={`badge ${(o.status||'active')==='active'?'badge-green':o.status==='pending'?'badge-yellow':'badge-red'}`} style={{ textTransform:'capitalize' }}>
                          {o.status || 'active'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
