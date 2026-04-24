// src/app/dashboard/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

// Returns "YYYY-MM" for the current month
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}
// e.g. "May 2025"
function currentMonthLabel() {
  return new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'});
}

// ── Shared fund computation ───────────────────────────────────────────────────
function getFundAlloc(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb?.value) return 0;
  if (fb.type === 'amount') return Number(fb.value) || 0;
  const pct = Math.round(totalCapital * (Number(fb.value) || 0) / 100);
  const maxCap = fb.maxAmount && Number(fb.maxAmount) > 0 ? Number(fb.maxAmount) : Infinity;
  return Math.min(pct, maxCap);
}

function FundBar({ label, icon, alloc, used, color }) {
  if (alloc <= 0) return null;
  const balance = alloc - used;
  const usedPct = Math.min(100, (used/alloc)*100);
  const over    = balance < 0;
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{icon} {label}</span>
        <span style={{fontSize:12,fontWeight:700,color:over?'#dc2626':color}}>
          {fmt(balance)} remaining
        </span>
      </div>
      <div style={{height:7,borderRadius:99,background:'#e2e8f0',overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:99,
          background:over?'#dc2626':color,
          width:`${usedPct}%`,transition:'width 0.6s'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:3,fontSize:11,color:'#94a3b8'}}>
        <span>Used: {fmt(used)}</span>
        <span>Budget: {fmt(alloc)}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, userData, orgData, isSuperAdmin, impersonateMemberId } = useAuth();
  const viewUid = (isSuperAdmin && impersonateMemberId) ? impersonateMemberId : user?.uid;
  const orgId = userData?.activeOrgId;

  const [data,    setData]    = useState(null);
  const [notifs,  setNotifs]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId||!user) return;
    (async () => {
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const [paySnap, distSnap, loanSnap, expSnap, projSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(query(collection(db,'organizations',orgId,'profitDistributions'),orderBy('createdAt','desc'))),
        getDocs(collection(db,'organizations',orgId,'loans')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
      ]);

      const payments    = paySnap.docs.map(d=>({id:d.id,...d.data()}));
      const myPayments  = payments.filter(p=>p.userId===viewUid);
      const myCapital   = myPayments
        .filter(p=>p.status==='verified' && p.isContribution !== false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
      const myPending   = myPayments.filter(p=>p.status==='pending').length;
      const myVerified  = myPayments.filter(p=>p.status==='verified').length;

      const totalCapital = payments
        .filter(p=>p.status==='verified' && p.isContribution !== false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
      const myCapPct = totalCapital>0?((myCapital/totalCapital)*100).toFixed(1):'0';

      const dists = distSnap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.status==='distributed');
      const myTotalProfit = dists.reduce((s,d)=>{
        const ms=(d.memberShares||[]).find(m=>m.userId===viewUid);
        return s+(ms?.shareAmount||0);
      },0);
      const latestDist    = dists[0];
      const myLatestShare = latestDist
        ? (latestDist.memberShares||[]).find(m=>m.userId===viewUid)?.shareAmount||0
        : 0;

      const myLoans    = loanSnap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.userId===viewUid);
      const activeLoans= myLoans.filter(l=>l.status==='disbursed');
      const outstanding= activeLoans.reduce((s,l)=>s+(l.outstandingBalance||0),0);

      // ── Next loan repayment (earliest upcoming schedule entry) ────────────
      let nextRepayment = null;
      const today = new Date(); today.setHours(0,0,0,0);
      activeLoans.forEach(loan => {
        (loan.repaymentSchedule||[]).forEach(entry => {
          if (entry.status === 'pending') {
            const d = new Date(entry.dueDate);
            if (d >= today && (!nextRepayment || d < new Date(nextRepayment.dueDate))) {
              nextRepayment = { ...entry, loanPurpose: loan.purpose };
            }
          }
        });
      });

      // ── Current-month installment paid? ──────────────────────────────────
      const curKey = currentMonthKey();
      const paidThisMonth = myPayments.some(p =>
        p.status !== 'rejected' &&
        (p.paidMonths||[]).some(m => {
          if (typeof m === 'string') return m === curKey;
          // handle timestamp-style paidMonths
          const d = m?.seconds ? new Date(m.seconds*1000) : new Date(m);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === curKey;
        })
      );

      // Fund usage
      const usedExpenses   = expSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);
      const projs = projSnap.docs.map(d=>d.data());
      const usedInvestment = projs.reduce((s,p) => {
        if (p.fundSources) return s + (Number(p.fundSources.investment)||0);
        return s + (p.fundSource!=='reserve' ? (p.investedAmount||0) : 0);
      },0);
      const usedReserve = projs.reduce((s,p) => {
        if (p.fundSources) return s + (Number(p.fundSources.reserve)||0);
        return s + (p.fundSource==='reserve' ? (p.investedAmount||0) : 0);
      },0);
      const usedBenevolent = loanSnap.docs.map(d=>d.data())
        .filter(l=>l.status==='disbursed'||l.status==='repaid').reduce((s,l)=>s+(l.amount||0),0);

      setData({
        myCapital, myCapPct, myPending, myVerified, myTotalProfit, myLatestShare, latestDist,
        activeLoans:activeLoans.length, outstanding, myPayments,
        totalCapital, usedExpenses, usedInvestment, usedReserve, usedBenevolent,
        paidThisMonth, nextRepayment,
        isNewMember: myVerified === 0 && myPending === 0,
      });

      try {
        const nSnap = await getDocs(
          query(
            collection(db,'organizations',orgId,'notifications'),
            where('userId','==',viewUid),
            orderBy('createdAt','desc'),
            limit(3)
          )
        );
        setNotifs(nSnap.docs.map(d=>({id:d.id,...d.data()})));
      } catch (_) {}

      setLoading(false);
    })();
  }, [orgId, user]);

  const orgF = orgData?.orgFeatures || {};
  const s    = orgData?.settings    || {};
  const name = userData?.nameEnglish||userData?.displayName||'Member';

  const showMyCapital          = s.showMyCapital          !== false;
  const showPendingWarning     = s.showPendingWarning     !== false;
  const showFund               = s.showFund               !== false;
  const showFundBreakdown      = !!s.showFundBreakdown;
  const showLatestDistribution = s.showLatestDistribution !== false;
  const showNotificationsCard  = s.showNotificationsCard  !== false;
  const showRecentPayments     = s.showRecentPayments     !== false;
  const showSlogan             = !!s.showSlogan;

  const hasFundBudgets = data && showFundBreakdown && Object.values(s.fundBudgets||{}).some(f=>f?.value);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Welcome, {name.split(' ')[0]} 👋</div>
        <div className="page-subtitle">
          {orgData?.name||'Organization'}
          {showSlogan && s.slogan ? ` · ${s.slogan}` : ' · Member Dashboard'}
        </div>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : (
        <>
          {/* ── New member onboarding nudge ── */}
          {data.isNewMember && (
            <Link href="/installment" style={{textDecoration:'none'}}>
              <div style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'14px 18px',borderRadius:10,marginBottom:16,
                background:'#eff6ff',border:'1px solid #bfdbfe',
              }}>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:'#1e40af'}}>👋 Welcome to the fund!</div>
                  <div style={{fontSize:12,color:'#3b82f6',marginTop:2}}>
                    Make your first installment to join the capital pool.
                  </div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:'#1e40af',flexShrink:0}}>Pay now →</span>
              </div>
            </Link>
          )}

          {/* ── This month's installment reminder ── */}
          {!data.isNewMember && !data.paidThisMonth && (
            <Link href="/installment" style={{textDecoration:'none'}}>
              <div style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'12px 16px',borderRadius:10,marginBottom:16,
                background:'#fffbeb',border:'1px solid #fde68a',
              }}>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:'#92400e'}}>
                    📅 {currentMonthLabel()} installment not yet paid
                  </div>
                  <div style={{fontSize:12,color:'#b45309',marginTop:2}}>
                    Stay up to date — tap to pay now.
                  </div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:'#92400e',flexShrink:0}}>Pay →</span>
              </div>
            </Link>
          )}

          {/* ── Loan repayment reminder ── */}
          {data.nextRepayment && (
            <Link href="/loans" style={{textDecoration:'none'}}>
              <div style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'12px 16px',borderRadius:10,marginBottom:16,
                background:'#fdf4ff',border:'1px solid #e9d5ff',
              }}>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:'#7c3aed'}}>
                    🔁 Loan repayment due {tsDate(data.nextRepayment.dueDate)}
                  </div>
                  <div style={{fontSize:12,color:'#9333ea',marginTop:2}}>
                    {fmt(data.nextRepayment.amount)}
                    {data.nextRepayment.loanPurpose ? ` · ${data.nextRepayment.loanPurpose}` : ''}
                  </div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:'#7c3aed',flexShrink:0}}>View →</span>
              </div>
            </Link>
          )}

          {/* ── Personal stats grid ── */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:20}}>

            {showMyCapital && (
              <div style={{background:'#f0fdf4',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>My Capital</div>
                <div style={{fontSize:22,fontWeight:800,color:'#15803d'}}>{fmt(data.myCapital)}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{data.myCapPct}% of total pool</div>
              </div>
            )}

            {data.myTotalProfit > 0 && (
              <div style={{background:'#eff6ff',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Total Profit</div>
                <div style={{fontSize:22,fontWeight:800,color:'#1d4ed8'}}>{fmt(data.myTotalProfit)}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>all distributions</div>
              </div>
            )}

            {showFund && (
              <div style={{background:'#fafafa',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Total Fund</div>
                <div style={{fontSize:22,fontWeight:800,color:'#0f172a'}}>{fmt(data.totalCapital)}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>org-wide capital</div>
              </div>
            )}

            {/* Verified payments count — always useful at a glance */}
            {data.myVerified > 0 && (
              <div style={{background:'#f8fafc',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Payments Made</div>
                <div style={{fontSize:22,fontWeight:800,color:'#0f172a'}}>{data.myVerified}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>
                  {data.myPending > 0 ? `${data.myPending} pending` : 'all verified'}
                </div>
              </div>
            )}

            {showPendingWarning && data.myPending > 0 && (
              <Link href="/installment" style={{textDecoration:'none'}}>
                <div style={{background:'#fef3c7',borderRadius:12,padding:'16px 18px',border:'1px solid #fde68a'}}>
                  <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Pending</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#92400e'}}>{data.myPending}</div>
                  <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>awaiting verification</div>
                </div>
              </Link>
            )}

            {orgF.qardHasana && data.activeLoans > 0 && (
              <Link href="/loans" style={{textDecoration:'none'}}>
                <div style={{background:'#fef2f2',borderRadius:12,padding:'16px 18px',border:'1px solid #fca5a5'}}>
                  <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Loan Outstanding</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#dc2626'}}>{fmt(data.outstanding)}</div>
                </div>
              </Link>
            )}
          </div>

          {/* ── Fund Breakdown Bars ── */}
          {hasFundBudgets && (
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
              padding:'16px 20px',marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>🏦 Fund Overview</div>
                <Link href="/admin/fund-structure" style={{fontSize:12,color:'#2563eb',textDecoration:'none',fontWeight:600}}>
                  View details →
                </Link>
              </div>
              <FundBar label="Investment Fund" icon="📈" color="#2563eb"
                alloc={getFundAlloc('investment',data.totalCapital,s)} used={data.usedInvestment}/>
              <FundBar label="Reserve Fund"    icon="🛡"  color="#16a34a"
                alloc={getFundAlloc('reserve',data.totalCapital,s)}    used={data.usedReserve}/>
              <FundBar label="Benevolent Fund" icon="🤝" color="#7c3aed"
                alloc={getFundAlloc('benevolent',data.totalCapital,s)} used={data.usedBenevolent}/>
              <FundBar label="Expenses Fund"   icon="🧾" color="#d97706"
                alloc={getFundAlloc('expenses',data.totalCapital,s)}   used={data.usedExpenses}/>
            </div>
          )}

          {/* ── Latest Distribution ── */}
          {showLatestDistribution && data.latestDist && (
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
              padding:'16px 20px',marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Latest Distribution</div>
                <span style={{fontSize:12,color:'#94a3b8'}}>{data.latestDist.periodLabel||data.latestDist.year}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div style={{background:'#f0fdf4',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:3}}>MY SHARE</div>
                  <div style={{fontSize:18,fontWeight:800,color:data.myLatestShare>=0?'#15803d':'#dc2626'}}>
                    {fmt(data.myLatestShare)}
                  </div>
                </div>
                <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:3}}>GROSS PROFIT</div>
                  <div style={{fontSize:18,fontWeight:800}}>{fmt(data.latestDist.grossProfit)}</div>
                </div>
                <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:3}}>RATE / ৳100</div>
                  <div style={{fontSize:18,fontWeight:800}}>
                    {data.latestDist.totalCapital>0
                      ? fmt((data.latestDist.distributableProfit/data.latestDist.totalCapital)*100):'—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {showNotificationsCard && notifs.length > 0 && (
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
              overflow:'hidden',marginBottom:16}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>🔔 Notifications</div>
              </div>
              {notifs.map((n, i) => (
                <div key={n.id} style={{padding:'10px 16px',borderBottom:i<notifs.length-1?'1px solid #f8fafc':'none',
                  background:n.read?'#fff':'#f0f9ff'}}>
                  <div style={{fontSize:13,color:'#0f172a',lineHeight:1.5}}>{n.message}</div>
                  {n.createdAt && (
                    <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{tsDate(n.createdAt)}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Recent Payments ── */}
          {showRecentPayments && data.myPayments.length > 0 && (
            <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden',marginBottom:16}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0f172a'}}>Recent Payments</div>
                <Link href="/installment" style={{fontSize:12,color:'#2563eb',textDecoration:'none',fontWeight:600}}>
                  Pay now →
                </Link>
              </div>
              {data.myPayments.slice(0,5).map((p,i) => (
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  padding:'10px 16px',borderBottom:i<4?'1px solid #f8fafc':'none',
                  background:i%2===0?'#fff':'#fafafa'}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:500,color:'#0f172a'}}>{tsDate(p.createdAt)}</div>
                    <div style={{fontSize:11,color:'#94a3b8'}}>{p.method}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{fmt(p.amount)}</div>
                    <span style={{fontSize:11,fontWeight:700,padding:'1px 7px',borderRadius:99,
                      background:p.status==='verified'?'#dcfce7':p.status==='pending'?'#fef3c7':'#fee2e2',
                      color:p.status==='verified'?'#15803d':p.status==='pending'?'#92400e':'#dc2626'}}>
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Quick links ── */}
          <div style={{marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}>
            <Link href="/installment" style={{padding:'10px 18px',borderRadius:8,
              background:'#0f172a',color:'#fff',fontWeight:600,fontSize:13,textDecoration:'none'}}>
              + Pay Installment
            </Link>
            {orgF.capitalLedger && (
              <Link href="/capital" style={{padding:'10px 18px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',color:'#475569',fontWeight:600,fontSize:13,textDecoration:'none'}}>
                My Capital
              </Link>
            )}
            {orgF.qardHasana && (
              <Link href="/loans" style={{padding:'10px 18px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',color:'#475569',fontWeight:600,fontSize:13,textDecoration:'none'}}>
                My Loans
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}