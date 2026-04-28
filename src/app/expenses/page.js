'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

const CATEGORY_COLORS = {
  Office:      { bg:'#eff6ff', color:'#1d4ed8' },
  Meeting:     { bg:'#f0fdf4', color:'#15803d' },
  Travel:      { bg:'#fdf4ff', color:'#7c3aed' },
  Utilities:   { bg:'#fff7ed', color:'#c2410c' },
  Maintenance: { bg:'#fefce8', color:'#a16207' },
  Marketing:   { bg:'#fdf2f8', color:'#be185d' },
  Legal:       { bg:'#f0f9ff', color:'#0369a1' },
  Other:       { bg:'#f8fafc', color:'#475569' },
};

function CategoryBadge({ category }) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
  return (
    <span style={{
      padding:'2px 9px', borderRadius:99, fontSize:11, fontWeight:700,
      background:c.bg, color:c.color,
    }}>{category || 'Other'}</span>
  );
}

// ── Detail Modal ───────────────────────────────────────────────────────────────
function DetailModal({ item, onClose }) {
  if (!item) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex:1000, padding:16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:'#fff', borderRadius:16, width:'100%', maxWidth:420,
          boxShadow:'0 20px 60px rgba(0,0,0,0.18)', overflow:'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 20px', borderBottom:'1px solid #f1f5f9',
        }}>
          <div style={{fontWeight:700, fontSize:15, color:'#0f172a'}}>Expense Detail</div>
          <button
            onClick={onClose}
            style={{
              background:'none', border:'none', cursor:'pointer',
              fontSize:20, color:'#94a3b8', lineHeight:1, padding:'0 4px',
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{padding:'20px'}}>
          {/* Category + Date row */}
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
            <CategoryBadge category={item.category} />
            <span style={{fontSize:12, color:'#94a3b8', fontWeight:500}}>
              {fmtDate(item.date)}
            </span>
          </div>

          {/* Title */}
          <div style={{fontSize:18, fontWeight:700, color:'#0f172a', marginBottom:10, lineHeight:1.3}}>
            {item.title}
          </div>

          {/* Amount chip */}
          <div style={{
            display:'inline-block',
            background:'#fef2f2', borderRadius:10, padding:'10px 18px',
            marginBottom:16,
          }}>
            <span style={{fontSize:26, fontWeight:800, color:'#dc2626'}}>{fmt(item.amount)}</span>
          </div>

          {/* Notes */}
          {item.notes && (
            <div style={{
              background:'#f8fafc', borderRadius:10, padding:'12px 14px',
              fontSize:13, color:'#475569', lineHeight:1.6,
            }}>
              <div style={{fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4}}>Notes</div>
              {item.notes}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'14px 20px', borderTop:'1px solid #f1f5f9', background:'#fafafa'}}>
          <button
            onClick={onClose}
            style={{
              width:'100%', padding:'10px', borderRadius:8,
              border:'1px solid #e2e8f0', background:'#fff',
              cursor:'pointer', fontSize:13, fontWeight:600, color:'#475569',
            }}
          >Close</button>
        </div>
      </div>
    </div>
  );
}

