// src/app/admin/page.js  — Admin Overview (Phase 6)
'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import {
  collection, onSnapshot, getDocs, doc, getDoc, query, orderBy,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── helpers ───────────────────────────────────────────────────────────────────
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
function normDate(val) {
  if (!val) return '—';
  if (typeof val === 'string') {
    const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2])-1, Number(iso[3]));
      return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    }
  }
  return tsDate(val);
}
function computeFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const p  = Math.round(totalCapital*(Number(fb.value)||0)/100);
  const mx = fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(p, mx);
}
function shortName(fullName) {
  if (!fullName) return '—';
  const words = fullName.trim().split(/\s+/);
  const trimmed = /^md\.?$/i.test(words[0]) ? words.slice(1) : words;
  return trimmed[0] || fullName;
}
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

// ── TYPE config ───────────────────────────────────────────────────────────────
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

function LedgerLegend() {
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:'5px 12px',
      padding:'7px 10px',background:'#f8fafc',borderRadius:0,
      borderBottom:'1px solid #e2e8f0',alignItems:'center'}}>
      <span style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',
        letterSpacing:'0.05em',flexShrink:0}}>Key:</span>
      {Object.entries(TYPE_CFG).map(([key,cfg])=>(
        <span key={key} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#475569'}}>
          <span style={{display:'inline-block',padding:'1px 5px',borderRadius:4,
            fontSize:9,fontWeight:800,background:cfg.bg,color:cfg.color,lineHeight:'16px'}}>
            {cfg.short}
          </span>
          {cfg.label}
        </span>
      ))}
    </div>
  );
}

