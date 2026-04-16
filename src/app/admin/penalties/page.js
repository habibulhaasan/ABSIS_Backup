'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function AdminPenalties() {
  const { userData } = useAuth();
  const [records, setRecords] = useState([]);
  const [profiles, setProfiles] = useState({}); // uid → {nameEnglish, idNo}
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(collection(db, 'organizations', orgId, 'investments'), async snap => {
      const penaltyRecs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.status === 'verified' && (d.penaltyPaid || 0) > 0);
      setRecords(penaltyRecs);
      // Load names for any uids we don't have yet
      const uids = [...new Set(penaltyRecs.map(r => r.userId))];
      const missing = uids.filter(uid => !profiles[uid]);
      if (missing.length > 0) {
        const fetched = await Promise.all(missing.map(async uid => {
          try {
            const [uSnap, mSnap] = await Promise.all([
              getDoc(doc(db, 'users', uid)),
              getDoc(doc(db, 'organizations', orgId, 'members', uid)),
            ]);
            return { uid, name: uSnap.data()?.nameEnglish || '—', idNo: mSnap.data()?.idNo || '—' };
          } catch { return { uid, name: '—', idNo: '—' }; }
        }));
        setProfiles(p => {
          const next = { ...p };
          fetched.forEach(({ uid, name, idNo }) => { next[uid] = { name, idNo }; });
          return next;
        });
      }
    });
  }, [orgId]);

  const total = records.reduce((s, r) => s + (r.penaltyPaid || 0), 0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Late Fees (Penalties)</div>
        <div className="page-subtitle">Collected as organization profit</div>
      </div>

      {/* Summary */}
      <div className="card" style={{ display:'flex', alignItems:'center', gap:24, marginBottom:20, padding:'16px 20px' }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Total Late Fees Collected</div>
          <div style={{ fontSize:26, fontWeight:800, color:'#16a34a' }}>৳{total.toLocaleString()}</div>
        </div>
        <div style={{ flex:1, fontSize:13, color:'#64748b', borderLeft:'1px solid #e2e8f0', paddingLeft:24 }}>
          Late fees are charged when members pay after the due date. They count as <strong>profit for the organization</strong>, not as part of the member's regular donation.
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Member</th><th>ID</th><th>Months</th><th>Payment Date</th><th>Late Fee</th></tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No late fee records yet</td></tr>
            ) : records.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight:600 }}>{profiles[r.userId]?.name || '…'}</td>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{profiles[r.userId]?.idNo || '—'}</td>
                <td style={{ fontSize:12, color:'#475569' }}>{(r.paidMonths || []).join(', ')}</td>
                <td style={{ fontSize:12, color:'#64748b' }}>
                  {r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('en-GB') : '—'}
                </td>
                <td style={{ fontWeight:700, color:'#d97706' }}>৳{r.penaltyPaid?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
