'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function Investments() {
  const { userData } = useAuth();
  const [items, setItems] = useState([]);
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(collection(db,'organizations',orgId,'deployments'), snap => setItems(snap.docs.map(d => ({id:d.id,...d.data()}))));
  }, [orgId]);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Projects</div>
        <div className="page-subtitle">Fund investments and deployments</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
        {items.length === 0
          ? <div className="card" style={{ textAlign:'center', color:'#94a3b8', gridColumn:'1/-1' }}>No projects yet</div>
          : items.map(p => (
            <div key={p.id} className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ fontWeight:600, fontSize:15, color:'#0f172a' }}>{p.sector}</div>
                <span className={`badge ${p.status==='matured'?'badge-green':'badge-blue'}`}>{p.status || 'active'}</span>
              </div>
              <div style={{ fontSize:22, fontWeight:700, color:'#2563eb', marginBottom:8 }}>৳{p.amount?.toLocaleString()}</div>
              <div style={{ fontSize:12, color:'#64748b' }}>
                <div>Invested: {p.investmentDate || '—'}</div>
                <div>Maturity: {p.maturityDate || '—'}</div>
                {p.status === 'matured' && p.profitGenerated != null && (
                  <div style={{ marginTop:6, fontWeight:600, color: p.profitGenerated>=0 ? '#16a34a' : '#dc2626' }}>
                    {p.profitGenerated>=0?'Profit':'Loss'}: ৳{Math.abs(p.profitGenerated).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}
