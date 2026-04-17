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
  const [investmentPaidUids, setInvestmentPaidUids] = useState(new Set());
  const [search,    setSearch]    = useState('');
  const [feeTabState, setFeeTabState] = useState('records'); // 'records'|'paid'|'unpaid'
  const feeTab = feeTabState;

  // Add form state
  const [form, setForm] = useState({ userId:'', amount:'', method:'Cash', paidAt:'', notes:'' });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    // Load members + check investments for entry_fee type payments
    (async () => {
      const [memSnap, invSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(collection(db,'organizations',orgId,'investments')),
      ]);
      const raw  = memSnap.docs.map(d=>({id:d.id,...d.data()}));
      const enriched = await Promise.all(raw.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists()?{...u.data(),...m}:m; }
        catch { return m; }
      }));
      setMembers(enriched.filter(m=>m.approved));

      // Find members who paid an entry_fee type sub via installment page
      const paidViaInv = new Set();
      invSnap.docs.forEach(d => {
        const data = d.data();
        if (data.status !== 'rejected' &&
            (data.paymentType === 'entry_fee' || data.specialSubType === 'entry_fee')) {
          paidViaInv.add(data.userId);
        }
      });
      setInvestmentPaidUids(paidViaInv);
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
      const { writeBatch: wb, getDocs: gd, collection: col,
              query: q2, where: w2, updateDoc: ud2, serverTimestamp: st2 } =
        await import('firebase/firestore');
      const batch = wb(db);

      // Write entry fee record
      const feeRef = doc(collection(db,'organizations',orgId,'entryFees'));
      batch.set(feeRef,{
        userId:form.userId, amount:Number(form.amount),
        method:form.method, paidAt:form.paidAt,
        notes:form.notes, recordedBy:user.uid, createdAt:serverTimestamp(),
        paymentType:    'entry_fee',
        isContribution: false,
      });
      // Mark member as entry fee paid
      batch.update(doc(db,'organizations',orgId,'members',form.userId),{entryFeePaid:true});
      await batch.commit();

      // Also verify any pending entry_fee type investment for this member
      // (in case they submitted via the installment page and it's still pending)
      try {
        const invSnap = await gd(q2(
          col(db,'organizations',orgId,'investments'),
          w2('userId','==',form.userId)
        ));
        const pending = invSnap.docs.filter(d => {
          const data = d.data();
          return data.status === 'pending' &&
            (data.paymentType === 'entry_fee' || data.specialSubType === 'entry_fee');
        });
        await Promise.all(pending.map(d =>
          ud2(d.ref, { status:'verified', verifiedAt:st2(), verifiedBy:user.uid })
        ));
      } catch (_) { /* non-critical */ }
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
  // A member is considered "paid" if either: admin recorded via entry-fees page (entryFeePaid flag)
  // OR they paid via the installment page special sub route (investmentPaidUids)
  const isPaid = (m) => m.entryFeePaid || investmentPaidUids.has(m.id);
  const paidCount   = members.filter(isPaid).length;
  const unpaidCount = members.filter(m => !isPaid(m)).length;

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

      {/* Tab bar */}
      {(() => {
        const [feeTab, setFeeTab] = [feeTabState, setFeeTabState];
        return null; // handled via state below
      })()}
      <div style={{display:'flex',gap:2,borderBottom:'2px solid #e2e8f0',marginBottom:20}}>
        {[
          ['records', `📋 Payment Records (${fees.length})`],
          ['paid',    `✅ Paid (${members.filter(isPaid).length})`],
          ['unpaid',  `⏳ Yet to Pay (${members.filter(m=>!isPaid(m)).length})`],
        ].map(([id,label]) => (
          <button key={id} onClick={() => setFeeTab(id)}
            style={{padding:'9px 16px',background:'none',border:'none',cursor:'pointer',
              fontSize:13,fontWeight:feeTab===id?700:400,whiteSpace:'nowrap',
              color:feeTab===id?'#2563eb':'#64748b',
              borderBottom:feeTab===id?'2px solid #2563eb':'2px solid transparent',
              marginBottom:-2}}>
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Search by member name or ID…"
        style={{width:'100%',padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',
          fontSize:13,marginBottom:16,boxSizing:'border-box'}}/>

      {/* ── PAYMENT RECORDS TAB ── */}
      {feeTab === 'records' && (loading ? (
        <div style={{textAlign:'center',padding:'60px 20px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No entry fee records yet</div>
          <button onClick={()=>setShowAdd(true)} className="btn-primary" style={{padding:'10px 24px',marginTop:8}}>+ Record Payment</button>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr auto',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Member','Amount','Method','Source','Date',''].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</div>
            ))}
          </div>
          {filtered.map((fee,i) => {
            const m = memberMap[fee.userId];
            const viaInstallment = investmentPaidUids.has(fee.userId) && !fee.recordedBy;
            return (
              <div key={fee.id} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr auto',padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',alignItems:'center'}}>
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
                <div>
                  <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:99,
                    background: fee.recordedBy ? '#f0fdf4' : '#eff6ff',
                    color:      fee.recordedBy ? '#15803d' : '#1d4ed8'}}>
                    {fee.recordedBy ? 'Admin entry' : 'Self-paid'}
                  </span>
                </div>
                <div style={{fontSize:12,color:'#64748b'}}>{fee.paidAt||tsDate(fee.createdAt)}</div>
                <button onClick={()=>handleDelete(fee)}
                  style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:13,padding:'4px 8px',borderRadius:4}}
                  title="Delete">✕</button>
              </div>
            );
          })}
        </div>
      ))}

      {/* ── PAID MEMBERS TAB ── */}
      {feeTab === 'paid' && (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          {members.filter(isPaid).length === 0 ? (
            <div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>
              No members have paid yet.
            </div>
          ) : members.filter(m => isPaid(m) && (
            !search ||
            (m.nameEnglish||m.name||'').toLowerCase().includes(search.toLowerCase()) ||
            (m.idNo||'').includes(search)
          )).map((m, i) => {
            const feeRecord = fees.find(f => f.userId === m.id);
            const viaInstallment = !feeRecord && investmentPaidUids.has(m.id);
            return (
              <div key={m.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'10px 16px',background:i%2===0?'#f0fdf4':'#fff',
                borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:'#dcfce7',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:11,fontWeight:700,color:'#15803d',flexShrink:0}}>
                    {initials(m.nameEnglish||m.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{m.nameEnglish||m.name}</div>
                    {m.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  {feeRecord ? (
                    <>
                      <div style={{fontWeight:700,color:'#15803d'}}>{fmt(feeRecord.amount)}</div>
                      <div style={{fontSize:11,color:'#94a3b8'}}>{feeRecord.paidAt||tsDate(feeRecord.createdAt)} · {feeRecord.method}</div>
                    </>
                  ) : (
                    <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:99,
                      background:'#eff6ff',color:'#1d4ed8'}}>
                      Paid via installment page
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── YET TO PAY TAB ── */}
      {feeTab === 'unpaid' && (
        members.filter(m => !isPaid(m)).length === 0 ? (
          <div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>
            <div style={{fontSize:28,marginBottom:8}}>🎉</div>
            <div style={{fontWeight:600,color:'#0f172a'}}>All members have paid!</div>
          </div>
        ) : (
          <div style={{borderRadius:12,border:'1px solid #fde68a',overflow:'hidden'}}>
            {members.filter(m => !isPaid(m) && (
              !search ||
              (m.nameEnglish||m.name||'').toLowerCase().includes(search.toLowerCase()) ||
              (m.idNo||'').includes(search)
            )).map((m,i) => (
              <div key={m.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'10px 16px',background:i%2===0?'#fffbeb':'#fefce8',
                borderBottom:'1px solid #fef3c7'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:'#fde68a',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:10,fontWeight:700,color:'#92400e'}}>
                    {initials(m.nameEnglish||m.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{m.nameEnglish||m.name}</div>
                    {m.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <button onClick={()=>{
                  setForm({userId:m.id,amount:defaultAmount||'',method:'Cash',
                    paidAt:new Date().toISOString().split('T')[0],notes:''});
                  setShowAdd(true);
                }} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #f59e0b',
                  background:'#fff',color:'#92400e',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  Record Fee
                </button>
              </div>
            ))}
          </div>
        )
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
                    {m.nameEnglish||m.name} {m.idNo?`(#${m.idNo})`:''} {isPaid(m)?'✓ Paid':''}
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