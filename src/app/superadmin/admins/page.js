//src/app/superadmin/admins/page.js

'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, getDoc, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const TOAST_STYLES = `
  .err-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#b91c1c; color:#fff; padding:12px 20px; border-radius:10px; font-size:13px; font-weight:600; z-index:99999; box-shadow:0 4px 20px rgba(0,0,0,.25); animation:fadeUp .25s ease both; }
  .ok-toast  { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#15803d; color:#fff; padding:12px 20px; border-radius:10px; font-size:13px; font-weight:600; z-index:99999; box-shadow:0 4px 20px rgba(0,0,0,.25); animation:fadeUp .25s ease both; }
`;
function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
  return <div className={type === 'err' ? 'err-toast' : 'ok-toast'}>{msg}</div>;
}

const initials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export default function SuperAdminAdmins() {
  const { isSuperAdmin } = useAuth();
  const [orgs, setOrgs]       = useState([]);
  const [selOrg, setSelOrg]   = useState('');
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(null);
  const [search, setSearch]   = useState('');
  const [toast, setToast]     = useState(null);

  // Load all orgs
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'organizations'),
      snap => setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
      err => setToast({ msg: 'Failed to load orgs: ' + err.message, type: 'err' })
    );
    return unsub;
  }, [isSuperAdmin]);

  // Load members with full user profiles when org selected
  useEffect(() => {
    if (!selOrg) { setMembers([]); return; }
    setLoading(true);
    let cancelled = false;

    // Use onSnapshot for live updates after role changes
    const unsub = onSnapshot(
      collection(db, 'organizations', selOrg, 'members'),
      async snap => {
        if (cancelled) return;
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Merge with /users/{id} for display names and emails
        const merged = await Promise.all(docs.map(async m => {
          try {
            const uSnap = await getDoc(doc(db, 'users', m.id));
            return uSnap.exists() ? { ...uSnap.data(), ...m } : m;
          } catch { return m; }
        }));
        if (!cancelled) {
          merged.sort((a, b) => (a.nameEnglish || '').localeCompare(b.nameEnglish || ''));
          setMembers(merged);
          setLoading(false);
        }
      },
      err => {
        if (!cancelled) {
          setToast({ msg: 'Failed to load members: ' + err.message, type: 'err' });
          setLoading(false);
        }
      }
    );
    return () => { cancelled = true; unsub(); };
  }, [selOrg]);

  const toggleRole = async (m) => {
    const newRole = m.role === 'admin' ? 'member' : 'admin';
    setSaving(m.id);
    try {
      await updateDoc(doc(db, 'organizations', selOrg, 'members', m.id), { role: newRole });
      setToast({ msg: `${m.nameEnglish || 'Member'} is now ${newRole === 'admin' ? 'an Admin' : 'a Member'}.`, type: 'ok' });
    } catch (e) {
      setToast({ msg: 'Failed: ' + e.message, type: 'err' });
    }
    setSaving(null);
  };

  const filtered = members.filter(m =>
    !search ||
    (m.nameEnglish || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.nameBengali || '').toLowerCase().includes(search.toLowerCase())
  );

  if (!isSuperAdmin) return null;

  const selectedOrg = orgs.find(o => o.id === selOrg);
  const adminCount  = members.filter(m => m.role === 'admin').length;

  return (
    <div className="page-wrap animate-fade">
      <style>{TOAST_STYLES}</style>

      <div className="page-header">
        <div style={{ fontSize:11, fontWeight:600, color:'#2563eb', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Super Admin</div>
        <div className="page-title">Admin Management</div>
        <div className="page-subtitle">Assign or revoke admin roles across all organizations</div>
      </div>

      {/* Org picker */}
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:10 }}>Select Organization</div>
        {orgs.length === 0
          ? <p style={{ fontSize:13, color:'#94a3b8' }}>No organizations found.</p>
          : <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {orgs.map(o => (
                <button key={o.id} onClick={() => { setSelOrg(o.id); setSearch(''); }}
                  style={{ padding:'8px 14px', borderRadius:8, fontSize:13, fontWeight:selOrg===o.id?600:400, cursor:'pointer',
                    border:     selOrg===o.id ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: selOrg===o.id ? '#eff6ff' : '#fff',
                    color:      selOrg===o.id ? '#1d4ed8' : '#475569' }}>
                  {o.name}
                  <span style={{ marginLeft:5, fontSize:10, opacity:0.6, textTransform:'capitalize' }}>({o.status||'active'})</span>
                </button>
              ))}
            </div>
        }
      </div>

      {selOrg && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
            <div>
              <span style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>{selectedOrg?.name}</span>
              <span style={{ fontSize:13, color:'#94a3b8', marginLeft:10 }}>
                {members.length} member{members.length!==1?'s':''} · {adminCount} admin{adminCount!==1?'s':''}
              </span>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search members…" style={{ width:200 }} />
          </div>

          {loading ? (
            <div style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>Loading members…</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:32, color:'#94a3b8' }}>
              {members.length === 0 ? 'No members in this organization yet.' : 'No members match your search.'}
            </div>
          ) : (
            <div className="table-wrap"><div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Member</th><th>Phone</th><th>Role</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:36, height:36, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
                            {m.photoURL ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : initials(m.nameEnglish)}
                          </div>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish || '(no name)'}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{m.email || m.id.slice(0,16)}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize:12, color:'#64748b' }}>{m.phone || '—'}</td>
                      <td>
                        <span className={`badge ${m.role==='admin'?'badge-blue':'badge-gray'}`} style={{ textTransform:'capitalize' }}>
                          {m.role || 'member'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${m.approved?'badge-green':'badge-yellow'}`}>
                          {m.approved ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => toggleRole(m)} disabled={saving === m.id}
                          style={{ padding:'6px 14px', fontSize:12, fontWeight:600, borderRadius:6, border:'none', cursor:'pointer', whiteSpace:'nowrap',
                            background: m.role==='admin' ? '#fee2e2' : '#dcfce7',
                            color:      m.role==='admin' ? '#b91c1c' : '#15803d',
                            opacity: saving === m.id ? 0.6 : 1 }}>
                          {saving === m.id ? '…' : m.role === 'admin' ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          )}
        </>
      )}

      {!selOrg && (
        <div style={{ textAlign:'center', color:'#94a3b8', padding:'60px 20px', fontSize:14 }}>
          ↑ Select an organization above to manage its admins
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
