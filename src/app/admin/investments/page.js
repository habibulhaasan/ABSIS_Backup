// src/app/admin/investments/page.js
'use client';
import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

const EMPTY = { sector:'', amount:'', investmentDate:'', maturityDate:'', notes:'' };

export default function AdminInvestments() {
  const { userData, orgData } = useAuth();
  const [items, setItems]               = useState([]);
  const [totalFund, setTotalFund]       = useState(0);
  const [totalSpent, setTotalSpent]     = useState(0);
  const [form, setForm]                 = useState(EMPTY);
  const [modal, setModal]               = useState(null);
  const [settleModal, setSettleModal]   = useState(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [settling, setSettling]         = useState(false);
  const [error, setError]               = useState('');
  const orgId = userData?.activeOrgId;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const notifyAll = async (message) => {
    if (!orgId) return;
    try {
      const mSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
      await Promise.all(mSnap.docs.filter(d=>d.data().approved).map(d =>
        addDoc(collection(db, 'organizations', orgId, 'notifications'), {
          userId: d.id, message, read: false, createdAt: serverTimestamp(),
        })
      ));
    } catch(e) { console.error('Notification error:', e); }
  };

  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'deployments'), snap => {
      setItems(snap.docs.map(d => ({ id:d.id, ...d.data() }))
        .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0)));
    });
    const refreshFund = async () => {
      const [inv, exp, dep] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'deployments')),
      ]);
      const fund     = inv.docs.filter(d=>d.data().status==='verified').reduce((s,d)=>s+(d.data().amount||0),0);
      const spent    = exp.docs.reduce((s,d)=>s+(d.data().amount||0),0);
      const deployed = dep.docs.filter(d=>d.data().status!=='matured').reduce((s,d)=>s+(d.data().amount||0),0);
      setTotalFund(fund);
      setTotalSpent(spent + deployed);
    };
    refreshFund();
    return unsub;
  }, [orgId]);

  const available = totalFund - totalSpent;
  const isEdit    = modal && modal !== 'add';

  const openAdd  = () => { setForm(EMPTY); setError(''); setModal('add'); };
  const openView = item => {
    setForm({ sector:item.sector, amount:item.amount, investmentDate:item.investmentDate||'', maturityDate:item.maturityDate||'', notes:item.notes||'' });
    setError('');
    setModal(item);
  };
  const closeModal  = useCallback(() => setModal(null), []);
  const openSettle  = (item) => { setSettleAmount(''); setSettleModal(item); setModal(null); };
  const closeSettle = () => setSettleModal(null);

  const handleSave = async e => {
    e.preventDefault(); setError('');
    const amt = Number(form.amount);
    if (!form.sector || !amt) { setError('Sector and amount are required.'); return; }
    if (!isEdit && amt > available) { setError(`Exceeds available funds (৳${available.toLocaleString()})`); return; }
    setSubmitting(true);
    try {
      if (!isEdit) {
        await addDoc(collection(db,'organizations',orgId,'deployments'), { ...form, amount:amt, status:'active', createdAt:serverTimestamp() });
        await notifyAll(`📊 New project added: "${form.sector}" — ৳${amt.toLocaleString()} deployed.`);
      } else {
        await updateDoc(doc(db,'organizations',orgId,'deployments',modal.id), { sector:form.sector, investmentDate:form.investmentDate, maturityDate:form.maturityDate, notes:form.notes });
      }
      setModal(null);
    } catch(err) { setError(err.message); }
    setSubmitting(false);
  };

  const handleDelete = async id => {
    if (!confirm('Delete this project?')) return;
    await deleteDoc(doc(db,'organizations',orgId,'deployments',id));
    setModal(null);
  };

  const handleSettle = async () => {
    const num = Number(settleAmount);
    if (settleAmount === '' || isNaN(num)) { alert('Please enter a valid amount (negative for loss).'); return; }
    setSettling(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'deployments',settleModal.id), {
        status:'matured', profitGenerated:num, settledAt:serverTimestamp(),
      });
      const resultText = num >= 0 ? `Profit: ৳${num.toLocaleString()}` : `Loss: ৳${Math.abs(num).toLocaleString()}`;
      await notifyAll(`🏁 Project "${settleModal.sector}" has been settled. ${resultText}`);
      setSettleModal(null);
    } catch(e) { alert(e.message); }
    setSettling(false);
  };

  const statusBadge = s => s==='matured'?'badge-green':s==='active'?'badge-blue':'badge-gray';

  return (
    <div className="page-wrap animate-fade">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {orgData?.logoURL && (
            <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
              <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
            </div>
          )}
          <div>
            <div className="page-title">Projects</div>
            <div className="page-subtitle">{items.length} total · {items.filter(i=>i.status==='active').length} active</div>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary">+ Add Project</button>
      </div>

      <div className="stats-row">
        {[
          ['Total Fund', `৳${totalFund.toLocaleString()}`, '#0f172a'],
          ['Deployed',   `৳${totalSpent.toLocaleString()}`, '#d97706'],
          ['Available',  `৳${available.toLocaleString()}`, available >= 0 ? '#16a34a' : '#dc2626'],
        ].map(([l,v,c]) => (
          <div key={l} className="stat-card">
            <div className="stat-label">{l}</div>
            <div className="stat-value" style={{ color:c }}>{v}</div>
          </div>
        ))}
      </div>

      {items.length === 0
        ? <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>No projects yet. Click "+ Add Project" to get started.</div>
        : <div className="table-wrap"><div className="table-scroll">
            <table>
              <thead>
                <tr><th>Sector</th><th>Amount</th><th>Start</th><th>Maturity</th><th>Status</th><th>P/L</th></tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} onClick={() => openView(item)}>
                    <td style={{ fontWeight:600 }}>{item.sector}</td>
                    <td style={{ fontWeight:600, color:'#2563eb' }}>৳{item.amount?.toLocaleString()}</td>
                    <td style={{ fontSize:12, color:'#64748b' }}>{item.investmentDate||'—'}</td>
                    <td style={{ fontSize:12, color:'#64748b' }}>{item.maturityDate||'—'}</td>
                    <td><span className={`badge ${statusBadge(item.status)}`}>{item.status}</span></td>
                    <td>
                      {item.status === 'matured'
                        ? <span style={{ fontWeight:600, color: item.profitGenerated>=0?'#16a34a':'#dc2626' }}>
                            {item.profitGenerated>=0?'+':''}৳{item.profitGenerated?.toLocaleString()}
                          </span>
                        : <span style={{ color:'#94a3b8' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
      }

      {modal && (
        <Modal title={!isEdit ? 'Add Project' : form.sector} onClose={closeModal}>
          {error && <div className="alert alert-error">{error}</div>}
          {isEdit && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
              <span className={`badge ${statusBadge(modal.status)}`}>{modal.status}</span>
              {modal.status === 'matured' && (
                <span style={{ fontSize:12, fontWeight:600, color: modal.profitGenerated>=0?'#16a34a':'#dc2626' }}>
                  {modal.profitGenerated>=0?'Profit':'Loss'}: ৳{Math.abs(modal.profitGenerated||0).toLocaleString()}
                </span>
              )}
            </div>
          )}
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Sector / Project Name *</label>
              <input value={form.sector} onChange={e=>set('sector',e.target.value)} placeholder="e.g. Real Estate" required />
            </div>
            {!isEdit
              ? <div className="form-group">
                  <label className="form-label">Amount * <span style={{ fontWeight:400, textTransform:'none', color:'#94a3b8', fontSize:10 }}>Available: ৳{available.toLocaleString()}</span></label>
                  <input type="number" min="1" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0" required />
                </div>
              : <div className="form-group">
                  <label className="form-label">Amount (locked)</label>
                  <input value={`৳${modal.amount?.toLocaleString()}`} disabled style={{ opacity:.6 }} />
                </div>
            }
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input type="date" value={form.investmentDate} onChange={e=>set('investmentDate',e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Maturity Date</label>
                <input type="date" value={form.maturityDate} onChange={e=>set('maturityDate',e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional" style={{ resize:'vertical' }} />
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:4 }}>
              {isEdit && modal.status !== 'matured' && (
                <button type="button" onClick={() => openSettle(modal)}
                  style={{ padding:'10px 16px', borderRadius:8, border:'none', background:'#dcfce7', color:'#15803d', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                  Settle
                </button>
              )}
              {isEdit && <button type="button" onClick={() => handleDelete(modal.id)} className="btn-danger">Delete</button>}
              <button type="submit" disabled={submitting} className="btn-primary" style={{ flex:1, justifyContent:'center' }}>
                {submitting ? 'Saving…' : !isEdit ? 'Add Project' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {settleModal && (
        <Modal title={`Settle: ${settleModal.sector}`} onClose={closeSettle}>
          <div className="alert alert-info" style={{ marginBottom:16 }}>
            Deployed amount: <strong>৳{settleModal.amount?.toLocaleString()}</strong>. Enter the total amount returned (use negative for a loss).
          </div>
          <div className="form-group">
            <label className="form-label">Return Amount *</label>
            <input
              type="number"
              value={settleAmount}
              onChange={e => setSettleAmount(e.target.value)}
              placeholder="e.g. 55000 or -5000 for loss"
              autoFocus
            />
            {settleAmount !== '' && !isNaN(Number(settleAmount)) && (
              <div style={{ marginTop:8, fontSize:13, fontWeight:600, color: Number(settleAmount) >= settleModal.amount ? '#16a34a' : '#dc2626' }}>
                {Number(settleAmount) >= 0
                  ? `Profit: ৳${(Number(settleAmount) - settleModal.amount).toLocaleString()}`
                  : `Loss: ৳${Math.abs(Number(settleAmount)).toLocaleString()}`}
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={closeSettle} className="btn-ghost" style={{ flex:1, justifyContent:'center' }}>Cancel</button>
            <button onClick={handleSettle} disabled={settling || settleAmount === ''} className="btn-primary" style={{ flex:2, justifyContent:'center' }}>
              {settling ? 'Settling…' : 'Confirm Settlement'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
