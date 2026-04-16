'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function AdminSummary() {
  const { userData } = useAuth();
  const [data, setData] = useState({ collected:0, penalties:0, expenses:0, profit:0, loss:0, activeProjects:0 });
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    const u1 = onSnapshot(collection(db,'organizations',orgId,'investments'), snap => {
      const v = snap.docs.filter(d=>d.data().status==='verified');
      setData(p => ({...p, collected: v.reduce((s,d)=>s+(d.data().amount||0),0), penalties: v.reduce((s,d)=>s+(d.data().penaltyPaid||0),0)}));
    });
    const u2 = onSnapshot(collection(db,'organizations',orgId,'expenses'), snap => {
      setData(p => ({...p, expenses: snap.docs.reduce((s,d)=>s+(d.data().amount||0),0)}));
    });
    const u3 = onSnapshot(collection(db,'organizations',orgId,'deployments'), snap => {
      const matured = snap.docs.filter(d=>d.data().status==='matured');
      const active  = snap.docs.filter(d=>d.data().status!=='matured');
      const profit  = matured.filter(d=>d.data().profitGenerated>=0).reduce((s,d)=>s+(d.data().profitGenerated||0),0);
      const loss    = matured.filter(d=>d.data().profitGenerated<0).reduce((s,d)=>s+Math.abs(d.data().profitGenerated||0),0);
      setData(p => ({...p, profit, loss, activeProjects: active.length}));
    });
    return () => { u1(); u2(); u3(); };
  }, [orgId]);

  const net = data.collected + data.profit - data.expenses - data.loss;

  const Card = ({ label, value, color='#0f172a', sub }) => (
    <div className="card" style={{ textAlign:'center' }}>
      <div style={{ fontSize:11, fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Financial Summary</div>
        <div className="page-subtitle">Organization-wide overview</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:14, marginBottom:16 }}>
        <Card label="Total Collected"  value={`৳${data.collected.toLocaleString()}`}  color="#0f172a" />
        <Card label="Penalties"        value={`৳${data.penalties.toLocaleString()}`}   color="#d97706" />
        <Card label="Total Expenses"   value={`৳${data.expenses.toLocaleString()}`}    color="#dc2626" />
        <Card label="Profit"           value={`৳${data.profit.toLocaleString()}`}      color="#16a34a" />
        <Card label="Loss"             value={`৳${data.loss.toLocaleString()}`}         color="#dc2626" />
        <Card label="Active Projects"  value={data.activeProjects}                      color="#2563eb" />
      </div>

      <div className="card" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 28px', border: `1.5px solid ${net>=0?'#bbf7d0':'#fecaca'}`, background: net>=0 ? '#f0fdf4' : '#fef2f2' }}>
        <div>
          <div style={{ fontSize:12, fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Net Balance</div>
          <div style={{ fontSize:13, color:'#64748b' }}>Collected + Profit − Expenses − Loss</div>
        </div>
        <div style={{ fontSize:32, fontWeight:800, color: net>=0?'#16a34a':'#dc2626' }}>৳{net.toLocaleString()}</div>
      </div>
    </div>
  );
}
