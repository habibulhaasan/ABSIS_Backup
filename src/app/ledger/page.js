// src/app/ledger/page.js — Unified member ledger (Phase 2A)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot,
  orderBy, getDocs,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

// ── Month range builder ──────────────────────────────────────────────────────
function getMonths(startDateStr) {
  if (!startDateStr) return [];
  const months = [];
  const start  = new Date(startDateStr);
  if (isNaN(start)) return [];
  const now  = new Date();
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= now) {
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    d.setMonth(d.getMonth()+1);
  }
  return months;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMonth(ym) {
  if (!ym) return '—';
  const [y,m] = ym.split('-');
  return `${MONTH_NAMES[+m-1]} ${y}`;
}

// ── Payment type display config ───────────────────────────────────────────────
const TYPE_CFG = {
  monthly:            { label:'Monthly Installment', color:'#15803d', bg:'#dcfce7',  icon:'📅', isContrib:true  },
  general:            { label:'Special Subscription', color:'#1d4ed8', bg:'#dbeafe', icon:'🎯', isContrib:true  },
  entry_fee:          { label:'Entry Fee',            color:'#0369a1', bg:'#e0f2fe',  icon:'🎫', isContrib:false },
  reregistration_fee: { label:'Re-Registration Fee',  color:'#7c3aed', bg:'#ede9fe',  icon:'🔄', isContrib:false },
  profit:             { label:'Profit Distribution',  color:'#059669', bg:'#d1fae5',  icon:'📊', isContrib:false },
  loan_disbursed:     { label:'Loan Disbursed',       color:'#dc2626', bg:'#fee2e2',  icon:'🤝', isContrib:false },
  loan_repayment:     { label:'Loan Repayment',       color:'#92400e', bg:'#fef3c7',  icon:'↩',  isContrib:false },
};

function TypeBadge({ type, countAsContribution }) {
  const cfg = TYPE_CFG[type] || { label: type || 'Payment', color:'#475569', bg:'#f1f5f9', icon:'💳' };
  // Entry fee can sometimes count as contribution
  const isContrib = type === 'entry_fee' ? !!countAsContribution : cfg.isContrib;
  return (
    <div style={{ display:'inline-flex', flexDirection:'column', gap:2 }}>
      <span style={{
        display:'inline-flex', alignItems:'center', gap:4,
        padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:700,
        background:cfg.bg, color:cfg.color, whiteSpace:'nowrap',
      }}>
        {cfg.icon} {cfg.label}
      </span>
      {(type === 'entry_fee' || type === 'reregistration_fee') && (
        <span style={{
          fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:99,
          background: isContrib ? '#dcfce7' : '#fef3c7',
          color:      isContrib ? '#15803d' : '#92400e',
          whiteSpace:'nowrap',
        }}>
          {isContrib ? '↗ Contribution' : '→ Expenses Fund'}
        </span>
      )}
    </div>
  );
}

