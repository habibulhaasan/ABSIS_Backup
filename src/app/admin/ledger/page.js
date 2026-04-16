// src/app/admin/ledger/page.js — Admin member ledger (Phase 2A)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, getDocs, doc, getDoc, query,
  where, orderBy,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n)     { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
const initials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

// ── Fund allocation with maxAmount cap ────────────────────────────────────────
function getFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value)||0;
  const pct    = Math.round(totalCapital * (Number(fb.value)||0) / 100);
  const maxCap = fb.maxAmount && Number(fb.maxAmount) > 0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(pct, maxCap);
}

// ── Type badge config ─────────────────────────────────────────────────────────
const TYPE_CFG = {
  monthly:            { label:'Monthly',    color:'#15803d', bg:'#dcfce7' },
  general:            { label:'Special Sub',color:'#1d4ed8', bg:'#dbeafe' },
  entry_fee:          { label:'Entry Fee',  color:'#0369a1', bg:'#e0f2fe' },
  reregistration_fee: { label:'Re-Reg Fee', color:'#7c3aed', bg:'#ede9fe' },
  profit:             { label:'Profit',     color:'#059669', bg:'#d1fae5' },
  loan_disbursed:     { label:'Loan Out',   color:'#dc2626', bg:'#fee2e2' },
  loan_repayment:     { label:'Loan In',    color:'#92400e', bg:'#fef3c7' },
};

function TypeBadge({ type }) {
  const c = TYPE_CFG[type] || { label:type||'Payment', color:'#475569', bg:'#f1f5f9' };
  return (
    <span style={{ padding:'2px 7px', borderRadius:99, fontSize:10, fontWeight:700,
      background:c.bg, color:c.color, whiteSpace:'nowrap' }}>
      {c.label}
    </span>
  );
}

function MemberAvatar({ m, size=36 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:'#dbeafe',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:700, fontSize:size*.34, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
      {m.photoURL
        ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
        : initials(m.nameEnglish)}
    </div>
  );
}

