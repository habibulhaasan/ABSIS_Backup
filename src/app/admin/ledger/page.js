// src/app/admin/ledger/page.js — Admin member ledger (Phase 2A)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, getDocs, doc, getDoc, query,
  where, orderBy, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n)     { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
const initials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

function fmtPaidMonth(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}$/.test(val)) {
    const [y,m] = val.split('-');
    return new Date(+y,+m-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'});
  }
  const d = val?.seconds ? new Date(val.seconds*1000) : val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString('en-GB',{month:'short',year:'numeric'});
}

// ── Fund allocation ───────────────────────────────────────────────────────────
function getFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const pct    = Math.round(totalCapital*(Number(fb.value)||0)/100);
  const maxCap = fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(pct, maxCap);
}

// ── Type badge config ─────────────────────────────────────────────────────────
const TYPE_CFG = {
  monthly:            { label:'Monthly',     color:'#15803d', bg:'#dcfce7' },
  general:            { label:'Special Sub', color:'#1d4ed8', bg:'#dbeafe' },
  entry_fee:          { label:'Entry Fee',   color:'#0369a1', bg:'#e0f2fe' },
  reregistration_fee: { label:'Re-Reg Fee',  color:'#7c3aed', bg:'#ede9fe' },
  profit:             { label:'Profit',      color:'#059669', bg:'#d1fae5' },
  loan_disbursed:     { label:'Loan Out',    color:'#dc2626', bg:'#fee2e2' },
  loan_repayment:     { label:'Loan In',     color:'#92400e', bg:'#fef3c7' },
};

