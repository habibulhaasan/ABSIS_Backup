// src/app/admin/fund-structure/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n)  { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function pctFmt(n){ return `${(Number(n)||0).toFixed(1)}%`; }

// ── Fund budget computation ───────────────────────────────────────────────────
function computeFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb || !fb.value) return 0;
  if (fb.type === 'amount') return Number(fb.value) || 0;
  const pct    = Math.round(totalCapital * (Number(fb.value) || 0) / 100);
  const maxCap = fb.maxAmount && Number(fb.maxAmount) > 0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(pct, maxCap);
}

// ── UI components ─────────────────────────────────────────────────────────────
function FundCard({ label, icon, alloc, used, color, bg, desc, budgetType, budgetValue }) {
  const balance   = alloc - used;
  const usedPct   = alloc > 0 ? Math.min(100, (used / alloc) * 100) : 0;
  const overBudget = used > alloc && alloc > 0;

  return (
    <div style={{ borderRadius:12, border:`1.5px solid ${color}33`, background:bg, padding:'16px 18px' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:22 }}>{icon}</span>
          <div>
            <div style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{label}</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{desc}</div>
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'#94a3b8' }}>Budget</div>
          <div style={{ fontWeight:700, fontSize:15, color }}>
            {alloc > 0 ? fmt(alloc) : '—'}
            {budgetValue && <span style={{ fontSize:11, color:'#94a3b8', marginLeft:4 }}>
              ({budgetType==='pct' ? `${budgetValue}%` : 'fixed'})
            </span>}
          </div>
        </div>
      </div>

      {alloc > 0 ? (
        <>
          {/* Progress bar */}
          <div style={{ marginBottom:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginBottom:4 }}>
              <span>Used: {fmt(used)}</span>
              <span style={{ color: overBudget ? '#dc2626' : '#64748b' }}>
                {pctFmt(usedPct)} used
              </span>
            </div>
            <div style={{ height:8, borderRadius:99, background:'#e2e8f0', overflow:'hidden' }}>
              <div style={{
                height:'100%', borderRadius:99,
                background: overBudget ? '#dc2626' : color,
                width:`${usedPct}%`, transition:'width 0.6s ease',
              }}/>
            </div>
          </div>

          {/* Balance */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'8px 12px', borderRadius:8,
            background: overBudget ? '#fee2e2' : '#fff',
            border: `1px solid ${overBudget ? '#fca5a5' : '#e2e8f0'}` }}>
            <span style={{ fontSize:12, fontWeight:600, color: overBudget ? '#b91c1c' : '#475569' }}>
              {overBudget ? '⚠️ Over budget' : 'Remaining'}
            </span>
            <span style={{ fontSize:15, fontWeight:800, color: overBudget ? '#dc2626' : color }}>
              {fmt(balance)}
            </span>
          </div>
        </>
      ) : (
        <div style={{ padding:'10px 12px', borderRadius:8, background:'#f8fafc',
          border:'1px solid #e2e8f0', fontSize:12, color:'#94a3b8', textAlign:'center' }}>
          No budget set.{' '}
          <a href="/admin/settings" style={{ color:'#2563eb' }}>Set in Fund Budgets →</a>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminFundStructure() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [loading,       setLoading]       = useState(true);
  const [totalCapital,  setTotalCapital]  = useState(0);
  const [usedExpenses,  setUsedExpenses]  = useState(0);
  const [usedInvestInv, setUsedInvestInv] = useState(0); // from investment fund
  const [usedReserveInv,setUsedReserveInv]= useState(0); // from reserve fund
  const [usedBenevolent,setUsedBenevolent]= useState(0);
  const [usedDistrib,   setUsedDistrib]   = useState(0);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const [paySnap, expSnap, projSnap, distSnap, loanSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'profitDistributions')),
        getDocs(collection(db,'organizations',orgId,'loans')),
      ]);

      const capital = paySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified' && p.isContribution !== false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);

      const expenses = expSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);

      // Phase 3B: use fundSources if present, fall back to legacy fundSource
      let investInv = 0, investRes = 0;
      projSnap.docs.map(d=>d.data()).forEach(p => {
        if (p.fundSources) {
          investInv += Number(p.fundSources.investment)||0;
          investRes += Number(p.fundSources.reserve)||0;
        } else {
          const amt = p.investedAmount||0;
          if (p.fundSource === 'reserve') investRes += amt;
          else investInv += amt;
        }
      });

      // Benevolent: loans disbursed + charity
      const loans = loanSnap.docs.map(d=>d.data())
        .filter(l=>l.status==='disbursed'||l.status==='repaid')
        .reduce((s,l)=>s+(l.amount||0),0);

      // Profit deductions (reserve + welfare from distributions)
      const deducted = distSnap.docs.map(d=>d.data()).filter(d=>d.status==='distributed')
        .reduce((s,d)=>s+(d.reserveDeduction||0)+(d.welfareDeduction||0)+(d.operationsDeduction||0),0);

      setTotalCapital(capital);
      setUsedExpenses(expenses);
      setUsedInvestInv(investInv);
      setUsedReserveInv(investRes);
      setUsedBenevolent(loans);
      setUsedDistrib(deducted);
      setLoading(false);
    })();
  }, [orgId]);

  if (!isOrgAdmin) return null;

  const s   = orgData?.settings || {};
  const fb  = s.fundBudgets    || {};

  const investAlloc    = computeFundAlloc('investment', totalCapital, s);
  const reserveAlloc   = computeFundAlloc('reserve',    totalCapital, s);
  const benevolAlloc   = computeFundAlloc('benevolent', totalCapital, s);
  const expensesAlloc  = computeFundAlloc('expenses',   totalCapital, s);

  const hasBudgets = Object.values(fb).some(f=>f?.value);

  const FUNDS = [
    {
      key:'investment', label:'Investment Fund', icon:'📈', color:'#2563eb', bg:'#eff6ff',
      desc:'Capital deployed in investment projects',
      alloc:investAlloc, used:usedInvestInv,
      budgetType:fb.investment?.type, budgetValue:fb.investment?.value,
    },
    {
      key:'reserve', label:'Reserve Fund', icon:'🛡', color:'#16a34a', bg:'#f0fdf4',
      desc:'Emergency buffer; can fund conservative investments',
      alloc:reserveAlloc, used:usedReserveInv,
      budgetType:fb.reserve?.type, budgetValue:fb.reserve?.value,
    },
    {
      key:'benevolent', label:'Benevolent Fund', icon:'🤝', color:'#7c3aed', bg:'#faf5ff',
      desc:'Welfare, charity, interest-free loans',
      alloc:benevolAlloc, used:usedBenevolent,
      budgetType:fb.benevolent?.type, budgetValue:fb.benevolent?.value,
    },
    {
      key:'expenses', label:'Expenses Fund', icon:'🧾', color:'#d97706', bg:'#fffbeb',
      desc:'Operational expenses and running costs',
      alloc:expensesAlloc, used:usedExpenses,
      budgetType:fb.expenses?.type, budgetValue:fb.expenses?.value,
    },
  ];

  const totalAlloc = FUNDS.reduce((s,f)=>s+f.alloc,0);
  const totalUsed  = FUNDS.reduce((s,f)=>s+f.used,0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div className="page-title">Fund Structure</div>
            <div className="page-subtitle">Budget vs actual usage for each fund. Set budgets in Settings → Fund Budgets.</div>
          </div>
          <a href="/admin/settings" style={{ padding:'10px 18px', borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', color:'#475569', fontSize:13, fontWeight:600, textDecoration:'none' }}>
            ⚙️ Edit Budgets
          </a>
        </div>
      </div>

      {!hasBudgets && (
        <div style={{ padding:'12px 16px', borderRadius:10, background:'#fffbeb',
          border:'1px solid #fde68a', fontSize:13, color:'#92400e', marginBottom:16 }}>
          💡 No fund budgets set yet.{' '}
          <a href="/admin/settings" style={{ color:'#2563eb', textDecoration:'underline' }}>
            Go to Settings → Fund Budgets
          </a>{' '}
          to configure allocations for each fund.
        </div>
      )}

      {/* Summary stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:24 }}>
        {[
          { label:'Total Capital',   value:fmt(totalCapital), color:'#15803d', bg:'#f0fdf4' },
          { label:'Total Budgeted',  value:fmt(totalAlloc),   color:'#1d4ed8', bg:'#eff6ff',
            sub: totalCapital>0 ? `${((totalAlloc/totalCapital)*100).toFixed(1)}% of capital` : undefined },
          { label:'Total Used',      value:fmt(totalUsed),    color:'#d97706', bg:'#fffbeb' },
          { label:'Total Available', value:fmt(totalAlloc-totalUsed),
            color:(totalAlloc-totalUsed)>=0?'#15803d':'#dc2626',
            bg:(totalAlloc-totalUsed)>=0?'#f0fdf4':'#fef2f2' },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase',
              letterSpacing:'0.07em', marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:20, fontWeight:700, color:s.color }}>{s.value}</div>
            {s.sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'60px', color:'#94a3b8' }}>Loading…</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:16 }}>
          {FUNDS.map(f => <FundCard key={f.key} {...f}/>)}
        </div>
      )}

      {/* Profit deductions note */}
      {usedDistrib > 0 && (
        <div style={{ marginTop:16, padding:'10px 14px', borderRadius:8, background:'#f8fafc',
          border:'1px solid #e2e8f0', fontSize:12, color:'#64748b' }}>
          ℹ️ <strong>{fmt(usedDistrib)}</strong> has been deducted from profit across reserve, welfare and operations via distributions. This is separate from fund usage above.
        </div>
      )}
    </div>
  );
}