// ── Summary stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color='#0f172a', bg='#f8fafc', border='#e2e8f0' }) {
  return (
    <div style={{ background:bg, borderRadius:10, padding:'14px 16px', border:`1px solid ${border}` }}>
      <div style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase',
        letterSpacing:'0.07em', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:19, fontWeight:800, color }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Ledger() {
const { user, userData, orgData, membership, isSuperAdmin, impersonateMemberId } = useAuth();  // Support superadmin impersonation: show ledger for the target member
  const viewUid = (isSuperAdmin && impersonateMemberId) ? impersonateMemberId : user?.uid;
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};
  const orgF     = orgData?.orgFeatures || {};

  // All data
  const [investments,    setInvestments]    = useState([]);
  const [entryFees,      setEntryFees]      = useState([]);
  const [distributions,  setDistributions]  = useState([]);
  const [loans,          setLoans]          = useState([]);
  const [loading,        setLoading]        = useState(true);

  // UI state
  const [typeFilter,   setTypeFilter]   = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search,       setSearch]       = useState('');

  // ── Load all collections ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !orgId) return;
    let done = 0;
    const finish = () => { done++; if (done >= 4) setLoading(false); };

    // 1. Investments (monthly + special subs)
    const q1 = query(
      collection(db,'organizations',orgId,'investments'),
      where('userId','==',viewUid),
      orderBy('createdAt','desc')
    );
    const u1 = onSnapshot(q1, snap => {
      setInvestments(snap.docs.map(d=>({id:d.id,...d.data()})));
      finish();
    });

    // 2. Entry fees
    getDocs(query(
      collection(db,'organizations',orgId,'entryFees'),
      where('userId','==',viewUid)
    )).then(snap => {
      setEntryFees(snap.docs.map(d=>({id:d.id,...d.data()})));
      finish();
    }).catch(()=>finish());

    // 3. Profit distributions
    getDocs(
      collection(db,'organizations',orgId,'profitDistributions')
    ).then(snap => {
      setDistributions(
        snap.docs.map(d=>({id:d.id,...d.data()}))
          .filter(d=>d.status==='distributed')
      );
      finish();
    }).catch(()=>finish());

    // 4. Loans
    getDocs(query(
      collection(db,'organizations',orgId,'loans'),
      where('userId','==',viewUid)
    )).then(snap => {
      setLoans(snap.docs.map(d=>({id:d.id,...d.data()})));
      finish();
    }).catch(()=>finish());

    return () => { u1(); };
  }, [user, orgId]);

  // ── Build unified ledger rows ─────────────────────────────────────────────
  const rows = [];

  // From investments collection
  investments.forEach(r => {
    const type = r.paymentType ||
      (r.paidMonths?.length > 0 ? 'monthly' : r.specialSubType || r.paymentType || 'general');
    const isContrib = r.isContribution !== false;
    rows.push({
      id:        r.id,
      source:    'investment',
      date:      r.createdAt,
      type,
      label:     r.paidMonths?.length > 0
                   ? r.paidMonths.join(', ')
                   : r.specialSubTitle || '—',
      method:    r.method || '—',
      txId:      r.txId || '',
      amount:    r.amount || 0,
      baseAmount:r.isContribution !== false
                   ? (r.baseAmount || (r.amount||0) - (r.penaltyPaid||0) - (r.gatewayFee||0))
                   : 0,
      penalty:   r.penaltyPaid || 0,
      gatewayFee:r.gatewayFee || 0,
      status:    r.status || 'pending',
      isContrib,
      countAsContribution: r.countAsContribution,
      raw:       r,
    });
  });

  // From entryFees collection
  entryFees.forEach(r => {
    rows.push({
      id:        'ef_'+r.id,
      source:    'entryFee',
      date:      r.createdAt || r.paidAt,
      type:      'entry_fee',
      label:     r.notes ? `Entry Fee — ${r.notes}` : 'Entry Fee',
      method:    r.method || '—',
      txId:      '',
      amount:    r.amount || 0,
      baseAmount:0,   // not a capital contribution
      penalty:   0,
      gatewayFee:0,
      status:    'verified',  // entry fees are recorded when paid
      isContrib: false,
      raw:       r,
    });
  });

  // From profit distributions
  distributions.forEach(d => {
    const myShare = (d.memberShares||[]).find(s => s.userId === viewUid);
    if (!myShare) return;
    rows.push({
      id:        'dist_'+d.id,
      source:    'distribution',
      date:      d.createdAt,
      type:      'profit',
      label:     d.periodLabel || d.year || '—',
      method:    '—',
      txId:      '',
      amount:    myShare.shareAmount || 0,
      baseAmount:myShare.shareAmount || 0,
      penalty:   0,
      gatewayFee:0,
      status:    'verified',
      isContrib: false,
      raw:       d,
    });
  });

  // From loans
  loans.forEach(l => {
    if (l.status === 'disbursed' || l.status === 'repaid') {
      rows.push({
        id:        'loan_d_'+l.id,
        source:    'loan',
        date:      l.disbursedAt || l.createdAt,
        type:      'loan_disbursed',
        label:     l.purpose || 'Loan',
        method:    '—',
        txId:      '',
        amount:    l.amount || 0,
        baseAmount:0,
        penalty:   0,
        gatewayFee:0,
        status:    'verified',
        isContrib: false,
        raw:       l,
      });
    }
    // Repayment entries
    (l.repayments||[]).forEach((rep, i) => {
      rows.push({
        id:        `loan_r_${l.id}_${i}`,
        source:    'loan_repay',
        date:      rep.createdAt || rep.date,
        type:      'loan_repayment',
        label:     `Loan Repayment — ${l.purpose||'Loan'}`,
        method:    rep.method || '—',
        txId:      '',
        amount:    rep.amount || 0,
        baseAmount:0,
        penalty:   0,
        gatewayFee:0,
        status:    'verified',
        isContrib: false,
        raw:       rep,
      });
    });
  });

  // Sort newest first
  rows.sort((a,b) => {
    const ta = a.date?.seconds || (typeof a.date === 'string' ? new Date(a.date).getTime()/1000 : 0);
    const tb = b.date?.seconds || (typeof b.date === 'string' ? new Date(b.date).getTime()/1000 : 0);
    return tb - ta;
  });

  // ── Phase 7: Monthly schedule data ──────────────────────────────────────────
  const requireBackpayment = !!settings.requireBackpayment;
  const joiningDateStr     = membership?.joiningDate || '';

  // Effective start for this member
  const effectiveStartDate = (() => {
    const orgStart = settings.startDate || '';
    if (requireBackpayment || !joiningDateStr) return orgStart;
    if (!orgStart) return joiningDateStr;
    return joiningDateStr > orgStart ? joiningDateStr : orgStart;
  })();

  // All months from org start (for greying pre-join months)
  const allOrgMonths = getMonths(settings.startDate);
  // Months the member is responsible for
  const memberMonths = getMonths(effectiveStartDate);
  // Pre-join months (only when backpayment not required)
  const preJoinMonthSet = new Set(
    (!requireBackpayment && joiningDateStr && settings.startDate)
      ? allOrgMonths.filter(m => m < effectiveStartDate.slice(0,7))
      : []
  );

  // Map each month → payment record status
  const monthStatusMap = {};
  investments.forEach(r => {
    (r.paidMonths || []).forEach(mo => {
      if (!monthStatusMap[mo] || r.status === 'verified') {
        monthStatusMap[mo] = {
          status:    r.status,
          amount:    r.amount || 0,
          baseAmount:r.baseAmount || (r.amount||0)-(r.penaltyPaid||0)-(r.gatewayFee||0),
          penalty:   r.penaltyPaid || 0,
          method:    r.method || '—',
          date:      r.createdAt,
        };
      }
    });
  });

  // ── Compute summary stats ─────────────────────────────────────────────────
  const feeInAcct = !!settings.gatewayFeeInAccounting;

  // Capital = only verified contributions
  const myCapital = rows
    .filter(r => r.status === 'verified' && r.isContrib)
    .reduce((s,r) => s + (r.baseAmount || 0) - (feeInAcct ? 0 : r.gatewayFee), 0);

  const totalProfit = rows
    .filter(r => r.type === 'profit')
    .reduce((s,r) => s + r.amount, 0);

  const totalEntryFees = rows
    .filter(r => r.type === 'entry_fee' || r.type === 'reregistration_fee')
    .reduce((s,r) => s + r.amount, 0);

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  // ── Filter logic ──────────────────────────────────────────────────────────
  const TYPE_FILTERS = [
    { key:'all',               label:'All' },
    { key:'schedule',          label:'📅 Monthly Schedule' },
    { key:'monthly',           label:'Monthly' },
    { key:'special',           label:'Special Subs' },
    { key:'fees',              label:'Fees' },
    { key:'profit',            label:'Profit' },
    ...(orgF.qardHasana ? [{ key:'loans', label:'Loans' }] : []),
  ];

  const filtered = rows.filter(r => {
    // Type filter
    if (typeFilter === 'monthly' && r.type !== 'monthly') return false;
    if (typeFilter === 'special' && r.type !== 'general') return false;
    if (typeFilter === 'fees' && r.type !== 'entry_fee' && r.type !== 'reregistration_fee') return false;
    if (typeFilter === 'profit' && r.type !== 'profit') return false;
    if (typeFilter === 'loans' && r.type !== 'loan_disbursed' && r.type !== 'loan_repayment') return false;
    // Status filter
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    // Search
    if (search) {
      const q = search.toLowerCase();
      if (!r.label.toLowerCase().includes(q) &&
          !r.txId.toLowerCase().includes(q) &&
          !r.method.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Monthly Schedule view ───────────────────────────────────────────────────
  const MonthlySchedule = () => {
    const dueDay = settings.dueDate || 10;

    // Show all org months, but grey the pre-join ones
    const displayMonths = [...allOrgMonths].reverse(); // newest first

    const verifiedCount = memberMonths.filter(m => monthStatusMap[m]?.status === 'verified').length;
    const pendingCount  = memberMonths.filter(m => monthStatusMap[m]?.status === 'pending').length;
    const dueCount      = memberMonths.filter(m => !monthStatusMap[m]).length;
    const totalPaidAmt  = memberMonths
      .filter(m => monthStatusMap[m]?.status === 'verified')
      .reduce((s,m) => s + (monthStatusMap[m]?.baseAmount || 0), 0);

    return (
      <div>
        {/* Member since banner */}
        {joiningDateStr && (
          <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:14,
            background: requireBackpayment ? '#fffbeb' : '#f0fdf4',
            border: `1px solid ${requireBackpayment ? '#fde68a' : '#bbf7d0'}`,
            fontSize:12,
            color: requireBackpayment ? '#92400e' : '#15803d' }}>
            {requireBackpayment
              ? <>📅 <strong>Member since {joiningDateStr}</strong> — all months from org start required.</>
              : <>📅 <strong>Member since {joiningDateStr}</strong> — months before joining shown as N/A.
                  {preJoinMonthSet.size > 0 && (
                    <span style={{ color:'#64748b' }}> ({preJoinMonthSet.size} pre-join month{preJoinMonthSet.size!==1?'s':''} greyed out)</span>
                  )}
                </>
            }
          </div>
        )}

        {/* Summary mini-stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))',
          gap:8, marginBottom:16 }}>
          {[
            ['Paid',    verifiedCount, '#15803d', '#f0fdf4'],
            ['Pending', pendingCount,  '#d97706', '#fffbeb'],
            ['Due',     dueCount,      '#dc2626', '#fef2f2'],
            ['Capital', fmt(totalPaidAmt), '#1d4ed8', '#eff6ff'],
          ].map(([l,v,c,bg]) => (
            <div key={l} style={{ background:bg, borderRadius:8, padding:'10px 12px',
              border:'1px solid #e2e8f0' }}>
              <div style={{ fontSize:9, fontWeight:700, color:'#94a3b8',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Month rows */}
        <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:'100px 1fr 90px 90px 80px',
            gap:8, padding:'8px 14px', background:'#f8fafc',
            borderBottom:'1px solid #e2e8f0' }}>
            {['Month','Status','Amount','Capital','Date'].map((h,i) => (
              <div key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</div>
            ))}
          </div>

          {displayMonths.length === 0 && (
            <div style={{ textAlign:'center', padding:'32px', color:'#94a3b8', fontSize:13 }}>
              No months to display. Set an org Start Date in Settings.
            </div>
          )}

          {displayMonths.map((mo, i) => {
            const rec        = monthStatusMap[mo];
            const isPreJoin  = preJoinMonthSet.has(mo);
            const isLate     = !rec && (() => {
              const [y,m2] = mo.split('-').map(Number);
              return new Date() > new Date(y,m2-1,dueDay);
            })();

            let statusEl;
            if (isPreJoin) {
              statusEl = (
                <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:99,
                  background:'#f1f5f9', color:'#94a3b8' }}>N/A</span>
              );
            } else if (rec?.status === 'verified') {
              statusEl = (
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                  background:'#dcfce7', color:'#15803d' }}>✓ Verified</span>
              );
            } else if (rec?.status === 'pending') {
              statusEl = (
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                  background:'#fef3c7', color:'#d97706' }}>⏳ Pending</span>
              );
            } else if (rec?.status === 'rejected') {
              statusEl = (
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                  background:'#fee2e2', color:'#dc2626' }}>✕ Rejected</span>
              );
            } else {
              statusEl = (
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99,
                  background: isLate ? '#fee2e2' : '#f1f5f9',
                  color:      isLate ? '#dc2626' : '#64748b' }}>
                  {isLate ? '⚠ Overdue' : '○ Unpaid'}
                </span>
              );
            }

            return (
              <div key={mo} style={{
                display:'grid', gridTemplateColumns:'100px 1fr 90px 90px 80px',
                gap:8, padding:'9px 14px', alignItems:'center',
                borderBottom: i < displayMonths.length-1 ? '1px solid #f1f5f9' : 'none',
                background: isPreJoin ? '#fafafa'
                  : rec?.status === 'verified' ? '#f0fdf4'
                  : isLate ? '#fff8f8'
                  : '#fff',
                opacity: isPreJoin ? 0.55 : 1,
                borderLeft: `3px solid ${
                  isPreJoin        ? 'transparent'
                  : rec?.status === 'verified' ? '#86efac'
                  : rec?.status === 'pending'  ? '#fde68a'
                  : isLate         ? '#fca5a5'
                  : 'transparent'
                }`,
              }}>
                <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:600,
                  color: isPreJoin ? '#94a3b8' : '#0f172a' }}>
                  {fmtMonth(mo)}
                </div>
                <div>{statusEl}</div>
                <div style={{ fontSize:12, color: isPreJoin ? '#94a3b8' : '#0f172a',
                  fontWeight: rec ? 600 : 400 }}>
                  {isPreJoin ? '—' : rec ? fmt(rec.amount) : '—'}
                </div>
                <div style={{ fontSize:12, color:'#15803d', fontWeight:600 }}>
                  {isPreJoin || !rec || rec.status !== 'verified' ? '—' : fmt(rec.baseAmount)}
                </div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>
                  {isPreJoin || !rec ? '—' : tsDate(rec.date)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-wrap animate-fade">
      {/* Header */}
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">My Ledger</div>
          <div className="page-subtitle">
            {orgData?.name} · All financial records
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'60px', color:'#94a3b8' }}>Loading…</div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:20 }}>
            <StatCard
              label="My Capital"
              value={fmt(myCapital)}
              sub="verified contributions"
              color="#15803d" bg="#f0fdf4" border="#bbf7d0"
            />
            {pendingCount > 0 && (
              <StatCard
                label="Pending"
                value={pendingCount}
                sub="awaiting verification"
                color="#92400e" bg="#fef3c7" border="#fde68a"
              />
            )}
            {totalProfit > 0 && (
              <StatCard
                label="Total Profit"
                value={fmt(totalProfit)}
                sub="from distributions"
                color="#1d4ed8" bg="#eff6ff" border="#bfdbfe"
              />
            )}
            {totalEntryFees > 0 && (
              <StatCard
                label="Fees Paid"
                value={fmt(totalEntryFees)}
                sub="entry & re-reg (non-refundable)"
                color="#7c3aed" bg="#faf5ff" border="#ddd6fe"
              />
            )}
            <StatCard
              label="Total Records"
              value={rows.length}
              sub={`${rows.filter(r=>r.status==='verified').length} verified`}
            />
          </div>

          {/* ── Contribution note ── */}
          <div style={{ padding:'10px 14px', borderRadius:8, background:'#f8fafc',
            border:'1px solid #e2e8f0', fontSize:12, color:'#64748b', marginBottom:16,
            display:'flex', gap:16, flexWrap:'wrap' }}>
            <span>🟢 <strong>Green rows</strong> = counts as capital contribution</span>
            <span>⚪ <strong>Other rows</strong> = fee / distribution / loan (not capital)</span>
          </div>

          {/* ── Filters ── */}
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            {TYPE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)}
                className={typeFilter === f.key ? 'btn-primary' : 'btn-ghost'}
                style={{ padding:'7px 14px', fontSize:12 }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
            {['all','verified','pending','rejected'].map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                style={{
                  padding:'5px 12px', fontSize:11, borderRadius:7, cursor:'pointer', fontWeight:500,
                  border: statusFilter===f ? '2px solid #2563eb' : '1px solid #e2e8f0',
                  background: statusFilter===f ? '#eff6ff' : '#fff',
                  color: statusFilter===f ? '#1d4ed8' : '#475569',
                  textTransform:'capitalize',
                }}>
                {f}
              </button>
            ))}
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search…"
              style={{ flex:1, minWidth:140, padding:'5px 10px', borderRadius:7,
                border:'1px solid #e2e8f0', fontSize:12 }}/>
          </div>

          {/* ── Desktop table / Mobile cards ── */}
          <style>{`
            .ledger-table { display: none; }
            .ledger-cards { display: flex; flex-direction: column; gap: 10px; }
            @media (min-width: 768px) {
              .ledger-table { display: block; }
              .ledger-cards { display: none !important; }
            }
          `}</style>

          {/* Schedule view */}
          {typeFilter === 'schedule' && <MonthlySchedule />}

          {/* Transaction table/cards — hidden in schedule mode */}
          {typeFilter !== 'schedule' && (filtered.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
              <div style={{ fontWeight:600, color:'#0f172a' }}>No records found</div>
              <div style={{ fontSize:13, marginTop:4 }}>Try changing the filter.</div>
            </div>
          ) : (
            <>
              {/* ── Desktop table ── */}
              <div className="ledger-table">
                <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ display:'grid',
                    gridTemplateColumns:'100px 160px 1fr 100px 100px 100px 80px 90px',
                    gap:10, padding:'9px 16px', background:'#f8fafc',
                    borderBottom:'1px solid #e2e8f0' }}>
                    {['Date','Type','Description','Method','Amount','Capital','Fee','Status'].map((h,i) => (
                      <div key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b',
                        textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</div>
                    ))}
                  </div>

                  {/* Rows */}
                  {filtered.map((r, i) => (
                    <div key={r.id}
                      style={{
                        display:'grid',
                        gridTemplateColumns:'100px 160px 1fr 100px 100px 100px 80px 90px',
                        gap:10, padding:'10px 16px', alignItems:'center',
                        borderBottom:'1px solid #f1f5f9',
                        background: r.isContrib && r.status==='verified'
                          ? '#f0fdf4'
                          : i%2===0 ? '#fff' : '#fafafa',
                        borderLeft: r.isContrib && r.status==='verified'
                          ? '3px solid #86efac' : '3px solid transparent',
                      }}>
                      {/* Date */}
                      <div style={{ fontSize:11, color:'#64748b', whiteSpace:'nowrap' }}>
                        {tsDate(r.date)}
                      </div>
                      {/* Type badge */}
                      <div>
                        <TypeBadge type={r.type} countAsContribution={r.countAsContribution}/>
                      </div>
                      {/* Description */}
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:12, color:'#0f172a', fontWeight:500,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {r.label}
                        </div>
                        {r.txId && (
                          <div style={{ fontSize:10, color:'#94a3b8', fontFamily:'monospace',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            TxID: {r.txId}
                          </div>
                        )}
                      </div>
                      {/* Method */}
                      <div style={{ fontSize:11, color:'#64748b' }}>{r.method}</div>
                      {/* Total amount */}
                      <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>
                        {fmt(r.amount)}
                        {r.penalty > 0 && (
                          <div style={{ fontSize:10, color:'#d97706', fontWeight:600 }}>
                            +{fmt(r.penalty)} late fee
                          </div>
                        )}
                      </div>
                      {/* Capital credit */}
                      <div style={{ fontSize:13, fontWeight:600,
                        color: r.isContrib && r.status==='verified' ? '#15803d' : '#94a3b8' }}>
                        {r.isContrib && r.status==='verified' ? fmt(r.baseAmount) : '—'}
                      </div>
                      {/* Gateway fee */}
                      <div style={{ fontSize:11, color: r.gatewayFee > 0 ? '#d97706' : '#94a3b8' }}>
                        {r.gatewayFee > 0 ? fmt(r.gatewayFee) : '—'}
                      </div>
                      {/* Status */}
                      <div>
                        <span className={`badge ${
                          r.status==='verified' ? 'badge-green' :
                          r.status==='pending'  ? 'badge-yellow' : 'badge-red'
                        }`} style={{ textTransform:'capitalize', fontSize:10 }}>
                          {r.status}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Footer total */}
                  <div style={{ display:'grid',
                    gridTemplateColumns:'100px 160px 1fr 100px 100px 100px 80px 90px',
                    gap:10, padding:'10px 16px', background:'#f8fafc',
                    borderTop:'2px solid #e2e8f0' }}>
                    <div />
                    <div />
                    <div style={{ fontSize:12, fontWeight:700, color:'#64748b' }}>
                      {filtered.length} records shown
                    </div>
                    <div />
                    <div style={{ fontSize:13, fontWeight:800, color:'#0f172a' }}>
                      {fmt(filtered.reduce((s,r)=>s+r.amount,0))}
                    </div>
                    <div style={{ fontSize:13, fontWeight:800, color:'#15803d' }}>
                      {fmt(filtered.filter(r=>r.isContrib&&r.status==='verified').reduce((s,r)=>s+r.baseAmount,0))}
                    </div>
                    <div />
                    <div />
                  </div>
                </div>
              </div>

              {/* ── Mobile cards ── */}
              <div className="ledger-cards">
                {filtered.map(r => (
                  <div key={r.id} style={{
                    background: r.isContrib && r.status==='verified' ? '#f0fdf4' : '#fff',
                    borderRadius:12,
                    border:`1px solid ${r.isContrib && r.status==='verified' ? '#bbf7d0' : '#e2e8f0'}`,
                    borderLeft:`4px solid ${
                      r.isContrib && r.status==='verified' ? '#16a34a' :
                      r.status==='pending' ? '#f59e0b' :
                      r.status==='rejected' ? '#dc2626' : '#e2e8f0'
                    }`,
                    padding:'12px 14px',
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, marginBottom:6 }}>
                      <TypeBadge type={r.type} countAsContribution={r.countAsContribution}/>
                      <span className={`badge ${
                        r.status==='verified' ? 'badge-green' :
                        r.status==='pending'  ? 'badge-yellow' : 'badge-red'
                      }`} style={{ fontSize:10, textTransform:'capitalize', alignSelf:'flex-start' }}>
                        {r.status}
                      </span>
                    </div>
                    <div style={{ fontSize:13, fontWeight:600, color:'#0f172a', marginBottom:3 }}>
                      {r.label}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                      <div style={{ fontSize:11, color:'#64748b' }}>
                        {tsDate(r.date)} · {r.method}
                        {r.txId && <span style={{ fontFamily:'monospace', marginLeft:6 }}>{r.txId.slice(0,12)}…</span>}
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:16, fontWeight:800, color:'#0f172a' }}>{fmt(r.amount)}</div>
                        {r.isContrib && r.status==='verified' && r.baseAmount > 0 && (
                          <div style={{ fontSize:10, color:'#15803d', fontWeight:700 }}>
                            {fmt(r.baseAmount)} capital credit
                          </div>
                        )}
                        {r.penalty > 0 && (
                          <div style={{ fontSize:10, color:'#d97706' }}>+{fmt(r.penalty)} late fee</div>
                        )}
                        {r.gatewayFee > 0 && (
                          <div style={{ fontSize:10, color:'#94a3b8' }}>{fmt(r.gatewayFee)} fee</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ))}

          {/* ── Quick links ── */}
          <div style={{ marginTop:20, display:'flex', gap:10, flexWrap:'wrap' }}>
            <Link href="/installment" style={{ padding:'10px 18px', borderRadius:8,
              background:'#0f172a', color:'#fff', fontWeight:600, fontSize:13, textDecoration:'none' }}>
              + Pay Installment
            </Link>
            <Link href="/dashboard" style={{ padding:'10px 18px', borderRadius:8,
              border:'1px solid #e2e8f0', background:'#fff', color:'#475569',
              fontWeight:600, fontSize:13, textDecoration:'none' }}>
              Dashboard
            </Link>
          </div>
        </>
      )}
    </div>
  );
}