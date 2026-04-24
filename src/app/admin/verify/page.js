// src/app/admin/page.js  — Verify Payments (admin + cashier, filtered by specific accountId)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, updateDoc, addDoc, getDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { isCapitalContribution } from '@/lib/fundCalculations';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

export default function VerifyPayments() {
  const { user, userData, orgData, isOrgAdmin, isCashier, membership } = useAuth();
  const [payments, setPayments] = useState([]);
  const [members,  setMembers]  = useState({});
  const [filter,   setFilter]   = useState('pending');
  const [search,   setSearch]   = useState('');
  const [saving,   setSaving]   = useState(null);
  const [detail,   setDetail]   = useState(null);

  const orgId = userData?.activeOrgId;

  // Cashier is now filtered by specific account IDs; fall back to methods for old payments
  const cashierAccountIds = membership?.cashierAccountIds || [];
  const cashierMethods    = membership?.cashierMethods    || [];

  useEffect(() => {
    if (!orgId || (!isOrgAdmin && !isCashier)) return;

    const unsub1 = onSnapshot(collection(db, 'organizations', orgId, 'investments'), snap => {
      let all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

      // Cashier: only show payments sent to their specific assigned accounts
      if (isCashier && !isOrgAdmin) {
        all = all.filter(p => {
          if (p.accountId) return cashierAccountIds.includes(p.accountId);
          // Legacy payments without accountId: fall back to method matching
          return cashierMethods.includes(p.method);
        });
      }
      setPayments(all);
    });

    const unsub2 = onSnapshot(collection(db, 'organizations', orgId, 'members'), async snap => {
      const map = {};
      await Promise.all(snap.docs.map(async d => {
        const mem = d.data();
        try {
          const uSnap = await getDoc(doc(db, 'users', d.id));
          map[d.id] = uSnap.exists() ? { ...uSnap.data(), ...mem, uid: d.id } : { ...mem, uid: d.id };
        } catch { map[d.id] = { ...mem, uid: d.id }; }
      }));
      setMembers(map);
    });

    return () => { unsub1(); unsub2(); };
  }, [orgId, isOrgAdmin, isCashier, cashierAccountIds.join(','), cashierMethods.join(',')]);

  const verify = async (payment, status) => {
    setSaving(payment.id);
    try {
      await updateDoc(doc(db, 'organizations', orgId, 'investments', payment.id), {
        status, verifiedAt: serverTimestamp(), verifiedBy: user.uid,
      });
      const months = (payment.paidMonths||[]).join(', ') || 'your payment';
      const msg = status === 'verified'
        ? `✅ Your payment for ${months} has been verified. Amount: ৳${payment.amount?.toLocaleString()}`
        : `❌ Your payment for ${months} has been rejected. Please contact admin.`;
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId: payment.userId, message: msg, read: false, createdAt: serverTimestamp(),
      });
    } catch (e) { alert(e.message); }
    setSaving(null);
    setDetail(null);
  };

  const deletePayment = async (payment) => {
    if (!confirm(
      `Delete this payment record?\n\n` +
      `Member: ${members[payment.userId]?.nameEnglish || 'Unknown'}\n` +
      `Amount: ৳${(payment.amount||0).toLocaleString()}\n` +
      `Months: ${(payment.paidMonths||[]).join(', ') || '(special)'}\n\n` +
      `⚠️ This will REVERSE the accounting effect — capital/fund balances will adjust automatically (they are calculated live from raw data).`
    )) return;
    setSaving(payment.id);
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'investments', payment.id));
      // Notify member
      const wasVerified = payment.status === 'verified';
      const months = (payment.paidMonths||[]).join(', ') || 'your payment';
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId:    payment.userId,
        message:   `ℹ️ A payment record (${months}, ৳${payment.amount?.toLocaleString()}) has been deleted by an admin. Please contact admin if you believe this is an error.`,
        read:      false,
        createdAt: serverTimestamp(),
      });
      setDetail(null);
    } catch(e) { alert('Delete failed: ' + e.message); }
    setSaving(null);
  };

  const filtered = payments.filter(p => {
    const mf = filter === 'all' || p.status === filter;
    const m  = members[p.userId];
    const sf = !search
      || (m?.nameEnglish||'').toLowerCase().includes(search.toLowerCase())
      || (p.txId||'').toLowerCase().includes(search.toLowerCase())
      || (p.accountNumber||'').includes(search);
    return mf && sf;
  });

  const myVerifiedTotal = payments.filter(p => p.status === 'verified' && p.verifiedBy === user?.uid).reduce((s,p) => s+(p.amount||0), 0);
  const orgTotal        = payments.filter(p => p.status === 'verified').reduce((s,p) => s+(p.amount||0), 0);
  const pendingCount    = payments.filter(p => p.status === 'pending').length;
  const isCashierView   = isCashier && !isOrgAdmin;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">Verify Payments</div>
          <div className="page-subtitle">
            {pendingCount} pending
            {isCashierView && cashierAccountIds.length > 0 && (
              <span style={{ marginLeft:8 }}>· {cashierAccountIds.length} account{cashierAccountIds.length>1?'s':''} assigned to you</span>
            )}
          </div>
        </div>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:20 }}>
        <div className="stat-card">
          <div className="stat-label">Org Total Received</div>
          <div className="stat-value" style={{ color:'#16a34a' }}>৳{orgTotal.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{isCashierView ? 'Verified by Me' : 'Total Verified'}</div>
          <div className="stat-value" style={{ color:'#2563eb' }}>৳{isCashierView ? myVerifiedTotal.toLocaleString() : orgTotal.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending</div>
          <div className="stat-value" style={{ color:'#d97706' }}>{pendingCount}</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by member, TxID, or account number…" style={{ flex:1, minWidth:200 }} />
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {['pending','verified','rejected','all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={filter === f ? 'btn-primary' : 'btn-ghost'}
              style={{ padding:'9px 14px', fontSize:13, textTransform:'capitalize' }}>{f}</button>
          ))}
        </div>
      </div>

      <div className="table-wrap"><div className="table-scroll">
        <table>
          <thead>
            <tr><th>Member</th><th>Months</th><th>Method / Account</th><th>TxID</th><th>Amount</th><th>Date</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No records found</td></tr>
            ) : filtered.map(p => {
              const m = members[p.userId];
              return (
                <tr key={p.id} onClick={() => setDetail(p)} style={{ cursor:'pointer' }}>
                  <td>
                    <div style={{ fontWeight:600, fontSize:13 }}>{m?.nameEnglish||m?.nameBengali||<span style={{color:'#94a3b8',fontStyle:'italic'}}>Unknown</span>}</div>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>{m?.idNo||p.userId?.slice(0,8)||'—'}</div>
                  </td>
                  <td style={{ fontSize:11, maxWidth:120, color:'#475569' }}>{(p.paidMonths||[]).join(', ')||'—'}</td>
                  <td>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.method}</div>
                    {p.accountLabel && <div style={{ fontSize:11, color:'#64748b' }}>{p.accountLabel}</div>}
                    {p.accountNumber && <div style={{ fontFamily:'monospace', fontSize:10, color:'#94a3b8' }}>{p.accountNumber}</div>}
                  </td>
                  <td style={{ fontFamily:'monospace', fontSize:11, color:'#475569', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis' }}>{p.txId||'—'}</td>
                  <td style={{ fontWeight:600 }}>৳{p.amount?.toLocaleString()}</td>
                  <td style={{ whiteSpace:'nowrap', fontSize:12, color:'#64748b' }}>
                    {p.createdAt?.seconds ? new Date(p.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td>
                    <span className={`badge ${p.status==='verified'?'badge-green':p.status==='rejected'?'badge-red':'badge-yellow'}`}
                      style={{ textTransform:'capitalize' }}>{p.status}</span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {p.status === 'pending' && (
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => verify(p,'verified')} disabled={saving===p.id}
                          style={{ padding:'5px 12px', fontSize:12, borderRadius:6, border:'none', background:'#dcfce7', color:'#15803d', cursor:'pointer', fontWeight:600 }}>
                          {saving===p.id ? '…' : 'Verify'}
                        </button>
                        <button onClick={() => verify(p,'rejected')} disabled={saving===p.id}
                          style={{ padding:'5px 12px', fontSize:12, borderRadius:6, border:'none', background:'#fee2e2', color:'#b91c1c', cursor:'pointer', fontWeight:600 }}>
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></div>

      {detail && (
        <Modal title="Payment Detail" onClose={() => setDetail(null)}>
          {(() => {
            const m = members[detail.userId];
            return (
              <>
                <div style={{ display:'flex', flexDirection:'column' }}>
                  {[
                    ['Member',   m?.nameEnglish||'Unknown'],
                    ['Member ID',m?.idNo||'—'],
                    ['Method',   detail.method],
                    ...(detail.accountLabel ? [['Account', `${detail.accountLabel}${detail.accountNumber?' — '+detail.accountNumber:''}`]] : []),
                    ['Tx ID',    detail.txId||'—'],
                    ['Amount',   `৳${detail.amount?.toLocaleString()}`],
                    ['Months',   (detail.paidMonths||[]).join(', ')||'—'],
                    ['Type',     isCapitalContribution(detail) ? '↗ Capital Contribution' : '→ Expenses Fund'],
                    ...(detail.gatewayFee>0 ? [['Gateway Fee', `৳${detail.gatewayFee?.toLocaleString()}`]] : []),
                    ...(detail.penaltyPaid>0 ? [['Late Fee', `৳${detail.penaltyPaid?.toLocaleString()}`]] : []),
                    ['Net to Capital', detail.isContribution!==false ? `৳${((detail.amount||0)-(detail.gatewayFee||0)-(detail.penaltyPaid||0)).toLocaleString()}` : '—'],
                    ['Date',     detail.createdAt?.seconds ? new Date(detail.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—'],
                    ['Status',   detail.status],
                    ...(detail.notes ? [['Notes', detail.notes]] : []),
                  ].map(([l,v]) => (
                    <div key={l} style={{ display:'flex', justifyContent:'space-between', gap:12, fontSize:13, padding:'9px 0', borderBottom:'1px solid #f1f5f9' }}>
                      <span style={{ color:'#64748b' }}>{l}</span>
                      <span style={{ fontWeight:500, color:'#0f172a', textAlign:'right', wordBreak:'break-all' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:20, flexWrap:'wrap' }}>
                  {detail.status === 'pending' && (<>
                    <button onClick={() => verify(detail,'rejected')} disabled={saving===detail.id}
                      style={{ flex:1, padding:'11px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:600, background:'#fee2e2', color:'#b91c1c' }}>
                      Reject
                    </button>
                    <button onClick={() => verify(detail,'verified')} disabled={saving===detail.id}
                      className="btn-primary" style={{ flex:2, justifyContent:'center' }}>
                      {saving===detail.id ? 'Saving…' : '✓ Verify Payment'}
                    </button>
                  </>)}
                  {isOrgAdmin && (
                    <button onClick={() => deletePayment(detail)} disabled={saving===detail.id}
                      style={{ width:'100%', padding:'9px', borderRadius:8, border:'1px solid #fca5a5',
                        background:'#fff', cursor:'pointer', fontWeight:600, fontSize:12, color:'#b91c1c',
                        marginTop: detail.status==='pending' ? 4 : 0 }}>
                      🗑 Delete Record (reverses accounting)
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
