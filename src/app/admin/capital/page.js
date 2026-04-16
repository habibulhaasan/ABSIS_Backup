// src/app/admin/capital/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function fmtSigned(n) { const v=Number(n)||0; return `${v>=0?'+':'-'}৳${Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

export default function AdminCapital() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null); // member id for detail drill-down
  const [search,   setSearch]   = useState('');
  const [sortBy,   setSortBy]   = useState('capital'); // capital | name | payments

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [memSnap, paySnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(query(collection(db,'organizations',orgId,'investments'),orderBy('createdAt','desc'))),
      ]);
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const payments  = paySnap.docs.map(d=>({id:d.id,...d.data()}));

      const rawMembers = memSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.approved);
      const enriched = await Promise.all(rawMembers.map(async m => {
        try { const u=await getDoc(doc(db,'users',m.id)); return u.exists()?{...u.data(),...m}:m; }
        catch { return m; }
      }));

      const result = enriched.map(m => {
        const myPay  = payments.filter(p=>p.userId===m.id);
        const verified = myPay.filter(p=>p.status==='verified' && p.isContribution !== false);
        const capital  = verified.reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);
        const pending  = myPay.filter(p=>p.status==='pending').reduce((s,p)=>s+(p.amount||0),0);
        return { ...m, capital, pending, paymentCount:myPay.length, verifiedCount:verified.length, payments:myPay };
      });

      setRows(result);
      setLoading(false);
    })();
  }, [orgId]);

  if (!isOrgAdmin) return null;

  const totalCapital = rows.reduce((s,r)=>s+r.capital,0);
  const totalPending = rows.reduce((s,r)=>s+r.pending,0);

  const filtered = rows
    .filter(r => !search || (r.nameEnglish||r.name||'').toLowerCase().includes(search.toLowerCase()) || (r.idNo||'').includes(search))
    .sort((a,b) => sortBy==='capital'?b.capital-a.capital:sortBy==='payments'?b.verifiedCount-a.verifiedCount:(a.nameEnglish||a.name||'').localeCompare(b.nameEnglish||b.name||''));

  const selectedMember = selected ? rows.find(r=>r.id===selected) : null;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Capital Ledger</div>
        <div className="page-subtitle">Total verified capital contributed by each member through installment payments.</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Total Capital"   value={fmt(totalCapital)}      color="#15803d" bg="#f0fdf4"/>
        <Stat label="Active Members"  value={rows.filter(r=>r.capital>0).length} color="#1d4ed8" bg="#eff6ff"/>
        <Stat label="Pending Capital" value={fmt(totalPending)}      color="#92400e" bg="#fef3c7"/>
        <Stat label="Total Members"   value={rows.length}            bg="#f8fafc"/>
      </div>

      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search member…" style={{flex:1,minWidth:180,padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
          style={{padding:'9px 14px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,color:'#475569'}}>
          <option value="capital">Sort: Most Capital</option>
          <option value="name">Sort: Name A–Z</option>
          <option value="payments">Sort: Most Payments</option>
        </select>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Member','Capital','Pending','Payments'].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Member'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {filtered.map((r,i) => {
            const capPct = totalCapital>0?((r.capital/totalCapital)*100).toFixed(1):'0';
            return (
              <div key={r.id}
                onClick={()=>setSelected(r.id===selected?null:r.id)}
                style={{cursor:'pointer',borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'11px 16px',background:selected===r.id?'#eff6ff':i%2===0?'#fff':'#fafafa',transition:'background 0.1s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=selected===r.id?'#eff6ff':i%2===0?'#fff':'#fafafa'}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:30,height:30,borderRadius:'50%',background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                      {initials(r.nameEnglish||r.name)}
                    </div>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{r.nameEnglish||r.name||'—'}</div>
                      {r.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{r.idNo}</div>}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(r.capital)}</div>
                    <div style={{fontSize:11,color:'#94a3b8'}}>{capPct}%</div>
                  </div>
                  <div style={{textAlign:'right',fontWeight:600,fontSize:13,color:r.pending>0?'#92400e':'#94a3b8'}}>{r.pending>0?fmt(r.pending):'—'}</div>
                  <div style={{textAlign:'right',fontSize:13,color:'#475569'}}>{r.verifiedCount} / {r.paymentCount}</div>
                </div>

                {/* Drill-down: payment list */}
                {selected===r.id && (
                  <div style={{padding:'0 16px 12px',background:'#f0f9ff'}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:8,paddingTop:8}}>Payment History</div>
                    {r.payments.length===0 ? (
                      <div style={{fontSize:12,color:'#94a3b8'}}>No payments found.</div>
                    ) : (
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                        <thead>
                          <tr style={{background:'#dbeafe'}}>
                            {['Date','Amount','Fee','Net','Status'].map(h=>(
                              <th key={h} style={{padding:'6px 10px',textAlign:h==='Date'||h==='Status'?'left':'right',fontWeight:700,color:'#1e40af'}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {r.payments.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).map((p,pi)=>{
                            const net=(p.amount||0)-(!!orgData?.settings?.gatewayFeeInAccounting?0:(p.gatewayFee||0));
                            const statusColor=p.status==='verified'?'#15803d':p.status==='pending'?'#92400e':'#dc2626';
                            return (
                              <tr key={p.id} style={{background:pi%2===0?'#fff':'#f0f9ff'}}>
                                <td style={{padding:'6px 10px'}}>{tsDate(p.createdAt)}</td>
                                <td style={{padding:'6px 10px',textAlign:'right'}}>{fmt(p.amount)}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',color:'#dc2626'}}>{p.gatewayFee>0?`-${fmt(p.gatewayFee)}`:'—'}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:'#15803d'}}>{fmt(net)}</td>
                                <td style={{padding:'6px 10px'}}>
                                  <span style={{fontSize:11,fontWeight:700,color:statusColor,background:p.status==='verified'?'#dcfce7':p.status==='pending'?'#fef3c7':'#fee2e2',padding:'2px 8px',borderRadius:99}}>
                                    {p.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}