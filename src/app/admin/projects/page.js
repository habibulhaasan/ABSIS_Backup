// src/app/admin/projects/page.js
'use client';
import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc,
  getDocs, query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

// ── Constants ─────────────────────────────────────────────────────────────────

const INVESTMENT_TYPES = [
  'Musharaka','Mudaraba','Ijara','Murabaha','Muzaraa','Istisna','Salam','Other',
];

const RETURN_CATEGORIES  = ['rent','dividend','profit_share','capital_return','other'];
const EXPENSE_CATEGORIES = ['maintenance','management','legal','tax','insurance','repair','other'];

const STATUSES = [
  { key:'proposed',  label:'Proposed',  icon:'💡', color:'#92400e', bg:'#fef3c7', dot:'#f59e0b' },
  { key:'active',    label:'Active',    icon:'▶️',  color:'#1e40af', bg:'#dbeafe', dot:'#2563eb' },
  { key:'completed', label:'Completed', icon:'✅', color:'#14532d', bg:'#dcfce7', dot:'#16a34a' },
  { key:'cancelled', label:'Cancelled', icon:'✕',  color:'#6b7280', bg:'#f3f4f6', dot:'#9ca3af' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
}
function fmtSigned(n) {
  const v = Number(n)||0;
  const s = `৳${Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0})}`;
  return v < 0 ? `−${s}` : `+${s}`;
}
function pct(n) { return `${(Number(n)||0).toFixed(2)}%`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function initials(name) {
  return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
}
function cap(str) { return str ? str.charAt(0).toUpperCase()+str.slice(1) : ''; }

// ── Shared UI ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status]||STATUS_MAP.proposed;
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:5,
      padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,
      background:s.bg,color:s.color}}>
      <span style={{width:6,height:6,borderRadius:'50%',background:s.dot,display:'inline-block'}}/>
      {s.label}
    </span>
  );
}

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',
        letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{display:'flex',gap:4,borderBottom:'2px solid #e2e8f0',marginBottom:20}}>
      {tabs.map(([id,label]) => (
        <button key={id} onClick={() => onChange(id)}
          style={{padding:'8px 14px',border:'none',background:'none',cursor:'pointer',
            fontSize:13,fontWeight:active===id?700:400,
            color:active===id?'#2563eb':'#64748b',
            borderBottom:active===id?'2px solid #2563eb':'2px solid transparent',marginBottom:-2}}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Sub-entry form (shared for returns + expenses) ────────────────────────────

function EntryForm({ type, onSave, onCancel, saving }) {
  const isReturn = type === 'return';
  const [form, setForm] = useState({
    amount:      '',
    date:        new Date().toISOString().split('T')[0],
    description: '',
    category:    isReturn ? 'rent' : 'maintenance',
  });
  const set = (k,v) => setForm(p => ({...p,[k]:v}));

  const handleSave = () => {
    if (!form.amount || Number(form.amount) <= 0) return alert('Amount must be positive.');
    if (!form.date)                               return alert('Date is required.');
    onSave({ ...form, amount: Number(form.amount) });
  };

  return (
    <div style={{background:'#f8fafc',borderRadius:10,padding:14,border:'1px solid #e2e8f0',marginBottom:12}}>
      <div style={{fontWeight:600,fontSize:13,color:'#0f172a',marginBottom:12}}>
        {isReturn ? '+ Add Return Entry' : '+ Add Expense Entry'}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div>
          <label className="form-label">Amount (৳) *</label>
          <input type="number" min="0" value={form.amount}
            onChange={e => set('amount',e.target.value)} placeholder="0"/>
        </div>
        <div>
          <label className="form-label">Date *</label>
          <input type="date" value={form.date} onChange={e => set('date',e.target.value)}/>
        </div>
        <div>
          <label className="form-label">Category</label>
          <select value={form.category} onChange={e => set('category',e.target.value)}>
            {(isReturn ? RETURN_CATEGORIES : EXPENSE_CATEGORIES).map(c => (
              <option key={c} value={c}>{cap(c.replace('_',' '))}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Description</label>
          <input type="text" value={form.description}
            onChange={e => set('description',e.target.value)}
            placeholder={isReturn ? 'e.g. Monthly rent Jan 2025' : 'e.g. Roof repair'}/>
        </div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={handleSave} disabled={saving} className="btn-primary"
          style={{padding:'8px 18px',fontSize:13}}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel}
          style={{padding:'8px 14px',borderRadius:8,border:'1px solid #e2e8f0',
            background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Returns tab content ───────────────────────────────────────────────────────

function ReturnsTab({ project, orgId, isAdmin, onCacheUpdate }) {
  const { user } = useAuth();
  const [returns,     setReturns]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState('');

  useEffect(() => {
    if (!project?.id) return;
    const unsub = onSnapshot(
      query(collection(db,'organizations',orgId,'investmentProjects',project.id,'returns'),
        orderBy('date','desc')),
      snap => {
        const data = snap.docs.map(d => ({id:d.id,...d.data()}));
        setReturns(data);
        setLoading(false);
        const total = data.reduce((s,r) => s+(r.amount||0), 0);
        onCacheUpdate({ totalReturns: total });
      },
      err => {
        console.warn('Returns listener error (check Firestore rules):', err.code);
        setLoading(false);
      }
    );
    return unsub;
  }, [project?.id, orgId]);

  const handleAdd = async (entry) => {
    setSaving(true);
    try {
      await addDoc(
        collection(db,'organizations',orgId,'investmentProjects',project.id,'returns'),
        { ...entry, distributedInDistributionId: null, recordedBy: user.uid, createdAt: serverTimestamp() }
      );
      setShowForm(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this return entry?')) return;
    setDeleting(id);
    try {
      await deleteDoc(doc(db,'organizations',orgId,'investmentProjects',project.id,'returns',id));
    } catch(e) { alert(e.message); }
    setDeleting('');
  };

  const total           = returns.reduce((s,r) => s+(r.amount||0), 0);
  const distributed     = returns.filter(r => r.distributedInDistributionId).reduce((s,r) => s+(r.amount||0), 0);
  const undistributed   = total - distributed;

  if (loading) return <div style={{padding:24,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;

  return (
    <div>
      {/* Summary */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
        <Stat label="Total Returns"    value={fmt(total)}         color="#15803d" bg="#f0fdf4"/>
        <Stat label="Distributed"      value={fmt(distributed)}   color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Undistributed"    value={fmt(undistributed)} color="#7e22ce" bg="#faf5ff"
          sub={distributed > 0 ? 'Available for next distribution' : undefined}/>
      </div>

      {/* Add form */}
      {isAdmin && (
        showForm
          ? <EntryForm type="return" onSave={handleAdd} onCancel={() => setShowForm(false)} saving={saving}/>
          : <button onClick={() => setShowForm(true)}
              style={{marginBottom:12,padding:'8px 16px',borderRadius:8,border:'1.5px dashed #2563eb',
                background:'#eff6ff',color:'#2563eb',cursor:'pointer',fontSize:13,fontWeight:600,width:'100%'}}>
              + Add Return Entry
            </button>
      )}

      {/* List */}
      {returns.length === 0 ? (
        <div style={{textAlign:'center',padding:'32px 20px',color:'#94a3b8',fontSize:13,
          background:'#fafafa',borderRadius:10}}>
          No return entries yet.
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {returns.map(r => (
            <div key={r.id} style={{padding:'10px 14px',borderRadius:10,
              border:`1px solid ${r.distributedInDistributionId ? '#bae6fd' : '#e2e8f0'}`,
              background:r.distributedInDistributionId ? '#f0f9ff' : '#fff',
              display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>
                    {r.description || cap(r.category?.replace('_',' '))}
                  </span>
                  <span style={{padding:'2px 8px',borderRadius:5,background:'#f1f5f9',
                    color:'#475569',fontSize:11,fontWeight:600}}>
                    {cap(r.category?.replace('_',' '))}
                  </span>
                  {r.distributedInDistributionId && (
                    <span style={{padding:'2px 8px',borderRadius:5,background:'#dbeafe',
                      color:'#1d4ed8',fontSize:11,fontWeight:600}}>Distributed</span>
                  )}
                </div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{r.date}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                <span style={{fontWeight:700,fontSize:15,color:'#15803d'}}>{fmt(r.amount)}</span>
                {isAdmin && !r.distributedInDistributionId && (
                  <button onClick={() => handleDelete(r.id)} disabled={deleting===r.id}
                    style={{background:'none',border:'none',cursor:'pointer',
                      color:'#94a3b8',fontSize:14,padding:'2px 6px',borderRadius:4}}
                    title="Delete entry">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Expenses tab content ──────────────────────────────────────────────────────

function ExpensesTab({ project, orgId, isAdmin, onCacheUpdate }) {
  const { user } = useAuth();
  const [expenses,  setExpenses]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState('');

  useEffect(() => {
    if (!project?.id) return;
    const unsub = onSnapshot(
      query(collection(db,'organizations',orgId,'investmentProjects',project.id,'projectExpenses'),
        orderBy('date','desc')),
      snap => {
        const data = snap.docs.map(d => ({id:d.id,...d.data()}));
        setExpenses(data);
        setLoading(false);
        const total = data.reduce((s,e) => s+(e.amount||0), 0);
        onCacheUpdate({ totalExpenses: total });
      },
      err => {
        console.warn('Expenses listener error (check Firestore rules):', err.code);
        setLoading(false);
      }
    );
    return unsub;
  }, [project?.id, orgId]);

  const handleAdd = async (entry) => {
    setSaving(true);
    try {
      // Write to project-level subcollection
      const projExpRef = await addDoc(
        collection(db,'organizations',orgId,'investmentProjects',project.id,'projectExpenses'),
        { ...entry, recordedBy: user.uid, createdAt: serverTimestamp() }
      );
      // ALSO write a mirror entry to the org-level expenses collection
      // so it appears on admin/expenses and is counted in Expenses Fund usage.
      // sourceType + sourceProjectId allow reverse-linking and cascade delete.
      await addDoc(
        collection(db,'organizations',orgId,'expenses'),
        {
          ...entry,
          recordedBy:      user.uid,
          createdAt:       serverTimestamp(),
          sourceType:      'investment',          // came from a project
          sourceProjectId: project.id,
          sourceProjectTitle: project.title || '',
          sourceDocId:     projExpRef.id,         // original doc in subcollection
          fundSource:      'expenses',            // always charged to expenses fund
          notes: entry.notes
            ? `[${project.title}] ${entry.notes}`
            : `Investment project: ${project.title}`,
        }
      );
      setShowForm(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this expense entry?')) return;
    setDeleting(id);
    try {
      // Delete from project subcollection
      await deleteDoc(doc(db,'organizations',orgId,'investmentProjects',project.id,'projectExpenses',id));
      // Also delete the mirror entry from org expenses (find by sourceDocId)
      const expSnap = await getDocs(
        query(collection(db,'organizations',orgId,'expenses'),
          where('sourceDocId','==',id))
      );
      for (const d of expSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch(e) { alert(e.message); }
    setDeleting('');
  };

  const total = expenses.reduce((s,e) => s+(e.amount||0), 0);

  const byCategory = EXPENSE_CATEGORIES.reduce((acc,cat) => {
    const catTotal = expenses.filter(e=>e.category===cat).reduce((s,e)=>s+(e.amount||0),0);
    if (catTotal > 0) acc[cat] = catTotal;
    return acc;
  }, {});

  if (loading) return <div style={{padding:24,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
        <Stat label="Total Expenses" value={fmt(total)} color="#dc2626" bg="#fef2f2"
          sub={`${expenses.length} entries`}/>
        {Object.entries(byCategory).map(([cat,amount]) => (
          <Stat key={cat} label={cap(cat.replace('_',' '))} value={fmt(amount)} bg="#f8fafc"/>
        ))}
      </div>

      {isAdmin && (
        showForm
          ? <EntryForm type="expense" onSave={handleAdd} onCancel={() => setShowForm(false)} saving={saving}/>
          : <button onClick={() => setShowForm(true)}
              style={{marginBottom:12,padding:'8px 16px',borderRadius:8,border:'1.5px dashed #dc2626',
                background:'#fef2f2',color:'#dc2626',cursor:'pointer',fontSize:13,fontWeight:600,width:'100%'}}>
              + Add Expense Entry
            </button>
      )}

      {expenses.length === 0 ? (
        <div style={{textAlign:'center',padding:'32px 20px',color:'#94a3b8',fontSize:13,
          background:'#fafafa',borderRadius:10}}>
          No expense entries yet.
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {expenses.map(e => (
            <div key={e.id} style={{padding:'10px 14px',borderRadius:10,
              border:'1px solid #e2e8f0',background:'#fff',
              display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>
                    {e.description || cap(e.category?.replace('_',' '))}
                  </span>
                  <span style={{padding:'2px 8px',borderRadius:5,background:'#fef2f2',
                    color:'#dc2626',fontSize:11,fontWeight:600}}>
                    {cap(e.category?.replace('_',' '))}
                  </span>
                </div>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{e.date}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                <span style={{fontWeight:700,fontSize:15,color:'#dc2626'}}>−{fmt(e.amount)}</span>
                {isAdmin && (
                  <button onClick={() => handleDelete(e.id)} disabled={deleting===e.id}
                    style={{background:'none',border:'none',cursor:'pointer',
                      color:'#94a3b8',fontSize:14,padding:'2px 6px',borderRadius:4}}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Member Shares tab ─────────────────────────────────────────────────────────

function MemberSharesTab({ project, members, payments, orgData, liveCache }) {
  const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;

  // Phase 3A: determine who participates
  const participatingMembers = project.participatingMembers;
  const allParticipate = !participatingMembers || participatingMembers === 'all';
  const participantIds = allParticipate ? null : new Set(participatingMembers);

  // Capital per member — only verified contribution payments
  const capitalMap = {};
  payments
    .filter(p => p.status === 'verified' && p.isContribution !== false)
    .forEach(p => {
      const net = (p.amount||0) - (feeInAcct ? 0 : (p.gatewayFee||0));
      if (p.userId) capitalMap[p.userId] = (capitalMap[p.userId]||0) + net;
    });

  // Total capital = only from participating members (for this project's ratio)
  const totalCapital = Object.entries(capitalMap)
    .filter(([uid]) => allParticipate || participantIds.has(uid))
    .reduce((s,[,v]) => s+v, 0);

  // Net profit for this project
  let netProfit = 0;
  if (project.returnType === 'periodic') {
    const totalReturns  = liveCache?.totalReturns  ?? project.totalReturns  ?? 0;
    const totalExpenses = liveCache?.totalExpenses ?? project.totalExpenses ?? 0;
    netProfit = totalReturns - totalExpenses;
  } else {
    // lump sum
    if (project.actualReturnAmount != null) {
      netProfit = (project.actualReturnAmount||0) - (project.investedAmount||0);
    }
  }

  const rows = members
    .filter(m => m.approved && capitalMap[m.id] > 0
      && (allParticipate || participantIds.has(m.id)))
    .map(m => {
      const capShare = totalCapital > 0 ? (capitalMap[m.id]||0) / totalCapital : 0;
      return {
        ...m,
        capital:            Math.round(capitalMap[m.id]||0),
        capPct:             capShare * 100,
        effectiveInvested:  Math.round(capShare * (project.investedAmount||0)),
        profitShare:        Math.round(capShare * netProfit),
      };
    })
    .sort((a,b) => b.capital - a.capital);

  if (rows.length === 0) {
    return (
      <div style={{textAlign:'center',padding:'40px 20px',color:'#94a3b8',fontSize:13,
        background:'#fafafa',borderRadius:10}}>
        No members with verified capital payments found.
      </div>
    );
  }

  return (
    <div>
      <div style={{padding:'8px 12px',borderRadius:8,background:'#fffbeb',
        border:'1px solid #fde68a',fontSize:12,color:'#92400e',marginBottom:10}}>
        <strong>How this is calculated:</strong> Each member's share is proportional to their
        capital relative to the total capital of <strong>participating members only</strong>.
        Effective Investment = member capital share × project invested amount.
        Profit/Loss Share = member capital share × net profit.
      </div>
      {!allParticipate && (
        <div style={{padding:'8px 12px',borderRadius:8,background:'#eff6ff',
          border:'1px solid #bfdbfe',fontSize:12,color:'#1e40af',marginBottom:14}}>
          👥 <strong>Restricted participation:</strong> Only {participantIds.size} selected member(s)
          participate in this investment. Other members are excluded.
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
        <Stat label="Total Org Capital"  value={fmt(totalCapital)}         color="#15803d" bg="#f0fdf4"/>
        <Stat label="Project Invested"   value={fmt(project.investedAmount)} color="#92400e" bg="#fef3c7"/>
        <Stat label="Project Net"        value={fmtSigned(netProfit)}
          color={netProfit>=0?'#15803d':'#dc2626'}
          bg={netProfit>=0?'#f0fdf4':'#fef2f2'}/>
        <Stat label="Eligible Members"   value={rows.length} bg="#faf5ff"/>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'#f8fafc'}}>
              {['Member','Capital','Cap %','Eff. Investment','Profit / Loss Share'].map(h => (
                <th key={h} style={{padding:'9px 12px',
                  textAlign:h==='Member'?'left':'right',
                  fontSize:11,fontWeight:700,color:'#64748b',
                  textTransform:'uppercase',letterSpacing:'0.07em',
                  borderBottom:'1px solid #e2e8f0'}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m,i) => (
              <tr key={m.id}
                style={{borderBottom:'1px solid #f1f5f9',background:i%2===0?'#fff':'#fafafa'}}>
                <td style={{padding:'9px 12px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:28,height:28,borderRadius:'50%',background:'#dbeafe',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:10,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                      {initials(m.nameEnglish||m.name)}
                    </div>
                    <div>
                      <div style={{fontWeight:600,color:'#0f172a'}}>{m.nameEnglish||m.name||'—'}</div>
                      {m.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                    </div>
                  </div>
                </td>
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:600,color:'#15803d'}}>
                  {fmt(m.capital)}
                </td>
                <td style={{padding:'9px 12px',textAlign:'right',color:'#64748b'}}>
                  {m.capPct.toFixed(2)}%
                </td>
                <td style={{padding:'9px 12px',textAlign:'right',color:'#0f172a'}}>
                  {fmt(m.effectiveInvested)}
                </td>
                <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,
                  color:m.profitShare>=0?'#15803d':'#dc2626'}}>
                  {fmtSigned(m.profitShare)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{background:'#f0f9ff',borderTop:'2px solid #bae6fd'}}>
              <td style={{padding:'9px 12px',fontWeight:700}}>Total</td>
              <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'#15803d'}}>
                {fmt(totalCapital)}
              </td>
              <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'#64748b'}}>
                100%
              </td>
              <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700}}>
                {fmt(project.investedAmount)}
              </td>
              <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,
                color:netProfit>=0?'#15803d':'#dc2626'}}>
                {fmtSigned(netProfit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Project Form Modal (create / edit) ────────────────────────────────────────

function ProjectModal({ project, onClose, onSave, saving, members }) {
  const isEdit = !!project?.id;
  // Dual fund source: fundSources.investment + fundSources.reserve
  // Legacy: fundSource = 'investment' | 'reserve' (single) → migrate
  const legacyFS = project?.fundSource;
  const initFS   = project?.fundSources || (
    legacyFS === 'reserve'
      ? { investment: 0,                        reserve: project?.investedAmount ?? '' }
      : { investment: project?.investedAmount ?? '', reserve: 0 }
  );

  // Participating members: 'all' or array of uids
  const initPartic = project?.participatingMembers ?? 'all';

  const [form, setForm] = useState({
    title:               project?.title              || '',
    type:                project?.type               || 'Musharaka',
    returnType:          project?.returnType         || 'lump_sum',
    sector:              project?.sector             || '',
    description:         project?.description        || '',
    investedAmount:      project?.investedAmount     ?? '',
    expectedReturnPct:   project?.expectedReturnPct  ?? '',
    actualReturnAmount:  project?.actualReturnAmount ?? '',
    status:              project?.status             || 'proposed',
    startDate:           project?.startDate          || '',
    completedDate:       project?.completedDate      || '',
    notes:               project?.notes              || '',
    // Phase 3B: dual fund source amounts
    fundInvestment:      initFS.investment ?? '',
    fundReserve:         initFS.reserve    ?? 0,
    // Phase 3A: participating members
    participatingMembers: Array.isArray(initPartic) ? initPartic : 'all',
  });
  const set = (k,v) => setForm(p => ({...p,[k]:v}));

  const invested      = Number(form.investedAmount)||0;
  const isLump        = form.returnType === 'lump_sum';
  const showActual    = isLump && (form.status === 'completed' || form.status === 'active');
  const returned      = Number(form.actualReturnAmount)||0;
  const lumpProfit    = showActual && form.actualReturnAmount !== '' ? returned - invested : null;
  const expectedRet   = invested * (Number(form.expectedReturnPct)||0) / 100;

  const handleSave = () => {
    if (!form.title.trim())   return alert('Title is required.');
    if (invested <= 0)        return alert('Invested amount must be positive.');
    if (isLump && form.status === 'completed' && form.actualReturnAmount === '')
      return alert('Actual return amount is required for completed lump-sum projects.');
    const fi = Number(form.fundInvestment)||0;
    const fr = Number(form.fundReserve)||0;
    onSave({
      ...form,
      returnType:          form.returnType,
      // Phase 3B: dual fund source — keep legacy fundSource for backward compat
      fundSource:          fr > 0 && fi === 0 ? 'reserve' : 'investment',
      fundSources:         { investment: fi, reserve: fr },
      investedAmount:      invested,
      expectedReturnPct:   Number(form.expectedReturnPct)||0,
      actualReturnAmount:  isLump && form.actualReturnAmount !== '' ? returned : null,
      profit:              isLump && lumpProfit !== null ? lumpProfit : null,
      // Phase 3A: participating members
      participatingMembers: form.participatingMembers,
    });
  };

  return (
    <Modal title={isEdit ? 'Edit Investment Project' : 'New Investment Project'} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:16}}>

        {/* Title */}
        <div>
          <label className="form-label">Project Title *</label>
          <input value={form.title} onChange={e=>set('title',e.target.value)}
            placeholder="e.g. Rice Farm Partnership 2024"/>
        </div>

        {/* Type + Return type */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <label className="form-label">Investment Type *</label>
            <select value={form.type} onChange={e=>set('type',e.target.value)}>
              {INVESTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Return Pattern *</label>
            <select value={form.returnType} onChange={e=>set('returnType',e.target.value)}>
              <option value="lump_sum">Lump Sum (profit at end)</option>
              <option value="periodic">Periodic (ongoing returns)</option>
            </select>
            <div style={{fontSize:11,color:'#64748b',marginTop:3}}>
              {form.returnType === 'periodic'
                ? 'Rent, dividends, monthly profit — returns logged over time.'
                : 'Capital returned once at project end with profit or loss.'}
            </div>
          </div>
          {/* Phase 3B: dual fund source */}
          <div style={{gridColumn:'1 / -1'}}>
            <label className="form-label">Fund Source Amounts *</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:'#2563eb',marginBottom:4}}>
                  📈 Investment Fund (৳)
                </div>
                <input type="number" min="0"
                  value={form.fundInvestment}
                  onChange={e=>set('fundInvestment',e.target.value)}
                  placeholder="Amount from investment fund"/>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:'#16a34a',marginBottom:4}}>
                  🛡 Reserve Fund (৳)
                </div>
                <input type="number" min="0"
                  value={form.fundReserve}
                  onChange={e=>set('fundReserve',e.target.value)}
                  placeholder="0 (optional overflow)"/>
              </div>
            </div>
            {(() => {
              const fi = Number(form.fundInvestment)||0;
              const fr = Number(form.fundReserve)||0;
              const tot = fi+fr;
              const inv = Number(form.investedAmount)||0;
              if (!tot || !inv) return null;
              const match = tot === inv;
              return (
                <div style={{marginTop:6,fontSize:11,padding:'5px 10px',borderRadius:6,
                  background:match?'#f0fdf4':'#fef3c7',
                  color:match?'#15803d':'#92400e'}}>
                  {match
                    ? `✅ ${fmt(fi)} investment + ${fmt(fr)} reserve = ${fmt(tot)}`
                    : `⚠️ Fund total ${fmt(tot)} ≠ invested ${fmt(inv)} — adjust amounts`}
                </div>
              );
            })()}
            <div style={{fontSize:11,color:'#64748b',marginTop:4}}>
              Primary source is Investment Fund. Use Reserve Fund for overflow or conservative projects.
            </div>
          </div>
        </div>

        {/* Sector + Description */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <label className="form-label">Sector / Industry</label>
            <input value={form.sector} onChange={e=>set('sector',e.target.value)}
              placeholder="e.g. Agriculture, Real Estate"/>
          </div>
          <div>
            <label className="form-label">Description</label>
            <input value={form.description} onChange={e=>set('description',e.target.value)}
              placeholder="Brief description"/>
          </div>
        </div>

        {/* Financials */}
        <div style={{borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'9px 14px',background:'#f8fafc',fontWeight:700,
            fontSize:12,color:'#475569',textTransform:'uppercase',letterSpacing:'0.07em'}}>
            Financials
          </div>
          <div style={{padding:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label className="form-label">Invested Amount (৳) *</label>
              <input type="number" min="0" value={form.investedAmount}
                onChange={e=>set('investedAmount',e.target.value)} placeholder="0"/>
            </div>
            <div>
              <label className="form-label">Expected Return (%)</label>
              <input type="number" min="0" step="0.01" value={form.expectedReturnPct}
                onChange={e=>set('expectedReturnPct',e.target.value)} placeholder="0.00"/>
              {invested > 0 && Number(form.expectedReturnPct) > 0 && (
                <div style={{fontSize:11,color:'#16a34a',marginTop:3}}>
                  = {fmt(expectedRet)} expected
                </div>
              )}
            </div>

            {/* Lump sum: actual return when active/completed */}
            {showActual && (
              <div style={{gridColumn:'1 / -1'}}>
                <label className="form-label">
                  Actual Return Amount (৳)
                  {form.status==='completed' && <span style={{color:'#dc2626'}}> *</span>}
                </label>
                <input type="number" value={form.actualReturnAmount}
                  onChange={e=>set('actualReturnAmount',e.target.value)}
                  placeholder="Total returned (principal + profit, or less for a loss)"/>
                <div style={{fontSize:11,color:'#64748b',marginTop:3}}>
                  Enter the total amount received back. Less than invested = loss.
                </div>
                {lumpProfit !== null && (
                  <div style={{marginTop:8,padding:'8px 12px',borderRadius:8,fontSize:13,
                    background:lumpProfit>=0?'#f0fdf4':'#fef2f2',
                    color:lumpProfit>=0?'#15803d':'#b91c1c'}}>
                    {lumpProfit>=0?'📈 Profit':'📉 Loss'}: <strong>{fmtSigned(lumpProfit)}</strong>
                    &nbsp;({lumpProfit>=0?'+':''}{pct(invested>0?(lumpProfit/invested)*100:0)} ROI)
                  </div>
                )}
              </div>
            )}

            {/* Periodic: note about returns */}
            {form.returnType==='periodic' && (
              <div style={{gridColumn:'1 / -1',padding:'8px 12px',borderRadius:8,
                background:'#eff6ff',border:'1px solid #bfdbfe',fontSize:12,color:'#1e40af'}}>
                ℹ️ For periodic projects, individual return entries (rent, dividends, etc.) and
                expenses are recorded in the Returns and Expenses tabs after saving.
                Net profit is calculated automatically from those entries.
              </div>
            )}
          </div>
        </div>

        {/* Status + Dates */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12}}>
          <div>
            <label className="form-label">Status *</label>
            <select value={form.status} onChange={e=>set('status',e.target.value)}>
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Start Date</label>
            <input type="date" value={form.startDate} onChange={e=>set('startDate',e.target.value)}/>
          </div>
          {(form.status==='completed'||form.status==='cancelled') && (
            <div>
              <label className="form-label">
                {form.status==='completed'?'Completed Date':'Cancelled Date'}
              </label>
              <input type="date" value={form.completedDate}
                onChange={e=>set('completedDate',e.target.value)}/>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="form-label">Notes</label>
          <textarea value={form.notes} onChange={e=>set('notes',e.target.value)}
            rows={2} placeholder="Internal notes, partner details, etc."/>
        </div>

        {/* Phase 3A: Participating members */}
        <div style={{borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'9px 14px',background:'#f8fafc',fontWeight:700,
            fontSize:12,color:'#475569',textTransform:'uppercase',letterSpacing:'0.07em'}}>
            Participating Members
          </div>
          <div style={{padding:14}}>
            <div style={{fontSize:12,color:'#64748b',marginBottom:10}}>
              Only participating members' capital ratios count for this investment's profit/loss share.
              Non-participating members are excluded from this project entirely.
            </div>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              {[['all','All Members'],['specific','Specific Members']].map(([v,l]) => (
                <button type="button" key={v}
                  onClick={()=>set('participatingMembers', v==='all' ? 'all' : [])}
                  style={{padding:'7px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,
                    fontWeight:(form.participatingMembers==='all')===(v==='all')?700:400,
                    background:(form.participatingMembers==='all')===(v==='all')?'#0f172a':'#f1f5f9',
                    color:(form.participatingMembers==='all')===(v==='all')?'#fff':'#475569'}}>
                  {l}
                </button>
              ))}
            </div>
            {Array.isArray(form.participatingMembers) && (
              <div style={{border:'1px solid #e2e8f0',borderRadius:8,maxHeight:180,overflowY:'auto',padding:6}}>
                {members.filter(m=>m.approved).length === 0
                  ? <div style={{color:'#94a3b8',fontSize:13,textAlign:'center',padding:12}}>No approved members</div>
                  : members.filter(m=>m.approved).map(m => {
                      const checked = (form.participatingMembers||[]).includes(m.id);
                      return (
                        <label key={m.id} style={{display:'flex',alignItems:'center',gap:8,
                          padding:'6px 8px',borderRadius:6,cursor:'pointer',
                          background:checked?'#eff6ff':'transparent'}}>
                          <input type="checkbox" checked={checked}
                            onChange={e=>set('participatingMembers',
                              e.target.checked
                                ? [...(form.participatingMembers||[]),m.id]
                                : (form.participatingMembers||[]).filter(id=>id!==m.id)
                            )}/>
                          <span style={{fontSize:13,color:'#0f172a'}}>
                            {m.nameEnglish||m.id.slice(0,12)}
                          </span>
                          {m.idNo && <span style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</span>}
                        </label>
                      );
                    })}
              </div>
            )}
            {Array.isArray(form.participatingMembers) && (
              <div style={{marginTop:6,fontSize:11,color:'#64748b'}}>
                {form.participatingMembers.length} member(s) selected
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{display:'flex',gap:10,marginTop:24,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
        <button onClick={handleSave} disabled={saving} className="btn-primary"
          style={{padding:'10px 24px'}}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
        </button>
        <button onClick={onClose}
          style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
            background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ── Project Detail Modal ──────────────────────────────────────────────────────

function ProjectDetailModal({ project, onClose, onEdit, onDelete, saving, members, payments, orgData, orgId, isAdmin }) {
  const [tab,       setTab]       = useState('overview');
  const [liveCache, setLiveCache] = useState({});

  const handleCacheUpdate = useCallback((updates) => {
    setLiveCache(prev => ({...prev,...updates}));
  }, []);

  // Net profit — merge cached sub-collection totals with project doc values
  const totalReturns  = liveCache?.totalReturns  ?? project.totalReturns  ?? 0;
  const totalExpenses = liveCache?.totalExpenses ?? project.totalExpenses ?? 0;
  const netProfit = project.returnType === 'periodic'
    ? totalReturns - totalExpenses
    : (project.profit ?? null);

  const isPeriodic = project.returnType === 'periodic';

  const TABS = [
    ['overview', 'Overview'],
    ['returns',  `Returns${isPeriodic ? ` (${fmt(totalReturns)})` : ''}`],
    ['expenses', `Expenses${isPeriodic ? ` (${fmt(totalExpenses)})` : ''}`],
    ['members',  'Member Shares'],
  ];

  return (
    <Modal title={project.title} onClose={onClose}>
      {/* Type + Status row */}
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:20}}>
        <span style={{padding:'3px 10px',borderRadius:6,background:'#eff6ff',
          color:'#1d4ed8',fontSize:12,fontWeight:700}}>{project.type}</span>
        <span style={{padding:'3px 10px',borderRadius:6,
          background:isPeriodic?'#faf5ff':'#f0fdf4',
          color:isPeriodic?'#7e22ce':'#14532d',fontSize:12,fontWeight:700}}>
          {isPeriodic ? '🔄 Periodic' : '📦 Lump Sum'}
        </span>
        {/* Phase 3B: show dual fund sources */}
        {project.fundSources && (Number(project.fundSources.investment)||0) > 0 && (
          <span style={{padding:'3px 10px',borderRadius:6,background:'#eff6ff',
            color:'#2563eb',fontSize:12,fontWeight:700}}>
            📈 {fmt(project.fundSources.investment)} inv.
          </span>
        )}
        {project.fundSources && (Number(project.fundSources.reserve)||0) > 0 && (
          <span style={{padding:'3px 10px',borderRadius:6,background:'#f0fdf4',
            color:'#15803d',fontSize:12,fontWeight:700}}>
            🛡 {fmt(project.fundSources.reserve)} res.
          </span>
        )}
        {!project.fundSources && (
          <span style={{padding:'3px 10px',borderRadius:6,
            background:project.fundSource==='reserve'?'#f0fdf4':'#eff6ff',
            color:project.fundSource==='reserve'?'#15803d':'#2563eb',fontSize:12,fontWeight:700}}>
            {project.fundSource==='reserve'?'🛡 Reserve Fund':'📈 Investment Fund'}
          </span>
        )}
        {/* Phase 3A: participating members badge */}
        {project.participatingMembers && project.participatingMembers !== 'all' && (
          <span style={{padding:'3px 10px',borderRadius:6,background:'#faf5ff',
            color:'#7c3aed',fontSize:12,fontWeight:700}}>
            👥 {(project.participatingMembers||[]).length} participants
          </span>
        )}
        <StatusBadge status={project.status}/>
        {project.sector && <span style={{fontSize:12,color:'#94a3b8'}}>· {project.sector}</span>}
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab}/>

      {/* OVERVIEW TAB */}
      {tab==='overview' && (
        <div>
          {project.description && (
            <p style={{fontSize:13,color:'#475569',lineHeight:1.6,marginBottom:16,
              padding:'10px 14px',background:'#f8fafc',borderRadius:8}}>
              {project.description}
            </p>
          )}

          {/* Financial summary */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <Stat label="Invested"  value={fmt(project.investedAmount)} bg="#fef3c7" color="#92400e"/>
            {project.expectedReturnPct > 0 && (
              <Stat label="Expected Return"
                value={pct(project.expectedReturnPct)}
                sub={fmt(project.investedAmount * project.expectedReturnPct / 100)}
                bg="#f0fdf4" color="#15803d"/>
            )}
            {isPeriodic ? (
              <>
                <Stat label="Total Returns"  value={fmt(totalReturns)}  color="#15803d" bg="#f0fdf4"/>
                <Stat label="Total Expenses" value={fmt(totalExpenses)} color="#dc2626" bg="#fef2f2"/>
                <Stat label="Net Profit / Loss"
                  value={fmtSigned(netProfit)}
                  bg={netProfit>=0?'#f0fdf4':'#fef2f2'}
                  color={netProfit>=0?'#15803d':'#dc2626'}/>
              </>
            ) : (
              project.actualReturnAmount != null && (
                <>
                  <Stat label="Returned"    value={fmt(project.actualReturnAmount)} bg="#eff6ff" color="#1d4ed8"/>
                  <Stat label={netProfit>=0?'Profit':'Loss'}
                    value={fmtSigned(netProfit)}
                    sub={`${netProfit>=0?'+':''}${pct(project.investedAmount>0?(netProfit/project.investedAmount)*100:0)} ROI`}
                    bg={netProfit>=0?'#f0fdf4':'#fef2f2'}
                    color={netProfit>=0?'#15803d':'#dc2626'}/>
                </>
              )
            )}
          </div>

          {/* Dates + meta */}
          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:12}}>
            {project.startDate     && <div style={{fontSize:12,color:'#64748b'}}>📅 Started: <strong>{project.startDate}</strong></div>}
            {project.completedDate && <div style={{fontSize:12,color:'#64748b'}}>🏁 Completed: <strong>{project.completedDate}</strong></div>}
            <div style={{fontSize:12,color:'#64748b'}}>📝 Created: <strong>{tsDate(project.createdAt)}</strong></div>
          </div>

          {project.notes && (
            <div style={{padding:'10px 14px',borderRadius:8,background:'#fffbeb',
              border:'1px solid #fde68a',fontSize:13,color:'#78350f'}}>
              <strong>Notes:</strong> {project.notes}
            </div>
          )}

          {/* Loss callout */}
          {netProfit !== null && netProfit < 0 && (
            <div style={{marginTop:12,padding:'10px 14px',borderRadius:8,background:'#fef2f2',
              border:'1px solid #fca5a5',fontSize:13,color:'#b91c1c'}}>
              📉 <strong>Loss recorded:</strong> {fmtSigned(netProfit)}.
              When included in a Profit Distribution, this loss will reduce the distributable amount.
              If the total across all selected projects is still negative, members will absorb
              a proportional loss recorded against their capital.
            </div>
          )}

          {project.status==='completed' && netProfit !== null && (
            <div style={{marginTop:12,padding:'10px 14px',borderRadius:8,
              background:netProfit>=0?'#f0fdf4':'#fef2f2',
              border:`1px solid ${netProfit>=0?'#86efac':'#fca5a5'}`,fontSize:13,
              color:netProfit>=0?'#14532d':'#b91c1c'}}>
              ✅ This project is completed and can be selected in a{' '}
              <a href="/admin/distribution" style={{color:'#2563eb'}}>Profit Distribution</a>.
            </div>
          )}
        </div>
      )}

      {/* RETURNS TAB */}
      {tab==='returns' && (
        <ReturnsTab
          project={project} orgId={orgId} isAdmin={isAdmin}
          onCacheUpdate={handleCacheUpdate}/>
      )}

      {/* EXPENSES TAB */}
      {tab==='expenses' && (
        <ExpensesTab
          project={project} orgId={orgId} isAdmin={isAdmin}
          onCacheUpdate={handleCacheUpdate}/>
      )}

      {/* MEMBER SHARES TAB */}
      {tab==='members' && (
        <MemberSharesTab
          project={project} members={members} payments={payments}
          orgData={orgData} liveCache={liveCache}/>
      )}

      {/* Actions */}
      <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
        {isAdmin && (
          <button onClick={onEdit} className="btn-primary" style={{padding:'10px 20px'}}>
            Edit Project
          </button>
        )}
        {isAdmin && project.status==='proposed' && (
          <button onClick={() => onDelete(project)}
            style={{padding:'10px 20px',borderRadius:8,border:'1px solid #fca5a5',
              background:'#fff',cursor:'pointer',fontSize:13,color:'#dc2626'}}>
            Delete
          </button>
        )}
        <button onClick={onClose}
          style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
            background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b',marginLeft:'auto'}}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminProjects() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [projects,  setProjects]  = useState([]);
  const [members,   setMembers]   = useState([]);
  const [payments,  setPayments]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [editing,   setEditing]   = useState(null);
  const [filter,    setFilter]    = useState('all');
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    // Projects — live
    const unsubProj = onSnapshot(
      query(collection(db,'organizations',orgId,'investmentProjects'), orderBy('createdAt','desc')),
      snap => {
        setProjects(snap.docs.map(d=>({id:d.id,...d.data()})));
        setLoading(false);
      }
    );
    // Members + payments — one-time fetch (no need for live here)
    (async () => {
      const [memSnap, paySnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(collection(db,'organizations',orgId,'investments')),
      ]);
      const rawMembers = memSnap.docs.map(d=>({id:d.id,...d.data()}));
      // Enrich with user profiles (using top-level getDoc import)
      const enriched = await Promise.all(rawMembers.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists()?{...u.data(),...m}:m; }
        catch { return m; }
      }));
      setMembers(enriched);
      setPayments(paySnap.docs.map(d=>({id:d.id,...d.data()})));
    })();
    return () => unsubProj();
  }, [orgId]);

  const handleSave = async (payload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateDoc(doc(db,'organizations',orgId,'investmentProjects',editing.id),
          {...payload, updatedAt:serverTimestamp()});
        showToast('✅ Project updated!');
        // Keep selected in sync
        setSelected(prev => prev?.id===editing.id ? {...prev,...payload} : prev);
      } else {
        await addDoc(collection(db,'organizations',orgId,'investmentProjects'),
          {...payload, createdBy:user.uid, createdAt:serverTimestamp()});
        showToast('✅ Project created!');
      }
      setEditing(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleDelete = async (project) => {
    if (!confirm(`Delete "${project.title}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db,'organizations',orgId,'investmentProjects',project.id));
      setSelected(null);
      showToast('Project deleted.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  if (!isOrgAdmin) return null;

  const filtered = filter==='all' ? projects : projects.filter(p=>p.status===filter);

  // Summary stats
  const totalInvested = projects.reduce((s,p)=>s+(p.investedAmount||0),0);
  const active        = projects.filter(p=>p.status==='active');
  const completed     = projects.filter(p=>p.status==='completed');

  // Net profit across all completed projects
  const totalNetProfit = completed.reduce((s,p) => {
    if (p.returnType==='periodic') return s + ((p.totalReturns||0)-(p.totalExpenses||0));
    return s + (p.profit||0);
  }, 0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Investment Portfolio</div>
            <div className="page-subtitle">
              Track projects (lump-sum and periodic). Completed projects feed into Profit Distribution.
            </div>
          </div>
          <button onClick={()=>setEditing({})} className="btn-primary"
            style={{padding:'10px 20px',flexShrink:0,marginTop:4}}>
            + New Project
          </button>
        </div>
      </div>

      {toast && (
        <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,
          background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',
          color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>
          {toast}
        </div>
      )}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Invested"  value={fmt(totalInvested)}   bg="#fef3c7" color="#92400e"/>
        <Stat label="Active"          value={active.length}        bg="#dbeafe" color="#1e40af"/>
        <Stat label="Completed"       value={completed.length}     bg="#dcfce7" color="#14532d"/>
        <Stat label="Net Profit / Loss"
          value={fmtSigned(totalNetProfit)}
          bg={totalNetProfit>=0?'#f0fdf4':'#fef2f2'}
          color={totalNetProfit>=0?'#15803d':'#dc2626'}/>
      </div>

      {/* Ready for distribution hint */}
      {completed.filter(p => p.returnType==='lump_sum' ? p.profit!=null : true).length > 0 && (
        <div style={{padding:'10px 14px',borderRadius:10,background:'#eff6ff',
          border:'1px solid #bfdbfe',fontSize:13,color:'#1e40af',marginBottom:20}}>
          💡 <strong>{completed.length} completed project(s)</strong> are ready to be included in a{' '}
          <a href="/admin/distribution" style={{color:'#2563eb',textDecoration:'underline'}}>
            Profit Distribution
          </a>.
        </div>
      )}

      {/* Filter tabs */}
      <div style={{display:'flex',gap:6,marginBottom:20,flexWrap:'wrap'}}>
        {[['all','All',projects.length],...STATUSES.map(s=>[s.key,s.label,projects.filter(p=>p.status===s.key).length])].map(([key,label,count]) => (
          <button key={key} onClick={()=>setFilter(key)}
            style={{padding:'6px 14px',borderRadius:99,fontSize:12,cursor:'pointer',
              fontWeight:filter===key?700:400,border:'none',
              background:filter===key?'#0f172a':'#f1f5f9',
              color:filter===key?'#fff':'#64748b'}}>
            {label} {count>0 && <span style={{opacity:0.7}}>({count})</span>}
          </button>
        ))}
      </div>

      {/* Project cards */}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px 20px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:40,marginBottom:12}}>💹</div>
          <div style={{fontWeight:600,fontSize:16,color:'#0f172a',marginBottom:6}}>
            {filter==='all' ? 'No investment projects yet' : `No ${filter} projects`}
          </div>
          {filter==='all' && (
            <button onClick={()=>setEditing({})} className="btn-primary"
              style={{padding:'10px 24px',marginTop:8}}>
              + New Project
            </button>
          )}
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          {/* Table header */}
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',
            padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Project','Type','Status','Invested','Profit / Loss'].map(h => (
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',
                textAlign:h==='Project'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {filtered.map((p,i) => {
            const sc = STATUS_MAP[p.status]||STATUS_MAP.proposed;
            const isPeriodic = p.returnType==='periodic';
            const netP = isPeriodic
              ? (p.totalReturns||0)-(p.totalExpenses||0)
              : (p.profit??null);
            return (
              <div key={p.id} onClick={()=>setSelected(p)}
                style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',
                  padding:'11px 16px',cursor:'pointer',
                  background:i%2===0?'#fff':'#fafafa',
                  borderBottom:'1px solid #f1f5f9',
                  transition:'background 0.1s'}}
                onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
                {/* Project name */}
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#0f172a',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {p.title}
                  </div>
                  {p.sector && <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{p.sector}</div>}
                </div>
                {/* Type + return pattern */}
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:12,color:'#475569',fontWeight:500}}>{p.type}</div>
                  <div style={{fontSize:11,color:isPeriodic?'#7e22ce':'#15803d',marginTop:1}}>
                    {isPeriodic?'🔄 Periodic':'📦 Lump Sum'}
                  </div>
                </div>
                {/* Status */}
                <div style={{textAlign:'right',paddingRight:4}}>
                  <StatusBadge status={p.status}/>
                </div>
                {/* Invested */}
                <div style={{textAlign:'right',fontWeight:600,fontSize:13,color:'#92400e'}}>
                  {fmt(p.investedAmount)}
                  {isPeriodic && p.totalReturns > 0 && (
                    <div style={{fontSize:11,color:'#15803d',fontWeight:400}}>
                      {fmt(p.totalReturns||0)} returned
                    </div>
                  )}
                </div>
                {/* Profit / Loss */}
                <div style={{textAlign:'right',fontWeight:700,fontSize:13,
                  color:netP===null?'#94a3b8':netP>=0?'#15803d':'#dc2626'}}>
                  {netP===null
                    ? (p.expectedReturnPct ? pct(p.expectedReturnPct)+' exp.' : '—')
                    : fmtSigned(netP)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {selected && !editing && (
        <ProjectDetailModal
          project={selected}
          onClose={()=>setSelected(null)}
          onEdit={()=>{setEditing(selected);setSelected(null);}}
          onDelete={handleDelete}
          saving={saving}
          members={members}
          payments={payments}
          orgData={orgData}
          orgId={orgId}
          isAdmin={isOrgAdmin}
        />
      )}

      {/* Form modal */}
      {editing && (
        <ProjectModal
          project={editing?.id ? editing : null}
          onClose={()=>setEditing(null)}
          onSave={handleSave}
          saving={saving}
          members={members}
        />
      )}
    </div>
  );
}