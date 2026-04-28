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

// Convert ISO date string "2026-04-22" → "22 Apr 2026"
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

const CATEGORIES = ['Office','Meeting','Travel','Utilities','Maintenance','Marketing','Legal','Other'];
const EMPTY_FORM  = { title:'', amount:'', category:'Office', date:new Date().toISOString().split('T')[0], notes:'' };

// ── Date range helpers ────────────────────────────────────────────────────────
function getDateRange(preset, custom) {
  if (preset === 'all')    return { from:'', to:'' };
  if (preset === 'custom') return custom;

  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = v => String(v).padStart(2,'0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = iso(now);

  if (preset === 'this_month')  return { from:`${y}-${pad(m+1)}-01`, to: today };
  if (preset === 'last_month') {
    const fm = new Date(y, m-1, 1);
    const lm = new Date(y, m,   0);
    return { from: iso(fm), to: iso(lm) };
  }
  if (preset === '3m') return { from: iso(new Date(y, m-3, now.getDate())), to: today };
  if (preset === '6m') return { from: iso(new Date(y, m-6, now.getDate())), to: today };
  if (preset === 'this_year')  return { from:`${y}-01-01`, to: today };
  if (preset === 'last_year')  return { from:`${y-1}-01-01`, to:`${y-1}-12-31` };
  return { from:'', to:'' };
}

function inRange(expense, from, to) {
  if (!from && !to) return true;
  const d = expense.date ||
    (expense.createdAt?.seconds ? new Date(expense.createdAt.seconds*1000).toISOString().split('T')[0] : '');
  if (!d) return true;
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}

function fmtLabel(preset, custom) {
  const labels = {
    all:'All Time', this_month:'This Month', last_month:'Last Month',
    '3m':'Last 3 Months', '6m':'Last 6 Months',
    this_year:'This Year', last_year:'Last Year', custom:'Custom Range'
  };
  if (preset === 'custom' && custom.from && custom.to)
    return `${fmtDate(custom.from)} → ${fmtDate(custom.to)}`;
  return labels[preset] || 'All Time';
}

function Stat({label,value,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
    </div>
  );
}

function ExpenseForm({ form, set, expenseBudget, baseBalance, afterAdd, newAmount }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {expenseBudget > 0 && (
        <div style={{padding:'10px 14px',borderRadius:8,
          background:afterAdd!==null&&afterAdd<0?'#fef2f2':'#f0fdf4',
          border:`1px solid ${afterAdd!==null&&afterAdd<0?'#fca5a5':'#86efac'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:13}}>
            <span style={{color:'#64748b'}}>Expenses Fund remaining:</span>
            <span style={{fontWeight:700,color:afterAdd!==null&&afterAdd<0?'#dc2626':'#15803d'}}>{fmt(baseBalance)}</span>
          </div>
          {newAmount > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginTop:4}}>
              <span style={{color:'#64748b'}}>After this expense:</span>
              <span style={{fontWeight:700,color:afterAdd!==null&&afterAdd<0?'#dc2626':'#15803d'}}>
                {afterAdd!==null?fmt(afterAdd):'—'}{afterAdd!==null&&afterAdd<0?' ⚠️ Over budget':''}
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
          <input type="number" min="0" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0"/>
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
}

export default function AdminExpenses() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [expenses,       setExpenses]       = useState([]);
  const [totalCapital,   setTotalCapital]   = useState(0);
  const [totalFeeIncome, setTotalFeeIncome] = useState(0);
  const [loading,        setLoading]        = useState(true);
  const [showAdd,        setShowAdd]        = useState(false);
  const [viewTarget,     setViewTarget]     = useState(null);
  const [editTarget,     setEditTarget]     = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [toast,          setToast]          = useState('');
  const [search,         setSearch]         = useState('');
  const [catFilter,      setCatFilter]      = useState('all');
  const [datePreset,     setDatePreset]     = useState('all');
  const [customRange,    setCustomRange]    = useState({ from:'', to:'' });
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
      const adminFees = feeSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);
      const invFees   = paySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified'&&
          (p.paymentType==='entry_fee'||p.paymentType==='reregistration_fee')&&
          p.isContribution===false)
        .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
      setTotalFeeIncome(adminFees+invFees);
    })();
    const unsubExp = onSnapshot(
      query(collection(db,'organizations',orgId,'expenses'),orderBy('createdAt','desc')),
      snap => { setExpenses(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
    return unsubExp;
  }, [orgId]);

  const fb       = orgData?.settings?.fundBudgets?.expenses;
  const capAlloc = fb?.value
    ? (fb.type==='amount'
        ? Number(fb.value)||0
        : Math.min(Math.round(totalCapital*(Number(fb.value)||0)/100),
            fb.maxAmount&&Number(fb.maxAmount)>0?Number(fb.maxAmount):Infinity))
    : 0;
  const expenseBudget = capAlloc + totalFeeIncome;
  const totalUsed     = expenses.reduce((s,e)=>s+(e.amount||0),0);
  const fundBalance   = expenseBudget > 0 ? expenseBudget - totalUsed : null;
  const overBudget    = fundBalance !== null && fundBalance < 0;
  const newAmount     = Number(form.amount)||0;
  const baseBalance   = editTarget ? (fundBalance!==null?fundBalance+(editTarget.amount||0):null) : fundBalance;
  const afterAdd      = baseBalance !== null ? baseBalance - newAmount : null;

  const { from: drFrom, to: drTo } = getDateRange(datePreset, customRange);
  const filtered = expenses
    .filter(e => catFilter==='all' || e.category===catFilter)
    .filter(e => !search || e.title?.toLowerCase().includes(search.toLowerCase()))
    .filter(e => inRange(e, drFrom, drTo));
  const filteredTotal = filtered.reduce((s,e)=>s+(e.amount||0),0);
  const usedPct = expenseBudget > 0 ? Math.min(100,(totalUsed/expenseBudget)*100) : 0;

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    if (!form.amount||Number(form.amount)<=0) return alert('Enter a valid amount.');
    if (!form.date) return alert('Date is required.');
    setSaving(true);
    try {
      await addDoc(collection(db,'organizations',orgId,'expenses'),{
        title:form.title, amount:Number(form.amount), category:form.category,
        date:form.date, notes:form.notes, recordedBy:user.uid, createdAt:serverTimestamp(),
      });
      setShowAdd(false); setForm(EMPTY_FORM); showToast('✅ Expense recorded!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const openView  = e => setViewTarget(e);
  const closeView = () => { setViewTarget(null); setEditTarget(null); setForm(EMPTY_FORM); };
  const startEdit = e => {
    setEditTarget(e);
    setForm({title:e.title||'',amount:e.amount||'',category:e.category||'Office',
      date:e.date||new Date().toISOString().split('T')[0],notes:e.notes||''});
  };

  const handleUpdate = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    if (!form.amount||Number(form.amount)<=0) return alert('Enter a valid amount.');
    if (!form.date) return alert('Date is required.');
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'expenses',editTarget.id),{
        title:form.title, amount:Number(form.amount), category:form.category,
        date:form.date, notes:form.notes, updatedBy:user.uid, updatedAt:serverTimestamp(),
      });
      closeView(); showToast('✅ Expense updated!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleDelete = async (e, fromModal=false) => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    try {
      await deleteDoc(doc(db,'organizations',orgId,'expenses',e.id));
      if (fromModal) closeView();
      showToast('Deleted.');
    } catch(err) { showToast('Error: '+err.message); }
  };

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const org        = orgData || {};
    const label      = fmtLabel(datePreset, customRange);
    const reportDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const header = ['Date','Title','Category','Amount (৳)','Notes'];
    const rows   = filtered.map(e => [
      fmtDate(e.date)||tsDate(e.createdAt),
      `"${(e.title||'').replace(/"/g,'""')}"`,
      e.category, e.amount,
      `"${(e.notes||'').replace(/"/g,'""')}"`
    ]);
    const meta = [
      [`"${org.name_en||'Organization'}"`],
      [`"Expenses Report — ${label}"`],
      [`"Period: ${drFrom?fmtDate(drFrom):'—'} to ${drTo?fmtDate(drTo):'—'}"`],
      [`"Generated: ${reportDate}"`],
      [],
      header,
      ...rows,
      [],
      ['','','Total', filteredTotal, ''],
    ];
    const csv  = meta.map(r=>r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'),
      {href:url, download:`expenses_${label.replace(/[\s→]+/g,'_')}.csv`});
    a.click(); URL.revokeObjectURL(url);
  };

  // ── PDF / Print ────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const org        = orgData || {};
    const label      = fmtLabel(datePreset, customRange);
    const reportDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

    const rows = filtered.map((e,i) => `
      <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
        <td>${fmtDate(e.date)||tsDate(e.createdAt)}</td>
        <td>
          <strong>${e.title||''}</strong>
          ${e.notes?`<br/><small style="color:#64748b">${e.notes}</small>`:''}
        </td>
        <td><span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;
          font-size:11px;font-weight:600">${e.category||''}</span></td>
        <td style="text-align:right;font-weight:600;color:#dc2626">
          ৳${(e.amount||0).toLocaleString()}
        </td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <title>Expenses Report — ${label}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#0f172a;padding:32px 40px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        th{background:#f1f5f9;font-size:11px;font-weight:700;color:#475569;
           text-transform:uppercase;letter-spacing:.06em;padding:8px 10px;
           border-bottom:2px solid #e2e8f0;text-align:left}
        td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
        td:last-child,th:last-child{text-align:right}
        .tfoot td{background:#fef2f2;font-weight:700;border-top:2px solid #fca5a5}
        @media print{body{padding:20px 28px}}
      </style></head><body>

      <div style="border-bottom:2.5px solid #000;padding-bottom:14px;margin-bottom:18px;
        display:flex;align-items:flex-start;gap:16px">
        ${org.logoURL?`<img src="${org.logoURL}" alt="Logo"
          style="width:75px;height:75px;object-fit:contain;mix-blend-mode:multiply;filter:contrast(1.1)"/>`:''}
        <div style="flex:1">
          <div style="font-size:20px;font-weight:900;color:#000;line-height:1.2">
            ${org.name_bn||'Organization'}<br/>
            <span style="font-size:12px;color:#64748b">${org.name_en||''}</span>
          </div>
          ${org.slogan?`<div style="font-size:12px;color:#444;font-style:italic;margin-top:3px">${org.slogan}</div>`:''}
          <div style="margin-top:5px;font-size:10.5px;color:#333;display:flex;flex-wrap:wrap;gap:3px 14px">
            ${org.email  ?`<span>✉ ${org.email}</span>`  :''}
            ${org.phone  ?`<span>☎ ${org.phone}</span>`  :''}
            ${org.website?`<span>🌐 ${org.website}</span>`:''}
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px">
        <div>
          <div style="font-size:16px;font-weight:800">Expenses Report</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">
            Period: <strong>${label}</strong>
            ${drFrom||drTo?` &nbsp;|&nbsp; ${drFrom?fmtDate(drFrom):'—'} to ${drTo?fmtDate(drTo):'—'}`:''}
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:#64748b">
          <div>Generated: <strong>${reportDate}</strong></div>
          <div>Total entries: <strong>${filtered.length}</strong></div>
        </div>
      </div>

      ${expenseBudget>0?`
        <div style="display:flex;gap:24px;background:#f8fafc;border-radius:8px;
          padding:10px 14px;margin-bottom:8px;font-size:11px">
          <span>Budget: <strong>৳${expenseBudget.toLocaleString()}</strong></span>
          <span>Total Used: <strong style="color:#dc2626">৳${totalUsed.toLocaleString()}</strong></span>
          <span>Remaining: <strong style="color:${overBudget?'#dc2626':'#15803d'}">
            ৳${(fundBalance||0).toLocaleString()}</strong></span>
        </div>`:''}

      <table>
        <thead>
          <tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="tfoot">
            <td colspan="3">Total (${filtered.length} entries)</td>
            <td>৳${filteredTotal.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <script>
        window.addEventListener('load', function() {
          setTimeout(function() { window.print(); }, 250);
        });
      <\/script>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const w    = window.open(url, '_blank');
    if (!w) {
      const a = Object.assign(document.createElement('a'), { href: url, target: '_blank' });
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  if (!isOrgAdmin) return null;

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
                {capAlloc>0&&<span>{fb?.value}{fb?.type==='pct'?'% of capital':' fixed'}: {fmt(capAlloc)}</span>}
                {capAlloc>0&&totalFeeIncome>0&&<span> + </span>}
                {totalFeeIncome>0&&<span>Fees: {fmt(totalFeeIncome)}</span>}
              </div>
            </div>
            <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
              <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#64748b'}}>Budget</div><div style={{fontWeight:700,color:'#d97706'}}>{fmt(expenseBudget)}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#64748b'}}>Used</div><div style={{fontWeight:700,color:'#dc2626'}}>{fmt(totalUsed)}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#64748b'}}>Remaining</div>
                <div style={{fontWeight:700,fontSize:15,color:overBudget?'#dc2626':'#15803d'}}>{fmt(fundBalance)}</div>
              </div>
            </div>
          </div>
          <div style={{height:8,borderRadius:99,background:'#e2e8f0',overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:99,background:overBudget?'#dc2626':'#16a34a',width:`${usedPct}%`,transition:'width 0.5s'}}/>
          </div>
          {overBudget&&<div style={{marginTop:6,fontSize:12,color:'#b91c1c',fontWeight:600}}>⚠️ Expenses exceed the budget by {fmt(Math.abs(fundBalance))}.</div>}
        </div>
      )}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Expenses" value={fmt(totalUsed)} color="#dc2626" bg="#fef2f2"/>
        <Stat label="This Month"
          value={fmt(expenses.filter(e=>{
            const d=e.createdAt?.seconds?new Date(e.createdAt.seconds*1000):new Date();
            const n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();
          }).reduce((s,e)=>s+(e.amount||0),0))} bg="#f8fafc"/>
        <Stat label="Entries" value={expenses.length} bg="#f8fafc"/>
        {expenseBudget>0&&<Stat label="Fund Remaining" value={fmt(fundBalance)}
          color={overBudget?'#dc2626':'#15803d'} bg={overBudget?'#fef2f2':'#f0fdf4'}/>}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:10,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search expenses…"
          style={{flex:1,minWidth:160,padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
          style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,color:'#475569'}}>
          <option value="all">All Categories</option>
          {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select value={datePreset} onChange={e=>setDatePreset(e.target.value)}
          style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,color:'#475569'}}>
          <option value="all">All Time</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="3m">Last 3 Months</option>
          <option value="6m">Last 6 Months</option>
          <option value="this_year">This Year</option>
          <option value="last_year">Last Year</option>
          <option value="custom">Custom Range…</option>
        </select>
      </div>

      {/* Custom range */}
      {datePreset==='custom' && (
        <div style={{display:'flex',gap:10,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:12,color:'#64748b',fontWeight:600}}>From</span>
          <input type="date" value={customRange.from}
            onChange={e=>setCustomRange(p=>({...p,from:e.target.value}))}
            style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
          <span style={{fontSize:12,color:'#64748b',fontWeight:600}}>To</span>
          <input type="date" value={customRange.to}
            onChange={e=>setCustomRange(p=>({...p,to:e.target.value}))}
            style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
        </div>
      )}

      {/* Filter badge + export */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {datePreset!=='all' && (
            <span style={{background:'#eff6ff',color:'#2563eb',padding:'3px 10px',borderRadius:99,fontWeight:600,fontSize:11}}>
              📅 {fmtLabel(datePreset,customRange)}
            </span>
          )}
          <span style={{color:'#94a3b8',fontSize:12}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={exportCSV}
            style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',
              cursor:'pointer',fontSize:12,fontWeight:600,color:'#059669'}}>⬇ CSV</button>
          <button onClick={exportPDF}
            style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',
              cursor:'pointer',fontSize:12,fontWeight:600,color:'#2563eb'}}>🖨 PDF / Print</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No expenses found</div>
          <div style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>Try adjusting filters or date range</div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 24px'}}>+ Add Expense</button>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>

          {/* Column headers */}
          <div style={{display:'grid',// WITH:
gridTemplateColumns:'110px 1fr 110px 100px 36px',
            padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Date','Description','Category','Amount',''].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',
                letterSpacing:'0.06em',textAlign:h==='Amount'?'right':'left'}}>{h}</div>
            ))}
          </div>

          {filtered.map((e,i)=>(
            <div
              key={e.id}
              onClick={()=>openView(e)}
              style={{
                display:'grid',
                gridTemplateColumns:'110px 1fr 90px 90px 36px',
                padding:'10px 16px',
                background:i%2===0?'#fff':'#fafafa',
                borderBottom:'1px solid #f1f5f9',
                alignItems:'center',
                cursor:'pointer',
                transition:'background 0.12s',
              }}
              onMouseEnter={ev=>ev.currentTarget.style.background='#f1f5f9'}
              onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}
            >
              <div style={{fontSize:12,color:'#475569'}}>{fmtDate(e.date)||tsDate(e.createdAt)}</div>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{e.title}</div>
                {e.notes&&<div style={{fontSize:11,color:'#94a3b8'}}>{e.notes}</div>}
              </div>
              <div>
                
<span style={{padding:'2px 8px',borderRadius:5,background:'#fef3c7',
  color:'#92400e',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}}>{e.category}</span>

              </div>
              <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>{fmt(e.amount)}</div>

              {/* Desktop-only delete X — stopPropagation prevents opening the view modal */}
              <div style={{display:'flex',justifyContent:'center'}}>
                <button
                  onClick={ev=>{ ev.stopPropagation(); handleDelete(e); }}
                  title="Delete"
                  style={{background:'none',border:'none',cursor:'pointer',color:'#cbd5e1',
                    fontSize:14,padding:'4px 6px',borderRadius:4,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={ev=>ev.currentTarget.style.color='#dc2626'}
                  onMouseLeave={ev=>ev.currentTarget.style.color='#cbd5e1'}
                >✕</button>
              </div>
            </div>
          ))}

          {/* Footer total */}
          <div style={{display:'grid',gridTemplateColumns:'110px 1fr 90px 90px 36px',
            padding:'10px 16px',background:'#fef2f2',borderTop:'2px solid #fca5a5'}}>
            <div style={{fontWeight:700,fontSize:13,gridColumn:'1/5'}}>Total ({filtered.length} entries)</div>
            <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>{fmt(filteredTotal)}</div>
            <div/>
          </div>
        </div>
      )}

      {/* ADD modal */}
      {showAdd && (
        <Modal title="Add Expense" onClose={()=>{setShowAdd(false);setForm(EMPTY_FORM);}}>
          <ExpenseForm form={form} set={set} expenseBudget={expenseBudget}
            baseBalance={fundBalance}
            afterAdd={fundBalance!==null?fundBalance-newAmount:null}
            newAmount={newAmount}/>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleAdd} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'Record Expense'}
            </button>
            <button onClick={()=>{setShowAdd(false);setForm(EMPTY_FORM);}}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* VIEW / EDIT modal — triggered by clicking a row */}
      {viewTarget && (
        <Modal
          title={editTarget ? 'Edit Expense' : 'Expense Details'}
          onClose={closeView}
        >
          {editTarget ? (
            <>
              <ExpenseForm form={form} set={set} expenseBudget={expenseBudget}
                baseBalance={baseBalance} afterAdd={afterAdd} newAmount={newAmount}/>
              <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
                <button onClick={handleUpdate} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>
                  {saving?'Saving…':'Save Changes'}
                </button>
                <button
                  onClick={()=>{ setEditTarget(null); setForm(EMPTY_FORM); }}
                  style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                    background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              // FIND and REPLACE the entire {/* Detail view */} section (the non-editTarget branch):
{/* Detail view */}
<div style={{display:'flex',flexDirection:'column',gap:14}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
    <span style={{padding:'3px 10px',borderRadius:6,background:'#fef3c7',
      color:'#92400e',fontSize:12,fontWeight:600}}>{viewTarget.category}</span>
    <span style={{fontSize:12,color:'#94a3b8'}}>
      {fmtDate(viewTarget.date)||tsDate(viewTarget.createdAt)}
    </span>
  </div>
  <div style={{fontSize:18,fontWeight:700,color:'#0f172a',lineHeight:1.3}}>{viewTarget.title}</div>
  <div style={{
    background:'#fef2f2',borderRadius:10,
    padding:'12px 16px',display:'inline-block',
  }}>
    <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:3}}>Amount</div>
    <div style={{fontSize:26,fontWeight:800,color:'#dc2626',lineHeight:1}}>{fmt(viewTarget.amount)}</div>
  </div>
  {viewTarget.notes && (
    <div style={{background:'#f8fafc',borderRadius:10,padding:'12px 14px'}}>
      <div style={{fontSize:10,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:5}}>Notes</div>
      <div style={{fontSize:13,color:'#475569',lineHeight:1.6}}>{viewTarget.notes}</div>
    </div>
  )}
</div>

              <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0',flexWrap:'wrap'}}>
                <button onClick={()=>startEdit(viewTarget)} className="btn-primary" style={{padding:'10px 22px'}}>
                  ✏️ Edit
                </button>
                <button
                  onClick={()=>handleDelete(viewTarget, true)}
                  style={{padding:'10px 22px',borderRadius:8,border:'1px solid #fca5a5',
                    background:'#fef2f2',cursor:'pointer',fontSize:13,fontWeight:600,color:'#dc2626'}}>
                  🗑 Delete
                </button>
                <button
                  onClick={closeView}
                  style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                    background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b',marginLeft:'auto'}}>
                  Close
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
