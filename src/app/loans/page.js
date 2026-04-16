// src/app/loans/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

const STATUSES = {
  pending:   {label:'Pending Review',color:'#92400e',bg:'#fef3c7',dot:'#f59e0b'},
  approved:  {label:'Approved',      color:'#1e40af',bg:'#dbeafe',dot:'#2563eb'},
  disbursed: {label:'Disbursed',     color:'#14532d',bg:'#dcfce7',dot:'#16a34a'},
  repaid:    {label:'Fully Repaid',  color:'#6b7280',bg:'#f3f4f6',dot:'#9ca3af'},
  rejected:  {label:'Rejected',      color:'#7f1d1d',bg:'#fee2e2',dot:'#dc2626'},
};

function StatusBadge({status}) {
  const c=STATUSES[status]||STATUSES.pending;
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,background:c.bg,color:c.color}}><span style={{width:6,height:6,borderRadius:'50%',background:c.dot,display:'inline-block'}}/>{c.label}</span>;
}

export default function LoansPage() {
  const { user, userData } = useAuth();
  const orgId = userData?.activeOrgId;

  const [loans,    setLoans]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!orgId||!user) return;
    return onSnapshot(
      query(collection(db,'organizations',orgId,'loans'),orderBy('createdAt','desc')),
      snap => { setLoans(snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.userId===user.uid)); setLoading(false); }
    );
  }, [orgId, user]);

  const activeLoans = loans.filter(l=>l.status==='disbursed');
  const totalOutstanding = activeLoans.reduce((s,l)=>s+(l.outstandingBalance||0),0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">My Loans</div>
        <div className="page-subtitle">Interest-free loan (Qard al-Hasan) requests and repayment status.</div>
      </div>

      {activeLoans.length>0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:24}}>
          <div style={{background:'#fef2f2',borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>Outstanding Balance</div>
            <div style={{fontSize:20,fontWeight:700,color:'#dc2626'}}>{fmt(totalOutstanding)}</div>
          </div>
          <div style={{background:'#f8fafc',borderRadius:10,padding:'14px 16px'}}>
            <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>Active Loans</div>
            <div style={{fontSize:20,fontWeight:700}}>{activeLoans.length}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : loans.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🤝</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No loan requests</div>
          <div style={{fontSize:13,color:'#94a3b8'}}>Contact an admin to apply for a Qard al-Hasan loan.</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {loans.map(l=>(
            <div key={l.id} onClick={()=>setSelected(selected?.id===l.id?null:l)}
              style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 18px',cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:4}}>{fmt(l.amount)} — {l.purpose}</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><StatusBadge status={l.status}/><span style={{fontSize:11,color:'#94a3b8'}}>Applied {tsDate(l.createdAt)}</span></div>
                </div>
                {l.status==='disbursed' && (
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:11,color:'#94a3b8'}}>Outstanding</div>
                    <div style={{fontWeight:700,fontSize:16,color:'#dc2626'}}>{fmt(l.outstandingBalance||0)}</div>
                    <div style={{fontSize:11,color:'#94a3b8'}}>of {fmt(l.amount)}</div>
                  </div>
                )}
              </div>

              {selected?.id===l.id && (
                <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid #f1f5f9'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:12}}>
                    <div style={{background:'#eff6ff',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:11,color:'#1d4ed8',fontWeight:600,marginBottom:2}}>LOAN AMOUNT</div>
                      <div style={{fontSize:16,fontWeight:700,color:'#1d4ed8'}}>{fmt(l.amount)}</div>
                    </div>
                    <div style={{background:'#f0fdf4',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:11,color:'#15803d',fontWeight:600,marginBottom:2}}>REPAID</div>
                      <div style={{fontSize:16,fontWeight:700,color:'#15803d'}}>{fmt(l.totalRepaid||0)}</div>
                    </div>
                    <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:2}}>MONTHLY</div>
                      <div style={{fontSize:16,fontWeight:700}}>{fmt(l.monthlyInstallment||0)}</div>
                    </div>
                    <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,marginBottom:2}}>PERIOD</div>
                      <div style={{fontSize:16,fontWeight:700}}>{l.repaymentMonths} months</div>
                    </div>
                  </div>
                  {l.purposeDescription && <div style={{fontSize:13,color:'#64748b',marginBottom:8}}><strong>Details:</strong> {l.purposeDescription}</div>}
                  {(l.repayments||[]).length>0 && (
                    <div>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:6}}>Repayment History</div>
                      <div style={{borderRadius:8,border:'1px solid #e2e8f0',overflow:'hidden'}}>
                        {l.repayments.map((r,i)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 12px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
                            <span style={{color:'#475569'}}>{r.date}</span>
                            <span style={{fontWeight:600,color:'#15803d'}}>{fmt(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {l.status==='rejected' && <div style={{marginTop:8,padding:'8px 12px',borderRadius:8,background:'#fee2e2',fontSize:13,color:'#b91c1c'}}>This loan request was rejected. Contact an admin for more information.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
