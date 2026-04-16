'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, updateDoc, getDocs, getDoc, serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function AdminVerify() {
  const { userData, isOrgAdmin, isCashier} = useAuth();
  const router = useRouter();
  if (!isOrgAdmin && !isCashier) { typeof window !== 'undefined' && router.replace('/dashboard'); return null; }

  const [payments, setPayments] = useState([]);
  const [members, setMembers]   = useState({});  // uid → merged profile
  const [filter, setFilter]     = useState('pending');
  const [search, setSearch]     = useState('');
  const [saving,      setSaving]      = useState(null);
  const [specialSubs, setSpecialSubs] = useState({});  // id → sub data, for type migration
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;

    // Load payments
    const unsub = onSnapshot(collection(db, 'organizations', orgId, 'investments'), snap => {
      setPayments(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      );
    });

    // Load member profiles (merge subcollection + users)
    (async () => {
      const mSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
      const map   = {};
      await Promise.all(mSnap.docs.map(async d => {
        const membership = d.data();
        try {
          const uSnap = await getDoc(doc(db, 'users', d.id));
          map[d.id]   = uSnap.exists() ? { ...uSnap.data(), ...membership, uid: d.id } : { ...membership, uid: d.id };
        } catch { map[d.id] = { ...membership, uid: d.id }; }
      }));
      setMembers(map);
    })();

    // Load special subs for paymentType migration (keyed by id)
    getDocs(collection(db, 'organizations', orgId, 'specialSubscriptions'))
      .then(snap => {
        const map = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setSpecialSubs(map);
      });

    return unsub;
  }, [orgId]);

  const verify = async (id, status) => {
    setSaving(id);
    try {
      const payment = payments.find(p => p.id === id) || {};
      const update  = { status, verifiedAt: serverTimestamp() };

      // ── Phase 1 migration: stamp paymentType if record is missing it ─────
      if (!payment.paymentType) {
        if ((payment.paidMonths || []).length > 0) {
          update.paymentType    = 'monthly';
          update.isContribution = true;
        } else if (payment.specialSubId) {
          // Look up the sub's type from loaded specialSubs map if available
          const sub = specialSubs[payment.specialSubId];
          const t   = sub?.type || 'general';
          const ic  = t === 'general' ? true
                    : t === 'entry_fee' ? !!sub?.countAsContribution
                    : false;
          update.paymentType        = t;
          update.isContribution     = ic;
          update.countAsContribution = ic;
        } else {
          update.paymentType    = 'monthly';
          update.isContribution = true;
        }
      }
      await updateDoc(doc(db, 'organizations', orgId, 'investments', id), update);
    } catch (e) { alert(e.message); }
    setSaving(null);
  };

  const filtered = payments.filter(p => {
    const mf = filter === 'all' || p.status === filter;
    const m  = members[p.userId];
    const sf = !search ||
      (m?.nameEnglish || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.txId || '').toLowerCase().includes(search.toLowerCase());
    return mf && sf;
  });

  const counts = {
    pending:  payments.filter(p => p.status === 'pending').length,
    verified: payments.filter(p => p.status === 'verified').length,
  };

  return (
    <div style={{ padding:24, maxWidth:1040, margin:'0 auto' }} className="animate-fade">
      <div className="page-header">
        <div className="page-title">Verify Payments</div>
        <div className="page-subtitle">{counts.pending} pending · {counts.verified} verified</div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by member name or TxID…"
          style={{ flex:1, minWidth:200 }} />
        <div style={{ display:'flex', gap:8 }}>
          {['pending','verified','rejected','all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={filter === f ? 'btn-primary' : 'btn-ghost'}
              style={{ padding:'9px 14px', fontSize:13, textTransform:'capitalize' }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th><th>Type</th><th>Months / Sub</th><th>Method</th>
              <th>TxID</th><th>Amount</th><th>Date</th><th>Status</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>
                No records found
              </td></tr>
            ) : filtered.map(p => {
              const m = members[p.userId];
              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight:600, fontSize:13 }}>{m?.nameEnglish || '(loading…)'}</div>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>{m?.idNo || '—'}</div>
                  </td>
                  <td>
                    {/* Payment type badge */}
                    {(!p.paymentType || p.paymentType === 'monthly') && (
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#dcfce7', color:'#15803d' }}>
                        Monthly
                      </span>
                    )}
                    {p.paymentType === 'general' && (
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#eff6ff', color:'#1d4ed8' }}>
                        General Sub
                      </span>
                    )}
                    {p.paymentType === 'entry_fee' && (
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#dbeafe', color:'#1d4ed8' }}>
                        Entry Fee
                      </span>
                    )}
                    {p.paymentType === 'reregistration_fee' && (
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#ede9fe', color:'#7c3aed' }}>
                        Re-Reg Fee
                      </span>
                    )}
                    {/* Contribution routing indicator */}
                    {p.paymentType && p.paymentType !== 'monthly' && (
                      <div style={{ fontSize:9, marginTop:2, color: p.isContribution !== false ? '#15803d' : '#92400e', fontWeight:600 }}>
                        {p.isContribution !== false ? '↗ Capital' : '→ Expenses'}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize:11, maxWidth:120, color:'#475569' }}>
                    {(p.paidMonths || []).length > 0
                      ? (p.paidMonths || []).join(', ')
                      : p.specialSubTitle || '—'}
                  </td>
                  <td style={{ fontSize:12 }}>{p.method}</td>
                  <td style={{ fontFamily:'monospace', fontSize:11, color:'#475569', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis' }}>
                    {p.txId || '—'}
                  </td>
                  <td style={{ fontWeight:600 }}>৳{p.amount?.toLocaleString()}</td>
                  <td style={{ whiteSpace:'nowrap', fontSize:12, color:'#64748b' }}>
                    {p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td>
                    <span className={`badge ${p.status==='verified'?'badge-green':p.status==='rejected'?'badge-red':'badge-yellow'}`}
                      style={{ textTransform:'capitalize' }}>{p.status}</span>
                  </td>
                  <td>
                    {p.status === 'pending' && (
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => verify(p.id, 'verified')} disabled={saving === p.id}
                          style={{ padding:'5px 12px', fontSize:12, borderRadius:6, border:'none', background:'#dcfce7', color:'#15803d', cursor:'pointer', fontWeight:600 }}>
                          {saving === p.id ? '…' : 'Verify'}
                        </button>
                        <button onClick={() => verify(p.id, 'rejected')} disabled={saving === p.id}
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
      </div>
    </div>
  );
}