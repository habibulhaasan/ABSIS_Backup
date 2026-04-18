// src/app/admin/entry-fees/page.js
// ENHANCED: Phase 2 - Mark as Paid + Reverse Accounting
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';
import { reverseEntryFee } from '@/lib/reverseAccountingUtils';

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
  const [feeTabState, setFeeTabState] = useState('records');
  const feeTab = feeTabState;

  // Modal for "Mark as Paid"
  const [markPaidModal, setMarkPaidModal] = useState(null);
  const [markPaidForm, setMarkPaidForm] = useState({ method: 'Cash', paidAt: new Date().toISOString().split('T')[0], notes: '' });
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

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
      const batch = writeBatch(db);

      // Write entry fee record
      const feeRef = doc(collection(db,'organizations',orgId,'entryFees'));
      batch.set(feeRef,{
        userId:form.userId, amount:Number(form.amount),
        method:form.method, paidAt:form.paidAt,
        notes:form.notes, recordedBy:user.uid, createdAt:serverTimestamp(),
        paymentType:    'entry_fee',
        isContribution: false,
        fundDestination: 'expenses_fund',  // NEW
        isReversed: false,                  // NEW
        metadata: { version: 2 },           // NEW
      });
      // Mark member as entry fee paid
      batch.update(doc(db,'organizations',orgId,'members',form.userId),{entryFeePaid:true});
      await batch.commit();

      // Also verify any pending entry_fee type investment for this member
      try {
        const invSnap = await getDocs(query(
          collection(db,'organizations',orgId,'investments'),
          query(collection(db,'organizations',orgId,'investments'),
            { [Symbol.for('where')]: [['userId','==',form.userId]] })
        ));
        const pending = invSnap.docs.filter(d => {
          const data = d.data();
          return data.status === 'pending' &&
            (data.paymentType === 'entry_fee' || data.specialSubType === 'entry_fee');
        });
        const batch2 = writeBatch(db);
        pending.forEach(d => {
          batch2.update(d.ref, { status:'verified', verifiedAt:serverTimestamp(), verifiedBy:user.uid });
        });
        if (pending.length > 0) await batch2.commit();
      } catch (_) { /* non-critical */ }
      
      setShowAdd(false);
      setForm({userId:'',amount:defaultAmount||'',method:'Cash',paidAt:new Date().toISOString().split('T')[0],notes:''});
      showToast('✅ Entry fee recorded!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  // NEW: Mark unpaid member as paid (admin override)
  const handleMarkPaid = async (memberId, memberName) => {
    setMarkPaidModal({ memberId, memberName });
    setMarkPaidForm({ method: 'Cash', paidAt: new Date().toISOString().split('T')[0], notes: 'Admin marked as paid' });
  };

  const confirmMarkPaid = async () => {
    if (!markPaidModal) return;
    setMarkPaidSaving(true);
    try {
      const batch = writeBatch(db);

      // Create entry fee record
      const feeRef = doc(collection(db,'organizations',orgId,'entryFees'));
      batch.set(feeRef,{
        userId: markPaidModal.memberId,
        amount: Number(orgData?.settings?.entryFeeAmount || 0),
        method: markPaidForm.method,
        paidAt: markPaidForm.paidAt,
        notes: markPaidForm.notes,
        recordedBy: user.uid,
        createdAt: serverTimestamp(),
        paymentType: 'entry_fee',
        isContribution: false,
        fundDestination: 'expenses_fund',  // NEW
        isReversed: false,                  // NEW
        metadata: { version: 2 },           // NEW
      });

      // Update member
      batch.update(doc(db,'organizations',orgId,'members',markPaidModal.memberId),{
        entryFeePaid: true
      });

      await batch.commit();
      
      setMarkPaidModal(null);
      setMarkPaidForm({ method: 'Cash', paidAt: new Date().toISOString().split('T')[0], notes: '' });
      showToast('✅ Member marked as paid!');
    } catch(e) { 
      showToast('Error: '+e.message); 
    }
    setMarkPaidSaving(false);
  };

  // NEW: Enhanced delete with reverse accounting
  const handleDelete = async (fee) => {
    if (!confirm('Delete this entry fee record? This will create a reversal entry.')) return;
    try {
      await reverseEntryFee(orgId, fee.id, 'Admin deletion', user.uid);
      showToast('✅ Entry fee reversed.');
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

      {unpaidCount > 0 && (
        <div style={{padding:'10px 14px',borderRadius:10,background:'#fffbeb',border:'1px solid #fde68a',fontSize:13,color:'#92400e',marginBottom:16}}>
          ⚠️ <strong>{unpaidCount} member(s)</strong> have not paid their entry fee yet.
        </div>
      )}

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
              <div key={fee.id} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr auto',padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',alignItems:'center',opacity:fee.isReversed?0.5:1}}>
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
                <div style={{fontSize:11,color:'#94a3b8'}}>{viaInstallment?'Installment':'Entry Fees'}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{tsDate(fee.paidAt||fee.createdAt)}</div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>handleDelete(fee)} style={{padding:'4px 8px',fontSize:11,border:'1px solid #fee2e2',background:'#fff5f5',color:'#dc2626',borderRadius:4,cursor:'pointer'}}>
                    {fee.isReversed ? '↩️ Reversed' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PAID MEMBERS TAB ── */}
      {feeTab === 'paid' && (
        <div style={{display:'grid',gap:10}}>
          {members.filter(isPaid).length === 0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'#94a3b8',borderRadius:10,background:'#f8fafc'}}>No paid members yet</div>
          ) : (
            members.filter(isPaid).map(m => (
              <div key={m.id} style={{padding:'12px 16px',borderRadius:8,background:'#f0fdf4',border:'1px solid #bbf7d0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#1d4ed8'}}>
                    {initials(m.nameEnglish||m.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:14,color:'#0f172a'}}>{m.nameEnglish||m.name}</div>
                    {m.idNo && <div style={{fontSize:11,color:'#64748b'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <div style={{fontSize:12,color:'#15803d',fontWeight:600}}>✅ Paid</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── UNPAID MEMBERS TAB ── */}
      {feeTab === 'unpaid' && (
        <div style={{display:'grid',gap:10}}>
          {members.filter(m=>!isPaid(m)).length === 0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'#94a3b8',borderRadius:10,background:'#f8fafc'}}>All members have paid!</div>
          ) : (
            members.filter(m=>!isPaid(m)).map(m => (
              <div key={m.id} style={{padding:'12px 16px',borderRadius:8,background:'#fffbeb',border:'1px solid #fcd34d',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#92400e'}}>
                    {initials(m.nameEnglish||m.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:14,color:'#0f172a'}}>{m.nameEnglish||m.name}</div>
                    {m.idNo && <div style={{fontSize:11,color:'#64748b'}}>#{m.idNo}</div>}
                  </div>
                </div>
                <button onClick={()=>handleMarkPaid(m.id, m.nameEnglish||m.name)} className="btn-ghost" style={{padding:'6px 14px',fontSize:12}}>
                  Mark as Paid
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal: Add/Record Entry Fee */}
      {showAdd && (
        <Modal onClose={()=>setShowAdd(false)}>
          <div style={{width:'100%',maxWidth:500}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:20}}>Record Entry Fee Payment</div>
            
            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Member</div>
              <select value={form.userId} onChange={e=>set('userId',e.target.value)}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13}}>
                <option value="">Select a member…</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.nameEnglish||m.name} #{m.idNo||'?'}</option>
                ))}
              </select>
            </label>

            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Amount</div>
              <input type="number" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder={defaultAmount?`Standard: ${defaultAmount}`:'0'}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </label>

            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Payment Method</div>
              <select value={form.method} onChange={e=>set('method',e.target.value)}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13}}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Payment Date</div>
              <input type="date" value={form.paidAt} onChange={e=>set('paidAt',e.target.value)}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </label>

            <label style={{display:'block',marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Notes</div>
              <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional notes…" rows="2"
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </label>

            <div style={{display:'flex',gap:8}}>
              <button onClick={handleAdd} disabled={saving} className="btn-primary" style={{flex:1}}>
                {saving?'Saving…':'Save'}
              </button>
              <button onClick={()=>setShowAdd(false)} className="btn-ghost" style={{flex:1}}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Mark as Paid */}
      {markPaidModal && (
        <Modal onClose={()=>setMarkPaidModal(null)}>
          <div style={{width:'100%',maxWidth:500}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Mark as Paid</div>
            <div style={{fontSize:13,color:'#64748b',marginBottom:20}}>Admin override for {markPaidModal.memberName}</div>
            
            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Payment Method</div>
              <select value={markPaidForm.method} onChange={e=>setMarkPaidForm({...markPaidForm,method:e.target.value})}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13}}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label style={{display:'block',marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Date</div>
              <input type="date" value={markPaidForm.paidAt} onChange={e=>setMarkPaidForm({...markPaidForm,paidAt:e.target.value})}
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </label>

            <label style={{display:'block',marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a',marginBottom:6}}>Notes</div>
              <textarea value={markPaidForm.notes} onChange={e=>setMarkPaidForm({...markPaidForm,notes:e.target.value})} rows="2"
                style={{width:'100%',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:6,fontSize:13,boxSizing:'border-box'}}/>
            </label>

            <div style={{display:'flex',gap:8}}>
              <button onClick={confirmMarkPaid} disabled={markPaidSaving} className="btn-primary" style={{flex:1}}>
                {markPaidSaving?'Saving…':'Confirm'}
              </button>
              <button onClick={()=>setMarkPaidModal(null)} className="btn-ghost" style={{flex:1}}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
