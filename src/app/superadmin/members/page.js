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

export default function SuperAdminMembers() {
  const { isSuperAdmin } = useAuth();
  const [orgs, setOrgs]       = useState([]);
  const [selOrg, setSelOrg]   = useState(null);
  const [members, setMembers] = useState([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(null);
  const [toast, setToast]     = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsub = onSnapshot(
      collection(db, 'organizations'),
      snap => setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''))),
      err => setToast({ msg: 'Failed to load orgs: ' + err.message, type: 'err' })
    );
    return unsub;
  }, [isSuperAdmin]);

  // Live member subscription + profile merging
  useEffect(() => {
    if (!selOrg) { setMembers([]); return; }
    setLoading(true);
    let cancelled = false;

    const unsub = onSnapshot(
      collection(db, 'organizations', selOrg.id, 'members'),
      async snap => {
        if (cancelled) return;
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    setSaving(m.id + '_role');
    try {
      await updateDoc(doc(db, 'organizations', selOrg.id, 'members', m.id), { role: newRole });
      setToast({ msg: `${m.nameEnglish || 'Member'} role changed to ${newRole}.`, type: 'ok' });
    } catch (e) {
      setToast({ msg: 'Failed: ' + e.message, type: 'err' });
    }
    setSaving(null);
  };

  const toggleApproval = async (m) => {
    setSaving(m.id + '_approved');
    const next = !m.approved;
    try {
      await updateDoc(doc(db, 'organizations', selOrg.id, 'members', m.id), { approved: next });
      setToast({ msg: `${m.nameEnglish || 'Member'} ${next ? 'approved' : 'suspended'}.`, type: 'ok' });
    } catch (e) {
      setToast({ msg: 'Failed: ' + e.message, type: 'err' });
    }
    setSaving(null);
  };

  const filtered = members.filter(m =>
    !search ||
    (m.nameEnglish || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.idNo || '').includes(search)
  );

  if (!isSuperAdmin) return null;

  return (
    <div className="page-wrap animate-fade">
      <style>{TOAST_STYLES}</style>

      <div className="page-header">
        <div style={{ fontSize:11, fontWeight:600, color:'#2563eb', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Super Admin</div>
        <div className="page-title">All Members</div>
        <div className="page-subtitle">View, approve, and manage members across all organizations</div>
      </div>

      {/* Org selector */}
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:10 }}>Select Organization</div>
        {orgs.length === 0
          ? <p style={{ fontSize:13, color:'#94a3b8' }}>No organizations found.</p>
          : <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {orgs.map(o => (
                <button key={o.id} onClick={() => { setSelOrg(o); setSearch(''); }}
                  style={{ padding:'8px 14px', borderRadius:8, fontSize:13, fontWeight:selOrg?.id===o.id?600:400, cursor:'pointer',
                    border:     selOrg?.id===o.id ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: selOrg?.id===o.id ? '#eff6ff' : '#fff',
                    color:      selOrg?.id===o.id ? '#1d4ed8' : '#475569' }}>
                  {o.name}
                  <span style={{ marginLeft:5, fontSize:10, opacity:0.6 }}>
                    ({o.status === 'pending' ? '⏳ pending' : o.status || 'active'})
                  </span>
                </button>
              ))}
            </div>
        }
      </div>

      {selOrg && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
            <div>
              <span style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>{selOrg.name}</span>
              <span style={{ fontSize:13, color:'#94a3b8', marginLeft:10 }}>{members.length} members</span>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name / email / ID…" style={{ width:240 }} />
          </div>

          {loading ? (
            <div style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>Loading members…</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:32, color:'#94a3b8' }}>
              {members.length === 0 ? 'No members yet.' : 'No members match your search.'}
            </div>
          ) : (
            <div className="table-wrap"><div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Member</th><th>Phone</th><th>ID</th><th>Role</th><th>Status</th><th>Make Admin</th><th>Approve</th></tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:34, height:34, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
                            {m.photoURL ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : initials(m.nameEnglish)}
                          </div>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish || '(no name)'}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{m.email || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize:12 }}>{m.phone || '—'}</td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{m.idNo || '—'}</td>
                      <td><span className={`badge ${m.role==='admin'?'badge-blue':'badge-gray'}`}>{m.role || 'member'}</span></td>
                      <td><span className={`badge ${m.approved?'badge-green':'badge-yellow'}`}>{m.approved ? 'Approved' : 'Pending'}</span></td>
                      <td>
                        <button onClick={() => toggleRole(m)} disabled={!!saving}
                          style={{ padding:'5px 12px', fontSize:11, fontWeight:600, borderRadius:6, border:'none', cursor:'pointer', whiteSpace:'nowrap',
                            background: m.role==='admin' ? '#fee2e2' : '#eff6ff',
                            color:      m.role==='admin' ? '#b91c1c' : '#1d4ed8',
                            opacity: saving ? 0.6 : 1 }}>
                          {saving === m.id+'_role' ? '…' : m.role==='admin' ? 'Revoke' : 'Make Admin'}
                        </button>
                      </td>
                      <td>
                        <button onClick={() => toggleApproval(m)} disabled={!!saving}
                          style={{ padding:'5px 12px', fontSize:11, fontWeight:600, borderRadius:6, border:'none', cursor:'pointer', whiteSpace:'nowrap',
                            background: m.approved ? '#fee2e2' : '#dcfce7',
                            color:      m.approved ? '#b91c1c' : '#15803d',
                            opacity: saving ? 0.6 : 1 }}>
                          {saving === m.id+'_approved' ? '…' : m.approved ? 'Suspend' : 'Approve'}
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

      {!selOrg && orgs.length > 0 && (
        <div style={{ textAlign:'center', color:'#94a3b8', padding:'60px 20px', fontSize:14 }}>
          ↑ Select an organization above to view its members
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
