// src/app/admin/expenses/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp, getDocs
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

const CATEGORIES = ['Office','Meeting','Travel','Utilities','Maintenance','Marketing','Legal','Other'];
const EMPTY_FORM  = { title:'', amount:'', category:'Office', date:new Date().toISOString().split('T')[0], notes:'' };

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

export default function AdminExpenses() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [expenses,       setExpenses]       = useState([]);
  const [totalCapital,   setTotalCapital]   = useState(0);
  const [totalFeeIncome, setTotalFeeIncome] = useState(0);
  const [loading,        setLoading]        = useState(true);
  const [showAdd,        setShowAdd]        = useState(false);
  const [editTarget,     setEditTarget]     = useState(null); // expense obj being edited
  const [saving,         setSaving]         = useState(false);
  const [toast,          setToast]          = useState('');
  const [search,         setSearch]         = useState('');
  const [catFilter,      setCatFilter]      = useState('all');
  const [form,           setForm]           = useState(EMPTY_FORM);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [paySnap, feeSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'entryFees')),
      ]);
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const cap = paySnap.docs.map(d=>d.data()).filter(p=>p.status==='verified')
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
      setTotalCapital(cap);

      const adminFees = feeSnap.docs.reduce((s,d)=>s+(d.data().amount||0), 0);
      const invFees   = paySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified' &&
          (p.paymentType==='entry_fee'||p.paymentType==='reregistration_fee') &&
          p.isContribution === false)
        .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0), 0);
      setTotalFeeIncome(adminFees + invFees);
    })();

    const unsubExp = onSnapshot(
      query(collection(db,'organizations',orgId,'expenses'),orderBy('createdAt','desc')),
      snap => { setExpenses(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
    return unsubExp;
  }, [orgId]);

  const fb          = orgData?.settings?.fundBudgets?.expenses;
  const capAlloc    = fb?.value
    ? (fb.type==='amount'
        ? Number(fb.value)||0
        : Math.min(
            Math.round(totalCapital*(Number(fb.value)||0)/100),
            fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity
          ))
    : 0;
  const expenseBudget = capAlloc + totalFeeIncome;
  const totalUsed     = expenses.reduce((s,e)=>s+(e.amount||0), 0);
  const fundBalance   = expenseBudget > 0 ? expenseBudget - totalUsed : null;
  const overBudget    = fundBalance !== null && fundBalance < 0;
  const newAmount     = Number(form.amount)||0;
  // When editing, exclude the original amount so preview stays accurate
  const baseBalance   = editTarget ? (fundBalance !== null ? fundBalance + (editTarget.amount||0) : null) : fundBalance;
  const afterAdd      = baseBalance !== null ? baseBalance - newAmount : null;

  // ── CREATE ────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    if (!form.amount || Number(form.amount)<=0) return alert('Enter a valid amount.');
    if (!form.date) return alert('Date is required.');
    setSaving(true);
    try {
      await addDoc(collection(db,'organizations',orgId,'expenses'), {
        title:form.title, amount:Number(form.amount), category:form.category,
        date:form.date, notes:form.notes,
        recordedBy:user.uid, createdAt:serverTimestamp(),
      });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      showToast('✅ Expense recorded!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  // ── OPEN EDIT MODAL ───────────────────────────────────────────────────────
  const openEdit = (expense) => {
    setEditTarget(expense);
    setForm({
      title:    expense.title    || '',
      amount:   expense.amount   || '',
      category: expense.category || 'Office',
      date:     expense.date     || new Date().toISOString().split('T')[0],
      notes:    expense.notes    || '',
    });
  };

  const closeEdit = () => { setEditTarget(null); setForm(EMPTY_FORM); };

  // ── UPDATE ────────────────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    if (!form.amount || Number(form.amount)<=0) return alert('Enter a valid amount.');
    if (!form.date) return alert('Date is required.');
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'expenses',editTarget.id), {
        title:    form.title,
        amount:   Number(form.amount),
        category: form.category,
        date:     form.date,
        notes:    form.notes,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      closeEdit();
      showToast('✅ Expense updated!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  // ── DELETE ────────────────────────────────────────────────────────────────
  const handleDelete = async (e) => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    try { await deleteDoc(doc(db,'organizations',orgId,'expenses',e.id)); showToast('Deleted.'); }
    catch(err) { showToast('Error: '+err.message); }
  };

  if (!isOrgAdmin) return null;

  const filtered = expenses
    .filter(e => catFilter==='all' || e.category===catFilter)
    .filter(e => !search || e.title?.toLowerCase().includes(search.toLowerCase()));

  const usedPct = expenseBudget > 0 ? Math.min(100, (totalUsed/expenseBudget)*100) : 0;

  // ── SHARED FORM FIELDS ────────────────────────────────────────────────────
  const FormFields = () => (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {expenseBudget > 0 && (
        <div style={{padding:'10px 14px',borderRadius:8,
          background:afterAdd!==null&&afterAdd<0?'#fef2f2':'#f0fdf4',
          border:`1px solid ${afterAdd!==null&&afterAdd<0?'#fca5a5':'#86efac'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}>
            <span style={{color:'#64748b'}}>Expenses Fund remaining:</span>
            <span style={{fontWeight:700,color:afterAdd!==null&&afterAdd<0?'#dc2626':'#15803d'}}>
              {fmt(baseBalance)}
            </span>
          </div>
          {newAmount > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginTop:4}}>
              <span style={{color:'#64748b'}}>After this expense:</span>
              <span style={{fontWeight:700,color:afterAdd!==null&&afterAdd<0?'#dc2626':'#15803d'}}>
                {afterAdd!==null ? fmt(afterAdd) : '—'}
                {afterAdd!==null && afterAdd<0 && ' ⚠️ Over budget'}
              </span>
            </div>
          )}
        </div>
      )}
      <div>
        <label className="form-label">Title *</label>
        <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Office supplies"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div>
          <label className="form-label">Amount (৳) *</label>
          <input type="number" min="0" value={form.amount}
            onChange={e=>set('amount',e.target.value)} placeholder="0"/>
        </div>
        <div>
          <label className="form-label">Date *</label>
          <input type="date" value={form.date} onChange={e=>set('date',e.target.value)}/>
        </div>
        <div>
          <label className="form-label">Category</label>
          <select value={form.category} onChange={e=>set('category',e.target.value)}>
            {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Notes</label>
          <input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional"/>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Expenses</div>
            <div className="page-subtitle">Record and track organization expenses against the Expenses Fund budget.</div>
          </div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 20px',flexShrink:0}}>
            + Add Expense
          </button>
        </div>
      </div>

      {toast && (
        <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,
          background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',
          color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>{toast}</div>
      )}

      {/* Fund balance banner */}
      {expenseBudget > 0 && (
        <div style={{padding:'14px 16px',borderRadius:12,marginBottom:20,
          background:overBudget?'#fef2f2':'#f0fdf4',
          border:`1.5px solid ${overBudget?'#fca5a5':'#86efac'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>🧾 Expenses Fund</div>
              <div style={{fontSize:11,color:'#92400e',marginTop:2}}>
                {capAlloc>0 && <span>{fb?.value}{fb?.type==='pct'?'% of capital':' fixed'}: {fmt(capAlloc)}</span>}
                {capAlloc>0 && totalFeeIncome>0 && <span> + </span>}
                {totalFeeIncome>0 && <span>Fees: {fmt(totalFeeIncome)}</span>}
              </div>
            </div>
            <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'#64748b'}}>Budget</div>
                <div style={{fontWeight:700,color:'#d97706'}}>{fmt(expenseBudget)}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'#64748b'}}>Used</div>
                <div style={{fontWeight:700,color:'#dc2626'}}>{fmt(totalUsed)}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:11,color:'#64748b'}}>Remaining</div>
                <div style={{fontWeight:700,fontSize:15,color:overBudget?'#dc2626':'#15803d'}}>
                  {fmt(fundBalance)}
                </div>
              </div>
            </div>
          </div>
          <div style={{height:8,borderRadius:99,background:'#e2e8f0',overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:99,
              background:overBudget?'#dc2626':'#16a34a',
              width:`${usedPct}%`,transition:'width 0.5s'}}/>
          </div>
          {overBudget && (
            <div style={{marginTop:6,fontSize:12,color:'#b91c1c',fontWeight:600}}>
              ⚠️ Expenses exceed the budget by {fmt(Math.abs(fundBalance))}. Consider reviewing your Expenses Fund budget in Settings.
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Expenses" value={fmt(totalUsed)} color="#dc2626" bg="#fef2f2"/>
        <Stat label="This Month"
          value={fmt(expenses.filter(e=>{
            const d = e.createdAt?.seconds ? new Date(e.createdAt.seconds*1000) : new Date();
            const now = new Date();
            return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
          }).reduce((s,e)=>s+(e.amount||0),0))}
          bg="#f8fafc"/>
        <Stat label="Entries" value={expenses.length} bg="#f8fafc"/>
        {expenseBudget>0 && (
          <Stat label="Fund Remaining"
            value={fmt(fundBalance)}
            color={overBudget?'#dc2626':'#15803d'}
            bg={overBudget?'#fef2f2':'#f0fdf4'}/>
        )}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search expenses…"
          style={{flex:1,minWidth:180,padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
          style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,color:'#475569'}}>
          <option value="all">All Categories</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No expenses yet</div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 24px',marginTop:8}}>
            + Add Expense
          </button>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr auto',
            padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Date','Description','Category','Amount',''].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',
                textAlign:h==='Amount'?'right':'left'}}>{h}</div>
            ))}
          </div>
          {filtered.map((e,i)=>(
            <div key={e.id} style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr auto',
              padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',
              borderBottom:'1px solid #f1f5f9',alignItems:'center'}}>
              <div style={{fontSize:12,color:'#475569'}}>{e.date||tsDate(e.createdAt)}</div>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{e.title}</div>
                {e.notes && <div style={{fontSize:11,color:'#94a3b8'}}>{e.notes}</div>}
              </div>
              <div><span style={{padding:'2px 8px',borderRadius:5,background:'#fef3c7',
                color:'#92400e',fontSize:11,fontWeight:600}}>{e.category}</span></div>
              <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>{fmt(e.amount)}</div>
              {/* ── Edit + Delete buttons ── */}
              <div style={{display:'flex',gap:4}}>
                <button onClick={()=>openEdit(e)}
                  title="Edit"
                  style={{background:'none',border:'none',cursor:'pointer',
                    color:'#64748b',fontSize:13,padding:'4px 8px'}}>✏️</button>
                <button onClick={()=>handleDelete(e)}
                  title="Delete"
                  style={{background:'none',border:'none',cursor:'pointer',
                    color:'#94a3b8',fontSize:13,padding:'4px 8px'}}>✕</button>
              </div>
            </div>
          ))}
          {/* Total row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 2fr 1fr 1fr auto',
            padding:'10px 16px',background:'#fef2f2',borderTop:'2px solid #fca5a5'}}>
            <div style={{fontWeight:700,fontSize:13,gridColumn:'1/4'}}>Total</div>
            <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>
              {fmt(filtered.reduce((s,e)=>s+(e.amount||0),0))}
            </div>
            <div/>
          </div>
        </div>
      )}

      {/* ── ADD MODAL ── */}
      {showAdd && (
        <Modal title="Add Expense" onClose={()=>{ setShowAdd(false); setForm(EMPTY_FORM); }}>
          <FormFields/>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleAdd} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'Record Expense'}
            </button>
            <button onClick={()=>{ setShowAdd(false); setForm(EMPTY_FORM); }}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── EDIT MODAL ── */}
      {editTarget && (
        <Modal title="Edit Expense" onClose={closeEdit}>
          <FormFields/>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleUpdate} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'Save Changes'}
            </button>
            <button onClick={closeEdit}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}