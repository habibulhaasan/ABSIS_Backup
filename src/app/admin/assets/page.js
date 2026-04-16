// src/app/admin/assets/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

function fmt(n) { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

const ASSET_TYPES   = ['Real Estate','Vehicle','Equipment','Furniture','Electronics','Investment','Other'];
const ASSET_STATUSES = [
  {key:'active',   label:'Active',    color:'#14532d', bg:'#dcfce7', dot:'#16a34a'},
  {key:'disposed', label:'Disposed',  color:'#6b7280', bg:'#f3f4f6', dot:'#9ca3af'},
  {key:'damaged',  label:'Damaged',   color:'#92400e', bg:'#fef3c7', dot:'#f59e0b'},
];
const STATUS_MAP = Object.fromEntries(ASSET_STATUSES.map(s=>[s.key,s]));

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

function StatusBadge({status}) {
  const c=STATUS_MAP[status]||STATUS_MAP.active;
  return <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,background:c.bg,color:c.color}}><span style={{width:6,height:6,borderRadius:'50%',background:c.dot,display:'inline-block'}}/>{c.label}</span>;
}

const EMPTY = { name:'',type:'Real Estate',description:'',purchaseDate:'',purchasePrice:'',currentValue:'',registrationNo:'',location:'',insuranceType:'',insuranceExpiry:'',status:'active',notes:'' };

