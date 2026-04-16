// src/app/admin/reports/quarterly/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function fmtSigned(n) { const v=Number(n)||0; const s=`৳${Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0})}`; return v<0?`−${s}`:`+${s}`; }
function pct(n) { return `${(Number(n)||0).toFixed(2)}%`; }

const QUARTERS = ['Q1 (Jan–Mar)','Q2 (Apr–Jun)','Q3 (Jul–Sep)','Q4 (Oct–Dec)'];

function getQuarter(ts) {
  if (!ts) return null;
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return { year:d.getFullYear(), q:Math.floor(d.getMonth()/3) };
}

function qKey(year,q) { return `${year}-Q${q+1}`; }

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

export default function QuarterlyReports() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [selYear,  setSelYear]  = useState(new Date().getFullYear());
  const [selQ,     setSelQ]     = useState(Math.floor(new Date().getMonth()/3));

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const [paySnap, distSnap, projSnap, loanSnap, feeSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(query(collection(db,'organizations',orgId,'profitDistributions'),orderBy('createdAt','asc'))),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'loans')),
        getDocs(collection(db,'organizations',orgId,'entryFees')),
      ]);

      const payments  = paySnap.docs.map(d=>({id:d.id,...d.data()}));
      const dists     = distSnap.docs.map(d=>({id:d.id,...d.data()}));
      const projects  = projSnap.docs.map(d=>({id:d.id,...d.data()}));
      const loans     = loanSnap.docs.map(d=>({id:d.id,...d.data()}));
      const fees      = feeSnap.docs.map(d=>({id:d.id,...d.data()}));

      // Build quarters map
      const qMap = {};
      const ensureQ = (year,q) => {
        const k=qKey(year,q);
        if (!qMap[k]) qMap[k]={year,q,key:k,label:`${QUARTERS[q]} ${year}`,capitalIn:0,entryFees:0,loansOut:0,loansIn:0,projectsCompleted:0,profitDistributed:0,netProfit:0};
        return qMap[k];
      };

      payments.filter(p=>p.status==='verified').forEach(p=>{
        const qd=getQuarter(p.createdAt); if(!qd)return;
        const rec=ensureQ(qd.year,qd.q);
        rec.capitalIn+=(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0));
      });
      fees.forEach(f=>{
        const qd=getQuarter(f.createdAt); if(!qd)return;
        ensureQ(qd.year,qd.q).entryFees+=(f.amount||0);
      });
      loans.filter(l=>l.status!=='pending'&&l.status!=='rejected').forEach(l=>{
        if (l.disbursedAt) { const qd=getQuarter(l.disbursedAt); if(qd) ensureQ(qd.year,qd.q).loansOut+=(l.amount||0); }
        (l.repayments||[]).forEach(r=>{ if(r.date){ const d=new Date(r.date); ensureQ(d.getFullYear(),Math.floor(d.getMonth()/3)).loansIn+=(r.amount||0); }});
      });
      projects.filter(p=>p.status==='completed').forEach(p=>{
        const qd=getQuarter(p.createdAt); if(!qd)return;
        ensureQ(qd.year,qd.q).projectsCompleted++;
      });
      dists.filter(d=>d.status==='distributed').forEach(d=>{
        const qd=getQuarter(d.distributedAt||d.createdAt); if(!qd)return;
        const rec=ensureQ(qd.year,qd.q);
        rec.profitDistributed+=(d.distributableProfit||0);
        rec.netProfit+=(d.grossProfit||0);
      });

      setData(qMap);
      setLoading(false);
    })();
  }, [orgId]);

  if (!isOrgAdmin) return null;

  const years = data ? [...new Set(Object.values(data).map(q=>q.year))].sort((a,b)=>b-a) : [];
  const currentQ = data ? data[qKey(selYear,selQ)] : null;

  // Running totals for selected year
  const yearQs = data ? [0,1,2,3].map(q=>data[qKey(selYear,q)]).filter(Boolean) : [];
  const yearCapital = yearQs.reduce((s,q)=>s+(q.capitalIn||0),0);
  const yearProfit  = yearQs.reduce((s,q)=>s+(q.netProfit||0),0);
  const yearLoans   = yearQs.reduce((s,q)=>s+(q.loansOut||0),0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Quarterly Reports</div>
        <div className="page-subtitle">Financial summary broken down by quarter — capital, loans, investments, and profit distributions.</div>
      </div>

      {/* Year + quarter selector */}
      <div style={{display:'flex',gap:10,marginBottom:24,flexWrap:'wrap',alignItems:'center'}}>
        <select value={selYear} onChange={e=>setSelYear(Number(e.target.value))}
          style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,color:'#0f172a',fontWeight:600}}>
          {[...new Set([new Date().getFullYear(),...years])].sort((a,b)=>b-a).map(y=>(
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {[0,1,2,3].map(q=>(
          <button key={q} onClick={()=>setSelQ(q)}
            style={{padding:'9px 16px',borderRadius:8,fontSize:13,cursor:'pointer',border:'none',fontWeight:selQ===q?700:400,background:selQ===q?'#0f172a':'#f1f5f9',color:selQ===q?'#fff':'#64748b'}}>
            Q{q+1}
          </button>
        ))}
      </div>

      {/* Year summary */}
      <div style={{background:'#f8fafc',borderRadius:12,padding:'16px',marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:13,color:'#475569',marginBottom:12}}>📅 {selYear} Full Year</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}>
          <Stat label="Capital In"        value={fmt(yearCapital)}   color="#15803d" bg="#f0fdf4"/>
          <Stat label="Profit Distributed" value={fmt(yearProfit)}   color="#1d4ed8" bg="#eff6ff"/>
          <Stat label="Loans Issued"       value={fmt(yearLoans)}    color="#92400e" bg="#fef3c7"/>
          <Stat label="Active Quarters"    value={yearQs.length}     bg="#fff"/>
        </div>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : (
        <>
          {/* Selected quarter detail */}
          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,fontSize:15,color:'#0f172a',marginBottom:12}}>
              {QUARTERS[selQ]} {selYear}
              {!currentQ && <span style={{fontSize:13,fontWeight:400,color:'#94a3b8',marginLeft:8}}>— No activity this quarter</span>}
            </div>
            {currentQ ? (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12}}>
                <Stat label="Capital Collected"   value={fmt(currentQ.capitalIn)}       color="#15803d" bg="#f0fdf4"/>
                <Stat label="Entry Fees"           value={fmt(currentQ.entryFees)}       bg="#f8fafc"/>
                <Stat label="Loans Issued"         value={fmt(currentQ.loansOut)}        color="#dc2626" bg="#fef2f2"/>
                <Stat label="Loan Repayments"      value={fmt(currentQ.loansIn)}         color="#15803d" bg="#f0fdf4"/>
                <Stat label="Projects Completed"   value={currentQ.projectsCompleted}    bg="#dbeafe" color="#1d4ed8"/>
                <Stat label="Profit Distributed"   value={fmt(currentQ.profitDistributed)} color="#7e22ce" bg="#faf5ff"/>
              </div>
            ) : (
              <div style={{padding:'32px',textAlign:'center',borderRadius:12,border:'2px dashed #e2e8f0',color:'#94a3b8',fontSize:13}}>
                No financial activity recorded in this quarter yet.
              </div>
            )}
          </div>

          {/* All quarters table for selected year */}
          {yearQs.length>0 && (
            <div>
              <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:10}}>All Quarters — {selYear}</div>
              <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                  {['Quarter','Capital In','Loans Out','Profit','Projects'].map(h=>(
                    <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Quarter'?'left':'right'}}>{h}</div>
                  ))}
                </div>
                {[0,1,2,3].map((q,i)=>{
                  const rec=data[qKey(selYear,q)];
                  const isSelected=selQ===q;
                  return (
                    <div key={q} onClick={()=>setSelQ(q)}
                      style={{display:'grid',gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr',padding:'11px 16px',background:isSelected?'#eff6ff':i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',cursor:'pointer',alignItems:'center'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                      onMouseLeave={e=>e.currentTarget.style.background=isSelected?'#eff6ff':i%2===0?'#fff':'#fafafa'}>
                      <div style={{fontWeight:isSelected?700:400,fontSize:13,color:isSelected?'#1d4ed8':'#0f172a'}}>
                        Q{q+1} {QUARTERS[q].split('(')[1]?.replace(')','').trim()||''}
                        {isSelected&&<span style={{fontSize:11,color:'#2563eb',marginLeft:6}}>◀</span>}
                      </div>
                      <div style={{textAlign:'right',fontWeight:600,fontSize:13,color:rec?'#15803d':'#94a3b8'}}>{rec?fmt(rec.capitalIn):'—'}</div>
                      <div style={{textAlign:'right',fontWeight:600,fontSize:13,color:rec?'#dc2626':'#94a3b8'}}>{rec?fmt(rec.loansOut):'—'}</div>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:rec&&rec.netProfit>0?'#1d4ed8':rec&&rec.netProfit<0?'#dc2626':'#94a3b8'}}>{rec&&rec.netProfit!==0?fmtSigned(rec.netProfit):'—'}</div>
                      <div style={{textAlign:'right',fontSize:13,color:'#475569'}}>{rec?rec.projectsCompleted:'—'}</div>
                    </div>
                  );
                })}
                {/* Year total row */}
                <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr',padding:'10px 16px',background:'#f0f9ff',borderTop:'2px solid #bae6fd'}}>
                  <div style={{fontWeight:700,fontSize:13}}>Year Total</div>
                  <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(yearCapital)}</div>
                  <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>{fmt(yearLoans)}</div>
                  <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:yearProfit>=0?'#1d4ed8':'#dc2626'}}>{fmtSigned(yearProfit)}</div>
                  <div style={{textAlign:'right',fontWeight:700,fontSize:13}}>{yearQs.reduce((s,q)=>s+q.projectsCompleted,0)}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