function TypeBadge({ type }) {
  const c = TYPE_CFG[type] || { label:type||'Payment', color:'#475569', bg:'#f1f5f9' };
  return (
    <span style={{ padding:'2px 7px', borderRadius:99, fontSize:10, fontWeight:700,
      background:c.bg, color:c.color, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  );
}

function MemberAvatar({ m, size=36 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:'#dbeafe',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:700, fontSize:size*.34, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
      {m.photoURL
        ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
        : initials(m.nameEnglish)}
    </div>
  );
}

// ── Build unified ledger for a member ─────────────────────────────────────────
async function buildMemberLedger(orgId, memberId, settings) {
  const feeInAcct = !!settings?.gatewayFeeInAccounting;

  const [invSnap, feeSnap, distSnap, loanSnap] = await Promise.all([
    getDocs(query(
      collection(db,'organizations',orgId,'investments'),
      where('userId','==',memberId),
      orderBy('createdAt','desc')
    )),
    getDocs(query(
      collection(db,'organizations',orgId,'entryFees'),
      where('userId','==',memberId)
    )),
    getDocs(collection(db,'organizations',orgId,'profitDistributions')),
    getDocs(query(
      collection(db,'organizations',orgId,'loans'),
      where('userId','==',memberId)
    )),
  ]);

  const rows = [];

  invSnap.docs.forEach(d => {
    const r = {id:d.id,...d.data()};
    const type = r.paymentType ||
      (r.paidMonths?.length > 0 ? 'monthly' : r.specialSubType || 'general');
    const isContrib = r.isContribution !== false;
    const paidMonthsLabel = (r.paidMonths||[]).map(fmtPaidMonth).filter(Boolean).join(', ');

    rows.push({
      id:'inv_'+r.id, _rawId:r.id, _collection:'investments',
      date:r.createdAt, type,
      label: paidMonthsLabel || r.specialSubTitle || '—',
      paidMonthsLabel,
      method:r.method||'—', txId:r.txId||'',
      amount:r.amount||0,
      capitalCredit: isContrib && r.status==='verified'
        ? (r.baseAmount || (r.amount||0)-(r.penaltyPaid||0)-(feeInAcct?0:(r.gatewayFee||0)))
        : 0,
      penalty:r.penaltyPaid||0, gatewayFee:r.gatewayFee||0,
      status:r.status||'pending', isContrib,
      countAsContribution:r.countAsContribution,
      _raw: r,
    });
  });

  feeSnap.docs.forEach(d => {
    const r = {id:d.id,...d.data()};
    rows.push({
      id:'ef_'+r.id, _rawId:r.id, _collection:'entryFees',
      date:r.createdAt||r.paidAt, type:'entry_fee',
      label:'Entry Fee'+(r.notes?` — ${r.notes}`:''),
      paidMonthsLabel:'',
      method:r.method||'—', txId:'',
      amount:r.amount||0, capitalCredit:0,
      penalty:0, gatewayFee:0,
      status:'verified', isContrib:false,
      _raw: r,
    });
  });

  distSnap.docs.forEach(d => {
    const dist = {id:d.id,...d.data()};
    if (dist.status !== 'distributed') return;
    const share = (dist.memberShares||[]).find(s => s.userId===memberId);
    if (!share) return;
    rows.push({
      id:'dist_'+dist.id, _rawId:dist.id, _collection:'profitDistributions',
      date:dist.createdAt, type:'profit',
      label:dist.periodLabel||dist.year||'Distribution',
      paidMonthsLabel:'',
      method:'—', txId:'',
      amount:share.shareAmount||0, capitalCredit:0,
      penalty:0, gatewayFee:0,
      status:'verified', isContrib:false,
      _raw: {...dist, _shareAmount: share.shareAmount},
    });
  });

  loanSnap.docs.forEach(d => {
    const l = {id:d.id,...d.data()};
    if (l.status==='disbursed'||l.status==='repaid') {
      rows.push({
        id:'loan_d_'+l.id, _rawId:l.id, _collection:'loans',
        date:l.disbursedAt||l.createdAt, type:'loan_disbursed',
        label:`Loan — ${l.purpose||'Loan'}`,
        paidMonthsLabel:'',
        method:'—', txId:'', amount:l.amount||0, capitalCredit:0,
        penalty:0, gatewayFee:0, status:'verified', isContrib:false,
        _raw: l,
      });
    }
    (l.repayments||[]).forEach((rep,i) => {
      rows.push({
        id:`loan_r_${l.id}_${i}`, _rawId:l.id, _collection:'loans',
        date:rep.createdAt||rep.date, type:'loan_repayment',
        label:`Repayment — ${l.purpose||'Loan'}`,
        paidMonthsLabel:'',
        method:rep.method||'—', txId:'', amount:rep.amount||0, capitalCredit:0,
        penalty:0, gatewayFee:0, status:'verified', isContrib:false,
        _raw: {...l, _repaymentIndex: i, _repayment: rep},
      });
    });
  });

  rows.sort((a,b) => (b.date?.seconds||0) - (a.date?.seconds||0));
  return rows;
}

// ── Excel export ──────────────────────────────────────────────────────────────
async function exportMemberExcel(member, ledger, orgData) {
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  const org  = orgData || {};
  const gen  = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const name = member.nameEnglish || member.name || 'Member';

  const data = [
    [`${org.name_en||org.name||'Organisation'} — Member Ledger`],
    [`Member: ${name}  |  ID: ${member.idNo||'—'}`],
    [`Generated: ${gen}`],
    [],
    ['Date','Type','Installment','Method','Amount','Gateway Fee','Capital Credit','Penalty','Status'],
    ...ledger.map(r => [
      tsDate(r.date),
      TYPE_CFG[r.type]?.label || r.type,
      r.paidMonthsLabel || '—',
      r.method,
      r.amount,
      r.gatewayFee || '',
      r.capitalCredit || '',
      r.penalty || '',
      r.status,
    ]),
    [],
    ['','','','Total',
      ledger.reduce((s,r)=>s+r.amount,0), '',
      ledger.filter(r=>r.capitalCredit>0).reduce((s,r)=>s+r.capitalCredit,0),
      '', '',
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:14},{wch:20},{wch:12},{wch:12},{wch:12},{wch:14},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0,28));
  XLSX.writeFile(wb, `ledger-${name.replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Row Detail / CRUD Modal ───────────────────────────────────────────────────
function RowModal({ row, orgId, member, onClose, onSaved, onDeleted }) {
  const [editing, setEditing]   = useState(false);
  const [delConf, setDelConf]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState('');

  const canEdit   = row._collection === 'investments';
  const canDelete = row._collection === 'investments';

  const [fields, setFields] = useState({
    status:     row.status,
    amount:     row.amount,
    gatewayFee: row.gatewayFee || 0,
    method:     row.method,
    txId:       row.txId || '',
    penalty:    row.penalty || 0,
  });

  const set = (k,v) => setFields(f => ({...f,[k]:v}));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const ref = doc(db,'organizations',orgId,row._collection,row._rawId);
      await updateDoc(ref, {
        status:     fields.status,
        amount:     Number(fields.amount),
        gatewayFee: Number(fields.gatewayFee),
        method:     fields.method,
        txId:       fields.txId,
        penaltyPaid:Number(fields.penalty),
      });
      onSaved({ ...row, ...fields, amount:Number(fields.amount),
        gatewayFee:Number(fields.gatewayFee), penalty:Number(fields.penalty) });
    } catch(e) { setError(e.message); }
    setSaving(false);
  };

  const handleDelete = async () => {
    setSaving(true); setError('');
    try {
      await deleteDoc(doc(db,'organizations',orgId,row._collection,row._rawId));
      onDeleted(row.id);
    } catch(e) { setError(e.message); setSaving(false); }
  };

  const raw = row._raw || {};
  const infoFields = [
    ['Member',       member?.nameEnglish || '—'],
    ['Member ID',    member?.idNo || '—'],
    ['Date',         tsDate(row.date)],
    ['Type',         TYPE_CFG[row.type]?.label || row.type],
    row.paidMonthsLabel && ['Installment', row.paidMonthsLabel],
    raw.txId && ['Transaction ID', raw.txId],
    raw.notes && ['Notes', raw.notes],
    raw.purpose && ['Purpose', raw.purpose],
  ].filter(Boolean);

  const inputStyle = {
    padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0',
    fontSize:13, width:'100%', boxSizing:'border-box',
  };
  const labelStyle = { fontSize:11, fontWeight:600, color:'#64748b', marginBottom:3, display:'block' };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
      zIndex:2000, display:'flex', alignItems:'flex-end', justifyContent:'center',
      padding:0,
    }} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{
        background:'#fff', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:560,
        boxShadow:'0 -4px 40px rgba(0,0,0,0.18)', overflow:'hidden',
        maxHeight:'92vh', display:'flex', flexDirection:'column',
      }}>
        {/* Drag handle */}
        <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 4px' }}>
          <div style={{ width:36, height:4, borderRadius:99, background:'#e2e8f0' }}/>
        </div>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'8px 18px 12px', borderBottom:'1px solid #f1f5f9' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <TypeBadge type={row.type}/>
            <span style={{ color:'#0f172a', fontWeight:700, fontSize:14 }}>
              {editing ? 'Edit Record' : 'Record Details'}
            </span>
          </div>
          <button onClick={onClose}
            style={{ background:'#f1f5f9', border:'none', color:'#64748b',
              fontSize:14, cursor:'pointer', lineHeight:1, borderRadius:99,
              width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY:'auto', flex:1, padding:'16px 18px',
          display:'flex', flexDirection:'column', gap:14 }}>

          {!editing && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px' }}>
              {infoFields.map(([k,v]) => (
                <div key={k} style={{ minWidth:0 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', textTransform:'uppercase',
                    letterSpacing:'0.05em', marginBottom:2 }}>{k}</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#0f172a',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {!editing && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10,
              padding:'12px 14px', borderRadius:10, background:'#f8fafc',
              border:'1px solid #e2e8f0' }}>
              {[
                ['Amount',      fmt(row.amount),                            '#0f172a'],
                ['Gateway Fee', row.gatewayFee>0?fmt(row.gatewayFee):'—',  '#dc2626'],
                ['Capital Net', row.capitalCredit>0?fmt(row.capitalCredit):'—', '#15803d'],
                ['Penalty',     row.penalty>0?fmt(row.penalty):'—',        '#d97706'],
                ['Status',      row.status,                                 row.status==='verified'?'#15803d':row.status==='pending'?'#92400e':'#dc2626'],
                ['Method',      row.method||'—',                           '#475569'],
              ].map(([k,v,c]) => (
                <div key={k}>
                  <div style={{ fontSize:10, color:'#94a3b8', textTransform:'uppercase',
                    letterSpacing:'0.05em' }}>{k}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:c }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {editing && canEdit && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={labelStyle}>Status</label>
                  <select value={fields.status} onChange={e=>set('status',e.target.value)} style={inputStyle}>
                    <option value="pending">pending</option>
                    <option value="verified">verified</option>
                    <option value="rejected">rejected</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Method</label>
                  <select value={fields.method} onChange={e=>set('method',e.target.value)} style={inputStyle}>
                    {['bKash','Nagad','Rocket','Bank','Cash','Other'].map(m=>(
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {!['bKash','Nagad','Rocket','Bank','Cash','Other'].includes(fields.method) && (
                      <option value={fields.method}>{fields.method}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Amount (৳)</label>
                  <input type="number" value={fields.amount}
                    onChange={e=>set('amount',e.target.value)} style={inputStyle}/>
                </div>
                <div>
                  <label style={labelStyle}>Gateway Fee (৳)</label>
                  <input type="number" value={fields.gatewayFee}
                    onChange={e=>set('gatewayFee',e.target.value)} style={inputStyle}/>
                </div>
                <div>
                  <label style={labelStyle}>Penalty (৳)</label>
                  <input type="number" value={fields.penalty}
                    onChange={e=>set('penalty',e.target.value)} style={inputStyle}/>
                </div>
                <div>
                  <label style={labelStyle}>Transaction ID</label>
                  <input value={fields.txId}
                    onChange={e=>set('txId',e.target.value)} style={inputStyle}/>
                </div>
              </div>
              <div style={{ padding:'8px 12px', borderRadius:8, background:'#f0fdf4',
                border:'1px solid #bbf7d0', fontSize:12, color:'#15803d', fontWeight:600 }}>
                Capital net preview: {fmt(Number(fields.amount)-Number(fields.gatewayFee)-Number(fields.penalty))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding:'8px 12px', borderRadius:8, background:'#fef2f2',
              border:'1px solid #fca5a5', fontSize:12, color:'#dc2626' }}>
              ⚠️ {error}
            </div>
          )}

          {delConf && (
            <div style={{ padding:'12px 14px', borderRadius:10, background:'#fef2f2',
              border:'1px solid #fca5a5' }}>
              <div style={{ fontWeight:700, color:'#dc2626', marginBottom:6, fontSize:13 }}>
                ⚠️ Delete this record permanently?
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:10 }}>
                This removes the investment document from Firestore. This action cannot be undone.
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={handleDelete} disabled={saving}
                  style={{ padding:'8px 18px', borderRadius:8, background:'#dc2626', color:'#fff',
                    border:'none', cursor:'pointer', fontWeight:700, fontSize:13, flex:1 }}>
                  {saving ? 'Deleting…' : 'Yes, Delete'}
                </button>
                <button onClick={()=>setDelConf(false)} disabled={saving}
                  style={{ padding:'8px 18px', borderRadius:8, background:'#f1f5f9', color:'#475569',
                    border:'none', cursor:'pointer', fontWeight:600, fontSize:13, flex:1 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer buttons */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid #f1f5f9',
          display:'flex', gap:8, background:'#fff' }}>
          {!editing && !delConf && (
            <>
              {canEdit && (
                <button onClick={()=>setEditing(true)}
                  style={{ flex:1, padding:'10px', borderRadius:10, background:'#2563eb', color:'#fff',
                    border:'none', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                  ✏️ Edit
                </button>
              )}
              {canDelete && (
                <button onClick={()=>setDelConf(true)}
                  style={{ flex:1, padding:'10px', borderRadius:10, background:'#fef2f2', color:'#dc2626',
                    border:'1px solid #fca5a5', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                  🗑 Delete
                </button>
              )}
              {!canEdit && (
                <div style={{ fontSize:12, color:'#94a3b8', alignSelf:'center', flex:1 }}>
                  Read-only — {row.type==='profit'?'distributions':row._collection} cannot be edited here.
                </div>
              )}
              <button onClick={onClose}
                style={{ flex:1, padding:'10px', borderRadius:10,
                  background:'#f1f5f9', color:'#475569', border:'none',
                  cursor:'pointer', fontWeight:600, fontSize:13 }}>
                Close
              </button>
            </>
          )}
          {editing && (
            <>
              <button onClick={handleSave} disabled={saving}
                style={{ flex:2, padding:'10px', borderRadius:10, background:'#15803d', color:'#fff',
                  border:'none', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                {saving ? 'Saving…' : '✓ Save Changes'}
              </button>
              <button onClick={()=>{ setEditing(false); setError(''); }}
                style={{ flex:1, padding:'10px', borderRadius:10, background:'#f1f5f9', color:'#475569',
                  border:'none', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminLedger() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};

  const [members,    setMembers]    = useState([]);
  const [selMember,  setSelMember]  = useState(null);
  const [ledger,     setLedger]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showFundBreakdown, setShowFundBreakdown] = useState(false);
  const [mobileView, setMobileView] = useState('list');
  const [exporting,  setExporting]  = useState(false);
  const [modalRow,   setModalRow]   = useState(null);

  const [orgTotalCapital, setOrgTotalCapital] = useState(0);
  const [orgExpenses,     setOrgExpenses]     = useState(0);
  const [orgInvestments,  setOrgInvestments]  = useState(0);
  const [orgReserveUsed,  setOrgReserveUsed]  = useState(0);
  const [orgBenevolent,   setOrgBenevolent]   = useState(0);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const snap = await getDocs(collection(db,'organizations',orgId,'members'));
      const docs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const merged = await Promise.all(docs.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists()?{...m,...u.data(),id:m.id}:m; }
        catch { return m; }
      }));
      merged.sort((a,b) => (a.idNo||'').localeCompare(b.idNo||'',undefined,{numeric:true}));
      setMembers(merged);
    })();

    (async () => {
      const feeInAcct = !!settings.gatewayFeeInAccounting;
      const [paySnap, expSnap, projSnap, loanSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'loans')),
      ]);
      const tc = paySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified' && p.isContribution!==false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
      setOrgTotalCapital(tc);
      setOrgExpenses(expSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0));
      const projs = projSnap.docs.map(d=>d.data());
      setOrgInvestments(projs.reduce((s,p)=>s+(p.fundSources?Number(p.fundSources.investment)||0:p.fundSource!=='reserve'?(p.investedAmount||0):0),0));
      setOrgReserveUsed(projs.reduce((s,p)=>s+(p.fundSources?Number(p.fundSources.reserve)||0:p.fundSource==='reserve'?(p.investedAmount||0):0),0));
      setOrgBenevolent(loanSnap.docs.map(d=>d.data())
        .filter(l=>l.status==='disbursed'||l.status==='repaid')
        .reduce((s,l)=>s+(l.amount||0),0));
    })();
  }, [orgId]);

  const loadMember = async m => {
    setSelMember(m);
    setMobileView('detail');
    setLoading(true);
    setShowFundBreakdown(false);
    setTypeFilter('all');
    const rows = await buildMemberLedger(orgId, m.id, settings);
    setLedger(rows);
    setLoading(false);
  };

  const handleSaved = updatedRow => {
    setLedger(prev => prev.map(r => r.id === updatedRow.id ? {...r,...updatedRow} : r));
    setModalRow(null);
  };
  const handleDeleted = rowId => {
    setLedger(prev => prev.filter(r => r.id !== rowId));
    setModalRow(null);
  };

  const memberCapital = ledger
    .filter(r=>r.isContrib && r.status==='verified')
    .reduce((s,r)=>s+r.capitalCredit,0);
  const memberPending = ledger.filter(r=>r.status==='pending').length;
  const memberPct     = orgTotalCapital > 0 ? memberCapital / orgTotalCapital : 0;

  const FUNDS = [
    { key:'investment', label:'Investment Fund', icon:'📈', color:'#2563eb',
      orgAlloc:getFundAlloc('investment',orgTotalCapital,settings), orgUsed:orgInvestments },
    { key:'reserve',    label:'Reserve Fund',    icon:'🛡',  color:'#16a34a',
      orgAlloc:getFundAlloc('reserve',orgTotalCapital,settings),    orgUsed:orgReserveUsed },
    { key:'benevolent', label:'Benevolent Fund', icon:'🤝', color:'#7c3aed',
      orgAlloc:getFundAlloc('benevolent',orgTotalCapital,settings), orgUsed:orgBenevolent },
    { key:'expenses',   label:'Expenses Fund',   icon:'🧾', color:'#d97706',
      orgAlloc:getFundAlloc('expenses',orgTotalCapital,settings),   orgUsed:orgExpenses },
  ];
  const hasFundBudgets = FUNDS.some(f => f.orgAlloc > 0);

  const filteredLedger = typeFilter==='all'            ? ledger
    : typeFilter==='contributions' ? ledger.filter(r=>r.isContrib)
    : typeFilter==='fees'          ? ledger.filter(r=>r.type==='entry_fee'||r.type==='reregistration_fee')
    : typeFilter==='profit'        ? ledger.filter(r=>r.type==='profit')
    : typeFilter==='loans'         ? ledger.filter(r=>r.type==='loan_disbursed'||r.type==='loan_repayment')
    : ledger;

  const searchedMembers = members.filter(m =>
    !search ||
    (m.nameEnglish||'').toLowerCase().includes(search.toLowerCase()) ||
    (m.idNo||'').includes(search)
  );

  if (!isOrgAdmin) return null;

  // ── Member list panel ─────────────────────────────────────────────────────
  const MemberList = () => (
    <div className="card" style={{ padding:0, overflow:'hidden' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid #e2e8f0' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by name or ID…"
          style={{ width:'100%', padding:'8px 12px', borderRadius:8,
            border:'1px solid #e2e8f0', fontSize:13, boxSizing:'border-box' }}/>
      </div>
      <div style={{ overflowY:'auto', maxHeight:'calc(100vh - 260px)' }}>
        {searchedMembers.map(m => {
          const sel = selMember?.id === m.id;
          return (
            <button key={m.id} onClick={()=>loadMember(m)}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
                width:'100%', border:'none', borderBottom:'1px solid #f1f5f9',
                background:sel?'#eff6ff':'#fff', cursor:'pointer', textAlign:'left' }}
              onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f8fafc'; }}
              onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='#fff'; }}>
              <MemberAvatar m={m} size={34}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:13, color:sel?'#1d4ed8':'#0f172a',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {m.nameEnglish||'(no name)'}
                </div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>
                  {m.idNo ? `#${m.idNo}` : 'No ID'}
                </div>
              </div>
              <span style={{ color:'#cbd5e1', fontSize:16 }}>›</span>
            </button>
          );
        })}
        {searchedMembers.length === 0 && (
          <div style={{ textAlign:'center', color:'#94a3b8', padding:24, fontSize:13 }}>
            No members found
          </div>
        )}
      </div>
    </div>
  );

  // ── Ledger detail panel ───────────────────────────────────────────────────
  const LedgerDetail = () => {
    if (loading) return (
      <div className="card" style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>
        Loading ledger…
      </div>
    );

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {/* Member header */}
        <div className="card" style={{ padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <MemberAvatar m={selMember} size={44}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>
                {selMember.nameEnglish}
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginTop:1 }}>
                ID: {selMember.idNo||'—'}{selMember.phone&&` · ${selMember.phone}`}
              </div>
            </div>
            <div style={{ display:'flex', gap:14, flexShrink:0 }}>
              {[
                ['Capital', fmt(memberCapital), '#15803d'],
                ['Records', ledger.length,      '#0f172a'],
                ['Pending', memberPending,       memberPending>0?'#d97706':'#94a3b8'],
              ].map(([l,v,c]) => (
                <div key={l} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div>
                  <div style={{ fontSize:9, color:'#94a3b8', textTransform:'uppercase',
                    letterSpacing:'.05em' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid #f1f5f9',
            display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <button
              onClick={async () => {
                setExporting(true);
                try { await exportMemberExcel(selMember, ledger, orgData); }
                catch(e) { alert('Export failed: '+e.message); }
                setExporting(false);
              }}
              disabled={exporting || ledger.length===0}
              style={{ padding:'7px 14px', borderRadius:8, background:exporting?'#94a3b8':'#15803d',
                color:'#fff', border:'none', cursor:exporting?'not-allowed':'pointer',
                fontSize:12, fontWeight:700 }}>
              {exporting ? '⏳ Exporting…' : '⬇ Export Excel'}
            </button>
            {hasFundBudgets && (
              <button onClick={()=>setShowFundBreakdown(v=>!v)}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid #e2e8f0',
                  background:showFundBreakdown?'#eff6ff':'#fff',
                  color:showFundBreakdown?'#1d4ed8':'#475569',
                  cursor:'pointer', fontSize:12, fontWeight:600 }}>
                {showFundBreakdown?'▲ Hide':'▼'} Funds
              </button>
            )}
          </div>
        </div>

        {/* Fund breakdown */}
        {showFundBreakdown && hasFundBudgets && (
          <div className="card" style={{ padding:'14px 16px' }}>
            <div style={{ fontWeight:700, fontSize:13, color:'#0f172a', marginBottom:3 }}>
              🏦 Fund Breakdown — {selMember.nameEnglish}
            </div>
            <div style={{ fontSize:11, color:'#64748b', marginBottom:12 }}>
              {(memberPct*100).toFixed(2)}% capital share
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {FUNDS.map(fund => {
                if (!fund.orgAlloc) return null;
                const mAlloc = Math.round(fund.orgAlloc * memberPct);
                const mUsed  = Math.round(fund.orgUsed  * memberPct);
                const rem    = mAlloc - mUsed;
                const up     = mAlloc>0 ? Math.min(100,(mUsed/mAlloc)*100) : 0;
                const over   = rem < 0;
                return (
                  <div key={fund.key} style={{ padding:'10px 12px', borderRadius:10,
                    border:`1px solid ${fund.color}33`, background:`${fund.color}08` }}>
                    <div style={{ display:'flex', justifyContent:'space-between',
                      alignItems:'center', marginBottom:6 }}>
                      <span style={{ fontWeight:700, fontSize:12, color:'#0f172a' }}>
                        {fund.icon} {fund.label}
                      </span>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:12, fontWeight:700,
                          color:over?'#dc2626':fund.color }}>
                          {fmt(rem)} left
                        </div>
                        <div style={{ fontSize:10, color:'#94a3b8' }}>of {fmt(mAlloc)}</div>
                      </div>
                    </div>
                    <div style={{ height:5, borderRadius:99, background:'#e2e8f0', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:99, transition:'width .6s',
                        background:over?'#dc2626':fund.color, width:`${up}%` }}/>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between',
                      fontSize:10, color:'#94a3b8', marginTop:3 }}>
                      <span>Used: {fmt(mUsed)} ({up.toFixed(1)}%)</span>
                      <span>Org: {fmt(fund.orgAlloc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter bar — horizontally scrollable on mobile */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:2,
          WebkitOverflowScrolling:'touch', scrollbarWidth:'none' }}>
          {[
            ['all','All'],['contributions','Contributions'],
            ['fees','Fees'],['profit','Profit'],['loans','Loans'],
          ].map(([k,l]) => (
            <button key={k} onClick={()=>setTypeFilter(k)}
              style={{ padding:'5px 12px', fontSize:11, borderRadius:7, cursor:'pointer', flexShrink:0,
                border:typeFilter===k?'2px solid #2563eb':'1px solid #e2e8f0',
                background:typeFilter===k?'#eff6ff':'#fff',
                color:typeFilter===k?'#1d4ed8':'#475569', fontWeight:500 }}>
              {l}
            </button>
          ))}
        </div>

        {filteredLedger.length > 0 && (
          <div style={{ fontSize:11, color:'#94a3b8' }}>
            💡 Tap any row to view details or edit
          </div>
        )}

        {/* ── Ledger table — horizontally scrollable on mobile ── */}
        {filteredLedger.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:32, color:'#94a3b8', fontSize:13 }}>
            No records in this category.
          </div>
        ) : (
          <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            {/* Outer scroll wrapper */}
            <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
              <div style={{ minWidth:520 }}>
                {/* Header */}
                <div style={{ display:'grid',
                  gridTemplateColumns:'84px 100px 1fr 90px 80px 72px',
                  gap:6, padding:'8px 12px', background:'#f8fafc',
                  borderBottom:'1px solid #e2e8f0' }}>
                  {['Date','Type','Installment','Amount','Capital','Status'].map((h,i)=>(
                    <div key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b',
                      textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</div>
                  ))}
                </div>

                {/* Rows */}
                {filteredLedger.map((r,i) => (
                  <div key={r.id}
                    onClick={()=>setModalRow(r)}
                    style={{
                      display:'grid',
                      gridTemplateColumns:'84px 100px 1fr 90px 80px 72px',
                      gap:6, padding:'9px 12px', alignItems:'center',
                      borderBottom:'1px solid #f1f5f9',
                      background: r.isContrib && r.status==='verified'
                        ? '#f0fdf4' : i%2===0 ? '#fff' : '#fafafa',
                      borderLeft:`3px solid ${
                        r.isContrib && r.status==='verified' ? '#86efac' :
                        r.status==='pending' ? '#fde68a' :
                        r.status==='rejected' ? '#fca5a5' : 'transparent'}`,
                      cursor:'pointer',
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                    onMouseLeave={e=>e.currentTarget.style.background=
                      r.isContrib&&r.status==='verified'?'#f0fdf4':i%2===0?'#fff':'#fafafa'
                    }
                  >
                    <div style={{ fontSize:11, color:'#64748b', whiteSpace:'nowrap' }}>
                      {tsDate(r.date)}
                    </div>
                    <TypeBadge type={r.type}/>

                    {/* Installment column — paidMonthsLabel if present, else type label */}
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#1d4ed8',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {r.paidMonthsLabel || '—'}
                      </div>
                      {r.txId && (
                        <div style={{ fontSize:10, color:'#94a3b8', fontFamily:'monospace',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {r.txId.slice(0,14)}…
                        </div>
                      )}
                    </div>

                    <div style={{ fontWeight:700, fontSize:12, color:'#0f172a' }}>
                      {fmt(r.amount)}
                      {r.penalty>0 && (
                        <div style={{ fontSize:9, color:'#d97706' }}>+{fmt(r.penalty)} pen.</div>
                      )}
                    </div>
                    <div style={{ fontSize:12, fontWeight:600,
                      color:r.capitalCredit>0?'#15803d':'#94a3b8' }}>
                      {r.capitalCredit>0 ? fmt(r.capitalCredit) : '—'}
                    </div>
                    <span className={`badge ${
                      r.status==='verified'?'badge-green':
                      r.status==='pending'?'badge-yellow':'badge-red'}`}
                      style={{ fontSize:9, textTransform:'capitalize' }}>
                      {r.status}
                    </span>
                  </div>
                ))}

                {/* Footer */}
                <div style={{ display:'grid',
                  gridTemplateColumns:'84px 100px 1fr 90px 80px 72px',
                  gap:6, padding:'8px 12px', background:'#f8fafc',
                  borderTop:'2px solid #e2e8f0' }}>
                  <div/><div/>
                  <div style={{ fontSize:11, fontWeight:700, color:'#64748b' }}>
                    {filteredLedger.length} records
                  </div>
                  <div style={{ fontSize:12, fontWeight:800, color:'#0f172a' }}>
                    {fmt(filteredLedger.reduce((s,r)=>s+r.amount,0))}
                  </div>
                  <div style={{ fontSize:12, fontWeight:800, color:'#15803d' }}>
                    {fmt(filteredLedger.filter(r=>r.capitalCredit>0).reduce((s,r)=>s+r.capitalCredit,0))}
                  </div>
                  <div/>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-wrap animate-fade">
      {modalRow && (
        <RowModal
          row={modalRow}
          orgId={orgId}
          member={selMember}
          onClose={()=>setModalRow(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      <style>{`
        .adm-ledger { display: block; }
        @media (min-width: 768px) {
          .adm-ledger { display: grid !important;
            grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
          .adm-list  { display: block !important; }
          .adm-detail { display: block !important; }
          .adm-back  { display: none !important; }
        }
        @media (max-width: 767px) {
          .adm-list.hide   { display: none; }
          .adm-detail.hide { display: none; }
        }
        /* hide scrollbar on filter row */
        div::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:12 }}>
        {orgData?.logoURL && (
          <div style={{ width:38, height:38, borderRadius:9, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">Member Ledger</div>
          <div className="page-subtitle">
            {members.length} members · Tap row to view/edit
          </div>
        </div>
      </div>

      {mobileView==='detail' && (
        <div className="adm-back" style={{ marginBottom:12 }}>
          <button onClick={()=>setMobileView('list')}
            style={{ background:'none', border:'none', cursor:'pointer',
              color:'#2563eb', fontWeight:600, fontSize:14, padding:0,
              display:'inline-flex', alignItems:'center', gap:6 }}>
            ← All Members
          </button>
        </div>
      )}

      <div className="adm-ledger" style={{ display:'block' }}>
        <div className={`adm-list${mobileView==='detail'?' hide':''}`}>
          <MemberList/>
        </div>
        <div className={`adm-detail${mobileView==='list'?' hide':''}`}>
          {selMember ? <LedgerDetail/> : (
            <div className="card" style={{ textAlign:'center', padding:'60px 20px', color:'#94a3b8' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>👈</div>
              <div style={{ fontWeight:500 }}>Select a member to view their ledger</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}