export default function AdminAssets() {
  const { user, userData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [assets,  setAssets]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [selected,setSelected]= useState(null);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState('');
  const [filter,  setFilter]  = useState('all');
  const [form,    setForm]    = useState(EMPTY);
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(
      query(collection(db,'organizations',orgId,'assets'),orderBy('createdAt','desc')),
      snap => { setAssets(snap.docs.map(d=>({id:d.id,...d.data()}))); setLoading(false); }
    );
  }, [orgId]);

  const handleSave = async () => {
    if (!form.name.trim()) return alert('Asset name is required.');
    setSaving(true);
    try {
      const payload = {...form, purchasePrice:Number(form.purchasePrice)||0, currentValue:Number(form.currentValue)||null };
      if (editing?.id) {
        await updateDoc(doc(db,'organizations',orgId,'assets',editing.id),{...payload,updatedAt:serverTimestamp()});
        showToast('✅ Asset updated!');
      } else {
        await addDoc(collection(db,'organizations',orgId,'assets'),{...payload,createdBy:user.uid,createdAt:serverTimestamp()});
        showToast('✅ Asset added!');
      }
      setEditing(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleDelete = async (asset) => {
    if (!confirm(`Delete "${asset.name}"?`)) return;
    try { await deleteDoc(doc(db,'organizations',orgId,'assets',asset.id)); setSelected(null); showToast('Deleted.'); }
    catch(e) { showToast('Error: '+e.message); }
  };

  if (!isOrgAdmin) return null;

  const active   = assets.filter(a=>a.status==='active');
  const totalPurchase = active.reduce((s,a)=>s+(a.purchasePrice||0),0);
  const totalCurrent  = active.reduce((s,a)=>s+(a.currentValue||a.purchasePrice||0),0);
  const filtered = filter==='all'?assets:assets.filter(a=>a.status===filter);

  const openNew  = () => { setForm({...EMPTY}); setEditing({}); };
  const openEdit = (a) => { setForm({name:a.name,type:a.type,description:a.description||'',purchaseDate:a.purchaseDate||'',purchasePrice:a.purchasePrice??'',currentValue:a.currentValue??'',registrationNo:a.registrationNo||'',location:a.location||'',insuranceType:a.insuranceType||'',insuranceExpiry:a.insuranceExpiry||'',status:a.status||'active',notes:a.notes||''}); setEditing(a); setSelected(null); };

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Asset Registry</div>
            <div className="page-subtitle">Track organization-owned assets, valuations, and insurance.</div>
          </div>
          <button onClick={openNew} className="btn-primary" style={{padding:'10px 20px',flexShrink:0}}>+ Add Asset</button>
        </div>
      </div>

      {toast && <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>{toast}</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:24}}>
        <Stat label="Active Assets"      value={active.length}           bg="#f8fafc"/>
        <Stat label="Purchase Value"     value={fmt(totalPurchase)}      color="#92400e" bg="#fef3c7"/>
        <Stat label="Current Value"      value={fmt(totalCurrent)}       color="#15803d" bg="#f0fdf4"
          sub={totalCurrent>totalPurchase?`+${fmt(totalCurrent-totalPurchase)} appreciation`:totalCurrent<totalPurchase?`-${fmt(totalPurchase-totalCurrent)} depreciation`:undefined}/>
        <Stat label="Disposed / Damaged" value={assets.filter(a=>a.status!=='active').length} bg="#f8fafc"/>
      </div>

      {/* Filter */}
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {[['all','All',assets.length],...ASSET_STATUSES.map(s=>[s.key,s.label,assets.filter(a=>a.status===s.key).length])].map(([key,label,count])=>(
          <button key={key} onClick={()=>setFilter(key)}
            style={{padding:'6px 14px',borderRadius:99,fontSize:12,cursor:'pointer',fontWeight:filter===key?700:400,border:'none',background:filter===key?'#0f172a':'#f1f5f9',color:filter===key?'#fff':'#64748b'}}>
            {label} {count>0&&<span style={{opacity:0.7}}>({count})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'60px'}}>
          <div style={{fontSize:36,marginBottom:10}}>🏢</div>
          <div style={{fontWeight:600,color:'#0f172a',marginBottom:4}}>No assets yet</div>
          <button onClick={openNew} className="btn-primary" style={{padding:'10px 24px',marginTop:8}}>+ Add Asset</button>
        </div>
      ) : (
        <div style={{borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',padding:'9px 16px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {['Asset','Type','Status','Purchase Value','Current Value'].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em',textAlign:h==='Asset'?'left':'right'}}>{h}</div>
            ))}
          </div>
          {filtered.map((a,i)=>(
            <div key={a.id} onClick={()=>setSelected(a)} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',padding:'11px 16px',background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f1f5f9',cursor:'pointer',alignItems:'center'}}
              onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
              onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{a.name}</div>
                {a.location && <div style={{fontSize:11,color:'#94a3b8'}}>{a.location}</div>}
              </div>
              <div style={{textAlign:'right',fontSize:12,color:'#475569'}}>{a.type}</div>
              <div style={{textAlign:'right'}}><StatusBadge status={a.status}/></div>
              <div style={{textAlign:'right',fontWeight:600,fontSize:13,color:'#92400e'}}>{fmt(a.purchasePrice)}</div>
              <div style={{textAlign:'right',fontWeight:700,fontSize:13,color:'#15803d'}}>{a.currentValue!=null?fmt(a.currentValue):'—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && !editing && (
        <Modal title={selected.name} onClose={()=>setSelected(null)}>
          <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
            <span style={{padding:'3px 10px',borderRadius:6,background:'#f1f5f9',color:'#475569',fontSize:12,fontWeight:700}}>{selected.type}</span>
            <StatusBadge status={selected.status}/>
          </div>
          {selected.description && <p style={{fontSize:13,color:'#475569',marginBottom:16,padding:'10px 12px',background:'#f8fafc',borderRadius:8}}>{selected.description}</p>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <Stat label="Purchase Value" value={fmt(selected.purchasePrice)} color="#92400e" bg="#fef3c7"/>
            {selected.currentValue!=null && <Stat label="Current Value" value={fmt(selected.currentValue)} color="#15803d" bg="#f0fdf4"/>}
            {selected.purchaseDate && <Stat label="Purchase Date" value={selected.purchaseDate} bg="#f8fafc"/>}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13,color:'#475569'}}>
            {selected.registrationNo && <div>📋 Registration: <strong>{selected.registrationNo}</strong></div>}
            {selected.location       && <div>📍 Location: <strong>{selected.location}</strong></div>}
            {selected.insuranceType  && <div>🛡 Insurance: <strong>{selected.insuranceType}</strong>{selected.insuranceExpiry&&` (expires ${selected.insuranceExpiry})`}</div>}
            {selected.notes          && <div style={{padding:'8px 12px',background:'#fffbeb',borderRadius:8,color:'#78350f'}}>📝 {selected.notes}</div>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={()=>openEdit(selected)} className="btn-primary" style={{padding:'10px 20px'}}>Edit</button>
            <button onClick={()=>handleDelete(selected)} style={{padding:'10px 20px',borderRadius:8,border:'1px solid #fca5a5',background:'#fff',cursor:'pointer',fontSize:13,color:'#dc2626'}}>Delete</button>
            <button onClick={()=>setSelected(null)} style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b',marginLeft:'auto'}}>Close</button>
          </div>
        </Modal>
      )}

      {/* Form modal */}
      {editing && (
        <Modal title={editing?.id?'Edit Asset':'Add Asset'} onClose={()=>setEditing(null)}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{gridColumn:'1/-1'}}>
                <label className="form-label">Asset Name *</label>
                <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Office Building, Toyota Hilux"/>
              </div>
              <div>
                <label className="form-label">Type</label>
                <select value={form.type} onChange={e=>set('type',e.target.value)}>
                  {ASSET_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select value={form.status} onChange={e=>set('status',e.target.value)}>
                  {ASSET_STATUSES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Purchase Price (৳)</label>
                <input type="number" min="0" value={form.purchasePrice} onChange={e=>set('purchasePrice',e.target.value)} placeholder="0"/>
              </div>
              <div>
                <label className="form-label">Current Value (৳)</label>
                <input type="number" min="0" value={form.currentValue} onChange={e=>set('currentValue',e.target.value)} placeholder="Leave blank if same as purchase"/>
              </div>
              <div>
                <label className="form-label">Purchase Date</label>
                <input type="date" value={form.purchaseDate} onChange={e=>set('purchaseDate',e.target.value)}/>
              </div>
              <div>
                <label className="form-label">Location</label>
                <input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="e.g. Dhaka Office"/>
              </div>
              <div>
                <label className="form-label">Registration No.</label>
                <input value={form.registrationNo} onChange={e=>set('registrationNo',e.target.value)} placeholder="Optional"/>
              </div>
              <div>
                <label className="form-label">Insurance Type</label>
                <input value={form.insuranceType} onChange={e=>set('insuranceType',e.target.value)} placeholder="e.g. Comprehensive"/>
              </div>
              <div>
                <label className="form-label">Insurance Expiry</label>
                <input type="date" value={form.insuranceExpiry} onChange={e=>set('insuranceExpiry',e.target.value)}/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label className="form-label">Description / Notes</label>
                <textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={2} placeholder="Optional description"/>
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:10,marginTop:20,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{padding:'10px 24px'}}>{saving?'Saving…':editing?.id?'Save Changes':'Add Asset'}</button>
            <button onClick={()=>setEditing(null)} style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
