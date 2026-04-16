// src/app/admin/charity/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

const EMPTY    = { recipient:'', purpose:'', amount:'', date:'', notes:'', receiptUrl:'' };
const PURPOSES = ['Education','Medical Aid','Disaster Relief','Food Aid','Infrastructure','Religious','Other'];
const fmt = n => `৳${(n||0).toLocaleString(undefined, { maximumFractionDigits:0 })}`;

export default function AdminCharity() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [records,  setRecords]  = useState([]);
  const [form,     setForm]     = useState(EMPTY);
  const [open,     setOpen]     = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [search,   setSearch]   = useState('');
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'charityRecords'), snap =>
      setRecords(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.date||'').localeCompare(a.date||'')))
    );
    return unsub;
  }, [orgId]);

  const save = async () => {
    if (!form.recipient || !form.amount || !form.date) return alert('Fill recipient, amount and date.');
    setSaving(true);
    try {
      await addDoc(collection(db,'organizations',orgId,'charityRecords'), {
        ...form, amount: Number(form.amount), createdAt: serverTimestamp(),
      });
      setForm(EMPTY); setOpen(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  const del = async (id) => {
    if (!confirm('Delete this charity record?')) return;
    setDeleting(id);
    try { await deleteDoc(doc(db,'organizations',orgId,'charityRecords',id)); }
    catch(e) { alert(e.message); }
    setDeleting(null);
  };

  const filtered = records.filter(r =>
    !search ||
    (r.recipient||'').toLowerCase().includes(search.toLowerCase()) ||
    (r.purpose||'').toLowerCase().includes(search.toLowerCase())
  );

  const totalCharity = records.reduce((s,r) => s+(r.amount||0), 0);

  if (!isOrgAdmin) return <div className="page-wrap"><div style={{textAlign:'center',padding:80,color:'#94a3b8'}}>Admin only.</div></div>;
  if (!orgData?.features?.charityTracking) return (
    <div className="page-wrap">
      <div style={{ textAlign:'center', padding:80 }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Feature Not Enabled</div>
        <div style={{ fontSize:13, color:'#64748b' }}>Charity Tracking is not enabled for this org.<br />Contact your platform superadmin.</div>
      </div>
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}><img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /></div>}
        <div style={{ flex:1 }}>
          <div className="page-title">Charity & Donations</div>
          <div className="page-subtitle">{orgData?.name} · Total given: {fmt(totalCharity)}</div>
        </div>
        <button onClick={() => setOpen(true)} className="btn-primary" style={{ padding:'9px 18px', fontSize:13, flexShrink:0 }}>+ Add Record</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:12, marginBottom:20 }}>
        {[
          ['Total Given',  fmt(totalCharity), '#dc2626'],
          ['Records',      records.length,    '#0f172a'],
          ['This Year',    fmt(records.filter(r => (r.date||'').startsWith(new Date().getFullYear())).reduce((s,r)=>s+(r.amount||0),0)), '#d97706'],
        ].map(([l,v,c]) => (
          <div key={l} className="stat-card">
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ color:c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search recipient or purpose…" style={{ flex:1 }} />
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>
          No charity records yet. Click "+ Add Record" to log a donation.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(r => (
            <div key={r.id} className="card" style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              <div style={{ width:44, height:44, borderRadius:12, background:'#fee2e2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>❤️</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{r.recipient}</div>
                    <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                      {r.purpose && <span className="badge badge-red" style={{ marginRight:6, fontSize:10 }}>{r.purpose}</span>}
                      {r.date}
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontWeight:800, fontSize:18, color:'#dc2626' }}>{fmt(r.amount)}</div>
                  </div>
                </div>
                {r.notes && <div style={{ fontSize:12, color:'#64748b', marginTop:8, fontStyle:'italic' }}>{r.notes}</div>}
                {r.receiptUrl && <a href={r.receiptUrl} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'#2563eb', marginTop:4, display:'inline-block' }}>📎 Receipt</a>}
              </div>
              <button onClick={() => del(r.id)} disabled={deleting===r.id}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:18, padding:4, flexShrink:0, opacity: deleting===r.id ? .5 : 1 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title="Add Charity Record" onClose={() => setOpen(false)}>
          <div className="form-group"><label className="form-label">Recipient / Organization *</label>
            <input value={form.recipient} onChange={e=>setForm(p=>({...p,recipient:e.target.value}))} placeholder="e.g. Red Crescent" /></div>
          <div className="form-group"><label className="form-label">Purpose</label>
            <select value={form.purpose} onChange={e=>setForm(p=>({...p,purpose:e.target.value}))}>
              <option value="">Select purpose…</option>
              {PURPOSES.map(p => <option key={p}>{p}</option>)}
            </select></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Amount *</label>
              <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" /></div>
            <div className="form-group"><label className="form-label">Date *</label>
              <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Optional details…" /></div>
          <div className="form-group"><label className="form-label">Receipt URL</label>
            <input value={form.receiptUrl} onChange={e=>setForm(p=>({...p,receiptUrl:e.target.value}))} placeholder="https://…" /></div>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }}>
            {saving ? 'Saving…' : 'Save Record'}
          </button>
        </Modal>
      )}
    </div>
  );
}
