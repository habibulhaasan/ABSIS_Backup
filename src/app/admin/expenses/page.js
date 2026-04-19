'use client';
import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, orderBy, query, getDocs } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const CATS  = ['Operations','Event','Maintenance','Charity','Salary','Utilities','Other'];
const EMPTY = { title:'', amount:'', date:'', category:'', notes:'' };

// Self-contained modal CSS — no globals dependency.
// Desktop: padding-left:264px shifts the flex centering point into the content
//          area (past the 240px sidebar), so justify-content:center centres there.
// Mobile : bottom sheet slides up, clears 56px topbar.
const CSS = `
  .m-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.48);
    z-index: 9000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-top: 56px;
  }
  .m-box {
    background: #fff;
    width: 100%;
    max-height: calc(100vh - 56px);
    overflow-y: auto;
    border-radius: 20px 20px 0 0;
    -webkit-overflow-scrolling: touch;
    animation: mUp .26s cubic-bezier(.32,1,.32,1) both;
  }
  .m-pill  { width:40px; height:4px; background:#e2e8f0; border-radius:99px; margin:12px auto 0; }
  .m-inner { padding:16px 20px 44px; }
  .m-top   { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
  .m-2col  { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
  @keyframes mUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
  @media (min-width:769px) {
    .m-overlay { align-items:center; padding:24px 24px 24px 264px; }
    .m-box     { width:500px; max-height:90vh; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.18); animation:mPop .18s ease both; }
    .m-pill    { display:none; }
    .m-inner   { padding:28px 32px 36px; }
  }
  @keyframes mPop { from { opacity:0; transform:scale(.95); } to { opacity:1; transform:scale(1); } }
  @media (max-width:480px) { .m-2col { grid-template-columns:1fr; } }
`;

function Modal({ title, onClose, children }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);
  return (
    <>
      <style>{CSS}</style>
      <div className="m-overlay" onClick={onClose}>
        <div className="m-box" onClick={e => e.stopPropagation()}>
          <div className="m-pill" />
          <div className="m-inner">
            <div className="m-top">
              <h3 style={{ fontSize:16, fontWeight:700, color:'#0f172a', margin:0 }}>{title}</h3>
              <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:28, lineHeight:1, padding:'0 0 0 12px' }}>x</button>
            </div>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export default function AdminExpenses() {
  const { userData, orgData } = useAuth();
  const [items,      setItems]      = useState([]);
  const [totalFund,  setTotalFund]  = useState(0);
  const [form,       setForm]       = useState(EMPTY);
  const [modal,      setModal]      = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const orgId = userData?.activeOrgId;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db,'organizations',orgId,'expenses'), orderBy('date','desc'));
    const unsub = onSnapshot(q, snap => setItems(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    getDocs(collection(db,'organizations',orgId,'investments')).then(snap => {
      setTotalFund(snap.docs.filter(d => d.data().status==='verified').reduce((s,d) => s+(d.data().amount||0), 0));
    });
    return unsub;
  }, [orgId]);

  const totalSpent = items.reduce((s,i) => s+(i.amount||0), 0);
  const available  = totalFund - totalSpent;
  const isEdit     = modal && modal !== 'add';

  const notifyAll = async (msg) => {
    if (!orgId) return;
    try {
      const ms = await getDocs(collection(db,'organizations',orgId,'members'));
      await Promise.all(ms.docs.filter(d => d.data().approved).map(d =>
        addDoc(collection(db,'organizations',orgId,'notifications'), { userId:d.id, message:msg, read:false, createdAt:serverTimestamp() })
      ));
    } catch(e) { console.error(e); }
  };

  const openAdd    = () => { setForm({...EMPTY, date:new Date().toISOString().slice(0,10)}); setError(''); setModal('add'); };
  const openView   = item => { setForm({ title:item.title, amount:item.amount, date:item.date||'', category:item.category||'', notes:item.notes||'' }); setError(''); setModal(item); };
  const closeModal = useCallback(() => setModal(null), []);

  const handleSave = async e => {
    e.preventDefault(); setError('');
    const amt = Number(form.amount);
    if (!form.title || !amt) { setError('Title and amount are required.'); return; }
    if (!isEdit && amt > available) { setError(`Exceeds available funds`); return; }
    setSubmitting(true);
    try {
      if (!isEdit) {
        await addDoc(collection(db,'organizations',orgId,'expenses'), { ...form, amount:amt, createdAt:serverTimestamp() });
        await notifyAll(`New expense: "${form.title}" ${form.category ? `(${form.category})` : ''}`);
      } else {
        await updateDoc(doc(db,'organizations',orgId,'expenses',modal.id), { title:form.title, amount:amt, date:form.date, category:form.category, notes:form.notes });
      }
      setModal(null);
    } catch(err) { setError(err.message); }
    setSubmitting(false);
  };

  const handleDelete = async id => {
    if (!confirm('Delete this expense?')) return;
    await deleteDoc(doc(db,'organizations',orgId,'expenses',id));
    setModal(null);
  };

  return (
    <div className="page-wrap animate-fade">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {orgData?.logoURL && <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}><img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /></div>}
          <div>
            <div className="page-title">Expenses</div>
            <div className="page-subtitle">Total spent: {totalSpent.toLocaleString()}</div>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary">+ Add Expense</button>
      </div>

      <div className="stats-row">
        {[['Total Fund', totalFund.toLocaleString(), '#0f172a'], ['Total Spent', totalSpent.toLocaleString(), '#dc2626'], ['Available', available.toLocaleString(), available >= 0 ? '#16a34a' : '#dc2626']].map(([l,v,c]) => (
          <div key={l} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value" style={{ color:c }}>{v}</div></div>
        ))}
      </div>

      {items.length === 0
        ? <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>No expenses yet. Click "+ Add Expense" to record one.</div>
        : <div className="table-wrap"><div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th></tr></thead>
              <tbody>{items.map(item => (
                <tr key={item.id} onClick={() => openView(item)}>
                  <td style={{ fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>{item.date||'--'}</td>
                  <td style={{ fontWeight:500 }}>{item.title}</td>
                  <td>{item.category ? <span className="badge badge-gray">{item.category}</span> : '--'}</td>
                  <td style={{ fontWeight:600, color:'#dc2626' }}>{item.amount?.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
      }

      {modal && (
        <Modal title={!isEdit ? 'Add Expense' : 'Edit Expense'} onClose={closeModal}>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="What was this expense for?" required />
            </div>
            <div className="form-group">
              <label className="form-label">
                Amount *
                {!isEdit && <span style={{ fontWeight:400, textTransform:'none', color:'#94a3b8', fontSize:10, marginLeft:6 }}>Available: {available.toLocaleString()}</span>}
              </label>
              <input type="number" min="1" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0" required />
            </div>
            <div className="m-2col">
              <div className="form-group"><label className="form-label">Date</label><input type="date" value={form.date} onChange={e => set('date', e.target.value)} /></div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">Select...</option>
                  {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Notes</label><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional details" style={{ resize:'vertical' }} /></div>
            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              {isEdit && <button type="button" onClick={() => handleDelete(modal.id)} className="btn-danger">Delete</button>}
              <button type="submit" disabled={submitting} className="btn-primary" style={{ flex:1, justifyContent:'center' }}>
                {submitting ? 'Saving...' : !isEdit ? 'Add Expense' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
