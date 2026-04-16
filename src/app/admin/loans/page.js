// src/app/admin/loans/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc, addDoc, updateDoc,
  query, orderBy, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

const STATUSES = {
  pending:   {label:'Pending',   color:'#92400e',bg:'#fef3c7',dot:'#f59e0b'},
  approved:  {label:'Approved',  color:'#1e40af',bg:'#dbeafe',dot:'#2563eb'},
  disbursed: {label:'Disbursed', color:'#14532d',bg:'#dcfce7',dot:'#16a34a'},
  repaid:    {label:'Repaid',    color:'#6b7280',bg:'#f3f4f6',dot:'#9ca3af'},
  rejected:  {label:'Rejected',  color:'#7f1d1d',bg:'#fee2e2',dot:'#dc2626'},
};

function StatusBadge({status}) {
  const c=STATUSES[status]||STATUSES.pending;
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,background:c.bg,color:c.color}}><span style={{width:6,height:6,borderRadius:'50%',background:c.dot,display:'inline-block'}}/>{c.label}</span>;
}

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

const PURPOSES = ['Business','Education','Medical','Home Repair','Emergency','Other'];

export default function AdminLoans() {
  const { user, userData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [loans,    setLoans]    = useState([]);
  const [members,  setMembers]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [filter,   setFilter]   = useState('all');
  const [repayForm,setRepayForm]= useState({amount:'',date:new Date().toISOString().split('T')[0],notes:''});
  const [showRepay,setShowRepay]= useState(false);

  const [form, setForm] = useState({userId:'',amount:'',purpose:'Business',purposeDescription:'',repaymentMonths:12});
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const snap = await getDocs(collection(db,'organizations',orgId,'members'));
      const raw  = snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const enriched = await Promise.all(raw.map(async m => {
        try { const u=await getDoc(doc(db,'users',m.id)); return u.exists()?{...u.data(),...m}:m; } catch { return m; }
      }));
      setMembers(enriched);
    })();
    return onSnapshot(
      query(collection(db,'organizations',orgId,'loans'),orderBy('createdAt','desc')),
      snap => { setLoans(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
  }, [orgId]);

  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));

  const handleCreate = async () => {
    if (!form.userId)  return alert('Select a member.');
    if (Number(form.amount)<=0) return alert('Enter a valid amount.');
    setSaving(true);
    try {
      const monthly = Math.round(Number(form.amount)/Number(form.repaymentMonths||1));
      await addDoc(collection(db,'organizations',orgId,'loans'),{
        userId:form.userId, amount:Number(form.amount), purpose:form.purpose,
        purposeDescription:form.purposeDescription, status:'pending',
        repaymentMonths:Number(form.repaymentMonths||12), monthlyInstallment:monthly,
        totalRepaid:0, outstandingBalance:Number(form.amount),
        repayments:[], forgiven:false,
        createdBy:user.uid, createdAt:serverTimestamp(),
      });
      setShowAdd(false);
      setForm({userId:'',amount:'',purpose:'Business',purposeDescription:'',repaymentMonths:12});
      showToast('✅ Loan request created!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleApprove = async (loan) => {
    if (!confirm(`Approve this loan of ${fmt(loan.amount)} for ${memberMap[loan.userId]?.nameEnglish||'member'}?`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'loans',loan.id),{status:'approved',approvedBy:user.uid,approvedAt:serverTimestamp()});
      setSelected(prev=>prev?.id===loan.id?{...prev,status:'approved'}:prev);
      showToast('✅ Loan approved!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleDisbursed = async (loan) => {
    if (!confirm('Mark as disbursed (funds given to member)?')) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'loans',loan.id),{status:'disbursed',disbursedAt:serverTimestamp()});
      setSelected(prev=>prev?.id===loan.id?{...prev,status:'disbursed'}:prev);
      showToast('✅ Marked as disbursed!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleReject = async (loan) => {
    if (!confirm('Reject this loan request?')) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'loans',loan.id),{status:'rejected',rejectedBy:user.uid,rejectedAt:serverTimestamp()});
      setSelected(prev=>prev?.id===loan.id?{...prev,status:'rejected'}:prev);
      showToast('Loan rejected.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleRepayment = async (loan) => {
    if (Number(repayForm.amount)<=0) return alert('Enter a valid amount.');
    if (!repayForm.date)             return alert('Enter payment date.');
    setSaving(true);
    try {
      const amount   = Number(repayForm.amount);
      const newRepaid   = (loan.totalRepaid||0)+amount;
      const newBalance  = Math.max(0,(loan.outstandingBalance||loan.amount||0)-amount);
      const newStatus   = newBalance<=0?'repaid':'disbursed';
      const repayments  = [...(loan.repayments||[]),{amount,date:repayForm.date,notes:repayForm.notes,recordedBy:user.uid,recordedAt:new Date().toISOString()}];
      await updateDoc(doc(db,'organizations',orgId,'loans',loan.id),{totalRepaid:newRepaid,outstandingBalance:newBalance,repayments,status:newStatus});
      const updated = {...loan,totalRepaid:newRepaid,outstandingBalance:newBalance,repayments,status:newStatus};
      setSelected(updated);
      setLoans(prev=>prev.map(l=>l.id===loan.id?updated:l));
      setShowRepay(false);
      setRepayForm({amount:'',date:new Date().toISOString().split('T')[0],notes:''});
      showToast(newBalance<=0?'✅ Loan fully repaid!':'✅ Repayment recorded!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  if (!isOrgAdmin) return null;

  const filtered = filter==='all'?loans:loans.filter(l=>l.status===filter);
  const totalDisbursed  = loans.filter(l=>['disbursed','repaid'].includes(l.status)).reduce((s,l)=>s+(l.amount||0),0);
  const totalOutstanding= loans.filter(l=>l.status==='disbursed').reduce((s,l)=>s+(l.outstandingBalance||0),0);
  const pendingCount    = loans.filter(l=>l.status==='pending').length;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Qard al-Hasan Loans</div>
            <div className="page-subtitle">Interest-free loans for members. Track applications, approvals, disbursements, and repayments.</div>
          </div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 20px',flexShrink:0}}>+ New Loan</button>
        </div>
      </div>

      {toast && <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>{toast}</div>}

      {pendingCount>0 && (
        <div style={{padding:'10px 14px',borderRadius:10,background:'#fffbeb',border:'1px solid #fde68a',fontSize:13,color:'#92400e',marginBottom:16}}>
          ⏳ <strong>{pendingCount} loan request(s)</strong> pending review. Click to approve or reject.
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Disbursed"  value={fmt(totalDisbursed)}   color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Outstanding"      value={fmt(totalOutstanding)}  color="#dc2626" bg="#fef2f2"/>
        <Stat label="Active Loans"     value={loans.filter(l=>l.status==='disbursed').length} bg="#f8fafc"/>
        <Stat label="Pending Requests" value={pendingCount}           color="#92400e" bg="#fef3c7"/>
      </div>

      {/* Filter tabs */}
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {[['all','All',loans.length],...Object.entries(STATUSES).map(([k,v])=>[k,v.label,loans.filter(l=>l.status===k).length])].map(([key,label,count])=>(
          <button key={key} onClick={()=>setFilter(key)}
            style={{padding:'6px 14px',borderRadius:99,fontSize:12,cursor:'pointer',fontWeight:filter===key?700:400,border:'none',background:filter===key?'#0f172a':'#f1f5f9',color:filter===key?'#fff':'#64748b'}}>
            {label} {count>0&&<span style={{opacity:0.7}}>({count})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🤝</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No loans yet</div>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Member','Amount','Outstanding','Status','Date'].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Member'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {filtered.map((l,i)=>{
            const m=memberMap[l.userId];
            return (
              <div key={l.id} onClick={()=>setSelected(l)}
                style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',padding:'11px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',cursor:'pointer',alignItems:'center'}}
                onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>{initials(m?.nameEnglish||m?.name)}</div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{m?.nameEnglish||m?.name||'Unknown'}</div>
                    <div style={{fontSize:11,color:'#94a3b8'}}>{l.purpose}</div>
                  </div>
                </div>
                <div style={{textAlign:'right',fontWeight:600,fontSize:13}}>{fmt(l.amount)}</div>
                <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:l.outstandingBalance>0?'#dc2626':'#15803d'}}>{l.status==='repaid'?'Fully repaid':fmt(l.outstandingBalance||0)}</div>
                <div style={{textAlign:'right'}}><StatusBadge status={l.status}/></div>
                <div style={{textAlign:'right',fontSize:12,color:'#64748b'}}>{tsDate(l.createdAt)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loan detail modal */}
      {selected && (
        <Modal title={`Loan — ${memberMap[selected.userId]?.nameEnglish||'Member'}`} onClose={()=>{setSelected(null);setShowRepay(false);}}>
          <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
            <StatusBadge status={selected.status}/>
            <span style={{fontSize:12,color:'#94a3b8'}}>Created {tsDate(selected.createdAt)}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:16}}>
            <Stat label="Loan Amount"      value={fmt(selected.amount)}                color="#1d4ed8" bg="#eff6ff"/>
            <Stat label="Total Repaid"     value={fmt(selected.totalRepaid||0)}        color="#15803d" bg="#f0fdf4"/>
            <Stat label="Outstanding"      value={fmt(selected.outstandingBalance||0)} color={(selected.outstandingBalance||0)>0?'#dc2626':'#15803d'} bg={(selected.outstandingBalance||0)>0?'#fef2f2':'#f0fdf4'}/>
            <Stat label="Monthly Installment" value={fmt(selected.monthlyInstallment||0)} bg="#f8fafc" sub={`${selected.repaymentMonths} months`}/>
          </div>
          <div style={{fontSize:13,color:'#475569',marginBottom:12}}>
            <strong>Purpose:</strong> {selected.purpose}{selected.purposeDescription?` — ${selected.purposeDescription}`:''}
          </div>

          {/* Repayment history */}
          {(selected.repayments||[]).length>0 && (
            <div style={{marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Repayment History</div>
              <div style={{borderRadius:8,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                {selected.repayments.map((r,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 12px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
                    <span style={{color:'#475569'}}>{r.date}</span>
                    <span style={{fontWeight:600,color:'#15803d'}}>{fmt(r.amount)}</span>
                    {r.notes && <span style={{fontSize:11,color:'#94a3b8'}}>{r.notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Record repayment form */}
          {showRepay && selected.status==='disbursed' && (
            <div style={{padding:'12px 14px',borderRadius:10,background:'#f0fdf4',border:'1px solid #86efac',marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>Record Repayment</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div>
                  <label className="form-label">Amount (৳) *</label>
                  <input type="number" min="0" value={repayForm.amount} onChange={e=>setRepayForm(p=>({...p,amount:e.target.value}))} placeholder="0"/>
                </div>
                <div>
                  <label className="form-label">Date *</label>
                  <input type="date" value={repayForm.date} onChange={e=>setRepayForm(p=>({...p,date:e.target.value}))}/>
                </div>
                <div style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Notes</label>
                  <input type="text" value={repayForm.notes} onChange={e=>setRepayForm(p=>({...p,notes:e.target.value}))} placeholder="Optional"/>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>handleRepayment(selected)} disabled={saving} className="btn-primary" style={{padding:'8px 20px',fontSize:13}}>{saving?'Saving…':'Record'}</button>
                <button onClick={()=>setShowRepay(false)} style={{padding:'8px 14px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{display:'flex',gap:8,paddingTop:16,borderTop:'1px solid #e2e8f0',flexWrap:'wrap'}}>
            {selected.status==='pending' && (<>
              <button onClick={()=>handleApprove(selected)} disabled={saving} className="btn-primary" style={{padding:'9px 20px'}}>✅ Approve</button>
              <button onClick={()=>handleReject(selected)} disabled={saving} style={{padding:'9px 20px',borderRadius:8,border:'1px solid #fca5a5',background:'#fff',cursor:'pointer',fontSize:13,color:'#dc2626'}}>✕ Reject</button>
            </>)}
            {selected.status==='approved' && (
              <button onClick={()=>handleDisbursed(selected)} disabled={saving} className="btn-primary" style={{padding:'9px 20px',background:'#16a34a'}}>💸 Mark Disbursed</button>
            )}
            {selected.status==='disbursed' && !showRepay && (
              <button onClick={()=>setShowRepay(true)} className="btn-primary" style={{padding:'9px 20px'}}>+ Record Repayment</button>
            )}
            <button onClick={()=>{setSelected(null);setShowRepay(false);}} style={{padding:'9px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b',marginLeft:'auto'}}>Close</button>
          </div>
        </Modal>
      )}

      {/* New loan modal */}
      {showAdd && (
        <Modal title="New Loan Request" onClose={()=>setShowAdd(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label className="form-label">Member *</label>
              <select value={form.userId} onChange={e=>set('userId',e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m=><option key={m.id} value={m.id}>{m.nameEnglish||m.name} {m.idNo?`(#${m.idNo})`:''}</option>)}
              </select>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label className="form-label">Loan Amount (৳) *</label>
                <input type="number" min="0" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0"/>
              </div>
              <div>
                <label className="form-label">Repayment Period (months)</label>
                <input type="number" min="1" value={form.repaymentMonths} onChange={e=>set('repaymentMonths',e.target.value)}/>
                {form.amount>0 && <div style={{fontSize:11,color:'#64748b',marginTop:3}}>≈ {fmt(Math.round(Number(form.amount)/Number(form.repaymentMonths||1)))} / month</div>}
              </div>
              <div>
                <label className="form-label">Purpose</label>
                <select value={form.purpose} onChange={e=>set('purpose',e.target.value)}>
                  {PURPOSES.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Description</label>
                <input type="text" value={form.purposeDescription} onChange={e=>set('purposeDescription',e.target.value)} placeholder="Brief description"/>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleCreate} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>{saving?'Saving…':'Create Loan'}</button>
            <button onClick={()=>setShowAdd(false)} style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
