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

// ── NEW: format a paidMonths entry (e.g. "2026-04" or timestamp) → "Apr 2026"
function fmtPaidMonth(val) {
  if (!val) return '—';
  // "YYYY-MM" string format
  if (typeof val === 'string' && /^\d{4}-\d{2}$/.test(val)) {
    const [y, m] = val.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  // Firestore timestamp or Date
  const d = val?.seconds ? new Date(val.seconds * 1000) : val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function computeFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const p = Math.round(totalCapital*(Number(fb.value)||0)/100);
  const mx = fb.maxAmount && Number(fb.maxAmount)>0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(p, mx);
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

function buildOrgEntries(payments, expenses, fees, loans, memberMap) {
  const rows = [];
  payments.filter(p=>p.status==='verified').forEach(p => {
    const net = (p.amount||0) - (p.gatewayFee||0);
    const m   = memberMap[p.userId]||{};
    rows.push({
      id:`pay-${p.id}`, type:'installment', ts:p.createdAt,
      sortKey:tsSort(p.createdAt), date:normDate(p.createdAt),
      desc:'Capital Installment',
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
      meta:{...f, memberName:m.nameEnglish||m.name||'—'},
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

// ── TYPE CONFIG ───────────────────────────────────────────────────────────────
const TYPE_CFG = {
  installment:      {label:'Installment',  short:'In',  bg:'#dbeafe', color:'#1e40af'},
  expense:          {label:'Expense',      short:'Ex',  bg:'#fee2e2', color:'#dc2626'},
  entry_fee:        {label:'Entry Fee',    short:'En',  bg:'#ccfbf1', color:'#0d9488'},
  loan_disbursement:{label:'Loan Out',     short:'LoO', bg:'#fef3c7', color:'#92400e'},
  loan_repayment:   {label:'Loan In',      short:'LoI', bg:'#d1fae5', color:'#065f46'},
  reregistration_fee:{label:'Re-Reg Fee', short:'RR',  bg:'#ede9fe', color:'#7c3aed'},
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

function TypeTag({type}) {
  const c = TYPE_CFG[type] || {short:type.slice(0,3), label:type, bg:'#f1f5f9', color:'#475569'};
  return (
    <span title={c.label} style={{
      display:'inline-block',
      padding:'1px 5px',
      borderRadius:4,
      fontSize:9,
      fontWeight:800,
      letterSpacing:'0.03em',
      background:c.bg,
      color:c.color,
      whiteSpace:'nowrap',
      flexShrink:0,
      lineHeight:'16px',
    }}>
      {c.short}
    </span>
  );
}

function LedgerLegend() {
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:'5px 12px',
      padding:'7px 10px',background:'#f8fafc',borderRadius:8,
      border:'1px solid #e2e8f0',marginBottom:8,alignItems:'center'}}>
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

function EntryDetailPanel({ entry }) {
  const m = entry.meta || {};
  const fields = [];

  if (m.memberName)    fields.push(['Member',       m.memberName + (m.memberIdNo ? ` #${m.memberIdNo}` : '')]);
  if (entry.desc)      fields.push(['Description',  entry.desc]);
  if (entry.sub && entry.sub !== m.memberName) fields.push(['Details', entry.sub]);
  if (entry.credit>0)  fields.push(['Credit',       fmt(entry.credit)]);
  if (entry.debit>0)   fields.push(['Debit',        fmt(entry.debit)]);
  if (m.gatewayFee>0)  fields.push(['Gateway Fee',  `−${fmt(m.gatewayFee)}`]);
  if (m.method)        fields.push(['Method',       m.method]);
  if (m.status)        fields.push(['Status',       m.status]);
  if (m.purpose)       fields.push(['Purpose',      m.purpose]);
  if (m.category)      fields.push(['Category',     m.category]);
  if (m.repayment) {
    if (m.repayment.principal) fields.push(['Principal', fmt(m.repayment.principal)]);
    if (m.repayment.interest)  fields.push(['Interest',  fmt(m.repayment.interest)]);
  }
  fields.push(['Balance After', fmt(entry.balance)]);

  return (
    <div style={{
      padding:'10px 12px 10px 16px',
      background:'#f0f9ff',
      borderTop:'1px solid #bae6fd',
      borderBottom:'1px solid #bae6fd',
    }}>
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:7}}>
        <TypeTag type={entry.type}/>
        <span style={{fontSize:10,color:'#94a3b8'}}>{entry.date}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',
        gap:'3px 16px'}}>
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

// ── DateGroupRow ──────────────────────────────────────────────────────────────
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
          cursor:'pointer',
          userSelect:'none',
          alignItems:'center',
          gap:'4px 8px',
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
                alignItems:'center',
                gap:'4px 8px',
                cursor:'pointer',
                userSelect:'none',
              }}
              onMouseEnter={e2=>{ if(!isOpen) e2.currentTarget.style.background='#e0f2fe'; }}
              onMouseLeave={e2=>{ e2.currentTarget.style.background=isOpen?'#e0f2fe':ei%2===0?'#fafeff':'#f0f9ff'; }}
            >
              <div style={{display:'flex',alignItems:'center',gap:5,minWidth:0,overflow:'hidden'}}>
                <span style={{fontSize:10,color:'#94a3b8',flexShrink:0}}>{isOpen?'▾':'▸'}</span>
                <TypeTag type={e.type}/>
                <span style={{fontSize:11,color:'#475569',overflow:'hidden',
                  textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {e.meta?.memberName
                    ? `${e.meta.memberName}${e.meta.memberIdNo?` #${e.meta.memberIdNo}`:''}`
                    : e.sub||''}
                </span>
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,
                color:cap>0?'#1e40af':'#cbd5e1'}}>
                {cap>0?`+${fmt(cap)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,
                color:exp>0?'#dc2626':'#cbd5e1'}}>
                {exp>0?`−${fmt(exp)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:600,
                color:fee>0?'#0d9488':'#cbd5e1'}}>
                {fee>0?`+${fmt(fee)}`:'—'}
              </div>
              <div style={{textAlign:'right',fontSize:11,fontWeight:700,
                color:e.balance>=0?'#0f172a':'#dc2626'}}>
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

// ── LedgerRow ─────────────────────────────────────────────────────────────────
function LedgerRow({ row, isGrouped, isMobile }) {
  const [open, setOpen] = useState(false);
  if (isGrouped) {
    const totalCapital  = row.entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
    const totalExpenses = row.entries.filter(e=>e.debit>0).reduce((s,e)=>s+e.debit,0);
    const totalFees     = row.entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
    const byDate = {};
    row.entries.forEach(e=>{
      if(!byDate[e.date]) byDate[e.date]=[];
      byDate[e.date].push(e);
    });
    const dateGroups = Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b));
    return (
      <div style={{borderBottom:'1px solid #e2e8f0'}}>
        <div
          onClick={()=>setOpen(o=>!o)}
          style={{
            display:'grid',
            gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
            padding:'8px 10px',
            background:'#f8fafc',
            cursor:'pointer',
            userSelect:'none',
            alignItems:'center',
            gap:'4px 8px',
          }}
        >
          <div style={{fontSize:12,fontWeight:700,color:'#0f172a',display:'flex',alignItems:'center',gap:5,minWidth:0}}>
            <span style={{color:'#94a3b8',flexShrink:0}}>{open?'▾':'▸'}</span>
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{row.label}</span>
            {!isMobile && (
              <span style={{fontSize:11,color:'#94a3b8',fontWeight:400,flexShrink:0}}>
                {row.entries.length} entries
              </span>
            )}
          </div>
          <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalCapital>0?'#1e40af':'#cbd5e1'}}>
            {totalCapital>0?`+${fmt(totalCapital)}`:'—'}
          </div>
          <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalExpenses>0?'#dc2626':'#cbd5e1'}}>
            {totalExpenses>0?`−${fmt(totalExpenses)}`:'—'}
          </div>
          <div style={{textAlign:'right',fontSize:11,fontWeight:700,color:totalFees>0?'#0d9488':'#cbd5e1'}}>
            {totalFees>0?`+${fmt(totalFees)}`:'—'}
          </div>
          <div style={{textAlign:'right',fontSize:13,fontWeight:800,color:'#1d4ed8',flexShrink:0}}>
            {fmt(row.closingBalance)}
          </div>
        </div>
        {open && dateGroups.map(([date, grpEntries])=>(
          <DateGroupRow key={date} dateLabel={date} entries={grpEntries} isMobile={isMobile}/>
        ))}
      </div>
    );
  }
  return null;
}

