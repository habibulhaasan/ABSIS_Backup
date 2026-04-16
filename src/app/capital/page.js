// src/app/capital/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

export default function CapitalPage() {
  const { user, userData, orgData } = useAuth();
  const orgId = userData?.activeOrgId;

  const [payments, setPayments] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!orgId||!user) return;
    getDocs(query(collection(db,'organizations',orgId,'investments'),orderBy('createdAt','desc')))
      .then(snap => {
        setPayments(snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>p.userId===user.uid));
        setLoading(false);
      });
  }, [orgId, user]);

  const feeInAcct  = !!orgData?.settings?.gatewayFeeInAccounting;
  const verified   = payments.filter(p=>p.status==='verified');
  const myCapital  = verified.reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
  const pending    = payments.filter(p=>p.status==='pending').reduce((s,p)=>s+(p.amount||0),0);

  const statusColor = s => s==='verified'?'#15803d':s==='pending'?'#92400e':'#dc2626';
  const statusBg    = s => s==='verified'?'#dcfce7':s==='pending'?'#fef3c7':'#fee2e2';

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">My Capital</div>
        <div className="page-subtitle">Your total verified capital contributions to the organization.</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="My Capital"       value={fmt(myCapital)}    color="#15803d" bg="#f0fdf4"/>
        <Stat label="Verified Payments" value={verified.length}  color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Pending"          value={fmt(pending)}      color="#92400e" bg="#fef3c7" sub={pending>0?'Awaiting verification':undefined}/>
        <Stat label="Total Payments"   value={payments.length}   bg="#f8fafc"/>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : payments.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>💰</div>
          <div style={{fontWeight:600,color:'#0f172a'}}>No payments recorded yet</div>
          <div style={{fontSize:13,color:'#94a3b8',marginTop:4}}>Your installment payments will appear here once recorded.</div>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Date','Amount','Gateway Fee','Net Capital','Status'].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Date'||h==='Status'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {payments.map((p,i)=>{
            const net=(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0));
            return (
              <div key={p.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',padding:'11px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',alignItems:'center'}}>
                <div style={{fontSize:13,color:'#475569'}}>{tsDate(p.createdAt)}</div>
                <div style={{textAlign:'right',fontWeight:600,fontSize:13}}>{fmt(p.amount)}</div>
                <div style={{textAlign:'right',fontSize:13,color:'#dc2626'}}>{p.gatewayFee>0?`-${fmt(p.gatewayFee)}`:'—'}</div>
                <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:p.status==='verified'?'#15803d':'#94a3b8'}}>{p.status==='verified'?fmt(net):'—'}</div>
                <div>
                  <span style={{fontSize:11,fontWeight:700,color:statusColor(p.status),background:statusBg(p.status),padding:'2px 8px',borderRadius:99}}>
                    {p.status}
                  </span>
                </div>
              </div>
            );
          })}
          {/* Total row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',padding:'10px 16px',background:'#f0f9ff',borderTop:'2px solid #bae6fd'}}>
            <div style={{fontWeight:700,fontSize:13}}>Total</div>
            <div style={{textAlign:'right',fontWeight:700,fontSize:13}}>{fmt(payments.reduce((s,p)=>s+(p.amount||0),0))}</div>
            <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>-{fmt(verified.reduce((s,p)=>s+(p.gatewayFee||0),0))}</div>
            <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(myCapital)}</div>
            <div/>
          </div>
        </div>
      )}
    </div>
  );
}