// ── EntryDetailPanel (mirrors account-book) ───────────────────────────────────
function EntryDetailPanel({ entry }) {
  const m = entry.meta || {};
  const fields = [];
  const displayMemberName = m.memberName ? shortName(m.memberName) : null;
  if (displayMemberName) fields.push(['Member', displayMemberName]);
  if (m.memberIdNo)      fields.push(['ID', `#${m.memberIdNo}`]);
  if (entry.desc)        fields.push(['Description', entry.desc]);
  if (entry.sub && entry.sub !== m.memberName) fields.push(['Details', entry.sub]);
  if (entry.credit>0)    fields.push(['Credit', fmt(entry.credit)]);
  if (entry.debit>0)     fields.push(['Debit', fmt(entry.debit)]);
  if (m.gatewayFee>0)    fields.push(['Gateway Fee', `−${fmt(m.gatewayFee)}`]);
  if (m.method)          fields.push(['Method', m.method]);
  if (m.status)          fields.push(['Status', m.status]);
  if (m.purpose)         fields.push(['Purpose', m.purpose]);
  if (m.category)        fields.push(['Category', m.category]);
  fields.push(['Balance After', fmt(entry.balance)]);
  return (
    <div style={{padding:'10px 12px 10px 16px',background:'#f0f9ff',
      borderTop:'1px solid #bae6fd',borderBottom:'1px solid #bae6fd'}}>
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:7}}>
        <TypeTag type={entry.type}/>
        <span style={{fontSize:10,color:'#94a3b8'}}>{entry.date}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'3px 16px'}}>
        {fields.map(([k,v])=>(
          <div key={k} style={{display:'flex',gap:4,fontSize:11,alignItems:'baseline',minWidth:0}}>
            <span style={{color:'#94a3b8',flexShrink:0,fontSize:10}}>{k}:</span>
            <span style={{color:'#0f172a',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DateGroupRow (mirrors account-book exactly) ───────────────────────────────
function DateGroupRow({ dateLabel, entries, isMobile }) {
  const [open, setOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState(null);

  const totalCapital  = entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
  const totalExpenses = entries.filter(e=>e.debit>0).reduce((s,e)=>s+e.debit,0);
  const totalFees     = entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
  const closingBal    = entries[entries.length - 1]?.balance ?? 0;
  const typeSet       = [...new Set(entries.map(e => e.type))];

  return (
    <div style={{borderBottom:'1px solid #f1f5f9'}}>
      <div
        onClick={()=>setOpen(o=>!o)}
        style={{
          display:'grid',
          gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
          padding:'8px 10px',
          background: open ? '#f0f9ff' : '#fff',
          cursor:'pointer', userSelect:'none', alignItems:'center', gap:'4px 8px',
          transition:'background 0.1s',
        }}
        onMouseEnter={e=>{ if(!open) e.currentTarget.style.background='#f8fafc'; }}
        onMouseLeave={e=>{ e.currentTarget.style.background=open?'#f0f9ff':'#fff'; }}
      >
        <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',minWidth:0}}>
          <span style={{fontSize:10,color:'#94a3b8',flexShrink:0}}>{open?'▾':'▸'}</span>
          <span style={{fontSize:11,color:'#475569',fontWeight:600,flexShrink:0}}>{dateLabel}</span>
          {(!isMobile || open) && typeSet.map(t=><TypeTag key={t} type={t}/>)}
          {entries.length>1 && !isMobile && (
            <span style={{fontSize:10,color:'#94a3b8',flexShrink:0}}>×{entries.length}</span>
          )}
        </div>
        <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalCapital>0?'#1e40af':'#cbd5e1'}}>
          {totalCapital>0 ? `+${fmt(totalCapital)}` : '—'}
        </div>
        <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalExpenses>0?'#dc2626':'#cbd5e1'}}>
          {totalExpenses>0 ? `−${fmt(totalExpenses)}` : '—'}
        </div>
        <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalFees>0?'#0d9488':'#cbd5e1'}}>
          {totalFees>0 ? `+${fmt(totalFees)}` : '—'}
        </div>
        <div style={{textAlign:'right',fontSize:12,fontWeight:800,flexShrink:0,
          color:closingBal>=0?'#0f172a':'#dc2626'}}>
          {fmt(closingBal)}
        </div>
      </div>

      {open && entries.map((e,ei)=>{
        const isOpen = openEntry === e.id;
        const cap  = e.type==='installment' ? e.credit : 0;
        const exp  = e.debit > 0 ? e.debit : 0;
        const fee  = (e.type==='entry_fee'||e.type==='loan_repayment') ? e.credit : 0;
        const rowLabel = e.meta?.memberName
          ? `${shortName(e.meta.memberName)}${e.meta.memberIdNo ? ` #${e.meta.memberIdNo}` : ''}`
          : e.sub || '';
        return (
          <div key={e.id}>
            <div
              onClick={()=>setOpenEntry(isOpen ? null : e.id)}
              style={{
                display:'grid',
                gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
                padding:'7px 10px 7px 20px',
                borderTop:'1px solid #f1f5f9',
                background: isOpen ? '#e0f2fe' : ei%2===0?'#fafeff':'#f0f9ff',
                alignItems:'center', gap:'4px 8px', cursor:'pointer', userSelect:'none',
              }}
              onMouseEnter={e2=>{ if(!isOpen) e2.currentTarget.style.background='#e0f2fe'; }}
              onMouseLeave={e2=>{ e2.currentTarget.style.background=isOpen?'#e0f2fe':ei%2===0?'#fafeff':'#f0f9ff'; }}
            >
              <div style={{display:'flex',alignItems:'center',gap:5,minWidth:0,overflow:'hidden'}}>
                <span style={{fontSize:10,color:'#94a3b8',flexShrink:0}}>{isOpen?'▾':'▸'}</span>
                <TypeTag type={e.type}/>
                <span style={{fontSize:11,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {rowLabel}
                </span>
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,color:cap>0?'#1e40af':'#cbd5e1'}}>
                {cap>0?`+${fmt(cap)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,color:exp>0?'#dc2626':'#cbd5e1'}}>
                {exp>0?`−${fmt(exp)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,color:fee>0?'#0d9488':'#cbd5e1'}}>
                {fee>0?`+${fmt(fee)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:e.balance>=0?'#0f172a':'#dc2626'}}>
                {fmt(e.balance)}
              </div>
            </div>
            {isOpen && <EntryDetailPanel entry={e}/>}
          </div>
        );
      })}
    </div>
  );
}

// ── buildOrgEntries (mirrors account-book) ────────────────────────────────────
function buildOrgEntries(payments, expenses, fees, loans, memberMap) {
  const rows = [];
  payments.filter(p=>p.status==='verified').forEach(p => {
    const net = (p.amount||0) - (p.gatewayFee||0);
    const m   = memberMap[p.userId]||{};
    rows.push({
      id:`pay-${p.id}`, type:'installment', ts:p.createdAt,
      sortKey:tsSort(p.createdAt), date:normDate(p.createdAt),
      desc:'Installment',
      sub:m.nameEnglish||m.name||'Member',
      debit:0, credit:net, count:1,
      meta:{...p, memberName:m.nameEnglish||m.name||'—', memberIdNo:m.idNo||''},
    });
  });
  expenses.forEach(e => {
    rows.push({
      id:`exp-${e.id}`, type:'expense', ts:e.createdAt,
      sortKey:tsSort(e.createdAt), date:e.date?normDate(e.date):normDate(e.createdAt),
      desc:e.title||e.description||'Expense', sub:e.category||'',
      debit:e.amount||0, credit:0, count:0, meta:e,
    });
  });
  fees.forEach(f => {
    const m = memberMap[f.userId]||{};
    rows.push({
      id:`fee-${f.id}`, type:'entry_fee', ts:f.createdAt,
      sortKey:tsSort(f.createdAt), date:f.paidAt?normDate(f.paidAt):normDate(f.createdAt),
      desc:'Entry Fee',
      sub:m.nameEnglish||m.name||'Member',
      debit:0, credit:f.amount||0, count:0,
      meta:{...f, memberName:m.nameEnglish||m.name||'—', memberIdNo:m.idNo||''},
    });
  });
  loans.filter(l=>['disbursed','repaid'].includes(l.status)).forEach(l => {
    const m = memberMap[l.userId]||{};
    if (l.disbursedAt && l.amount) {
      rows.push({
        id:`loand-${l.id}`, type:'loan_disbursement', ts:l.disbursedAt,
        sortKey:tsSort(l.disbursedAt), date:normDate(l.disbursedAt),
        desc:'Loan Disbursed',
        sub:`${m.nameEnglish||m.name||'Member'}${l.purpose?` — ${l.purpose}`:''}`,
        debit:l.amount, credit:0, count:0,
        meta:{...l, memberName:m.nameEnglish||m.name||'—'},
      });
    }
    (l.repayments||[]).forEach((r,ri) => {
      const d2 = new Date(r.date);
      rows.push({
        id:`loanr-${l.id}-${ri}`, type:'loan_repayment',
        ts:{seconds:d2.getTime()/1000}, sortKey:d2.getTime()/1000,
        date:normDate(r.date), desc:'Loan Repayment',
        sub:`${m.nameEnglish||m.name||'Member'}${l.purpose?` — ${l.purpose}`:''}`,
        debit:0, credit:r.amount, count:0,
        meta:{...l, repayment:r, memberName:m.nameEnglish||m.name||'—'},
      });
    });
  });
  rows.sort((a,b) => a.sortKey - b.sortKey);
  let bal = 0;
  rows.forEach(r => { bal += r.credit - r.debit; r.balance = bal; });
  return rows;
}

function buildDateGroups(entries) {
  const map = {};
  entries.forEach(e => {
    const key = e.date || '—';
    if (!map[key]) map[key] = { dateLabel: key, entries: [], sortKey: e.sortKey };
    map[key].entries.push(e);
    if (e.sortKey < map[key].sortKey) map[key].sortKey = e.sortKey;
  });
  return Object.values(map).sort((a, b) => a.sortKey - b.sortKey);
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

function ProgressBar({ pct, color }) {
  const c = color || (pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#2563eb');
  return (
    <div style={{ height:6, borderRadius:3, background:'#e2e8f0', overflow:'hidden', marginTop:6 }}>
      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:c, borderRadius:3, transition:'width .5s' }}/>
    </div>
  );
}

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

  const [payments,   setPayments]   = useState([]);
  const [expenses,   setExpenses]   = useState([]);
  const [fees,       setFees]       = useState([]);
  const [loans,      setLoans]      = useState([]);
  const [projects,   setProjects]   = useState([]);
  const [dists,      setDists]      = useState([]);
  const [members,    setMembers]    = useState([]);
  const [memberMap,  setMemberMap]  = useState({});
  const [loading,    setLoading]    = useState(true);
  const [isMobile,   setIsMobile]   = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!orgId) return;
    const unsubs = [];

    unsubs.push(onSnapshot(
      query(collection(db,'organizations',orgId,'investments'), orderBy('createdAt','desc')),
      snap => setPayments(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'expenses'),
      snap => setExpenses(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'entryFees'),
      snap => setFees(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'loans'),
      snap => setLoans(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'investmentProjects'),
      snap => setProjects(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));
    unsubs.push(onSnapshot(
      collection(db,'organizations',orgId,'profitDistributions'),
      snap => setDists(snap.docs.map(d=>({id:d.id,...d.data()})))
    ));

    // members — one-time fetch + build map (same as account-book)
    getDocs(collection(db,'organizations',orgId,'members')).then(async snap => {
      const rawMem = snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const enriched = await Promise.all(rawMem.map(async m => {
        try {
          const u = await getDoc(doc(db,'users',m.id));
          return u.exists() ? {...u.data(),...m, id:m.id} : m;
        } catch { return m; }
      }));
      setMembers(snap.docs.map(d=>({id:d.id,...d.data()})));
      setMemberMap(Object.fromEntries(enriched.map(m=>[m.id,m])));
      setLoading(false);
    });

    return () => unsubs.forEach(u=>u());
  }, [orgId]);

  // ── Derived numbers ───────────────────────────────────────────────────────
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

  const { totalProfit, totalLoss } = useMemo(() => {
    const distributed = dists.filter(d => d.status==='distributed');
    return {
      totalProfit: distributed.filter(d => (d.distributableProfit||0)>=0)
        .reduce((s,d) => s+(d.distributableProfit||0), 0),
      totalLoss: distributed.filter(d => (d.distributableProfit||0)<0)
        .reduce((s,d) => s+Math.abs(d.distributableProfit||0), 0),
    };
  }, [dists]);

  const net = totalCapital + totalProfit - totalExpenses - totalLoss;

  // ── Full org entries (for Recent Transactions) ────────────────────────────
  const allEntries = useMemo(() =>
    buildOrgEntries(payments, expenses, fees, loans, memberMap),
  [payments, expenses, fees, loans, memberMap]);

  // Last 5 date groups (most recent first → reverse, take 5, then re-reverse for display)
  const recentDateGroups = useMemo(() => {
    const groups = buildDateGroups(allEntries);
    return groups.slice(-5); // last 5 date groups (oldest→newest for running balance)
  }, [allEntries]);

  // ── Fund budgets ──────────────────────────────────────────────────────────
  const expAlloc  = computeFundAlloc('expenses',   totalCapital, settings) + totalFeeIncome;
  const invAlloc  = computeFundAlloc('investment', totalCapital, settings);
  const resAlloc  = computeFundAlloc('reserve',    totalCapital, settings);
  const benAlloc  = computeFundAlloc('benevolent', totalCapital, settings);
  const hasBudgets = expAlloc>0 || invAlloc>0 || resAlloc>0 || benAlloc>0;

  const expUsed = totalExpenses;
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

      {/* ── Pending Installments ── */}
      {pendingPayments.length > 0 && (
        <>
          <SL>Pending Installments</SL>
          <div style={{ background:'var(--color-background-primary,#fff)',
            border:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
            borderRadius:12, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto auto',
              gap:'4px 12px', padding:'8px 14px', background:'#92400e' }}>
              {['Member / Method','Amount','Months',''].map((h,i)=>(
                <div key={i} style={{ fontSize:10, fontWeight:700, color:'#fef3c7',
                  textTransform:'uppercase', letterSpacing:'0.05em',
                  textAlign:i===0?'left':'right' }}>{h}</div>
              ))}
            </div>
            {pendingPayments.slice(0, 8).map((p, i) => {
              const m = memberMap[p.userId] || {};
              const name = shortName(m.nameEnglish || m.name || '—');
              const months = (p.paidMonths||[]).join(', ') || '—';
              return (
                <div key={p.id} style={{
                  display:'grid', gridTemplateColumns:'1fr auto auto auto',
                  gap:'4px 12px', padding:'9px 14px', alignItems:'center',
                  background:i%2===0?'var(--color-background-primary,#fff)':'#fffbeb',
                  borderBottom:'0.5px solid #fde68a',
                }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#0f172a',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {name}
                      {m.idNo && <span style={{ fontWeight:400, color:'#94a3b8', marginLeft:5 }}>#{m.idNo}</span>}
                    </div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>
                      {p.method}{p.accountLabel ? ` · ${p.accountLabel}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign:'right', fontSize:12, fontWeight:700, color:'#92400e' }}>
                    {fmt(p.amount)}
                  </div>
                  <div style={{ textAlign:'right', fontSize:11, color:'#64748b', maxWidth:120,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {months}
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
                      background:'#fef3c7', color:'#92400e' }}>
                      pending
                    </span>
                  </div>
                </div>
              );
            })}
            <div style={{ padding:'10px 14px', display:'flex', justifyContent:'space-between',
              alignItems:'center', borderTop:'0.5px solid #fde68a', background:'#fffbeb' }}>
              <span style={{ fontSize:12, color:'#92400e', fontWeight:500 }}>
                {pendingPayments.length > 8 ? `+${pendingPayments.length - 8} more pending` : `${pendingPayments.length} total pending`}
              </span>
              <Link href="/admin/verify" style={{ fontSize:12, color:'#92400e', fontWeight:700, textDecoration:'none' }}>
                Verify all →
              </Link>
            </div>
          </div>
        </>
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
                    <span style={{ fontSize:12, fontWeight:600, color:over?'#dc2626':f.color }}>{pct}%</span>
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


      {/* ── Recent Transactions (last 5 date groups, same as account-book) ── */}
      <SL>Recent Transactions</SL>
      <div style={{ background:'var(--color-background-primary,#fff)',
        border:'0.5px solid var(--color-border-tertiary,#e5e7eb)',
        borderRadius:12, overflow:'hidden' }}>
        {/* column header */}
        <div style={{
          display:'grid',
          gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
          padding:'7px 10px', background:'#0f172a', gap:'4px 8px',
        }}>
          {['Date / Type','Capital (+)','Expenses (−)','Fees (+)','Balance'].map((h,hi)=>(
            <div key={h} style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
              textTransform:'uppercase', letterSpacing:'0.05em', textAlign:hi===0?'left':'right' }}>
              {h}
            </div>
          ))}
        </div>
        <LedgerLegend/>
        {loading ? (
          <div style={{ padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>Loading…</div>
        ) : recentDateGroups.length === 0 ? (
          <div style={{ padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:13 }}>No transactions yet.</div>
        ) : (
          recentDateGroups.map(grp => (
            <DateGroupRow key={grp.dateLabel} dateLabel={grp.dateLabel} entries={grp.entries} isMobile={isMobile}/>
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