// ── FundCard ──────────────────────────────────────────────────────────────────
function FundCard({ label, icon, color, bg, desc, alloc, used, budgetType, budgetValue, allocBreakdown }) {
  const remaining = alloc - used;
  const pctUsed   = alloc > 0 ? Math.min(100, (used / alloc) * 100) : 0;
  const over      = used > alloc;
  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #f1f5f9',background:bg}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:20}}>{icon}</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color}}>{label}</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{desc}</div>
          </div>
        </div>
      </div>
      <div style={{padding:'14px 18px'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6,fontSize:12}}>
          <span style={{color:'#64748b'}}>Budget</span>
          <span style={{fontWeight:700,color:'#0f172a'}}>
            {budgetType==='amount'?fmt(budgetValue):budgetValue?`${budgetValue}% of capital`:'Not set'}
          </span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6,fontSize:12}}>
          <span style={{color:'#64748b'}}>Allocated</span>
          <span style={{fontWeight:700,color}}>{fmt(alloc)}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10,fontSize:12}}>
          <span style={{color:'#64748b'}}>Used</span>
          <span style={{fontWeight:700,color:over?'#dc2626':'#0f172a'}}>{fmt(used)}</span>
        </div>
        <div style={{height:8,borderRadius:99,background:'#e2e8f0',overflow:'hidden',marginBottom:6}}>
          <div style={{height:'100%',borderRadius:99,background:over?'#dc2626':color,
            width:`${pctUsed}%`,transition:'width 0.6s'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,
          fontWeight:700,color:over?'#dc2626':'#15803d'}}>
          <span>{over?'⚠️ Over budget':`${(100-pctUsed).toFixed(1)}% remaining`}</span>
          <span>{over?`-${fmt(Math.abs(remaining))}`:fmt(remaining)}</span>
        </div>
        {allocBreakdown && alloc>0 && (
          <div style={{marginTop:10,padding:'8px 12px',borderRadius:8,
            background:'#fffbeb',border:'1px solid #fde68a',
            display:'flex',flexDirection:'column',gap:4}}>
            <div style={{fontSize:10,fontWeight:700,color:'#92400e',marginBottom:2}}>Allocation Breakdown</div>
            {allocBreakdown.fromCapital>0 && (
              <div style={{fontSize:11,color:'#92400e'}}>📊 Capital %: {fmt(allocBreakdown.fromCapital)}</div>
            )}
            {allocBreakdown.entryFees>0 && (
              <div style={{fontSize:11,color:'#92400e'}}>🎫 Entry fees: {fmt(allocBreakdown.entryFees)}</div>
            )}
            {allocBreakdown.reregFees>0 && (
              <div style={{fontSize:11,color:'#92400e'}}>🔄 Re-reg fees: {fmt(allocBreakdown.reregFees)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Report helpers ────────────────────────────────────────────────────────────
function buildReportDateGroups(entries) {
  const map = {};
  entries.forEach(e => {
    const k = e.date || '—';
    if (!map[k]) map[k] = { date: k, sortKey: e.sortKey, entries: [] };
    map[k].entries.push(e);
  });
  return Object.values(map).sort((a, b) => a.sortKey - b.sortKey);
}

function downloadCSV(entries, orgData) {
  const org = orgData || {};
  const genDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const groups = buildReportDateGroups(entries);
  const rows = [
    [`Organisation: ${org.name||org.name_en||''}`, '', '', '', '', '', ''],
    [`Report generated: ${genDate}`, '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Date','Type','Member / Description','Capital (+)','Expenses (−)','Fees (+)','Balance'],
  ];
  groups.forEach(g => {
    const cap = g.entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
    const exp = g.entries.filter(e=>e.debit>0).reduce((s,e)=>s+e.debit,0);
    const fee = g.entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
    const bal = g.entries[g.entries.length-1]?.balance ?? 0;
    const types = [...new Set(g.entries.map(e=>e.type))].join('+');
    rows.push([g.date, types, `${g.entries.length} transaction(s)`,
      cap>0?cap:'', exp>0?exp:'', fee>0?fee:'', bal]);
    g.entries.forEach(e => {
      const name = e.meta?.memberName || e.sub || '';
      rows.push(['', `  ${e.type}`, name,
        e.type==='installment'&&e.credit>0?e.credit:'',
        e.debit>0?e.debit:'',
        (e.type==='entry_fee'||e.type==='loan_repayment')&&e.credit>0?e.credit:'',
        e.balance]);
    });
  });
  const totalCap = entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
  const totalExp = entries.reduce((s,e)=>s+e.debit,0);
  const totalFee = entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
  const finalBal = entries.length>0?entries[entries.length-1].balance:0;
  rows.push(['TOTALS','','',totalCap,totalExp,totalFee,finalBal]);

  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url;
  a.download=`ledger-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── NEW: Export per-member Excel (one sheet per member) ───────────────────────
// Uses SheetJS (xlsx) loaded from CDN. We lazy-load it so the page doesn't block.
async function exportMembersExcel(memberRows, orgData) {
  // Dynamically load SheetJS if not already present
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const org = orgData || {};
  const genDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // ── Sheet 1: Summary of all members ──────────────────────────────────────
  const summaryData = [
    [`${org.name_en || org.name || 'Organisation'} — Member Capital Summary`],
    [`Generated: ${genDate}`],
    [],
    ['#', 'Member ID', 'Name', 'Capital (Net)', 'Pending', 'Verified Payments', 'Total Payments'],
    ...memberRows.map((r, i) => [
      i + 1,
      r.idNo || '',
      r.nameEnglish || r.name || '—',
      r.capital,
      r.pending,
      r.verifiedCount,
      r.paymentCount,
    ]),
    [],
    ['', '', 'TOTAL',
      memberRows.reduce((s, r) => s + r.capital, 0),
      memberRows.reduce((s, r) => s + r.pending, 0),
      memberRows.reduce((s, r) => s + r.verifiedCount, 0),
      memberRows.reduce((s, r) => s + r.paymentCount, 0),
    ],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [
    {wch:4},{wch:10},{wch:24},{wch:14},{wch:12},{wch:18},{wch:16},
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // ── One sheet per member ──────────────────────────────────────────────────
  memberRows.forEach(r => {
    const name = (r.nameEnglish || r.name || 'Member').slice(0, 28); // sheet name max 31 chars
    const safeSheetName = name.replace(/[:\\/?*\[\]]/g, '').trim() || `M_${r.idNo || 'unknown'}`;

    // Build unified payment rows (same logic as MemberPaymentHistory)
    const allRows = [];

    // Installment payments
    (r.payments || [])
      .filter(p => !p.paymentType || p.paymentType === 'monthly')
      .forEach(p => {
        const net = (p.amount || 0) - (p.gatewayFee || 0);
        // Collect paidMonths labels
        const months = (p.paidMonths || []).map(fmtPaidMonth).join(', ');
        allRows.push({
          _sortKey: tsSort(p.createdAt),
          date: tsDate(p.createdAt),
          type: 'Installment',
          installmentMonth: months,
          amount: p.amount || 0,
          gatewayFee: p.gatewayFee || 0,
          net,
          method: p.method || '—',
          status: p.status || '—',
        });
      });

    // Entry fees from entryFees collection
    (r.entryFees || []).forEach(f => {
      allRows.push({
        _sortKey: tsSort(f.paidAt || f.createdAt),
        date: f.paidAt ? normDate(f.paidAt) : normDate(f.createdAt),
        type: 'Entry Fee',
        installmentMonth: '',
        amount: f.amount || 0,
        gatewayFee: 0,
        net: f.amount || 0,
        method: f.method || '—',
        status: 'verified',
      });
    });

    // Fee payments from investments collection
    (r.feePays || [])
      .filter(p => p.status !== 'rejected')
      .forEach(p => {
        const net = (p.amount || 0) - (p.gatewayFee || 0);
        allRows.push({
          _sortKey: tsSort(p.createdAt),
          date: normDate(p.createdAt),
          type: p.paymentType === 'reregistration_fee' ? 'Re-Registration Fee' : 'Entry Fee',
          installmentMonth: '',
          amount: p.amount || 0,
          gatewayFee: p.gatewayFee || 0,
          net,
          method: p.method || '—',
          status: p.status || '—',
        });
      });

    allRows.sort((a, b) => a._sortKey - b._sortKey);

    const capitalNet = allRows
      .filter(x => x.type === 'Installment' && x.status === 'verified')
      .reduce((s, x) => s + x.net, 0);
    const feeTotal = allRows
      .filter(x => x.type !== 'Installment')
      .reduce((s, x) => s + x.net, 0);

    const sheetData = [
      [`${org.name_en || org.name || 'Organisation'} — Member Payment History`],
      [`Member: ${r.nameEnglish || r.name || '—'}  |  ID: ${r.idNo || '—'}`],
      [`Generated: ${genDate}`],
      [],
      ['Date', 'Type', 'Installment Month', 'Amount', 'Gateway Fee', 'Net', 'Method', 'Status'],
      ...allRows.map(row => [
        row.date,
        row.type,
        row.installmentMonth,
        row.amount,
        row.gatewayFee || '',
        row.net,
        row.method,
        row.status,
      ]),
      [],
      ['', '', 'Capital Net (verified)', '', '', capitalNet, '', ''],
      ['', '', 'Fee Income (not capital)', '', '', feeTotal, '', ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      {wch:14},{wch:20},{wch:18},{wch:12},{wch:12},{wch:12},{wch:12},{wch:10},
    ];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
  });

  XLSX.writeFile(wb, `members-capital-${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── ReportModal ───────────────────────────────────────────────────────────────
function ReportModal({ entries, orgData, onClose }) {
  const org = orgData || {};
  const [showBreakdown, setShowBreakdown] = useState(false);
  const totalCapital  = entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
  const totalExpenses = entries.reduce((s,e)=>s+e.debit,0);
  const totalFees     = entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
  const finalBalance  = entries.length>0?entries[entries.length-1].balance:0;
  const genDate       = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  const dateGroups    = buildReportDateGroups(entries);

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',
      zIndex:1000,display:'flex',alignItems:'flex-start',justifyContent:'center',
      padding:'16px',overflowY:'auto',
    }} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{
        background:'#fff',borderRadius:14,width:'100%',maxWidth:900,
        boxShadow:'0 8px 40px rgba(0,0,0,0.22)',overflow:'hidden',
      }}>
        <div className="no-print" style={{
          display:'flex',justifyContent:'space-between',alignItems:'center',
          padding:'14px 20px',background:'#0f172a',flexWrap:'wrap',gap:8,
        }}>
          <div style={{color:'#fff',fontWeight:700,fontSize:14}}>📋 Ledger Report</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',
              color:'#e2e8f0',fontSize:12,userSelect:'none'}}>
              <div
                onClick={()=>setShowBreakdown(v=>!v)}
                style={{width:34,height:18,borderRadius:99,
                  background:showBreakdown?'#22c55e':'#475569',
                  position:'relative',transition:'background 0.2s',cursor:'pointer',flexShrink:0}}>
                <div style={{position:'absolute',top:2,left:showBreakdown?16:2,
                  width:14,height:14,borderRadius:'50%',background:'#fff',
                  transition:'left 0.2s'}}/>
              </div>
              Show Breakdown
            </label>
            <button onClick={()=>downloadCSV(entries,orgData)}
              style={{padding:'7px 15px',borderRadius:8,background:'#15803d',color:'#fff',
                border:'none',cursor:'pointer',fontWeight:700,fontSize:12}}>
              ⬇ CSV
            </button>
            <button onClick={()=>window.print()}
              style={{padding:'7px 15px',borderRadius:8,background:'#2563eb',color:'#fff',
                border:'none',cursor:'pointer',fontWeight:700,fontSize:12}}>
              🖨 Print / PDF
            </button>
            <button onClick={onClose}
              style={{padding:'7px 13px',borderRadius:8,background:'#334155',color:'#fff',
                border:'none',cursor:'pointer',fontWeight:700,fontSize:12}}>
              ✕
            </button>
          </div>
        </div>

        <div id="ledger-print-root" style={{padding:'28px 32px'}}>
          <div style={{borderBottom:'2.5px solid #000',paddingBottom:14,marginBottom:18,
            display:'flex',alignItems:'flex-start',gap:16}}>
            {org.logoURL && (
              <img src={org.logoURL} alt="Logo"
                style={{width:75,height:75,objectFit:'contain',
                  mixBlendMode:'multiply',filter:'contrast(1.1)'}}/>
            )}
            <div style={{flex:1}}>
              <div style={{fontSize:20,fontWeight:900,color:'#000',
                fontFamily:"'SolaimanLipi','Arial',sans-serif",lineHeight:1.2}}>
                {org.name_bn||org.name||'Organisation'}<br/>
                <div style={{fontSize:12,color:'#64748b'}}>{org.name_en||org.name||''}</div>
              </div>
              {org.slogan && (
                <div style={{fontSize:12,color:'#444',fontStyle:'italic',marginTop:3,marginBottom:4}}>
                  {org.slogan}
                </div>
              )}
              <div style={{marginTop:5,fontSize:10.5,color:'#333',
                display:'flex',flexWrap:'wrap',gap:'3px 14px'}}>
                {org.email   && <span>✉ {org.email}</span>}
                {org.phone   && <span>☎ {org.phone}</span>}
                {org.website && <span>🌐 {org.website}</span>}
              </div>
            </div>
            <div style={{textAlign:'right',fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>
              <div style={{fontWeight:600,color:'#0f172a'}}>Account Book</div>
              <div>Generated: {genDate}</div>
            </div>
          </div>

          <div style={{display:'flex',gap:24,marginBottom:20,flexWrap:'wrap'}}>
            {[
              ['Total Capital',  fmt(totalCapital),  '#15803d'],
              ['Total Expenses', fmt(totalExpenses),  '#dc2626'],
              ['Total Fees',     fmt(totalFees),      '#0d9488'],
              ['Net Balance',    fmt(finalBalance),   finalBalance>=0?'#1d4ed8':'#dc2626'],
            ].map(([label,value,color])=>(
              <div key={label}>
                <div style={{fontSize:10,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
                <div style={{fontWeight:800,fontSize:16,color}}>{value}</div>
              </div>
            ))}
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{background:'#0f172a'}}>
                {['Date','Type / Member','Capital (+)','Expenses (−)','Fees (+)','Balance'].map(h=>(
                  <th key={h} style={{padding:'7px 10px',color:'#94a3b8',fontWeight:700,
                    textAlign:['Capital (+)','Expenses (−)','Fees (+)','Balance'].includes(h)?'right':'left',
                    fontSize:10,textTransform:'uppercase'}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dateGroups.map((g, gi) => {
                const gCap = g.entries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0);
                const gExp = g.entries.filter(e=>e.debit>0).reduce((s,e)=>s+e.debit,0);
                const gFee = g.entries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0);
                const gBal = g.entries[g.entries.length-1]?.balance ?? 0;
                return (
                  <>
                    <tr key={`g-${gi}`} style={{background:'#f1f5f9',borderTop:'2px solid #e2e8f0'}}>
                      <td style={{padding:'6px 10px',fontWeight:700,color:'#0f172a',whiteSpace:'nowrap'}}>{g.date}</td>
                      <td style={{padding:'6px 10px',color:'#64748b',fontStyle:'italic',fontSize:10}}>
                        {g.entries.length} transaction{g.entries.length!==1?'s':''}
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:gCap>0?'#1e40af':'#94a3b8'}}>
                        {gCap>0?`+${fmt(gCap)}`:'—'}
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:gExp>0?'#dc2626':'#94a3b8'}}>
                        {gExp>0?`−${fmt(gExp)}`:'—'}
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:gFee>0?'#0d9488':'#94a3b8'}}>
                        {gFee>0?`+${fmt(gFee)}`:'—'}
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right',fontWeight:800,color:gBal>=0?'#0f172a':'#dc2626'}}>
                        {fmt(gBal)}
                      </td>
                    </tr>
                    {showBreakdown && g.entries.map((e, ei) => {
                      const cap = e.type==='installment'?e.credit:0;
                      const exp = e.debit>0?e.debit:0;
                      const fee = (e.type==='entry_fee'||e.type==='loan_repayment')?e.credit:0;
                      const name = e.meta?.memberName || e.sub || '';
                      return (
                        <tr key={e.id} style={{background:ei%2===0?'#fff':'#fafafa',borderTop:'1px solid #f1f5f9'}}>
                          <td style={{padding:'5px 10px 5px 18px',color:'#94a3b8',whiteSpace:'nowrap'}}>{e.date}</td>
                          <td style={{padding:'5px 10px 5px 18px'}}>
                            <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
                              <TypeTag type={e.type}/>
                              <span style={{color:'#334155'}}>{name}</span>
                            </span>
                          </td>
                          <td style={{padding:'5px 10px',textAlign:'right',color:cap>0?'#1e40af':'#cbd5e1',fontWeight:600}}>
                            {cap>0?`+${fmt(cap)}`:'—'}
                          </td>
                          <td style={{padding:'5px 10px',textAlign:'right',color:exp>0?'#dc2626':'#cbd5e1',fontWeight:600}}>
                            {exp>0?`−${fmt(exp)}`:'—'}
                          </td>
                          <td style={{padding:'5px 10px',textAlign:'right',color:fee>0?'#0d9488':'#cbd5e1',fontWeight:600}}>
                            {fee>0?`+${fmt(fee)}`:'—'}
                          </td>
                          <td style={{padding:'5px 10px',textAlign:'right',fontWeight:700,
                            color:e.balance>=0?'#0f172a':'#dc2626'}}>
                            {fmt(e.balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                );
              })}
              <tr style={{background:'#0f172a',borderTop:'2px solid #334155'}}>
                <td colSpan={2} style={{padding:'8px 10px',color:'#e2e8f0',fontWeight:700,fontSize:11}}>CLOSING TOTALS</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'#93c5fd'}}>
                  {totalCapital>0?`+${fmt(totalCapital)}`:'—'}
                </td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'#fca5a5'}}>
                  {totalExpenses>0?`−${fmt(totalExpenses)}`:'—'}
                </td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:'#5eead4'}}>
                  {totalFees>0?`+${fmt(totalFees)}`:'—'}
                </td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:800,fontSize:13,color:'#fff'}}>
                  {fmt(finalBalance)}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{marginTop:24,fontSize:10,color:'#94a3b8',textAlign:'center',
            borderTop:'1px solid #e2e8f0',paddingTop:12}}>
            This report was generated on {genDate} · {org.name_en||org.name||''}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #ledger-print-root,
          #ledger-print-root * { visibility: visible !important; }
          #ledger-print-root {
            position: fixed !important; top: 0 !important; left: 0 !important;
            width: 100% !important; padding: 14mm 14mm 20mm 14mm !important;
            box-sizing: border-box !important;
          }
          @page { size: A4 portrait; margin: 0; }
          table { page-break-inside: auto; width: 100%; }
          tr    { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
      `}</style>
    </div>
  );
}

// ── MemberPaymentHistory — with Installment Month column ─────────────────────
function MemberPaymentHistory({ member }) {
  const r = member;
  const allRows = [];

  // Installment payments
  (r.payments || [])
    .filter(p => !p.paymentType || p.paymentType === 'monthly')
    .forEach(p => {
      const net = (p.amount || 0) - (p.gatewayFee || 0);
      // Format each entry in paidMonths array → "Apr 2026"
      const months = (p.paidMonths || []).map(fmtPaidMonth).join(', ');
      allRows.push({
        _sortKey: tsSort(p.createdAt),
        date: tsDate(p.createdAt),
        type: 'installment',
        installmentMonth: months,
        label: '',
        amount: p.amount || 0,
        gatewayFee: p.gatewayFee || 0,
        net,
        isCapital: true,
        method: p.method || '—',
        status: p.status,
      });
    });

  // Entry fees from entryFees collection
  (r.entryFees || []).forEach(f => {
    allRows.push({
      _sortKey: tsSort(f.paidAt || f.createdAt),
      date: f.paidAt ? normDate(f.paidAt) : normDate(f.createdAt),
      type: 'entry_fee',
      installmentMonth: '',
      label: '',
      amount: f.amount || 0,
      gatewayFee: 0,
      net: f.amount || 0,
      isCapital: false,
      method: f.method || '—',
      status: 'verified',
    });
  });

  // Fee payments from investments collection
  (r.feePays || [])
    .filter(p => p.status !== 'rejected')
    .forEach(p => {
      const net = (p.amount || 0) - (p.gatewayFee || 0);
      allRows.push({
        _sortKey: tsSort(p.createdAt),
        date: normDate(p.createdAt),
        type: p.paymentType || 'entry_fee',
        installmentMonth: '',
        label: p.paymentType === 'reregistration_fee' ? 'Re-Registration Fee' : 'Entry Fee',
        amount: p.amount || 0,
        gatewayFee: p.gatewayFee || 0,
        net,
        isCapital: false,
        method: p.method || '—',
        status: p.status,
      });
    });

  allRows.sort((a, b) => b._sortKey - a._sortKey);

  if (allRows.length === 0) {
    return <div style={{fontSize:12,color:'#94a3b8',padding:'8px 0'}}>No payment history.</div>;
  }

  const statusColor = s => s==='verified'?'#15803d':s==='pending'?'#92400e':'#dc2626';
  const statusBg    = s => s==='verified'?'#dcfce7':s==='pending'?'#fef3c7':'#fee2e2';

  return (
    <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
      <table style={{width:'100%',minWidth:560,borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:'#dbeafe'}}>
            {['Date','Type','Inst. Month','Amount','Fee','Net','Method','Status'].map(h => (
              <th key={h} style={{
                padding:'6px 10px',
                textAlign:['Amount','Fee','Net'].includes(h)?'right':'left',
                fontWeight:700, color:'#1e40af', whiteSpace:'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allRows.map((row, i) => (
            <tr key={i} style={{background:i%2===0?'#fff':'#f0f9ff',borderTop:'1px solid #e2e8f0'}}>
              <td style={{padding:'6px 10px',color:'#64748b',whiteSpace:'nowrap'}}>{row.date}</td>
              <td style={{padding:'6px 10px'}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
                  <TypeTag type={row.type}/>
                  <span style={{color:'#334155',fontSize:11}}>{row.label}</span>
                </span>
              </td>
              {/* ── NEW: Installment Month column ── */}
              <td style={{padding:'6px 10px',color:'#475569',fontSize:11,whiteSpace:'nowrap'}}>
                {row.installmentMonth || <span style={{color:'#cbd5e1'}}>—</span>}
              </td>
              <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(row.amount)}</td>
              <td style={{padding:'6px 10px',textAlign:'right',color:row.gatewayFee>0?'#dc2626':'#94a3b8'}}>
                {row.gatewayFee>0?`−${fmt(row.gatewayFee)}`:'—'}
              </td>
              <td style={{
                padding:'6px 10px',textAlign:'right',fontWeight:700,
                color:row.isCapital?'#15803d':'#0d9488',
              }}>
                {fmt(row.net)}
                {!row.isCapital && (
                  <span style={{display:'block',fontSize:9,fontWeight:400,
                    color:'#94a3b8',fontStyle:'italic'}}>not capital</span>
                )}
              </td>
              <td style={{padding:'6px 10px',color:'#64748b'}}>{row.method}</td>
              <td style={{padding:'6px 10px'}}>
                <span style={{fontSize:11,fontWeight:700,
                  color:statusColor(row.status),background:statusBg(row.status),
                  padding:'2px 8px',borderRadius:99}}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{background:'#f1f5f9',borderTop:'2px solid #e2e8f0'}}>
            <td colSpan={5} style={{padding:'7px 10px',fontWeight:700,color:'#0f172a',fontSize:12}}>
              Capital Net (verified)
            </td>
            <td style={{padding:'7px 10px',textAlign:'right',fontWeight:800,color:'#15803d',fontSize:13}}>
              {fmt(allRows.filter(x=>x.isCapital&&x.status==='verified').reduce((s,x)=>s+x.net,0))}
            </td>
            <td colSpan={2}/>
          </tr>
          {allRows.some(x=>!x.isCapital) && (
            <tr style={{background:'#f0fdfa',borderTop:'1px solid #e2e8f0'}}>
              <td colSpan={5} style={{padding:'7px 10px',fontWeight:700,color:'#0d9488',fontSize:12}}>
                Fee Income (not capital)
              </td>
              <td style={{padding:'7px 10px',textAlign:'right',fontWeight:800,color:'#0d9488',fontSize:13}}>
                {fmt(allRows.filter(x=>!x.isCapital).reduce((s,x)=>s+x.net,0))}
              </td>
              <td colSpan={2}/>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
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
  const [memSort,    setMemSort]    = useState('idNo');
  const [selMember,  setSelMember]  = useState(null);
  const [exporting,  setExporting]  = useState(false); // ← NEW
  const [isMobile,   setIsMobile]   = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!orgId || !isOrgAdmin) return;
    (async () => {
      const [paySnap,expSnap,feeSnap,loanSnap,projSnap,distSnap,memSnap] = await Promise.all([
        getDocs(query(collection(db,'organizations',orgId,'investments'),orderBy('createdAt','asc'))),
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
        const capital  = verified.reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
        const pending  = myPay.filter(p=>p.status==='pending').reduce((s,p)=>s+(p.amount||0),0);
        const myEntryFees = rawFees.filter(f=>f.userId===m.id);
        const myFeePays   = myPay.filter(p=>p.paymentType==='entry_fee'||p.paymentType==='reregistration_fee');
        return {...m, capital, pending, verifiedCount:verified.length,
          paymentCount:myPay.length, payments:myPay,
          entryFees:myEntryFees, feePays:myFeePays};
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

  const monthly    = useMemo(()=>groupEntries(filteredEntries,ymKey,ymLabel),[filteredEntries]);
  const yearly     = useMemo(()=>groupEntries(filteredEntries,yKey,k=>`Year ${k}`),[filteredEntries]);
  const dateGroups = useMemo(()=>buildDateGroups(filteredEntries),[filteredEntries]);
  const displayRows = viewMode==='daily' ? filteredEntries : viewMode==='monthly' ? monthly : yearly;
  const isGrouped   = viewMode !== 'daily';

  const totalCredit    = filteredEntries.reduce((s,e)=>s+e.credit,0);
  const totalDebit     = filteredEntries.reduce((s,e)=>s+e.debit,0);
  const ledgerBalance  = filteredEntries.length>0 ? filteredEntries[filteredEntries.length-1].balance : 0;
  const instCount      = filteredEntries.filter(e=>e.type==='installment').length;
  const totalCapital   = memberRows.reduce((s,r)=>s+r.capital,0);
  const totalPending   = memberRows.reduce((s,r)=>s+r.pending,0);
  const totalExpenses  = expenses.reduce((s,e)=>s+(e.amount||0),0);
  const totalLoansOut  = loans.filter(l=>l.status==='disbursed'||l.status==='repaid').reduce((s,l)=>s+(l.amount||0),0);
  const activeLoans    = loans.filter(l=>l.status==='disbursed').length;
  const activeProjects = projects.filter(p=>p.status==='active').length;
  const totalInvested  = projects.reduce((s,p)=>s+(p.investedAmount||0),0);
  const distCount      = dists.filter(d=>d.status==='distributed').length;
  const totalFees      = fees.reduce((s,f)=>s+(f.amount||0),0);
  const totalEntryFeeInv = payments
    .filter(p=>p.status==='verified'&&p.paymentType==='entry_fee'&&p.isContribution===false)
    .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
  const totalReregFeeInv = payments
    .filter(p=>p.status==='verified'&&p.paymentType==='reregistration_fee')
    .reduce((s,p)=>s+(p.amount||0)-(p.gatewayFee||0),0);
  const totalFeeIncome = totalFees + totalEntryFeeInv + totalReregFeeInv;

  const fb = settings.fundBudgets || {};
  let investInv = 0, investRes = 0;
  projects.forEach(p => {
    if (p.fundSources) {
      investInv += Number(p.fundSources.investment)||0;
      investRes += Number(p.fundSources.reserve)||0;
    } else {
      const a = p.investedAmount||0;
      if (p.fundSource==='reserve') investRes+=a; else investInv+=a;
    }
  });
  const usedBenevolent = loans
    .filter(l=>l.status==='disbursed'||l.status==='repaid')
    .reduce((s,l)=>s+(l.amount||0),0);

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
      desc:'Operational running costs',
      alloc: computeFundAlloc('expenses',totalCapital,settings) + totalFeeIncome,
      used: totalExpenses,
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
      memSort==='idNo'     ? (a.idNo||'').localeCompare(b.idNo||'',undefined,{numeric:true}) :
      memSort==='capital'  ? b.capital-a.capital :
      memSort==='payments' ? b.verifiedCount-a.verifiedCount :
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

  const RecentTransactionsList = ({ entries }) => (
    <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid #e2e8f0',
        display:'flex',justifyContent:'space-between',alignItems:'center',background:'#fff'}}>
        <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Recent Transactions</div>
        <button onClick={()=>setTab('ledger')}
          style={{fontSize:12,color:'#2563eb',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
          Full ledger →
        </button>
      </div>
      <LedgerLegend/>
      <div style={{
        display:'grid',
        gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
        padding:'7px 10px',background:'#0f172a',gap:'4px 8px',
      }}>
        {['Date / Type','Capital (+)','Expenses (−)','Fees (+)','Balance'].map((h,hi)=>(
          <div key={h} style={{fontSize:10,fontWeight:700,color:'#94a3b8',
            textTransform:'uppercase',letterSpacing:'0.05em',textAlign:hi===0?'left':'right'}}>
            {h}
          </div>
        ))}
      </div>
      {buildDateGroups([...entries].reverse().slice(0,20)).map(grp => (
        <DateGroupRow key={grp.dateLabel} dateLabel={grp.dateLabel} entries={grp.entries} isMobile={isMobile}/>
      ))}
    </div>
  );

  // ── Export handler ────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      await exportMembersExcel(memberRows, orgData);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

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
          {/* ── NEW: Export Excel button on members tab ── */}
          {tab==='members' && (
            <button
              onClick={handleExportExcel}
              disabled={exporting || memberRows.length === 0}
              style={{padding:'10px 18px',borderRadius:8,
                background:exporting?'#94a3b8':'#15803d',color:'#fff',
                border:'none',cursor:exporting?'not-allowed':'pointer',
                fontSize:13,fontWeight:700,flexShrink:0,
                opacity: memberRows.length===0 ? 0.5 : 1}}>
              {exporting ? '⏳ Exporting…' : '⬇ Export Excel'}
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
                <SB label="Entry Fees"      value={fmt(totalFees)}     color="#0d9488" bg="#f0fdfa"/>
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
                      style={{fontSize:12,color:'#2563eb',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
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
                      style={{fontSize:12,color:'#2563eb',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
                      See all →
                    </button>
                  </div>
                  {[...memberRows].sort((a,b)=>b.capital-a.capital).slice(0,5).map((r,i) => {
                    const cp = totalCapital>0?((r.capital/totalCapital)*100).toFixed(1):'0';
                    return (
                      <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,
                        padding:'10px 16px',borderBottom:'1px solid #f1f5f9',
                        background:i%2===0?'#fff':'#fafafa'}}>
                        <div style={{width:32,height:32,borderRadius:'50%',background:'#dbeafe',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0,overflow:'hidden'}}>
                          {r.photoURL
                            ? <img src={r.photoURL} style={{width:32,height:32,objectFit:'cover',borderRadius:'50%',display:'block'}} alt=""/>
                            : initials(r.nameEnglish||r.name)}
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

              {allEntries.length > 0 && <RecentTransactionsList entries={allEntries}/>}
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
                    <button key={k} onClick={()=>setViewMode(k)}
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
                  <button key={key} onClick={()=>setTypeFilter(key)}
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
                <div>
                  <LedgerLegend/>
                  <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                    <div style={{
                      display:'grid',
                      gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
                      padding:'7px 10px',background:'#0f172a',gap:'4px 8px',
                    }}>
                      {['Date / Type','Capital (+)','Expenses (−)','Fees (+)','Balance'].map((h,hi)=>(
                        <div key={h} style={{fontSize:10,fontWeight:700,color:'#94a3b8',
                          textTransform:'uppercase',letterSpacing:'0.05em',textAlign:hi===0?'left':'right'}}>
                          {h}
                        </div>
                      ))}
                    </div>
                    <div style={{
                      display:'grid',
                      gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
                      padding:'6px 10px',background:'#fafafa',borderBottom:'2px solid #e2e8f0',gap:'4px 8px',
                    }}>
                      <div style={{fontSize:11,color:'#64748b',fontStyle:'italic'}}>Opening Balance</div>
                      <div/><div/><div/>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:11,color:'#64748b'}}>{fmt(0)}</div>
                    </div>
                    {isGrouped
                      ? displayRows.map(row => (
                          <LedgerRow key={row.key} row={row} isGrouped={true} isMobile={isMobile}/>
                        ))
                      : dateGroups.map(grp => (
                          <DateGroupRow key={grp.dateLabel} dateLabel={grp.dateLabel} entries={grp.entries} isMobile={isMobile}/>
                        ))
                    }
                    <div style={{
                      display:'grid',
                      gridTemplateColumns:'1fr minmax(60px,auto) minmax(60px,auto) minmax(60px,auto) minmax(64px,auto)',
                      padding:'8px 10px',background:'#0f172a',gap:'4px 8px',
                    }}>
                      <div style={{fontSize:11,color:'#e2e8f0',fontWeight:700}}>Closing Balance</div>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:11,color:'#93c5fd'}}>
                        {filteredEntries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0)>0
                          ? `+${fmt(filteredEntries.filter(e=>e.type==='installment').reduce((s,e)=>s+e.credit,0))}`
                          : '—'}
                      </div>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:11,color:'#fca5a5'}}>
                        {filteredEntries.reduce((s,e)=>s+e.debit,0)>0
                          ? `−${fmt(filteredEntries.reduce((s,e)=>s+e.debit,0))}`
                          : '—'}
                      </div>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:11,color:'#5eead4'}}>
                        {filteredEntries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0)>0
                          ? `+${fmt(filteredEntries.filter(e=>e.type==='entry_fee'||e.type==='loan_repayment').reduce((s,e)=>s+e.credit,0))}`
                          : '—'}
                      </div>
                      <div style={{textAlign:'right',fontWeight:800,fontSize:13,color:'#fff'}}>
                        {fmt(ledgerBalance)}
                      </div>
                    </div>
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
                  <option value="idNo">Sort: Member ID</option>
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
                  const cp  = totalCapital>0?((r.capital/totalCapital)*100).toFixed(1):'0';
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
                          <div style={{width:34,height:34,borderRadius:'50%',background:'#dbeafe',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:12,fontWeight:700,color:'#1d4ed8',flexShrink:0,overflow:'hidden'}}>
                            {r.photoURL
                              ? <img src={r.photoURL} style={{width:34,height:34,objectFit:'cover',borderRadius:'50%',display:'block'}} alt=""/>
                              : initials(r.nameEnglish||r.name)}
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
                        <div style={{padding:'12px 16px',background:'#f0f9ff'}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:10}}>
                            Payment History
                          </div>
                          <MemberPaymentHistory member={r}/>
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
                {FUNDS.map(({key:fKey,...fProps}) => <FundCard key={fKey} {...fProps}/>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}