// src/app/admin/account-book/page.js — Finance Hub (Phase 6)
'use client';
import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

function fmt(n)   { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function pct(n)   { return `${(Number(n)||0).toFixed(1)}%`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts?.seconds ? new Date(ts.seconds*1000) : ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function tsSort(ts) {
  if (!ts) return 0;
  return ts?.seconds ? ts.seconds : (ts instanceof Date ? ts.getTime()/1000 : new Date(ts).getTime()/1000);
}
function ymKey(ts) {
  const d = ts?.seconds ? new Date(ts.seconds*1000) : ts instanceof Date ? ts : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function ymLabel(key) {
  const [y,m] = key.split('-');
  return new Date(+y,+m-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
}
function yKey(ts)  { const d=ts?.seconds?new Date(ts.seconds*1000):ts instanceof Date?ts:new Date(ts); return String(d.getFullYear()); }
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

function computeFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const p = Math.round(totalCapital*(Number(fb.value)||0)/100);
  const mx = fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(p, mx);
}

function buildOrgEntries(payments, expenses, fees, loans, memberMap) {
  const rows = [];
  payments.filter(p=>p.status==='verified').forEach(p => {
    const net = (p.amount||0) - (p.gatewayFee||0);
    const m   = memberMap[p.userId]||{};
    rows.push({
      id:`pay-${p.id}`, type:'installment', ts:p.createdAt,
      sortKey:tsSort(p.createdAt), date:tsDate(p.createdAt),
      desc:'Capital Installment',
      sub:`${m.nameEnglish||m.name||'Member'} — ${p.method||''}`,
      debit:0, credit:net, count:1,
      meta:{...p, memberName:m.nameEnglish||m.name||'—', memberIdNo:m.idNo||''},
    });
  });
  expenses.forEach(e => {
    rows.push({
      id:`exp-${e.id}`, type:'expense', ts:e.createdAt,
      sortKey:tsSort(e.createdAt), date:e.date||tsDate(e.createdAt),
      desc:e.title||e.description||'Expense', sub:e.category||'',
      debit:e.amount||0, credit:0, count:0, meta:e,
    });
  });
  fees.forEach(f => {
    const m = memberMap[f.userId]||{};
    const isContrib = !!f.countAsContribution;
    rows.push({
      id:`fee-${f.id}`, type:'entry_fee', ts:f.createdAt,
      sortKey:tsSort(f.createdAt), date:f.paidAt||tsDate(f.createdAt),
      desc: isContrib ? 'Entry Fee (Capital)' : 'Entry Fee (Expenses Fund)',
      sub:m.nameEnglish||m.name||'Member',
      debit:0, credit:f.amount||0, count:0,
      meta:{...f, memberName:m.nameEnglish||m.name||'—'},
    });
  });
  loans.filter(l=>['disbursed','repaid'].includes(l.status)).forEach(l => {
    const m = memberMap[l.userId]||{};
    if (l.disbursedAt && l.amount) {
      rows.push({
        id:`loand-${l.id}`, type:'loan_disbursement', ts:l.disbursedAt,
        sortKey:tsSort(l.disbursedAt), date:tsDate(l.disbursedAt),
        desc:'Loan Disbursed',
        sub:`${m.nameEnglish||m.name||'Member'} — ${l.purpose||''}`,
        debit:l.amount, credit:0, count:0,
        meta:{...l, memberName:m.nameEnglish||m.name||'—'},
      });
    }
    (l.repayments||[]).forEach((r,ri) => {
      const d2 = new Date(r.date);
      rows.push({
        id:`loanr-${l.id}-${ri}`, type:'loan_repayment',
        ts:{seconds:d2.getTime()/1000}, sortKey:d2.getTime()/1000,
        date:r.date, desc:'Loan Repayment',
        sub:`${m.nameEnglish||m.name||'Member'} — ${l.purpose||''}`,
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

function groupEntries(entries, keyFn, labelFn) {
  const map = {};
  entries.forEach(e => {
    const key = keyFn(e.ts);
    if (!map[key]) map[key] = {key, label:labelFn(key), entries:[], credit:0, debit:0, count:0};
    map[key].entries.push(e);
    map[key].credit += e.credit;
    map[key].debit  += e.debit;
    map[key].count  += e.count;
  });
  return Object.values(map).sort((a,b)=>a.key.localeCompare(b.key)).map((g,i,arr) => ({
    ...g,
    openingBalance: i===0 ? 0 : arr[i-1].closingBalance,
    closingBalance: g.entries[g.entries.length-1]?.balance ?? 0,
  }));
}

const TYPE_CFG = {
  installment:      {label:'Installment', bg:'#dbeafe', color:'#1e40af'},
  expense:          {label:'Expense',     bg:'#fef2f2', color:'#dc2626'},
  entry_fee:        {label:'Entry Fee',   bg:'#f0fdf4', color:'#15803d'},
  loan_disbursement:{label:'Loan Out',    bg:'#fef3c7', color:'#92400e'},
  loan_repayment:   {label:'Loan In',     bg:'#f0fdf4', color:'#15803d'},
};

function TypeBadge({type}) {
  const c = TYPE_CFG[type] || {label:type, bg:'#f1f5f9', color:'#475569'};
  return (
    <span style={{padding:'2px 8px',borderRadius:5,fontSize:10,fontWeight:700,
      background:c.bg,color:c.color,whiteSpace:'nowrap'}}>
      {c.label}
    </span>
  );
}


export default function AdminAccountBook() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const router   = useRouter();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};

  const [tab,        setTab]        = useState('summary');
  const [payments,   setPayments]   = useState([]);
  const [expenses,   setExpenses]   = useState([]);
  const [fees,       setFees]       = useState([]);
  const [loans,      setLoans]      = useState([]);
  const [projects,   setProjects]   = useState([]);
  const [dists,      setDists]      = useState([]);
  const [memberMap,  setMemberMap]  = useState({});
  const [memberRows, setMemberRows] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [viewMode,   setViewMode]   = useState('daily');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showReport, setShowReport] = useState(false);
  const [search,     setSearch]     = useState('');
  const [memSearch,  setMemSearch]  = useState('');
  const [memSort,    setMemSort]    = useState('capital');
  const [selMember,  setSelMember]  = useState(null);

  useEffect(() => {
    if (!orgId || !isOrgAdmin) return;
    (async () => {
      const [paySnap,expSnap,feeSnap,loanSnap,projSnap,distSnap,memSnap] = await Promise.all([
        getDocs(query(collection(db,'organizations',orgId,'investments'), orderBy('createdAt','asc'))),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'entryFees')),
        getDocs(collection(db,'organizations',orgId,'loans')),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'profitDistributions')),
        getDocs(collection(db,'organizations',orgId,'members')),
      ]);

      const rawPay = paySnap.docs.map(d=>({id:d.id,...d.data()}));
      const rawMem = memSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const enriched = await Promise.all(rawMem.map(async m => {
        try {
          const u = await getDoc(doc(db,'users',m.id));
          return u.exists() ? {...u.data(),...m, id:m.id} : m;
        } catch { return m; }
      }));
      const mmap = Object.fromEntries(enriched.map(m=>[m.id,m]));

      const rawFees = feeSnap.docs.map(d=>({id:d.id,...d.data()}));
      const rows = enriched.map(m => {
        const myPay    = rawPay.filter(p=>p.userId===m.id);
        const verified = myPay.filter(p=>p.status==='verified');
        // Gateway fee always excluded from capital
        const capital  = verified.reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0), 0);
        const pending  = myPay.filter(p=>p.status==='pending').reduce((s,p)=>s+(p.amount||0), 0);
        // Entry fees for this member (from entryFees collection)
        const myEntryFees = rawFees.filter(f=>f.userId===m.id);
        // Also pick up entry_fee / reregistration_fee type payments from investments collection
        const myFeePays   = myPay.filter(p=>p.paymentType==='entry_fee'||p.paymentType==='reregistration_fee');
        return {...m, capital, pending, verifiedCount:verified.length,
          paymentCount:myPay.length, payments:myPay,
          entryFees: myEntryFees, feePays: myFeePays};
      });

      setPayments(rawPay);
      setExpenses(expSnap.docs.map(d=>({id:d.id,...d.data()})));
      setFees(feeSnap.docs.map(d=>({id:d.id,...d.data()})));
      setLoans(loanSnap.docs.map(d=>({id:d.id,...d.data()})));
      setProjects(projSnap.docs.map(d=>({id:d.id,...d.data()})));
      setDists(distSnap.docs.map(d=>({id:d.id,...d.data()})));
      setMemberMap(mmap);
      setMemberRows(rows);
      setLoading(false);
    })();
  }, [orgId, isOrgAdmin]);

  if (!isOrgAdmin) { router.replace('/dashboard'); return null; }

  const allEntries = useMemo(() =>
    buildOrgEntries(payments, expenses, fees, loans, memberMap),
    [payments, expenses, fees, loans, memberMap]
  );

  const filteredEntries = useMemo(() => {
    let rows = typeFilter==='all' ? allEntries : allEntries.filter(e=>e.type===typeFilter);
    if (search) rows = rows.filter(e =>
      e.desc.toLowerCase().includes(search.toLowerCase()) ||
      e.sub.toLowerCase().includes(search.toLowerCase())
    );
    let bal = 0;
    return rows.map(r => { bal += r.credit-r.debit; return {...r, balance:bal}; });
  }, [allEntries, typeFilter, search]);

  const monthly  = useMemo(()=>groupEntries(filteredEntries,ymKey,ymLabel),[filteredEntries]);
  const yearly   = useMemo(()=>groupEntries(filteredEntries,yKey,k=>`Year ${k}`),[filteredEntries]);
  const displayRows = viewMode==='daily' ? filteredEntries : viewMode==='monthly' ? monthly : yearly;
  const isGrouped   = viewMode !== 'daily';

  const totalCredit    = filteredEntries.reduce((s,e)=>s+e.credit, 0);
  const totalDebit     = filteredEntries.reduce((s,e)=>s+e.debit,  0);
  const ledgerBalance  = filteredEntries.length>0 ? filteredEntries[filteredEntries.length-1].balance : 0;
  const instCount      = filteredEntries.filter(e=>e.type==='installment').length;
  const totalCapital   = memberRows.reduce((s,r)=>s+r.capital, 0);
  const totalPending   = memberRows.reduce((s,r)=>s+r.pending, 0);
  const totalExpenses  = expenses.reduce((s,e)=>s+(e.amount||0), 0);
  const totalLoansOut  = loans.filter(l=>l.status==='disbursed'||l.status==='repaid').reduce((s,l)=>s+(l.amount||0),0);
  const activeLoans    = loans.filter(l=>l.status==='disbursed').length;
  const activeProjects = projects.filter(p=>p.status==='active').length;
  const totalInvested  = projects.reduce((s,p)=>s+(p.investedAmount||0),0);
  const distCount      = dists.filter(d=>d.status==='distributed').length;
  const totalFees      = fees.reduce((s,f)=>s+(f.amount||0),0); // admin-recorded entry fees
  // Entry/re-reg fees paid via installment page (special sub route)
  const totalEntryFeeInv    = payments
    .filter(p=>p.status==='verified' && (p.paymentType==='entry_fee') && p.isContribution===false)
    .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
  const totalReregFeeInv    = payments
    .filter(p=>p.status==='verified' && p.paymentType==='reregistration_fee')
    .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
  // Total fee income that funds the Expenses Fund
  const totalFeeIncome      = totalFees + totalEntryFeeInv + totalReregFeeInv;

  const fb = settings.fundBudgets || {};
  let investInv = 0, investRes = 0;
  projects.forEach(p => {
    if (p.fundSources) {
      investInv += Number(p.fundSources.investment)||0;
      investRes += Number(p.fundSources.reserve)||0;
    } else {
      const a = p.investedAmount||0;
      if (p.fundSource==='reserve') investRes += a; else investInv += a;
    }
  });
  const usedBenevolent = loans
    .filter(l=>l.status==='disbursed'||l.status==='repaid')
    .reduce((s,l)=>s+(l.amount||0), 0);

  const FUNDS = [
    {key:'investment', label:'Investment Fund', icon:'📈', color:'#2563eb', bg:'#eff6ff',
      desc:'Capital deployed in investment projects',
      alloc:computeFundAlloc('investment',totalCapital,settings), used:investInv,
      budgetType:fb.investment?.type, budgetValue:fb.investment?.value},
    {key:'reserve', label:'Reserve Fund', icon:'🛡', color:'#16a34a', bg:'#f0fdf4',
      desc:'Emergency buffer; can fund conservative investments',
      alloc:computeFundAlloc('reserve',totalCapital,settings), used:investRes,
      budgetType:fb.reserve?.type, budgetValue:fb.reserve?.value},
    {key:'benevolent', label:'Benevolent Fund', icon:'🤝', color:'#7c3aed', bg:'#faf5ff',
      desc:'Welfare, charity, interest-free loans',
      alloc:computeFundAlloc('benevolent',totalCapital,settings), used:usedBenevolent,
      budgetType:fb.benevolent?.type, budgetValue:fb.benevolent?.value},
    {key:'expenses', label:'Expenses Fund', icon:'🧾', color:'#d97706', bg:'#fffbeb',
      desc:'Operational running costs (entry fees fund this, but are not spending from it)',
      // Alloc = % of capital budget + all fee income collected (entry fees + re-reg fees)
      // The fee income directly replenishes the expenses fund on top of the % allocation
      alloc: computeFundAlloc('expenses',totalCapital,settings) + totalFeeIncome,
      // used = only actual expenditures from the /expenses collection
      used: totalExpenses,
      // breakdown for display
      allocBreakdown: {
        fromCapital: computeFundAlloc('expenses',totalCapital,settings),
        fromFees:    totalFeeIncome,
        entryFees:   totalFees + totalEntryFeeInv,
        reregFees:   totalReregFeeInv,
      },
      budgetType:fb.expenses?.type, budgetValue:fb.expenses?.value},
  ];
  const hasBudgets = Object.values(fb).some(f=>f?.value);

  const filteredMembers = memberRows
    .filter(r =>
      !memSearch ||
      (r.nameEnglish||r.name||'').toLowerCase().includes(memSearch.toLowerCase()) ||
      (r.idNo||'').includes(memSearch)
    )
    .sort((a,b) =>
      memSort==='capital'   ? b.capital-a.capital :
      memSort==='payments'  ? b.verifiedCount-a.verifiedCount :
      (a.nameEnglish||a.name||'').localeCompare(b.nameEnglish||b.name||'')
    );

  const TABS = [
    {id:'summary', label:'📊 Summary'},
    {id:'ledger',  label:'📒 Ledger'},
    {id:'members', label:'💰 Per Member'},
    {id:'funds',   label:'🏦 Fund Breakdown'},
  ];

  const SB = ({label,value,sub,color='#0f172a',bg='#f8fafc'}) => (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:10,color:'#64748b',fontWeight:700,textTransform:'uppercase',
        letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:19,fontWeight:800,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      {showReport && (
        <ReportModal entries={allEntries} orgData={orgData} onClose={()=>setShowReport(false)}/>
      )}

      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',
          gap:12,flexWrap:'wrap'}}>
          <div>
            <div className="page-title">Account Book</div>
            <div className="page-subtitle">Finance hub — summary, ledger, capital, and fund breakdown</div>
          </div>
          {tab==='ledger' && (
            <button onClick={()=>setShowReport(true)}
              style={{padding:'10px 18px',borderRadius:8,background:'#0f172a',color:'#fff',
                border:'none',cursor:'pointer',fontSize:13,fontWeight:700,flexShrink:0}}>
              🖨 Generate Report
            </button>
          )}
          {tab==='funds' && (
            <a href="/admin/settings"
              style={{padding:'10px 18px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',color:'#475569',fontSize:13,fontWeight:600,textDecoration:'none'}}>
              ⚙️ Edit Budgets
            </a>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:2,borderBottom:'2px solid #e2e8f0',marginBottom:24,overflowX:'auto'}}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:'10px 18px',background:'none',border:'none',whiteSpace:'nowrap',
              cursor:'pointer',fontSize:13,fontWeight:tab===t.id?700:400,
              color:tab===t.id?'#2563eb':'#64748b',
              borderBottom:tab===t.id?'2px solid #2563eb':'2px solid transparent',
              marginBottom:-2}}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : (
        <>
          {/* ══ SUMMARY TAB ══ */}
          {tab==='summary' && (
            <div style={{display:'flex',flexDirection:'column',gap:20}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12}}>
                <SB label="Total Capital"   value={fmt(totalCapital)}  color="#15803d" bg="#f0fdf4"
                  sub={`${memberRows.filter(r=>r.capital>0).length} members`}/>
                <SB label="Pending Capital" value={fmt(totalPending)}  color="#92400e" bg="#fef3c7"/>
                <SB label="Total Expenses"  value={fmt(totalExpenses)} color="#dc2626" bg="#fef2f2"/>
                <SB label="Entry Fees"      value={fmt(totalFees)}     color="#0369a1" bg="#e0f2fe"/>
                <SB label="Active Projects" value={activeProjects}     color="#1d4ed8" bg="#eff6ff"
                  sub={`${fmt(totalInvested)} invested`}/>
                <SB label="Active Loans"    value={activeLoans}        color="#7c3aed" bg="#faf5ff"
                  sub={`${fmt(totalLoansOut)} out`}/>
                <SB label="Distributions"   value={distCount}          sub="completed"/>
                <SB label="Net Balance"     value={fmt(ledgerBalance)}
                  color={ledgerBalance>=0?'#0f172a':'#dc2626'}
                  bg={ledgerBalance>=0?'#f8fafc':'#fef2f2'}/>
              </div>

              {hasBudgets && (
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 20px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Fund Overview</div>
                    <button onClick={()=>setTab('funds')}
                      style={{fontSize:12,color:'#2563eb',background:'none',border:'none',
                        cursor:'pointer',fontWeight:600}}>
                      Full breakdown →
                    </button>
                  </div>
                  {FUNDS.filter(f=>f.alloc>0).map(f => {
                    const up = Math.min(100,(f.used/f.alloc)*100);
                    const ov = f.used>f.alloc;
                    return (
                      <div key={f.key} style={{marginBottom:14}}>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                          <span style={{fontWeight:600,color:'#0f172a'}}>{f.icon} {f.label}</span>
                          <span style={{color:ov?'#dc2626':f.color,fontWeight:600}}>
                            {fmt(f.alloc-f.used)} remaining
                          </span>
                        </div>
                        <div style={{height:6,borderRadius:99,background:'#e2e8f0',overflow:'hidden'}}>
                          <div style={{height:'100%',borderRadius:99,background:ov?'#dc2626':f.color,
                            width:`${up}%`,transition:'width 0.6s'}}/>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',
                          fontSize:10,color:'#94a3b8',marginTop:2}}>
                          <span>Used: {fmt(f.used)}</span>
                          <span>Budget: {fmt(f.alloc)}</span>
                        </div>
                        {f.key==='expenses' && f.allocBreakdown && f.alloc>0 && (
                          <div style={{marginTop:5,padding:'5px 10px',borderRadius:7,
                            background:'#fffbeb',border:'1px solid #fde68a',
                            display:'flex',flexWrap:'wrap',gap:'4px 14px'}}>
                            {f.allocBreakdown.fromCapital>0 && (
                              <span style={{fontSize:10,color:'#92400e'}}>
                                📊 {fb.expenses?.value}% of capital: {fmt(f.allocBreakdown.fromCapital)}
                              </span>
                            )}
                            {f.allocBreakdown.entryFees>0 && (
                              <span style={{fontSize:10,color:'#92400e'}}>
                                🎫 Entry fees: {fmt(f.allocBreakdown.entryFees)}
                              </span>
                            )}
                            {f.allocBreakdown.reregFees>0 && (
                              <span style={{fontSize:10,color:'#92400e'}}>
                                🔄 Re-reg fees: {fmt(f.allocBreakdown.reregFees)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {memberRows.length>0 && (
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid #e2e8f0',
                    display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Top Members by Capital</div>
                    <button onClick={()=>setTab('members')}
                      style={{fontSize:12,color:'#2563eb',background:'none',border:'none',
                        cursor:'pointer',fontWeight:600}}>See all →</button>
                  </div>
                  {[...memberRows].sort((a,b)=>b.capital-a.capital).slice(0,5).map((r,i) => {
                    const cp = totalCapital>0 ? ((r.capital/totalCapital)*100).toFixed(1) : '0';
                    return (
                      <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,
                        padding:'10px 16px',borderBottom:'1px solid #f1f5f9',
                        background:i%2===0?'#fff':'#fafafa'}}>
                        <div style={{width:24,height:24,borderRadius:'50%',background:'#dbeafe',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:10,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                          {r.photoURL?<img src={r.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:initials(r.nameEnglish||r.name)}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,color:'#0f172a',
                            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {r.nameEnglish||r.name||'—'}
                          </div>
                          {r.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{r.idNo}</div>}
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(r.capital)}</div>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{cp}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {allEntries.length>0 && (
                <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid #e2e8f0',
                    display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Recent Transactions</div>
                    <button onClick={()=>setTab('ledger')}
                      style={{fontSize:12,color:'#2563eb',background:'none',border:'none',
                        cursor:'pointer',fontWeight:600}}>Full ledger →</button>
                  </div>
                  {[...allEntries].reverse().slice(0,8).map((e,i) => (
                    <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,
                      padding:'9px 16px',borderBottom:'1px solid #f1f5f9',
                      background:i%2===0?'#fff':'#fafafa'}}>
                      <TypeBadge type={e.type}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:'#0f172a',
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.desc}</div>
                        <div style={{fontSize:11,color:'#94a3b8'}}>{e.sub} · {e.date}</div>
                      </div>
                      <div style={{fontWeight:700,fontSize:13,flexShrink:0,
                        color:e.debit>0?'#dc2626':'#15803d'}}>
                        {e.debit>0 ? `−${fmt(e.debit)}` : `+${fmt(e.credit)}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ LEDGER TAB ══ */}
          {tab==='ledger' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
                gap:12,marginBottom:20}}>
                <SB label="Total Credits" value={fmt(totalCredit)} color="#15803d" bg="#f0fdf4"
                  sub={`${instCount} installments`}/>
                <SB label="Total Debits"  value={fmt(totalDebit)}  color="#dc2626" bg="#fef2f2"/>
                <SB label="Net Balance"   value={fmt(ledgerBalance)}
                  color={ledgerBalance>=0?'#1d4ed8':'#dc2626'}
                  bg={ledgerBalance>=0?'#eff6ff':'#fef2f2'}/>
                <SB label="Entries" value={filteredEntries.length}/>
              </div>

              <div style={{display:'flex',gap:10,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
                <div style={{display:'flex',gap:4}}>
                  {[['daily','Day by Day'],['monthly','Monthly'],['yearly','Yearly']].map(([k,l]) => (
                    <button key={k} onClick={()=>{setViewMode(k);}}
                      style={{padding:'7px 14px',borderRadius:8,fontSize:12,cursor:'pointer',
                        border:'none',fontWeight:viewMode===k?700:400,
                        background:viewMode===k?'#0f172a':'#f1f5f9',
                        color:viewMode===k?'#fff':'#64748b'}}>
                      {l}
                    </button>
                  ))}
                </div>
                <input value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="Search transactions…"
                  style={{flex:1,minWidth:160,padding:'7px 12px',borderRadius:8,
                    border:'1px solid #e2e8f0',fontSize:13}}/>
              </div>

              <div style={{display:'flex',gap:5,marginBottom:16,flexWrap:'wrap'}}>
                {[['all','All'],['installment','Installments'],['expense','Expenses'],
                  ['entry_fee','Entry Fees'],['loan_disbursement','Loans Out'],
                  ['loan_repayment','Loan Repayments']].map(([key,label]) => (
                  <button key={key} onClick={()=>{setTypeFilter(key);}}
                    style={{padding:'5px 12px',borderRadius:99,fontSize:12,cursor:'pointer',
                      border:'none',fontWeight:typeFilter===key?700:400,
                      background:typeFilter===key?'#0f172a':'#f1f5f9',
                      color:typeFilter===key?'#fff':'#64748b'}}>
                    {label}
                    {key!=='all' && (
                      <span style={{opacity:0.7,marginLeft:4}}>
                        ({allEntries.filter(e=>e.type===key).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {filteredEntries.length === 0 ? (
                <div style={{textAlign:'center',padding:'60px'}}>
                  <div style={{fontSize:36,marginBottom:10}}>📒</div>
                  <div style={{fontWeight:600,color:'#0f172a'}}>No transactions found</div>
                </div>
              ) : (
                <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                  <div style={{display:'grid',
                    gridTemplateColumns:'0.85fr 2.5fr 1fr 1fr 1fr 0.5fr 1fr',
                    padding:'9px 16px',background:'#0f172a'}}>
                    {['Date','Description','Debit (−)','Capital (+)','Fees (+)','Inst.','Balance'].map(h => (
                      <div key={h} style={{fontSize:11,fontWeight:700,color:'#94a3b8',
                        textTransform:'uppercase',letterSpacing:'0.06em',
                        textAlign:['Debit (−)','Capital (+)','Fees (+)','Inst.','Balance'].includes(h)?'right':'left'}}>
                        {h}
                      </div>
                    ))}
                  </div>
                  <div style={{display:'grid',
                    gridTemplateColumns:'0.85fr 2.5fr 1fr 1fr 1fr 0.5fr 1fr',
                    padding:'8px 16px',background:'#fafafa',borderBottom:'2px solid #e2e8f0'}}>
                    <div style={{fontSize:12,color:'#94a3b8'}}>—</div>
                    <div style={{fontSize:12,color:'#64748b',fontStyle:'italic'}}>Opening Balance</div>
                    <div/><div/><div/><div/>
                    <div style={{textAlign:'right',fontWeight:700,color:'#64748b'}}>{fmt(0)}</div>
                  </div>
                  {displayRows.map(row => (
                    <LedgerRow
                      key={row.id||row.key}
                      row={row}
                      isGrouped={isGrouped}
                    />
                  ))}
                  <div style={{display:'grid',
                    gridTemplateColumns:'0.85fr 2.5fr 1fr 1fr 1fr 0.5fr 1fr',
                    padding:'10px 16px',background:'#0f172a'}}>
                    <div style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>Closing</div>
                    <div/>
                    <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>Closing Balance</div>
                    <div style={{textAlign:'right',fontWeight:700,color:'#fca5a5'}}>
                      {totalDebit>0?fmt(totalDebit):'—'}
                    </div>
                    <div style={{textAlign:'right',fontWeight:700,color:'#86efac'}}>
                      {(() => { const t=filteredEntries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0); return t>0?fmt(t):'—'; })()}
                    </div>
                    <div style={{textAlign:'right',fontWeight:700,color:'#fde68a'}}>
                      {(() => { const t=filteredEntries.filter(e=>e.type==='entry_fee'||e.type==='reregistration_fee').reduce((s,e)=>s+e.credit,0); return t>0?fmt(t):'—'; })()}
                    </div>
                    <div style={{textAlign:'right',fontWeight:700,color:'#93c5fd'}}>{instCount}</div>
                    <div style={{textAlign:'right',fontWeight:800,fontSize:15,color:'#fff'}}>
                      {fmt(ledgerBalance)}
                    </div>
                    <div/>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ MEMBERS TAB ══ */}
          {tab==='members' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
                gap:12,marginBottom:20}}>
                <SB label="Total Capital"   value={fmt(totalCapital)}  color="#15803d" bg="#f0fdf4"/>
                <SB label="Active Members"  value={memberRows.filter(r=>r.capital>0).length}
                  color="#1d4ed8" bg="#eff6ff"/>
                <SB label="Pending Capital" value={fmt(totalPending)}  color="#92400e" bg="#fef3c7"/>
                <SB label="Total Members"   value={memberRows.length}/>
              </div>
              <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
                <input value={memSearch} onChange={e=>setMemSearch(e.target.value)}
                  placeholder="Search member…"
                  style={{flex:1,minWidth:180,padding:'9px 14px',borderRadius:8,
                    border:'1px solid #e2e8f0',fontSize:13}}/>
                <select value={memSort} onChange={e=>setMemSort(e.target.value)}
                  style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',
                    fontSize:13,color:'#475569'}}>
                  <option value="capital">Sort: Most Capital</option>
                  <option value="name">Sort: Name A–Z</option>
                  <option value="payments">Sort: Most Payments</option>
                </select>
              </div>
              <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',
                  padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                  {['Member','Capital','Pending','Payments'].map(h => (
                    <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',
                      textTransform:'uppercase',letterSpacing:'0.06em',
                      textAlign:h==='Member'?'left':'right'}}>{h}</div>
                  ))}
                </div>
                {filteredMembers.map((r,i) => {
                  const cp  = totalCapital>0 ? ((r.capital/totalCapital)*100).toFixed(1) : '0';
                  const sel = selMember===r.id;
                  return (
                    <div key={r.id} onClick={()=>setSelMember(sel?null:r.id)}
                      style={{cursor:'pointer',borderBottom:'1px solid #f1f5f9'}}>
                      <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',
                        padding:'11px 16px',
                        background:sel?'#eff6ff':i%2===0?'#fff':'#fafafa',
                        transition:'background 0.1s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                        onMouseLeave={e=>e.currentTarget.style.background=sel?'#eff6ff':i%2===0?'#fff':'#fafafa'}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{width:30,height:30,borderRadius:'50%',background:'#dbeafe',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                            {r.photoURL?<img src={r.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:initials(r.nameEnglish||r.name)}
                          </div>
                          <div>
                            <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>
                              {r.nameEnglish||r.name||'—'}
                            </div>
                            {r.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{r.idNo}</div>}
                          </div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(r.capital)}</div>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{cp}%</div>
                        </div>
                        <div style={{textAlign:'right',fontWeight:600,fontSize:13,
                          color:r.pending>0?'#92400e':'#94a3b8'}}>
                          {r.pending>0?fmt(r.pending):'—'}
                        </div>
                        <div style={{textAlign:'right',fontSize:13,color:'#475569'}}>
                          {r.verifiedCount} / {r.paymentCount}
                        </div>
                      </div>
                      {sel && (
                        <div style={{padding:'0 16px 12px',background:'#f0f9ff'}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#1e40af',
                            marginBottom:8,paddingTop:8}}>Payment History</div>
                          {r.payments.length===0 ? (
                            <div style={{fontSize:12,color:'#94a3b8'}}>No installment payments.</div>
                          ) : (
                            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                              <thead>
                                <tr style={{background:'#dbeafe'}}>
                                  {['Date','Amount','Fee','Net','Status'].map(h => (
                                    <th key={h} style={{padding:'6px 10px',
                                      textAlign:h==='Date'||h==='Status'?'left':'right',
                                      fontWeight:700,color:'#1e40af'}}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {r.payments
                                  .filter(p => !p.paymentType || p.paymentType==='monthly')
                                  .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
                                  .map((p,pi) => {
                                    const net = (p.amount||0) - (p.gatewayFee||0);
                                    const sc  = p.status==='verified'?'#15803d':p.status==='pending'?'#92400e':'#dc2626';
                                    return (
                                      <tr key={p.id} style={{background:pi%2===0?'#fff':'#f0f9ff'}}>
                                        <td style={{padding:'6px 10px'}}>{tsDate(p.createdAt)}</td>
                                        <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(p.amount)}</td>
                                        <td style={{padding:'6px 10px',textAlign:'right',color:'#dc2626'}}>
                                          {p.gatewayFee>0?`-${fmt(p.gatewayFee)}`:'—'}
                                        </td>
                                        <td style={{padding:'6px 10px',textAlign:'right',
                                          fontWeight:600,color:'#15803d'}}>{fmt(net)}</td>
                                        <td style={{padding:'6px 10px'}}>
                                          <span style={{fontSize:11,fontWeight:700,color:sc,
                                            background:p.status==='verified'?'#dcfce7':p.status==='pending'?'#fef3c7':'#fee2e2',
                                            padding:'2px 8px',borderRadius:99}}>
                                            {p.status}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })
                                }
                              </tbody>
                            </table>
                          )}
                          {/* ── Entry fees & Re-reg fees (not capital contributions) ── */}
                          {(() => {
                            const allFeeRows = [
                              ...(r.entryFees||[]).map(f=>({
                                date: f.paidAt||tsDate(f.createdAt),
                                amount: f.amount||0,
                                type: 'entry_fee',
                                method: f.method||'—',
                                label: 'Entry Fee',
                              })),
                              ...(r.feePays||[])
                                .filter(p=>p.status!=='rejected')
                                .map(p=>({
                                  date: tsDate(p.createdAt),
                                  amount: (p.amount||0)-(p.gatewayFee||0),
                                  type: p.paymentType||'entry_fee',
                                  method: p.method||'—',
                                  label: p.paymentType==='reregistration_fee'?'Re-Registration Fee':'Entry Fee',
                                  status: p.status,
                                })),
                            ];
                            if (allFeeRows.length===0) return null;
                            return (
                              <div style={{marginTop:10}}>
                                <div style={{fontSize:11,fontWeight:700,color:'#d97706',
                                  marginBottom:5,display:'flex',alignItems:'center',gap:5}}>
                                  🧾 Entry / Registration Fees
                                  <span style={{fontWeight:400,color:'#94a3b8',fontSize:10}}>
                                    (not counted as capital contribution)
                                  </span>
                                </div>
                                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                  <thead>
                                    <tr style={{background:'#fef3c7'}}>
                                      {['Date','Type','Amount','Method'].map(h=>(
                                        <th key={h} style={{padding:'5px 10px',
                                          textAlign:h==='Amount'?'right':'left',
                                          fontWeight:700,color:'#92400e'}}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {allFeeRows.map((f,fi)=>(
                                      <tr key={fi} style={{background:fi%2===0?'#fffbeb':'#fff'}}>
                                        <td style={{padding:'5px 10px',color:'#64748b'}}>{f.date}</td>
                                        <td style={{padding:'5px 10px'}}>
                                          <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',
                                            borderRadius:99,
                                            background:f.type==='reregistration_fee'?'#ede9fe':'#fef3c7',
                                            color:f.type==='reregistration_fee'?'#7c3aed':'#92400e'}}>
                                            {f.label}
                                          </span>
                                          {f.status && f.status!=='verified' && (
                                            <span style={{fontSize:10,marginLeft:4,color:'#94a3b8'}}>
                                              ({f.status})
                                            </span>
                                          )}
                                        </td>
                                        <td style={{padding:'5px 10px',textAlign:'right',
                                          fontWeight:600,color:'#d97706'}}>{fmt(f.amount)}</td>
                                        <td style={{padding:'5px 10px',color:'#64748b'}}>{f.method}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══ FUNDS TAB ══ */}
          {tab==='funds' && (
            <div>
              {!hasBudgets && (
                <div style={{padding:'12px 16px',borderRadius:10,background:'#fffbeb',
                  border:'1px solid #fde68a',fontSize:13,color:'#92400e',marginBottom:16}}>
                  💡 No fund budgets set yet.{' '}
                  <a href="/admin/settings" style={{color:'#2563eb',textDecoration:'underline'}}>
                    Go to Settings → Fund Budgets
                  </a>{' '}to configure allocations.
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',
                gap:12,marginBottom:20}}>
                <SB label="Total Capital"  value={fmt(totalCapital)} color="#15803d" bg="#f0fdf4"/>
                <SB label="Total Budgeted"
                  value={fmt(FUNDS.reduce((s,f)=>s+f.alloc,0))} color="#1d4ed8" bg="#eff6ff"
                  sub={totalCapital>0?pct(FUNDS.reduce((s,f)=>s+f.alloc,0)/totalCapital*100)+' of capital':undefined}/>
                <SB label="Total Used"
                  value={fmt(FUNDS.reduce((s,f)=>s+f.used,0))} color="#d97706" bg="#fffbeb"/>
                <SB label="Available"
                  value={fmt(FUNDS.reduce((s,f)=>s+f.alloc-f.used,0))}
                  color={FUNDS.reduce((s,f)=>s+f.alloc-f.used,0)>=0?'#15803d':'#dc2626'}
                  bg={FUNDS.reduce((s,f)=>s+f.alloc-f.used,0)>=0?'#f0fdf4':'#fef2f2'}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16}}>
                {FUNDS.map(({key:fKey, ...fProps}) => <FundCard key={fKey} {...fProps}/>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}