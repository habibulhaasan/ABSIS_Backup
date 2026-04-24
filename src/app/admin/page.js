'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, getDocs, doc, getDoc, query, orderBy,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── helpers (same as account-book) ───────────────────────────────────────────
function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsSort(ts) {
  if (!ts) return 0;
  return ts?.seconds ? ts.seconds : new Date(ts).getTime()/1000;
}
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts?.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function computeFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const p  = Math.round(totalCapital*(Number(fb.value)||0)/100);
  const mx = fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(p, mx);
}

// ── TYPE config (mirrors account-book) ───────────────────────────────────────
const TYPE_CFG = {
  installment:       { label:'Installment',  short:'In',  bg:'#dbeafe', color:'#1e40af' },
  expense:           { label:'Expense',      short:'Ex',  bg:'#fee2e2', color:'#dc2626' },
  entry_fee:         { label:'Entry Fee',    short:'En',  bg:'#ccfbf1', color:'#0d9488' },
  loan_disbursement: { label:'Loan Out',     short:'LoO', bg:'#fef3c7', color:'#92400e' },
  loan_repayment:    { label:'Loan In',      short:'LoI', bg:'#d1fae5', color:'#065f46' },
};

function TypeTag({ type }) {
  const c = TYPE_CFG[type] || { short: type?.slice(0,3)||'?', bg:'#f1f5f9', color:'#475569' };
  return (
    <span style={{
      padding:'1px 6px', borderRadius:4, fontSize:10, fontWeight:700,
      background:c.bg, color:c.color, whiteSpace:'nowrap', flexShrink:0,
    }}>
      {c.short}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function SB({ label, value, sub, color='#0f172a', bg='#f8fafc' }) {
  return (
    <div style={{ background:bg, borderRadius:10, padding:'14px 16px' }}>
      <div style={{ fontSize:10, color:'#64748b', fontWeight:600, textTransform:'uppercase',
        letterSpacing:'0.07em', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ pct, color }) {
  const c = color || (pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#2563eb');
  return (
    <div style={{ height:6, borderRadius:3, background:'#e2e8f0', overflow:'hidden', marginTop:6 }}>
      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:c, borderRadius:3, transition:'width .5s' }}/>
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────────────
function QuickBtn({ href, icon, label, sub, bg, stroke }) {
  return (
    <Link href={href} style={{
      display:'flex', alignItems:'center', gap:10,
      background:'var(--color-background-primary,#fff)',
      border:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
      borderRadius:12, padding:'12px 14px', textDecoration:'none',
      color:'var(--color-text-primary,#0f172a)',
    }}>
      <div style={{ width:32, height:32, borderRadius:8, background:bg, display:'flex',
        alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke={stroke} strokeWidth={2} strokeLinecap="round">
          <path d={icon}/>
        </svg>
      </div>
      <div>
        <div style={{ fontSize:13, fontWeight:500 }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:'var(--color-text-secondary,#64748b)' }}>{sub}</div>}
      </div>
    </Link>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SL({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase',
      letterSpacing:'0.07em', color:'#64748b', margin:'20px 0 8px' }}>
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};
  const feeInAcct = !!settings.gatewayFeeInAccounting;

  // raw data
  const [payments,   setPayments]   = useState([]);
  const [expenses,   setExpenses]   = useState([]);
  const [fees,       setFees]       = useState([]);
  const [loans,      setLoans]      = useState([]);
  const [projects,   setProjects]   = useState([]);
  const [dists,      setDists]      = useState([]);
  const [members,    setMembers]    = useState([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!orgId) return;
    const unsubs = [];
    // investments (payments)
    unsubs.push(onSnapshot(
      query(collection(db,'organizations',orgId,'investments'), orderBy('createdAt','desc')),
      snap => setPayments(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // expenses
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'expenses'),
      snap => setExpenses(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // entry fees
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'entryFees'),
      snap => setFees(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // loans
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'loans'),
      snap => setLoans(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // projects
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'investmentProjects'),
      snap => setProjects(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // distributions
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'profitDistributions'),
      snap => setDists(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    // members
    getDocs(collection(db,'organizations',orgId,'members'))
      .then(snap => {
        setMembers(snap.docs.map(d=>({id:d.id,...d.data()})));
        setLoading(false);
      });
    return () => unsubs.forEach(u=>u());
  }, [orgId]);

  // ── Derived numbers (mirrors account-book logic) ──────────────────────────
  const verified = useMemo(() =>
    payments.filter(p => p.status==='verified' && p.isContribution!==false),
  [payments]);

  const totalCapital = useMemo(() =>
    verified.reduce((s,p) => s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)), 0),
  [verified, feeInAcct]);

  const totalPenalties = useMemo(() =>
    verified.reduce((s,p) => s+(p.penaltyPaid||0), 0),
  [verified]);

  const totalExpenses = useMemo(() =>
    expenses.reduce((s,e) => s+(e.amount||0), 0),
  [expenses]);

  const totalFeeIncome = useMemo(() =>
    fees.reduce((s,f) => s+(f.amount||0), 0),
  [fees]);

  const activeProjects = useMemo(() =>
    projects.filter(p => p.status==='active'),
  [projects]);

  const activeLoans = useMemo(() =>
    loans.filter(l => l.status==='disbursed'),
  [loans]);

  const pendingPayments = useMemo(() =>
    payments.filter(p => p.status==='pending'),
  [payments]);

  const pendingMembers = useMemo(() =>
    members.filter(m => !m.approved),
  [members]);

  // profit/loss from distributions
  const { totalProfit, totalLoss } = useMemo(() => {
    const distributed = dists.filter(d => d.status==='distributed');
    return {
      totalProfit: distributed.filter(d => (d.distributableProfit||0)>=0)
        .reduce((s,d) => s+(d.distributableProfit||0), 0),
      totalLoss: distributed.filter(d => (d.distributableProfit||0)<0)
        .reduce((s,d) => s+Math.abs(d.distributableProfit||0), 0),
    };
  }, [dists]);

  // net balance
  const net = totalCapital + totalProfit - totalExpenses - totalLoss;

  // ── Fund budget bars ───────────────────────────────────────────────────────
  const expAlloc  = computeFundAlloc('expenses',   totalCapital, settings) + totalFeeIncome;
  const invAlloc  = computeFundAlloc('investment', totalCapital, settings);
  const resAlloc  = computeFundAlloc('reserve',    totalCapital, settings);
  const benAlloc  = computeFundAlloc('benevolent', totalCapital, settings);
  const hasBudgets = expAlloc>0 || invAlloc>0 || resAlloc>0 || benAlloc>0;

  // expenses used
  const expUsed = totalExpenses;
  // investments used
  const invUsed = projects.reduce((s,p) => {
    const fi = p.fundSources ? Number(p.fundSources.investment)||0 : (p.fundSource!=='reserve'?(p.investedAmount||0):0);
    return s+fi;
  }, 0);
  const resUsed = projects.reduce((s,p) => {
    const fr = p.fundSources ? Number(p.fundSources.reserve)||0 : (p.fundSource==='reserve'?(p.investedAmount||0):0);
    return s+fr;
  }, 0);
  const benUsed = loans.filter(l=>l.status==='disbursed'||l.status==='repaid')
    .reduce((s,l) => s+(l.amount||0), 0);

  const funds = [
    { key:'expenses',   label:'Expenses Fund', icon:'🧾', color:'#d97706', alloc:expAlloc,  used:expUsed  },
    { key:'investment', label:'Investment',     icon:'📈', color:'#2563eb', alloc:invAlloc,  used:invUsed  },
    { key:'reserve',    label:'Reserve',        icon:'🛡',  color:'#16a34a', alloc:resAlloc,  used:resUsed  },
    { key:'benevolent', label:'Benevolent',     icon:'🤝', color:'#7c3aed', alloc:benAlloc,  used:benUsed  },
  ].filter(f => f.alloc > 0);

  // ── Recent 20 transactions (mirrors account-book buildOrgEntries) ─────────
  const recentEntries = useMemo(() => {
    const rows = [];
    payments.filter(p=>p.status==='verified').slice(0,50).forEach(p => {
      rows.push({
        id:'pay-'+p.id, type:'installment', sortKey:tsSort(p.createdAt),
        date:tsDate(p.createdAt),
        desc: (p.paidMonths||[]).join(', ') || 'Installment',
        sub: p.userId?.slice(0,8),
        credit:((p.amount||0)-(p.gatewayFee||0)),
        debit:0,
      });
    });
    expenses.forEach(e => {
      rows.push({
        id:'exp-'+e.id, type:'expense', sortKey:tsSort(e.createdAt),
        date: e.date || tsDate(e.createdAt),
        desc: e.title || e.description || 'Expense',
        sub: e.category||'',
        credit:0, debit:e.amount||0,
      });
    });
    fees.forEach(f => {
      rows.push({
        id:'fee-'+f.id, type:'entry_fee', sortKey:tsSort(f.createdAt),
        date: f.paidAt || tsDate(f.createdAt),
        desc:'Entry Fee', sub:'',
        credit:f.amount||0, debit:0,
      });
    });
    loans.filter(l=>l.status==='disbursed'||l.status==='repaid').forEach(l => {
      if (l.disbursedAt && l.amount) {
        rows.push({
          id:'loand-'+l.id, type:'loan_disbursement', sortKey:tsSort(l.disbursedAt),
          date:tsDate(l.disbursedAt),
          desc:'Loan Disbursed', sub:l.purpose||'',
          credit:0, debit:l.amount,
        });
      }
    });
    return rows.sort((a,b)=>b.sortKey-a.sortKey).slice(0,20);
  }, [payments, expenses, fees, loans]);

  if (!isOrgAdmin) return null;

  return (
    <div className="page-wrap animate-fade">
      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
          <div>
            <div className="page-title">Overview</div>
            <div className="page-subtitle">
              {orgData?.name}
              {pendingPayments.length > 0 && (
                <span style={{ marginLeft:8, fontSize:11, fontWeight:600, padding:'2px 8px',
                  borderRadius:99, background:'#fef3c7', color:'#92400e' }}>
                  {pendingPayments.length} pending payments
                </span>
              )}
              {pendingMembers.length > 0 && (
                <span style={{ marginLeft:6, fontSize:11, fontWeight:600, padding:'2px 8px',
                  borderRadius:99, background:'#fef2f2', color:'#b91c1c' }}>
                  {pendingMembers.length} pending members
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Key metrics ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10 }}>
        <SB label="Total Capital"    value={fmt(totalCapital)}   color="#15803d" bg="#f0fdf4"
          sub={`${verified.length} payments`}/>
        <SB label="Total Expenses"   value={fmt(totalExpenses)}  color="#dc2626" bg="#fef2f2"
          sub={`${expenses.length} records`}/>
        <SB label="Penalties"        value={fmt(totalPenalties)} color="#d97706" bg="#fffbeb"/>
        <SB label="Active Projects"  value={activeProjects.length} color="#2563eb" bg="#eff6ff"
          sub={`${fmt(activeProjects.reduce((s,p)=>s+(p.investedAmount||0),0))} invested`}/>
        <SB label="Active Loans"     value={activeLoans.length} color="#7c3aed" bg="#faf5ff"
          sub={activeLoans.length>0 ? `${fmt(activeLoans.reduce((s,l)=>s+(l.outstandingBalance||0),0))} out` : undefined}/>
        <SB label="Distributions"    value={dists.filter(d=>d.status==='distributed').length} bg="#f8fafc"
          sub={`${dists.filter(d=>d.status==='draft').length} draft`}/>
      </div>

      {/* ── Net balance ── */}
      <div style={{
        marginTop:12, borderRadius:12, padding:'16px 20px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        background: net>=0 ? '#f0fdf4' : '#fef2f2',
        border:`1.5px solid ${net>=0?'#bbf7d0':'#fecaca'}`,
      }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#64748b', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:3 }}>Net Balance</div>
          <div style={{ fontSize:12, color:'#64748b' }}>Capital + Profit − Expenses − Loss</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:26, fontWeight:700, color:net>=0?'#16a34a':'#dc2626' }}>{fmt(net)}</div>
          <div style={{ fontSize:11, color:'#94a3b8' }}>{net>=0?'Surplus':'Deficit'}</div>
        </div>
      </div>

      {/* ── Alerts ── */}
      {(pendingPayments.length>0 || pendingMembers.length>0) && (
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:12 }}>
          {pendingPayments.length > 0 && (
            <Link href="/admin/verify" style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 14px', borderRadius:8, textDecoration:'none',
              background:'#fffbeb', border:'1px solid #fde68a', color:'#92400e',
            }}>
              <span style={{ fontSize:13, fontWeight:600 }}>
                ⏳ {pendingPayments.length} payment{pendingPayments.length>1?'s':''} waiting for verification
              </span>
              <span style={{ fontSize:12, fontWeight:600 }}>Verify →</span>
            </Link>
          )}
          {pendingMembers.length > 0 && (
            <Link href="/admin/members" style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 14px', borderRadius:8, textDecoration:'none',
              background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c',
            }}>
              <span style={{ fontSize:13, fontWeight:600 }}>
                👤 {pendingMembers.length} member{pendingMembers.length>1?'s':''} pending approval
              </span>
              <span style={{ fontSize:12, fontWeight:600 }}>Review →</span>
            </Link>
          )}
        </div>
      )}

      {/* ── Expenses Fund Budget ── */}
      {expAlloc > 0 && (() => {
        const pct = expAlloc > 0 ? Math.min(100, Math.round(expUsed/expAlloc*100)) : 0;
        const over = expUsed > expAlloc;
        return (
          <>
            <SL>Expenses Fund</SL>
            <div style={{ background:'var(--color-background-primary,#fff)',
              border:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
              borderRadius:12, padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
                <div style={{ fontSize:13, fontWeight:500 }}>
                  {over ? '⚠️ Over budget' : `${100-pct}% remaining`}
                </div>
                <div style={{ fontSize:13, fontWeight:600, color:over?'#dc2626':'#0f172a' }}>
                  {fmt(expUsed)}
                  <span style={{ fontWeight:400, color:'#94a3b8' }}> / {fmt(expAlloc)}</span>
                </div>
              </div>
              <ProgressBar pct={pct} color={over?'#dc2626': pct>=90?'#d97706':'#2563eb'}/>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:11, color:'#94a3b8' }}>
                <span>Used: {fmt(expUsed)}</span>
                <span>Budget: {fmt(expAlloc)}{totalFeeIncome>0?` (incl. ${fmt(totalFeeIncome)} fees)`:''}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}>
                <Link href="/admin/expenses" style={{ fontSize:12, color:'#2563eb', fontWeight:600, textDecoration:'none' }}>
                  View expenses →
                </Link>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── All fund budgets ── */}
      {hasBudgets && funds.filter(f=>f.key!=='expenses').length > 0 && (
        <>
          <SL>Fund Allocations</SL>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:10 }}>
            {funds.filter(f=>f.key!=='expenses').map(f => {
              const pct = f.alloc>0 ? Math.min(100,Math.round(f.used/f.alloc*100)) : 0;
              const over = f.used > f.alloc;
              return (
                <div key={f.key} style={{ background:'var(--color-background-primary,#fff)',
                  border:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
                  borderRadius:12, padding:'12px 14px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:12, fontWeight:500 }}>{f.icon} {f.label}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:over?'#dc2626':f.color }}>
                      {pct}%
                    </span>
                  </div>
                  <ProgressBar pct={pct} color={over?'#dc2626':f.color}/>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:11, color:'#94a3b8' }}>
                    <span>{fmt(f.used)}</span>
                    <span>{fmt(f.alloc)}</span>
                  </div>
                  {over && <div style={{ fontSize:10, color:'#dc2626', marginTop:3, fontWeight:600 }}>
                    Over budget by {fmt(f.used-f.alloc)}
                  </div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Recent transactions ── */}
      <SL>Recent Transactions</SL>
      <div style={{ background:'var(--color-background-primary,#fff)',
        border:'0.5px solid var(--color-border-tertiary,#e5e7eb)', borderRadius:12, overflow:'hidden' }}>
        {/* header */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto',
          gap:'4px 12px', padding:'8px 14px', background:'#0f172a' }}>
          {['Date / Type','Credit (+)','Debit (−)',''].map((h,i)=>(
            <div key={i} style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
              textTransform:'uppercase', letterSpacing:'0.05em',
              textAlign:i===0?'left':'right' }}>{h}</div>
          ))}
        </div>
        {loading ? (
          <div style={{ padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>Loading…</div>
        ) : recentEntries.length===0 ? (
          <div style={{ padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>No transactions yet.</div>
        ) : (
          recentEntries.map((e,i) => (
            <div key={e.id} style={{
              display:'grid', gridTemplateColumns:'1fr auto auto auto',
              gap:'4px 12px', padding:'9px 14px', alignItems:'center',
              background:i%2===0?'var(--color-background-primary,#fff)':'var(--color-background-secondary,#fafafa)',
              borderBottom:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                <TypeTag type={e.type}/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'#0f172a',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {e.desc}
                  </div>
                  <div style={{ fontSize:10, color:'#94a3b8' }}>{e.date}</div>
                </div>
              </div>
              <div style={{ textAlign:'right', fontSize:12, fontWeight:600,
                color:e.credit>0?'#15803d':'#cbd5e1' }}>
                {e.credit>0 ? `+${fmt(e.credit)}` : '—'}
              </div>
              <div style={{ textAlign:'right', fontSize:12, fontWeight:600,
                color:e.debit>0?'#dc2626':'#cbd5e1' }}>
                {e.debit>0 ? `−${fmt(e.debit)}` : '—'}
              </div>
              <div/>
            </div>
          ))
        )}
        <div style={{ padding:'10px 14px', display:'flex', justifyContent:'flex-end',
          borderTop:'0.5px solid var(--color-border-tertiary,#e5e7eb)' }}>
          <Link href="/admin/account-book" style={{ fontSize:12, color:'#2563eb', fontWeight:600, textDecoration:'none' }}>
            Full ledger →
          </Link>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <SL>Quick Actions</SL>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:8 }}>
        <QuickBtn href="/admin/verify"            label="Verify Payments"
          sub={pendingPayments.length>0?`${pendingPayments.length} pending`:undefined}
          icon="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
          bg="#EAF3DE" stroke="#3B6D11"/>
        <QuickBtn href="/admin/expenses"          label="Log Expense"      sub="Add operational cost"
          icon="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
          bg="#FAEEDA" stroke="#854F0B"/>
        <QuickBtn href="/admin/members"           label="Members"
          sub={pendingMembers.length>0?`${pendingMembers.length} pending`:undefined}
          icon="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
          bg="#E1F5EE" stroke="#0F6E56"/>
        <QuickBtn href="/admin/subscriptionsgrid" label="Installment Tracker" sub="Monthly grid view"
          icon="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"
          bg="#E6F1FB" stroke="#185FA5"/>
        <QuickBtn href="/admin/account-book"      label="Account Book"     sub="Full ledger"
          icon="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM8 7h8M8 11h8M8 15h5"
          bg="#EEEDFE" stroke="#534AB7"/>
        <QuickBtn href="/admin/projects"          label="Projects"
          sub={`${activeProjects.length} active`}
          icon="M22 12h-4l-3 9L9 3l-3 9H2"
          bg="#FCEBEB" stroke="#A32D2D"/>
        <QuickBtn href="/admin/distribution"      label="Profit Distribution"
          sub={dists.filter(d=>d.status==='draft').length>0?`${dists.filter(d=>d.status==='draft').length} draft`:undefined}
          icon="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6"
          bg="#FAEEDA" stroke="#854F0B"/>
        <QuickBtn href="/admin/memoranda"         label="Memoranda"        sub="Notices & circulars"
          icon="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-4M9 15l3 3 3-3"
          bg="#E6F1FB" stroke="#185FA5"/>
        <QuickBtn href="/admin/notifications"     label="Notify Members"   sub="Send a message"
          icon="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
          bg="#EAF3DE" stroke="#3B6D11"/>
        <QuickBtn href="/admin/export"            label="Export Data"      sub="XLSX / CSV / Backup"
          icon="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
          bg="#E1F5EE" stroke="#0F6E56"/>
      </div>
    </div>
  );
}