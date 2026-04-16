// src/app/admin/entry-fees/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, getDocs } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

const METHODS = ['Cash','bKash','Nagad','Rocket','Bank Transfer','Other'];

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

export default function AdminEntryFees() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [fees,      setFees]      = useState([]);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showAdd,   setShowAdd]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');
  const [search,    setSearch]    = useState('');

  // Add form state
  const [form, setForm] = useState({ userId:'', amount:'', method:'Cash', paidAt:'', notes:'' });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    // Load members once
    (async () => {
      const snap = await getDocs(collection(db,'organizations',orgId,'members'));
      const raw  = snap.docs.map(d=>({id:d.id,...d.data()}));
      const enriched = await Promise.all(raw.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists()?{...u.data(),...m}:m; }
        catch { return m; }
      }));
      setMembers(enriched.filter(m=>m.approved));
    })();

    return onSnapshot(
      query(collection(db,'organizations',orgId,'entryFees'), orderBy('createdAt','desc')),
      snap => { setFees(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
  }, [orgId]);

  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const defaultAmount = orgData?.settings?.entryFeeAmount || '';

  const handleAdd = async () => {
    if (!form.userId)  return alert('Select a member.');
    if (!form.amount || Number(form.amount)<=0) return alert('Enter a valid amount.');
    if (!form.paidAt)  return alert('Select payment date.');
    setSaving(true);
    try {
      const batch = (await import('firebase/firestore')).writeBatch(db);
      const feeRef = doc(collection(db,'organizations',orgId,'entryFees'));
      batch.set(feeRef,{
        userId:form.userId, amount:Number(form.amount),
        method:form.method, paidAt:form.paidAt,
        notes:form.notes, recordedBy:user.uid, createdAt:serverTimestamp(),
        // Phase 1: payment type taxonomy
        paymentType:    'entry_fee',
        isContribution: false,  // entry fees go to Expenses Fund by default
                                // (overridden to true only when countAsContribution is set on the special sub)
      });
      // Mark member as entry fee paid
      batch.update(doc(db,'organizations',orgId,'members',form.userId),{entryFeePaid:true});
      await batch.commit();
      setShowAdd(false);
      setForm({userId:'',amount:defaultAmount||'',method:'Cash',paidAt:new Date().toISOString().split('T')[0],notes:''});
      showToast('✅ Entry fee recorded!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleDelete = async (fee) => {
    if (!confirm('Delete this entry fee record?')) return;
    try {
      await deleteDoc(doc(db,'organizations',orgId,'entryFees',fee.id));
      // Check if member has any other fee records before clearing the flag
      const remaining = fees.filter(f=>f.id!==fee.id && f.userId===fee.userId);
      if (remaining.length===0) {
        await updateDoc(doc(db,'organizations',orgId,'members',fee.userId),{entryFeePaid:false});
      }
      showToast('Deleted.');
    } catch(e) { showToast('Error: '+e.message); }
  };

  if (!isOrgAdmin) return null;

  const filtered = search
    ? fees.filter(f => {
        const m = memberMap[f.userId];
        const name = (m?.nameEnglish||m?.name||'').toLowerCase();
        return name.includes(search.toLowerCase()) || (m?.idNo||'').includes(search);
      })
    : fees;

  const totalCollected  = fees.reduce((s,f)=>s+(f.amount||0),0);
  const paidCount       = [...new Set(fees.map(f=>f.userId))].length;
  const unpaidCount     = members.filter(m=>!m.entryFeePaid).length;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Entry Fee Tracking</div>
            <div className="page-subtitle">
              Record and track one-time membership entry fees.
              {defaultAmount ? ` Standard amount: ${fmt(defaultAmount)}.` : ''}
            </div>
          </div>
          <button onClick={()=>{setForm({userId:'',amount:defaultAmount||'',method:'Cash',paidAt:new Date().toISOString().split('T')[0],notes:''});setShowAdd(true);}} className="btn-primary" style={{padding:'10px 20px',flexShrink:0}}>
            + Record Payment
          </button>
        </div>
      </div>

      {toast && <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>{toast}</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Collected" value={fmt(totalCollected)} color="#15803d" bg="#f0fdf4"/>
        <Stat label="Members Paid"    value={paidCount}           color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Yet to Pay"      value={unpaidCount}         color="#92400e" bg="#fef3c7"/>
        <Stat label="Total Payments"  value={fees.length}         bg="#f8fafc"/>
      </div>

      {/* Unpaid members banner */}
      {unpaidCount > 0 && (
        <div style={{padding:'10px 14px',borderRadius:10,background:'#fffbeb',border:'1px solid #fde68a',fontSize:13,color:'#92400e',marginBottom:16}}>
          ⚠️ <strong>{unpaidCount} member(s)</strong> have not paid their entry fee yet.
        </div>
      )}

      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Search by member name or ID…"
        style={{width:'100%',padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',
          fontSize:13,marginBottom:16,boxSizing:'border-box'}}/>

      {/* Table */}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px 20px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No entry fee records yet</div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 24px',marginTop:8}}>+ Record Payment</button>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr auto',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Member','Amount','Method','Date',''].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</div>
            ))}
          </div>
          {filtered.map((fee,i) => {
            const m = memberMap[fee.userId];
            return (
              <div key={fee.id} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr auto',padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:30,height:30,borderRadius:'50%',background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                    {initials(m?.nameEnglish||m?.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{m?.nameEnglish||m?.name||'Unknown'}</div>
                    {m?.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <div style={{fontWeight:700,color:'#15803d'}}>{fmt(fee.amount)}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{fee.method}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{fee.paidAt||tsDate(fee.createdAt)}</div>
                <button onClick={()=>handleDelete(fee)}
                  style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:13,padding:'4px 8px',borderRadius:4}}
                  title="Delete">✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Unpaid members list */}
      {members.filter(m=>!m.entryFeePaid).length > 0 && (
        <div style={{marginTop:24}}>
          <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:10}}>Members Yet to Pay</div>
          <div style={{borderRadius:12,border:'1px solid #fde68a',overflow:'hidden'}}>
            {members.filter(m=>!m.entryFeePaid).map((m,i)=>(
              <div key={m.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 16px',background:i%2===0?'#fffbeb':'#fefce8',borderBottom:'1px solid #fef3c7'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#fde68a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#92400e'}}>{initials(m.nameEnglish||m.name)}</div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{m.nameEnglish||m.name}</div>
                    {m.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <button onClick={()=>{setForm({userId:m.id,amount:defaultAmount||'',method:'Cash',paidAt:new Date().toISOString().split('T')[0],notes:''});setShowAdd(true);}}
                  style={{padding:'6px 14px',borderRadius:8,border:'1px solid #f59e0b',background:'#fff',color:'#92400e',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  Record Fee
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <Modal title="Record Entry Fee Payment" onClose={()=>setShowAdd(false)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label className="form-label">Member *</label>
              <select value={form.userId} onChange={e=>set('userId',e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m=>(
                  <option key={m.id} value={m.id}>
                    {m.nameEnglish||m.name} {m.idNo?`(#${m.idNo})`:''} {m.entryFeePaid?'✓ Paid':''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label className="form-label">Amount (৳) *</label>
                <input type="number" min="0" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder={defaultAmount||'0'}/>
              </div>
              <div>
                <label className="form-label">Payment Method</label>
                <select value={form.method} onChange={e=>set('method',e.target.value)}>
                  {METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Payment Date *</label>
                <input type="date" value={form.paidAt} onChange={e=>set('paidAt',e.target.value)}/>
              </div>
              <div>
                <label className="form-label">Notes</label>
                <input type="text" value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional notes"/>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleAdd} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'Record Payment'}
            </button>
            <button onClick={()=>setShowAdd(false)} style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}