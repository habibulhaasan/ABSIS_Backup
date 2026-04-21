// src/app/admin/entry-fees/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, getDocs } from 'firebase/firestore';
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
  const [subFees,   setSubFees]   = useState([]); // entry-fee type special sub payments
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('paid');   // 'paid' | 'unpaid'
  const [showAdd,   setShowAdd]   = useState(false);
  const [detail,    setDetail]    = useState(null);     // fee record for detail modal
  const [editing,   setEditing]   = useState(null);     // fee being edited
  const [editForm,  setEditForm]  = useState({});
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');
  const [search,    setSearch]    = useState('');
  const [sortBy,    setSortBy]    = useState('idNo');   // idNo | name | date

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

    // Also load special-sub payments with paymentType='entry_fee' from investments
    getDocs(query(
      collection(db,'organizations',orgId,'investments'),
      where('paymentType','==','entry_fee')
    )).then(snap => {
      setSubFees(snap.docs.map(d=>({id:'inv_'+d.id,...d.data(), _fromSub:true})));
    }).catch(()=>{});

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

  const openEdit = (fee) => {
    setEditForm({
      amount:  String(fee.amount || ''),
      method:  fee.method  || 'Cash',
      paidAt:  fee.paidAt  || '',
      notes:   fee.notes   || '',
    });
    setEditing(fee);
    setDetail(null); // close detail if open
  };

  const handleEdit = async () => {
    if (!editForm.amount || Number(editForm.amount) <= 0) return alert('Enter a valid amount.');
    if (!editForm.paidAt) return alert('Select a date.');
    setSaving(true);
    try {
      await updateDoc(doc(db, 'organizations', orgId, 'entryFees', editing.id), {
        amount: Number(editForm.amount),
        method: editForm.method,
        paidAt: editForm.paidAt,
        notes:  editForm.notes,
        updatedBy: user.uid,
      });
      showToast('✅ Updated!');
      setEditing(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  if (!isOrgAdmin) return null;

  // ── helpers + derived data (must come before filtered) ───────────────────
  function tsSort(ts) {
    if (!ts) return 0;
    return ts?.seconds ? ts.seconds : new Date(ts).getTime() / 1000;
  }

  // All entry fee records: admin-recorded + verified special-sub payments
  const allFees = [
    ...fees,
    ...subFees.filter(sf => sf.status === 'verified'),
  ];
  const totalCollected = allFees.reduce((s, f) => s + (f.amount || 0), 0);
  // Lookup uid → display name for Recorded By field
  const uidToName = (uid) => {
    if (!uid) return '—';
    const m = memberMap[uid];
    if (m?.nameEnglish) return m.nameEnglish;
    if (m?.name)        return m.name;
    return uid.slice(0, 8) + '…'; // last fallback
  };

  // Sort unpaid members by member ID
  const unpaidMembers = members
    .filter(m => !m.entryFeePaid)
    .sort((a, b) => {
      const na = parseInt((a.idNo || '').replace(/\D/g, ''), 10);
      const nb = parseInt((b.idNo || '').replace(/\D/g, ''), 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.nameEnglish || '').localeCompare(b.nameEnglish || '');
    });
  const paidCount      = [...new Set(fees.map(f => f.userId))].length;
  const unpaidCount    = members.filter(m => !m.entryFeePaid).length;

  const filtered = (search
    ? allFees.filter(f => {
        const m = memberMap[f.userId];
        const name = (m?.nameEnglish || m?.name || '').toLowerCase();
        return name.includes(search.toLowerCase()) || (m?.idNo || '').includes(search);
      })
    : allFees
  ).sort((a, b) => {
    const ma = memberMap[a.userId], mb = memberMap[b.userId];
    if (sortBy === 'name') return (ma?.nameEnglish || '').localeCompare(mb?.nameEnglish || '');
    if (sortBy === 'date') return tsSort(b.createdAt) - tsSort(a.createdAt);
    // default: member ID numeric
    const na = parseInt((ma?.idNo || '').replace(/\D/g, ''), 10);
    const nb = parseInt((mb?.idNo || '').replace(/\D/g, ''), 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (ma?.nameEnglish || '').localeCompare(mb?.nameEnglish || '');
  });


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
          <button onClick={()=>{setForm({userId:'',amount:defaultAmount||'',method:'Cash',paidAt:new Date().toISOString().split('T')[0],notes:''});setShowAdd(true);}}
            className="btn-primary" style={{padding:'10px 20px',flexShrink:0}}>
            + Record Payment
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
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:20}}>
        <Stat label="Total Collected" value={fmt(totalCollected)} color="#15803d" bg="#f0fdf4"/>
        <Stat label="Members Paid"    value={paidCount}           color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Yet to Pay"      value={unpaidCount}         color="#92400e" bg="#fef3c7"/>
        <Stat label="Total Payments"  value={allFees.length}      bg="#f8fafc"
          sub={subFees.filter(s=>s.status==='verified').length > 0
            ? `incl. ${subFees.filter(s=>s.status==='verified').length} via sub` : undefined}/>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:2,borderBottom:'2px solid #e2e8f0',marginBottom:20}}>
        {[
          {id:'paid',   label:`✅ Paid (${paidCount})`},
          {id:'unpaid', label:`⏳ Not Paid Yet (${unpaidCount})`},
        ].map(t => (
          <button key={t.id} onClick={()=>{setActiveTab(t.id);setSearch('');}}
            style={{padding:'10px 20px',background:'none',border:'none',cursor:'pointer',
              fontSize:13,fontWeight:activeTab===t.id?700:400,
              color:activeTab===t.id?'#2563eb':'#64748b',
              borderBottom:activeTab===t.id?'2px solid #2563eb':'2px solid transparent',
              marginBottom:-2,whiteSpace:'nowrap'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PAID TAB ── */}
      {activeTab === 'paid' && (
        <>
          {/* Search + Sort — wide search */}
          <div style={{display:'flex',gap:10,marginBottom:16,alignItems:'center'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search by member name or ID…"
              style={{flex:1,minWidth:0,padding:'9px 14px',borderRadius:8,
                border:'1px solid #e2e8f0',fontSize:13}}/>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
              style={{flexShrink:0,padding:'9px 12px',borderRadius:8,
                border:'1px solid #e2e8f0',fontSize:12,color:'#475569',width:150}}>
              <option value="idNo">Member ID</option>
              <option value="name">Name A–Z</option>
              <option value="date">Latest First</option>
            </select>
          </div>

          {loading ? (
            <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{textAlign:'center',padding:'60px'}}>
              <div style={{fontSize:36,marginBottom:10}}>🧾</div>
              <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No entry fee records yet</div>
              <button onClick={()=>setShowAdd(true)} className="btn-primary"
                style={{padding:'10px 24px',marginTop:8}}>+ Record Payment</button>
            </div>
          ) : (
            <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr auto',
                padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                {['Member','Amount','Method','Date',''].map(h=>(
                  <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',
                    textTransform:'uppercase',letterSpacing:'0.06em'}}>{h}</div>
                ))}
              </div>
              {filtered.map((fee, i) => {
                const m = memberMap[fee.userId];
                return (
                  <div key={fee.id} onClick={()=>setDetail({...fee, _member:m})}
                    style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr auto',
                      padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',
                      borderBottom:'1px solid #f1f5f9',alignItems:'center',
                      cursor:'pointer',transition:'background 0.1s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:30,height:30,borderRadius:'50%',background:'#dbeafe',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0,overflow:'hidden'}}>
                        {m?.photoURL
                          ? <img src={m.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                          : initials(m?.nameEnglish||m?.name)}
                      </div>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>
                            {m?.nameEnglish||m?.name||'Unknown'}
                          </span>
                          {fee._fromSub && (
                            <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',
                              borderRadius:99,background:'#ede9fe',color:'#7c3aed'}}>Via Sub</span>
                          )}
                        </div>
                        {m?.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                      </div>
                    </div>
                    <div>
                      <div style={{fontWeight:700,color:'#15803d'}}>{fmt(fee.amount)}</div>
                      {fee._fromSub && fee.status && (
                        <div style={{fontSize:9,fontWeight:700,marginTop:1,
                          color:fee.status==='verified'?'#15803d':fee.status==='pending'?'#d97706':'#dc2626'}}>
                          {fee.status}
                        </div>
                      )}
                    </div>
                    <div style={{fontSize:12,color:'#64748b'}}>{fee.method||'—'}</div>
                    <div style={{fontSize:12,color:'#64748b'}}>{fee.paidAt||tsDate(fee.createdAt)}</div>
                    {fee._fromSub
                      ? <div style={{fontSize:10,color:'#94a3b8',padding:'4px 8px'}}>auto</div>
                      : <button onClick={e=>{e.stopPropagation();handleDelete(fee);}}
                          style={{background:'none',border:'none',cursor:'pointer',
                            color:'#94a3b8',fontSize:13,padding:'4px 8px',borderRadius:4}}
                          title="Delete">✕</button>
                    }
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── NOT PAID YET TAB ── */}
      {activeTab === 'unpaid' && (
        <>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by member name or ID…"
            style={{width:'100%',padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',
              fontSize:13,marginBottom:16,boxSizing:'border-box'}}/>

          {unpaidMembers.length === 0 ? (
            <div style={{textAlign:'center',padding:'60px'}}>
              <div style={{fontSize:40,marginBottom:10}}>🎉</div>
              <div style={{fontWeight:700,fontSize:15,color:'#0f172a',marginBottom:4}}>
                All members have paid!
              </div>
              <div style={{fontSize:13,color:'#64748b'}}>Everyone has cleared their entry fee.</div>
            </div>
          ) : (
            <div style={{borderRadius:12,border:'1px solid #fde68a',overflow:'hidden'}}>
              {unpaidMembers
                .filter(m => !search ||
                  (m.nameEnglish||m.name||'').toLowerCase().includes(search.toLowerCase()) ||
                  (m.idNo||'').includes(search))
                .map((m, i) => (
                  <div key={m.id} style={{display:'flex',alignItems:'center',gap:12,
                    padding:'12px 16px',background:i%2===0?'#fffbeb':'#fefce8',
                    borderBottom:'1px solid #fef3c7'}}>
                    {/* Photo */}
                    <div style={{width:36,height:36,borderRadius:'50%',background:'#fde68a',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:12,fontWeight:700,color:'#92400e',flexShrink:0,overflow:'hidden'}}>
                      {m.photoURL
                        ? <img src={m.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                        : initials(m.nameEnglish||m.name)}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,color:'#0f172a',
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {m.nameEnglish||m.name}
                      </div>
                      <div style={{fontSize:11,color:'#94a3b8'}}>
                        {m.idNo ? `#${m.idNo}` : 'No ID'}
                        {m.phone ? ` · ${m.phone}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={()=>{
                        setForm({userId:m.id,amount:defaultAmount||'',method:'Cash',
                          paidAt:new Date().toISOString().split('T')[0],notes:''});
                        setShowAdd(true);
                      }}
                      style={{padding:'7px 16px',borderRadius:8,border:'1px solid #f59e0b',
                        background:'#fff',color:'#92400e',fontSize:12,fontWeight:600,
                        cursor:'pointer',flexShrink:0}}>
                      Record Fee
                    </button>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {/* ── DETAIL MODAL ── */}
      {detail && (() => {
        const m = detail._member || memberMap[detail.userId];
        return (
          <Modal title="Entry Fee — Payment Detail" onClose={()=>setDetail(null)}>
            {/* Member header */}
            <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:20,
              padding:'14px 16px',borderRadius:10,background:'#f0fdf4',border:'1px solid #86efac'}}>
              <div style={{width:52,height:52,borderRadius:'50%',background:'#dbeafe',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:18,fontWeight:700,color:'#1d4ed8',flexShrink:0,overflow:'hidden'}}>
                {m?.photoURL
                  ? <img src={m.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                  : initials(m?.nameEnglish||m?.name)}
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:'#0f172a'}}>
                  {m?.nameEnglish||m?.name||'Unknown'}
                </div>
                {m?.idNo && <div style={{fontSize:12,color:'#64748b'}}>Member ID: #{m.idNo}</div>}
                {m?.phone && <div style={{fontSize:12,color:'#94a3b8'}}>{m.phone}</div>}
              </div>
            </div>

            {/* Details */}
            {[
              ['Amount',      fmt(detail.amount)],
              ['Method',      detail.method||'—'],
              ['Date Paid',   detail.paidAt||tsDate(detail.createdAt)],
              ['Recorded On', tsDate(detail.createdAt)],
              ['Recorded By', uidToName(detail.recordedBy)],
              ['Source',      detail._fromSub ? '🔗 Via Special Subscription' : '📝 Admin Recorded'],
              ...(detail._fromSub ? [['Sub Status', detail.status||'—']] : []),
              ['Notes',       detail.notes||'—'],
              ['Fund',        '🎫 Entry Fee → Expenses Fund'],
            ].map(([l,v]) => (
              <div key={l} style={{display:'flex',justifyContent:'space-between',gap:12,
                fontSize:13,padding:'9px 0',borderBottom:'1px solid #f1f5f9'}}>
                <span style={{color:'#64748b',fontWeight:500}}>{l}</span>
                <span style={{fontWeight:600,color:'#0f172a',textAlign:'right'}}>{v}</span>
              </div>
            ))}

            {/* Actions */}
            <div style={{display:'flex',gap:8,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
              {!detail._fromSub && (
                <>
                  <button onClick={()=>openEdit(detail)}
                    style={{padding:'9px 20px',borderRadius:8,border:'1px solid #bfdbfe',
                      background:'#eff6ff',color:'#1d4ed8',cursor:'pointer',
                      fontSize:13,fontWeight:600}}>
                    ✏️ Edit
                  </button>
                  <button onClick={()=>{handleDelete(detail);setDetail(null);}}
                    style={{padding:'9px 20px',borderRadius:8,border:'1px solid #fca5a5',
                      background:'#fff',color:'#b91c1c',cursor:'pointer',
                      fontSize:13,fontWeight:600}}>
                    🗑 Delete
                  </button>
                </>
              )}
              <button onClick={()=>setDetail(null)}
                style={{flex:1,padding:'9px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                  background:'#fff',color:'#475569',cursor:'pointer',fontSize:13}}>
                Close
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* ── EDIT MODAL ── */}
      {editing && (
        <Modal title="Edit Entry Fee Record" onClose={()=>setEditing(null)}>
          {(() => {
            const m = memberMap[editing.userId];
            return (
              <>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18,
                  padding:'10px 12px',borderRadius:8,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:'#dbeafe',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0,overflow:'hidden'}}>
                    {m?.photoURL
                      ? <img src={m.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                      : initials(m?.nameEnglish||m?.name)}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{m?.nameEnglish||m?.name||'Unknown'}</div>
                    {m?.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{m.idNo}</div>}
                  </div>
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:4}}>
                  <div>
                    <label className="form-label">Amount (৳) *</label>
                    <input type="number" min="0" value={editForm.amount}
                      onChange={e=>setEditForm(p=>({...p,amount:e.target.value}))}/>
                  </div>
                  <div>
                    <label className="form-label">Payment Method</label>
                    <select value={editForm.method}
                      onChange={e=>setEditForm(p=>({...p,method:e.target.value}))}>
                      {METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Date Paid *</label>
                    <input type="date" value={editForm.paidAt}
                      onChange={e=>setEditForm(p=>({...p,paidAt:e.target.value}))}/>
                  </div>
                  <div>
                    <label className="form-label">Notes</label>
                    <input type="text" value={editForm.notes}
                      onChange={e=>setEditForm(p=>({...p,notes:e.target.value}))}
                      placeholder="Optional"/>
                  </div>
                </div>

                <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
                  <button onClick={handleEdit} disabled={saving}
                    className="btn-primary" style={{padding:'10px 24px'}}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={()=>setEditing(null)}
                    style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                      background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
                    Cancel
                  </button>
                </div>
              </>
            );
          })()}
        </Modal>
      )}

      {/* ── ADD MODAL ── */}
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
                <input type="number" min="0" value={form.amount}
                  onChange={e=>set('amount',e.target.value)} placeholder={defaultAmount||'0'}/>
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
                <input type="text" value={form.notes} onChange={e=>set('notes',e.target.value)}
                  placeholder="Optional notes"/>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleAdd} disabled={saving} className="btn-primary"
              style={{padding:'10px 24px'}}>
              {saving ? 'Saving…' : 'Record Payment'}
            </button>
            <button onClick={()=>setShowAdd(false)}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}