// ── Build unified ledger for a member ─────────────────────────────────────────
async function buildMemberLedger(orgId, memberId, settings) {
  const feeInAcct = !!settings?.gatewayFeeInAccounting;

  const [invSnap, feeSnap, distSnap, loanSnap] = await Promise.all([
    getDocs(query(
      collection(db,'organizations',orgId,'investments'),
      where('userId','==',memberId),
      orderBy('createdAt','desc')
    )),
    getDocs(query(
      collection(db,'organizations',orgId,'entryFees'),
      where('userId','==',memberId)
    )),
    getDocs(collection(db,'organizations',orgId,'profitDistributions')),
    getDocs(query(
      collection(db,'organizations',orgId,'loans'),
      where('userId','==',memberId)
    )),
  ]);

  const rows = [];

  // Investments
  invSnap.docs.forEach(d => {
    const r = {id:d.id,...d.data()};
    const type = r.paymentType ||
      (r.paidMonths?.length > 0 ? 'monthly' : r.specialSubType || 'general');
    const isContrib = r.isContribution !== false;
    rows.push({
      id:'inv_'+r.id, date:r.createdAt, type,
      label: r.paidMonths?.length > 0 ? r.paidMonths.join(', ') : r.specialSubTitle||'—',
      method:r.method||'—', txId:r.txId||'',
      amount:r.amount||0,
      capitalCredit: isContrib && r.status==='verified'
        ? (r.baseAmount || (r.amount||0)-(r.penaltyPaid||0)-(feeInAcct?0:(r.gatewayFee||0)))
        : 0,
      penalty:r.penaltyPaid||0, gatewayFee:r.gatewayFee||0,
      status:r.status||'pending', isContrib,
      countAsContribution:r.countAsContribution,
    });
  });

  // Entry fees
  feeSnap.docs.forEach(d => {
    const r = {id:d.id,...d.data()};
    rows.push({
      id:'ef_'+r.id, date:r.createdAt||r.paidAt, type:'entry_fee',
      label:'Entry Fee'+(r.notes?` — ${r.notes}`:''),
      method:r.method||'—', txId:'',
      amount:r.amount||0, capitalCredit:0,
      penalty:0, gatewayFee:0,
      status:'verified', isContrib:false,
    });
  });

  // Profit distributions
  distSnap.docs.forEach(d => {
    const dist = {id:d.id,...d.data()};
    if (dist.status !== 'distributed') return;
    const share = (dist.memberShares||[]).find(s => s.userId===memberId);
    if (!share) return;
    rows.push({
      id:'dist_'+dist.id, date:dist.createdAt, type:'profit',
      label:dist.periodLabel||dist.year||'Distribution',
      method:'—', txId:'',
      amount:share.shareAmount||0, capitalCredit:0,
      penalty:0, gatewayFee:0,
      status:'verified', isContrib:false,
    });
  });

  // Loans
  loanSnap.docs.forEach(d => {
    const l = {id:d.id,...d.data()};
    if (l.status==='disbursed'||l.status==='repaid') {
      rows.push({
        id:'loan_d_'+l.id, date:l.disbursedAt||l.createdAt, type:'loan_disbursed',
        label:`Loan — ${l.purpose||'Loan'}`,
        method:'—', txId:'', amount:l.amount||0, capitalCredit:0,
        penalty:0, gatewayFee:0, status:'verified', isContrib:false,
      });
    }
    (l.repayments||[]).forEach((rep,i) => {
      rows.push({
        id:`loan_r_${l.id}_${i}`, date:rep.createdAt||rep.date, type:'loan_repayment',
        label:`Repayment — ${l.purpose||'Loan'}`,
        method:rep.method||'—', txId:'', amount:rep.amount||0, capitalCredit:0,
        penalty:0, gatewayFee:0, status:'verified', isContrib:false,
      });
    });
  });

  // Sort newest first
  rows.sort((a,b) => {
    const ta = a.date?.seconds || 0;
    const tb = b.date?.seconds || 0;
    return tb - ta;
  });

  return rows;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminLedger() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};

  const [members,    setMembers]    = useState([]);
  const [selMember,  setSelMember]  = useState(null);
  const [ledger,     setLedger]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showFundBreakdown, setShowFundBreakdown] = useState(false);
  // Mobile navigation
  const [mobileView, setMobileView] = useState('list');

  // Org-wide data needed for fund breakdown
  const [orgTotalCapital, setOrgTotalCapital] = useState(0);
  const [orgExpenses,     setOrgExpenses]     = useState(0);
  const [orgInvestments,  setOrgInvestments]  = useState(0);
  const [orgReserveUsed,  setOrgReserveUsed]  = useState(0);
  const [orgBenevolent,   setOrgBenevolent]   = useState(0);

  useEffect(() => {
    if (!orgId) return;
    // Load members
    (async () => {
      const snap = await getDocs(collection(db,'organizations',orgId,'members'));
      const docs = snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const merged = await Promise.all(docs.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists()?{...m,...u.data(),id:m.id}:m; }
        catch { return m; }
      }));
      merged.sort((a,b)=>(a.nameEnglish||'').localeCompare(b.nameEnglish||''));
      setMembers(merged);
    })();

    // Load org-wide data for fund breakdown
    (async () => {
      const feeInAcct = !!settings.gatewayFeeInAccounting;
      const [paySnap, expSnap, projSnap, loanSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'loans')),
      ]);
      const tc = paySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified' && p.isContribution!==false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
      setOrgTotalCapital(tc);
      setOrgExpenses(expSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0));
      const projs = projSnap.docs.map(d=>d.data());
      // Phase 3B: use fundSources if present
      setOrgInvestments(projs.reduce((s,p)=>s+(p.fundSources?Number(p.fundSources.investment)||0:p.fundSource!=='reserve'?(p.investedAmount||0):0),0));
      setOrgReserveUsed(projs.reduce((s,p)=>s+(p.fundSources?Number(p.fundSources.reserve)||0:p.fundSource==='reserve'?(p.investedAmount||0):0),0));
      setOrgBenevolent(loanSnap.docs.map(d=>d.data())
        .filter(l=>l.status==='disbursed'||l.status==='repaid')
        .reduce((s,l)=>s+(l.amount||0),0));
    })();
  }, [orgId]);

  const loadMember = async m => {
    setSelMember(m);
    setMobileView('detail');
    setLoading(true);
    setShowFundBreakdown(false);
    const rows = await buildMemberLedger(orgId, m.id, settings);
    setLedger(rows);
    setLoading(false);
  };

  // ── Per-member stats ──────────────────────────────────────────────────────
  const feeInAcct = !!settings.gatewayFeeInAccounting;

  const memberCapital = ledger
    .filter(r=>r.isContrib && r.status==='verified')
    .reduce((s,r)=>s+r.capitalCredit,0);

  const memberPending = ledger.filter(r=>r.status==='pending').length;

  // Member's fund allocations = (memberCapital / orgTotalCapital) * orgFundAlloc
  const memberPct = orgTotalCapital > 0 ? memberCapital / orgTotalCapital : 0;

  const FUNDS = [
    { key:'investment', label:'Investment Fund', icon:'📈', color:'#2563eb',
      orgAlloc: getFundAlloc('investment', orgTotalCapital, settings),
      orgUsed:  orgInvestments },
    { key:'reserve',    label:'Reserve Fund',    icon:'🛡',  color:'#16a34a',
      orgAlloc: getFundAlloc('reserve',    orgTotalCapital, settings),
      orgUsed:  orgReserveUsed },
    { key:'benevolent', label:'Benevolent Fund', icon:'🤝', color:'#7c3aed',
      orgAlloc: getFundAlloc('benevolent', orgTotalCapital, settings),
      orgUsed:  orgBenevolent },
    { key:'expenses',   label:'Expenses Fund',   icon:'🧾', color:'#d97706',
      orgAlloc: getFundAlloc('expenses',   orgTotalCapital, settings),
      orgUsed:  orgExpenses },
  ];

  const hasFundBudgets = FUNDS.some(f => f.orgAlloc > 0);

  // ── Filtered ledger ───────────────────────────────────────────────────────
  const filteredLedger = typeFilter === 'all' ? ledger :
    typeFilter === 'contributions' ? ledger.filter(r=>r.isContrib) :
    typeFilter === 'fees'          ? ledger.filter(r=>r.type==='entry_fee'||r.type==='reregistration_fee') :
    typeFilter === 'profit'        ? ledger.filter(r=>r.type==='profit') :
    typeFilter === 'loans'         ? ledger.filter(r=>r.type==='loan_disbursed'||r.type==='loan_repayment') :
    ledger;

  const searchedMembers = members.filter(m =>
    !search ||
    (m.nameEnglish||'').toLowerCase().includes(search.toLowerCase()) ||
    (m.idNo||'').includes(search)
  );

  if (!isOrgAdmin) return null;

  // ── Member list panel ─────────────────────────────────────────────────────
  const MemberList = () => (
    <div className="card" style={{ padding:0, overflow:'hidden' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid #e2e8f0' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search members…"
          style={{ width:'100%', padding:'8px 12px', borderRadius:8,
            border:'1px solid #e2e8f0', fontSize:13 }}/>
      </div>
      <div style={{ overflowY:'auto', maxHeight:'calc(100vh - 260px)' }}>
        {searchedMembers.map(m => {
          const sel = selMember?.id === m.id;
          return (
            <button key={m.id} onClick={()=>loadMember(m)}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
                width:'100%', border:'none', borderBottom:'1px solid #f1f5f9',
                background: sel ? '#eff6ff' : '#fff', cursor:'pointer', textAlign:'left',
                transition:'background .1s' }}
              onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f8fafc'; }}
              onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='#fff'; }}>
              <MemberAvatar m={m} size={34}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:13, color: sel?'#1d4ed8':'#0f172a',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {m.nameEnglish||'(no name)'}
                </div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo||'No ID'}</div>
              </div>
              <span style={{ color:'#cbd5e1', fontSize:16 }}>›</span>
            </button>
          );
        })}
        {searchedMembers.length === 0 && (
          <div style={{ textAlign:'center', color:'#94a3b8', padding:24, fontSize:13 }}>
            No members found
          </div>
        )}
      </div>
    </div>
  );

  // ── Ledger detail panel ───────────────────────────────────────────────────
  const LedgerDetail = () => {
    if (loading) return (
      <div className="card" style={{ textAlign:'center', padding:48, color:'#94a3b8' }}>
        Loading ledger…
      </div>
    );

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {/* Member header card */}
        <div className="card" style={{ padding:'16px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
            <MemberAvatar m={selMember} size={48}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:16, color:'#0f172a' }}>
                {selMember.nameEnglish}
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                ID: {selMember.idNo||'—'}
                {selMember.phone && ` · ${selMember.phone}`}
              </div>
            </div>
            {/* Quick stats */}
            <div style={{ display:'flex', gap:16, flexWrap:'wrap', flexShrink:0 }}>
              {[
                ['Capital',  fmt(memberCapital),  '#15803d'],
                ['Records',  ledger.length,         '#0f172a'],
                ['Pending',  memberPending,          memberPending>0?'#d97706':'#94a3b8'],
              ].map(([l,v,c]) => (
                <div key={l} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div>
                  <div style={{ fontSize:10, color:'#94a3b8', textTransform:'uppercase',
                    letterSpacing:'.05em' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Fund breakdown button — admin only, requires fund budgets configured */}
          {hasFundBudgets && (
            <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #f1f5f9' }}>
              <button onClick={()=>setShowFundBreakdown(v=>!v)}
                style={{ padding:'7px 16px', borderRadius:8, border:'1px solid #e2e8f0',
                  background: showFundBreakdown ? '#eff6ff' : '#fff',
                  color: showFundBreakdown ? '#1d4ed8' : '#475569',
                  cursor:'pointer', fontSize:12, fontWeight:600 }}>
                {showFundBreakdown ? '▲ Hide' : '▼ Show'} Member Fund Breakdown
              </button>
            </div>
          )}
        </div>

        {/* ── Per-fund breakdown — admin only ── */}
        {showFundBreakdown && hasFundBudgets && (
          <div className="card" style={{ padding:'16px 18px' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:4 }}>
              🏦 Fund Breakdown for {selMember.nameEnglish}
            </div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
              Based on {(memberPct*100).toFixed(2)}% capital share of the organisation.
              Org-wide fund usage is divided proportionally.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {FUNDS.map(fund => {
                if (!fund.orgAlloc) return null;
                // Member's portion of this fund
                const memberAlloc = Math.round(fund.orgAlloc * memberPct);
                const memberUsed  = Math.round(fund.orgUsed  * memberPct);
                const remaining   = memberAlloc - memberUsed;
                const usedPct     = memberAlloc > 0 ? Math.min(100,(memberUsed/memberAlloc)*100) : 0;
                const over        = remaining < 0;

                return (
                  <div key={fund.key} style={{
                    padding:'12px 14px', borderRadius:10,
                    border:`1px solid ${fund.color}33`,
                    background:`${fund.color}08`,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between',
                      alignItems:'center', marginBottom:6 }}>
                      <span style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>
                        {fund.icon} {fund.label}
                      </span>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ fontSize:13, fontWeight:700,
                          color: over ? '#dc2626' : fund.color }}>
                          {fmt(remaining)} remaining
                        </div>
                        <div style={{ fontSize:10, color:'#94a3b8' }}>
                          of {fmt(memberAlloc)} allocation
                        </div>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height:6, borderRadius:99, background:'#e2e8f0', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:99, transition:'width .6s',
                        background: over ? '#dc2626' : fund.color,
                        width:`${usedPct}%` }}/>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between',
                      fontSize:10, color:'#94a3b8', marginTop:3 }}>
                      <span>Used: {fmt(memberUsed)} ({usedPct.toFixed(1)}%)</span>
                      <span>Org total: {fmt(fund.orgAlloc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop:10, padding:'8px 12px', borderRadius:8,
              background:'#f8fafc', border:'1px solid #e2e8f0', fontSize:11, color:'#64748b' }}>
              💡 These figures show this member's proportional share of org-wide fund usage.
              They update in real-time as expenses and investments are recorded.
            </div>
          </div>
        )}

        {/* ── Filter bar ── */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {[
            ['all','All'],['contributions','Contributions'],
            ['fees','Fees'],['profit','Profit'],['loans','Loans'],
          ].map(([k,l]) => (
            <button key={k} onClick={()=>setTypeFilter(k)}
              style={{
                padding:'5px 12px', fontSize:11, borderRadius:7, cursor:'pointer',
                border: typeFilter===k ? '2px solid #2563eb' : '1px solid #e2e8f0',
                background: typeFilter===k ? '#eff6ff' : '#fff',
                color: typeFilter===k ? '#1d4ed8' : '#475569', fontWeight:500,
              }}>
              {l}
            </button>
          ))}
        </div>

        {/* ── Ledger table ── */}
        {filteredLedger.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:32, color:'#94a3b8', fontSize:13 }}>
            No records in this category.
          </div>
        ) : (
          <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            {/* Header */}
            <div style={{ display:'grid',
              gridTemplateColumns:'90px 120px 1fr 90px 100px 90px 80px',
              gap:8, padding:'8px 14px', background:'#f8fafc',
              borderBottom:'1px solid #e2e8f0' }}>
              {['Date','Type','Description','Method','Amount','Capital','Status'].map((h,i) => (
                <div key={i} style={{ fontSize:10, fontWeight:700, color:'#64748b',
                  textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {filteredLedger.map((r, i) => (
              <div key={r.id} style={{
                display:'grid',
                gridTemplateColumns:'90px 120px 1fr 90px 100px 90px 80px',
                gap:8, padding:'9px 14px', alignItems:'center',
                borderBottom:'1px solid #f1f5f9',
                background: r.isContrib && r.status==='verified'
                  ? '#f0fdf4'
                  : i%2===0 ? '#fff' : '#fafafa',
                borderLeft: `3px solid ${
                  r.isContrib && r.status==='verified' ? '#86efac' :
                  r.status==='pending' ? '#fde68a' :
                  r.status==='rejected' ? '#fca5a5' : 'transparent'
                }`,
              }}>
                <div style={{ fontSize:11, color:'#64748b', whiteSpace:'nowrap' }}>
                  {tsDate(r.date)}
                </div>
                <TypeBadge type={r.type}/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'#0f172a',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.label}
                  </div>
                  {r.txId && (
                    <div style={{ fontSize:10, color:'#94a3b8', fontFamily:'monospace' }}>
                      {r.txId.slice(0,16)}…
                    </div>
                  )}
                </div>
                <div style={{ fontSize:11, color:'#64748b' }}>{r.method}</div>
                <div style={{ fontWeight:700, fontSize:12, color:'#0f172a' }}>
                  {fmt(r.amount)}
                  {r.penalty>0 && (
                    <div style={{ fontSize:9, color:'#d97706' }}>+{fmt(r.penalty)}</div>
                  )}
                </div>
                <div style={{ fontSize:12, fontWeight:600,
                  color: r.capitalCredit>0 ? '#15803d' : '#94a3b8' }}>
                  {r.capitalCredit > 0 ? fmt(r.capitalCredit) : '—'}
                </div>
                <span className={`badge ${
                  r.status==='verified' ? 'badge-green' :
                  r.status==='pending'  ? 'badge-yellow' : 'badge-red'
                }`} style={{ fontSize:9, textTransform:'capitalize' }}>
                  {r.status}
                </span>
              </div>
            ))}

            {/* Footer row */}
            <div style={{ display:'grid',
              gridTemplateColumns:'90px 120px 1fr 90px 100px 90px 80px',
              gap:8, padding:'8px 14px', background:'#f8fafc',
              borderTop:'2px solid #e2e8f0' }}>
              <div/><div/>
              <div style={{ fontSize:11, fontWeight:700, color:'#64748b' }}>
                {filteredLedger.length} records
              </div>
              <div/>
              <div style={{ fontSize:12, fontWeight:800, color:'#0f172a' }}>
                {fmt(filteredLedger.reduce((s,r)=>s+r.amount,0))}
              </div>
              <div style={{ fontSize:12, fontWeight:800, color:'#15803d' }}>
                {fmt(filteredLedger.filter(r=>r.capitalCredit>0).reduce((s,r)=>s+r.capitalCredit,0))}
              </div>
              <div/>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="page-wrap animate-fade">
      <style>{`
        .adm-ledger { display: block; }
        @media (min-width: 768px) {
          .adm-ledger { display: grid !important;
            grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
          .adm-list  { display: block !important; }
          .adm-detail { display: block !important; }
          .adm-back  { display: none !important; }
        }
        @media (max-width: 767px) {
          .adm-list.hide   { display: none; }
          .adm-detail.hide { display: none; }
        }
      `}</style>

      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">Member Ledger</div>
          <div className="page-subtitle">
            {members.length} members · All payment types
          </div>
        </div>
      </div>

      {/* Mobile back button */}
      {mobileView === 'detail' && (
        <div className="adm-back" style={{ marginBottom:14 }}>
          <button onClick={()=>setMobileView('list')}
            style={{ background:'none', border:'none', cursor:'pointer',
              color:'#2563eb', fontWeight:600, fontSize:14, padding:0,
              display:'inline-flex', alignItems:'center', gap:6 }}>
            ← All Members
          </button>
        </div>
      )}

      <div className="adm-ledger" style={{ display:'block' }}>
        <div className={`adm-list${mobileView==='detail' ? ' hide' : ''}`}>
          <MemberList/>
        </div>
        <div className={`adm-detail${mobileView==='list' ? ' hide' : ''}`}>
          {selMember ? <LedgerDetail/> : (
            <div className="card" style={{ textAlign:'center', padding:'60px 20px', color:'#94a3b8' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>👈</div>
              <div style={{ fontWeight:500 }}>Select a member to view their ledger</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}