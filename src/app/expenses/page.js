'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function Expenses() {
  const { userData } = useAuth();
  const [items, setItems] = useState([]);
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db,'organizations',orgId,'expenses'), orderBy('date','desc'));
    return onSnapshot(q, snap => setItems(snap.docs.map(d => ({id:d.id,...d.data()}))));
  }, [orgId]);

  const total = items.reduce((s,i) => s+(i.amount||0), 0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Expenses</div>
        <div className="page-subtitle">Total: ৳{total.toLocaleString()}</div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th><th>Notes</th></tr></thead>
          <tbody>
            {items.length === 0
              ? <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No expenses recorded</td></tr>
              : items.map(i => (
                <tr key={i.id}>
                  <td style={{ whiteSpace:'nowrap' }}>{i.date || '—'}</td>
                  <td style={{ fontWeight:500 }}>{i.title}</td>
                  <td><span className="badge badge-gray">{i.category || '—'}</span></td>
                  <td style={{ fontWeight:600, color:'#dc2626' }}>৳{i.amount?.toLocaleString()}</td>
                  <td style={{ fontSize:12, color:'#64748b', maxWidth:200 }}>{i.notes || '—'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