export default function Expenses() {
  const { userData } = useAuth();
  const [items,     setItems]     = useState([]);
  const [selected,  setSelected]  = useState(null);
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db,'organizations',orgId,'expenses'), orderBy('date','desc'));
    return onSnapshot(q, snap => setItems(snap.docs.map(d => ({id:d.id,...d.data()}))));
  }, [orgId]);

  const total        = items.reduce((s,i) => s+(i.amount||0), 0);
  const thisMonth    = (() => {
    const n = new Date();
    return items
      .filter(i => {
        if (!i.date) return false;
        const d = new Date(i.date+'T00:00:00');
        return d.getMonth()===n.getMonth() && d.getFullYear()===n.getFullYear();
      })
      .reduce((s,i)=>s+(i.amount||0),0);
  })();

  // Category breakdown
  const byCat = items.reduce((acc, i) => {
    const c = i.category || 'Other';
    acc[c] = (acc[c]||0) + (i.amount||0);
    return acc;
  }, {});
  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,4);

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Expenses</div>
        <div className="page-subtitle">Organisation spending overview</div>
      </div>

      {/* ── Summary Cards ── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:20}}>
        <div style={{background:'#fef2f2', borderRadius:12, padding:'16px 18px', border:'1px solid #fecaca'}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Total Expenses</div>
          <div style={{fontSize:22,fontWeight:800,color:'#dc2626'}}>{fmt(total)}</div>
          <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>{items.length} entries</div>
        </div>
        <div style={{background:'#fff7ed', borderRadius:12, padding:'16px 18px', border:'1px solid #fed7aa'}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>This Month</div>
          <div style={{fontSize:22,fontWeight:800,color:'#c2410c'}}>{fmt(thisMonth)}</div>
          <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>
            {new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}
          </div>
        </div>
        {topCats.length > 0 && (
          <div style={{background:'#f8fafc', borderRadius:12, padding:'16px 18px', border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8}}>Top Category</div>
            <div style={{fontSize:15,fontWeight:700,color:'#0f172a'}}>{topCats[0]?.[0]}</div>
            <div style={{fontSize:13,fontWeight:600,color:'#dc2626',marginTop:2}}>{fmt(topCats[0]?.[1])}</div>
          </div>
        )}
        <div style={{background:'#f0fdf4', borderRadius:12, padding:'16px 18px', border:'1px solid #bbf7d0'}}>
          <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Categories</div>
          <div style={{fontSize:22,fontWeight:800,color:'#15803d'}}>{Object.keys(byCat).length}</div>
          <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>in use</div>
        </div>
      </div>

      {/* ── Category Breakdown Bar ── */}
      {total > 0 && topCats.length > 1 && (
        <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 18px',marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:13,color:'#0f172a',marginBottom:12}}>Spending by Category</div>
          {topCats.map(([cat, amt]) => {
            const pct = Math.round((amt/total)*100);
            const c   = CATEGORY_COLORS[cat] || CATEGORY_COLORS.Other;
            return (
              <div key={cat} style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,fontSize:12}}>
                  <span style={{fontWeight:600,color:'#0f172a'}}>{cat}</span>
                  <span style={{color:'#64748b'}}>{fmt(amt)} <span style={{color:'#94a3b8'}}>({pct}%)</span></span>
                </div>
                <div style={{height:6,borderRadius:99,background:'#f1f5f9',overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:99,background:c.color,width:`${pct}%`,transition:'width 0.5s'}}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Transactions List ── */}
      <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:10}}>All Transactions</div>
      {items.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 24px',color:'#94a3b8'}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No expenses recorded</div>
          <div style={{fontSize:12}}>The organisation hasn't logged any expenses yet.</div>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          {/* Column headers */}
          <div style={{
            display:'grid', gridTemplateColumns:'100px 1fr 90px 90px',
            padding:'9px 16px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0',
          }}>
            {['Date','Description','Category','Amount'].map((h,idx) => (
              <div key={h} style={{
                fontSize:11, fontWeight:700, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'0.06em',
                textAlign:idx===3?'right':'left',
              }}>{h}</div>
            ))}
          </div>

          {items.map((item, i) => (
            <div
              key={item.id}
              onClick={() => setSelected(item)}
              style={{
                display:'grid', gridTemplateColumns:'100px 1fr 90px 90px',
                padding:'11px 16px',
                background:i%2===0?'#fff':'#fafafa',
                borderBottom:'1px solid #f1f5f9',
                alignItems:'center', cursor:'pointer',
                transition:'background 0.12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background='#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}
            >
              <div style={{fontSize:12,color:'#475569'}}>{fmtDate(item.date)}</div>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{item.title}</div>
                {item.notes && <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{item.notes}</div>}
              </div>
              <div><CategoryBadge category={item.category} /></div>
              <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#dc2626'}}>{fmt(item.amount)}</div>
            </div>
          ))}

          {/* Footer total */}
          <div style={{
            display:'grid', gridTemplateColumns:'100px 1fr 90px 90px',
            padding:'10px 16px', background:'#fef2f2', borderTop:'2px solid #fca5a5',
          }}>
            <div style={{fontWeight:700,fontSize:13,color:'#0f172a',gridColumn:'1/4'}}>
              Total ({items.length} entries)
            </div>
            <div style={{textAlign:'right',fontWeight:800,fontSize:13,color:'#dc2626'}}>{fmt(total)}</div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}