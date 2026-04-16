// src/app/assets/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }

const STATUS_CFG = {
  active:   {label:'Active',   color:'#14532d',bg:'#dcfce7',dot:'#16a34a'},
  disposed: {label:'Disposed', color:'#6b7280',bg:'#f3f4f6',dot:'#9ca3af'},
  damaged:  {label:'Damaged',  color:'#92400e',bg:'#fef3c7',dot:'#f59e0b'},
};

function StatusBadge({status}) {
  const c=STATUS_CFG[status]||STATUS_CFG.active;
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'2px 8px',borderRadius:99,fontSize:11,fontWeight:700,background:c.bg,color:c.color}}><span style={{width:5,height:5,borderRadius:'50%',background:c.dot,display:'inline-block'}}/>{c.label}</span>;
}

export default function AssetsPage() {
  const { userData } = useAuth();
  const orgId = userData?.activeOrgId;

  const [assets,  setAssets]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected,setSelected]= useState(null);

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db,'organizations',orgId,'assets'),orderBy('createdAt','desc')),
      snap => { setAssets(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
  }, [orgId]);

  const active = assets.filter(a=>a.status==='active');
  const totalValue = active.reduce((s,a)=>s+(a.currentValue||a.purchasePrice||0),0);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Organization Assets</div>
        <div className="page-subtitle">Assets owned by the organization on behalf of all members.</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:24}}>
        <div style={{background:'#f0fdf4',borderRadius:10,padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>Total Value</div>
          <div style={{fontSize:20,fontWeight:700,color:'#15803d'}}>{fmt(totalValue)}</div>
        </div>
        <div style={{background:'#f8fafc',borderRadius:10,padding:'14px 16px'}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>Active Assets</div>
          <div style={{fontSize:20,fontWeight:700}}>{active.length}</div>
        </div>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : assets.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🏢</div>
          <div style={{fontWeight:600,color:'#0f172a'}}>No assets recorded yet</div>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Asset','Type','Status','Value'].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Asset'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {assets.map((a,i)=>(
            <div key={a.id} onClick={()=>setSelected(selected?.id===a.id?null:a)}
              style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',padding:'11px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',cursor:'pointer',alignItems:'center'}}
              onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
              onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{a.name}</div>
                {a.location&&<div style={{fontSize:11,color:'#94a3b8'}}>{a.location}</div>}
              </div>
              <div style={{textAlign:'right',fontSize:12,color:'#475569'}}>{a.type}</div>
              <div style={{textAlign:'right'}}><StatusBadge status={a.status}/></div>
              <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#15803d'}}>{fmt(a.currentValue||a.purchasePrice)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Simple detail expansion */}
      {selected && (
        <div style={{marginTop:16,padding:'16px 20px',borderRadius:12,border:'1px solid #e2e8f0',background:'#f8fafc'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
            <div style={{fontWeight:700,fontSize:15}}>{selected.name}</div>
            <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:16}}>✕</button>
          </div>
          {selected.description&&<p style={{fontSize:13,color:'#475569',marginBottom:10}}>{selected.description}</p>}
          <div style={{display:'flex',gap:20,flexWrap:'wrap',fontSize:13,color:'#475569'}}>
            {selected.purchaseDate&&<span>📅 Purchased: <strong>{selected.purchaseDate}</strong></span>}
            {selected.location&&<span>📍 <strong>{selected.location}</strong></span>}
            {selected.registrationNo&&<span>📋 Reg: <strong>{selected.registrationNo}</strong></span>}
            {selected.insuranceType&&<span>🛡 Insurance: <strong>{selected.insuranceType}</strong>{selected.insuranceExpiry&&` (exp. ${selected.insuranceExpiry})`}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
