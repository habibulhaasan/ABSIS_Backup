// src/app/admin/portfolio/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

const EMPTY    = { name:'', sector:'', invested:'', currentValue:'', startDate:'', endDate:'', status:'active', notes:'' };
const SECTORS  = ['Real Estate','Stock Market','Mutual Fund','Fixed Deposit','Gold/Jewelry','Business','Agriculture','Technology','Other'];
const STATUSES = ['active','matured','sold','loss'];
const fmt = n => `৳${(n||0).toLocaleString(undefined, { maximumFractionDigits:0 })}`;

function ROIBadge({ invested, current }) {
  if (!invested || !current) return null;
  const roi = ((current - invested) / invested * 100).toFixed(1);
  const pos  = current >= invested;
  return (
    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background: pos?'#dcfce7':'#fee2e2', color: pos?'#15803d':'#b91c1c' }}>
      {pos?'+':''}{roi}% ROI
    </span>
  );
}

export default function AdminPortfolio() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [items,    setItems]    = useState([]);
  const [form,     setForm]     = useState(EMPTY);
  const [open,     setOpen]     = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [filter,   setFilter]   = useState('all');
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'portfolio'), snap =>
      setItems(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.startDate||'').localeCompare(a.startDate||'')))
    );
    return unsub;
  }, [orgId]);

  const openAdd  = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (item) => {
    setForm({ name:item.name||'', sector:item.sector||'', invested:item.invested||'', currentValue:item.currentValue||'', startDate:item.startDate||'', endDate:item.endDate||'', status:item.status||'active', notes:item.notes||'' });
    setEditing(item.id);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.invested || !form.startDate) return alert('Fill name, invested amount and start date.');
    setSaving(true);
    try {
      const data = { ...form, invested:Number(form.invested), currentValue:Number(form.currentValue)||Number(form.invested) };
      if (editing) await updateDoc(doc(db,'organizations',orgId,'portfolio',editing), data);
      else         await addDoc(collection(db,'organizations',orgId,'portfolio'), { ...data, createdAt:serverTimestamp() });
      setOpen(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  const del = async (id) => {
    if (!confirm('Delete this portfolio entry?')) return;
    setDeleting(id);
    try { await deleteDoc(doc(db,'organizations',orgId,'portfolio',id)); }
    catch(e) { alert(e.message); }
    setDeleting(null);
  };

  const filtered      = items.filter(i => filter==='all' || i.status===filter);
  const totalInvested = items.reduce((s,i) => s+(i.invested||0), 0);
  const totalCurrent  = items.reduce((s,i) => s+(i.currentValue||i.invested||0), 0);
  const totalROI      = totalInvested > 0 ? ((totalCurrent-totalInvested)/totalInvested*100).toFixed(1) : 0;
  const activeCount   = items.filter(i=>i.status==='active').length;
  const statusColor   = { active:'badge-blue', matured:'badge-green', sold:'badge-gray', loss:'badge-red' };

  if (!isOrgAdmin) return <div className="page-wrap"><div style={{textAlign:'center',padding:80,color:'#94a3b8'}}>Admin only.</div></div>;
  if (!orgData?.features?.investmentPortfolio) return (
    <div className="page-wrap">
      <div style={{ textAlign:'center', padding:80 }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Feature Not Enabled</div>
        <div style={{ fontSize:13, color:'#64748b' }}>Investment Portfolio is not enabled for this org.<br />Contact your platform superadmin.</div>
      </div>
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}><img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /></div>}
        <div style={{ flex:1 }}>
          <div className="page-title">Investment Portfolio</div>
          <div className="page-subtitle">{orgData?.name} · {activeCount} active</div>
        </div>
        <button onClick={openAdd} className="btn-primary" style={{ padding:'9px 18px', fontSize:13, flexShrink:0 }}>+ Add</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:12, marginBottom:20 }}>
        {[
          ['Total Invested', fmt(totalInvested), '#2563eb'],
          ['Current Value',  fmt(totalCurrent),  totalCurrent>=totalInvested?'#16a34a':'#dc2626'],
          ['Portfolio ROI',  `${totalROI>0?'+':''}${totalROI}%`, totalROI>=0?'#16a34a':'#dc2626'],
          ['Active',         activeCount,         '#0f172a'],
        ].map(([l,v,c]) => (
          <div key={l} className="stat-card">
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ color:c }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        {['all','active','matured','sold','loss'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={filter===f?'btn-primary':'btn-ghost'} style={{ padding:'7px 14px', fontSize:12, textTransform:'capitalize' }}>{f}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>No investments found. Click "+ Add" to log one.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12 }}>
          {filtered.map(item => {
            const gain = (item.currentValue||item.invested||0) - (item.invested||0);
            return (
              <div key={item.id} className="card" style={{ cursor:'pointer' }} onClick={() => openEdit(item)}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{item.name}</div>
                    <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{item.sector}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span className={`badge ${statusColor[item.status]||'badge-gray'}`} style={{ textTransform:'capitalize', fontSize:10 }}>{item.status}</span>
                    <ROIBadge invested={item.invested} current={item.currentValue} />
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div style={{ background:'#f8fafc', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>Invested</div>
                    <div style={{ fontSize:15, fontWeight:700, color:'#0f172a', marginTop:2 }}>{fmt(item.invested)}</div>
                  </div>
                  <div style={{ background: gain>=0?'#f0fdf4':'#fef2f2', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>Current Value</div>
                    <div style={{ fontSize:15, fontWeight:700, color: gain>=0?'#16a34a':'#dc2626', marginTop:2 }}>{fmt(item.currentValue||item.invested)}</div>
                  </div>
                </div>
                {item.endDate && <div style={{ fontSize:11, color:'#94a3b8', marginTop:10 }}>Matures: {item.endDate}</div>}
                {item.notes   && <div style={{ fontSize:12, color:'#64748b', marginTop:8, fontStyle:'italic' }}>{item.notes}</div>}
                <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end' }}>
                  <button onClick={e=>{e.stopPropagation();del(item.id);}} disabled={deleting===item.id}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:12, padding:0, opacity:deleting===item.id?.5:1 }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Modal title={editing ? 'Edit Investment' : 'Add Investment'} onClose={() => setOpen(false)} wide>
          <div className="form-group"><label className="form-label">Investment Name *</label>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="e.g. ABC Mutual Fund" /></div>
          <div className="form-group"><label className="form-label">Sector</label>
            <select value={form.sector} onChange={e=>setForm(p=>({...p,sector:e.target.value}))}>
              <option value="">Select sector…</option>
              {SECTORS.map(s=><option key={s}>{s}</option>)}
            </select></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Amount Invested *</label>
              <input type="number" value={form.invested} onChange={e=>setForm(p=>({...p,invested:e.target.value}))} placeholder="0" /></div>
            <div className="form-group"><label className="form-label">Current Value</label>
              <input type="number" value={form.currentValue} onChange={e=>setForm(p=>({...p,currentValue:e.target.value}))} placeholder="0" /></div>
            <div className="form-group"><label className="form-label">Start Date *</label>
              <input type="date" value={form.startDate} onChange={e=>setForm(p=>({...p,startDate:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Maturity / End Date</label>
              <input type="date" value={form.endDate} onChange={e=>setForm(p=>({...p,endDate:e.target.value}))} /></div>
          </div>
          <div className="form-group"><label className="form-label">Status</label>
            <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}>
              {STATUSES.map(s=><option key={s} value={s} style={{ textTransform:'capitalize' }}>{s}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Optional…" /></div>
          <button onClick={save} disabled={saving} className="btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:8 }}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Add Investment')}
          </button>
        </Modal>
      )}
    </div>
  );
}
