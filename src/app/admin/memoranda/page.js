// src/app/admin/memoranda/page.js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

// ── GAS upload config ─────────────────────────────────────────────────────────
const GAS_URL    = "https://script.google.com/macros/s/AKfycbymijcqicl0oQoYZsCA5B1UjtqmJAsWDM-KQqvQzmaGZeD7GK8j2y9w8tZ6lr0c0H4A/exec";
const GAS_SECRET = "absis-secret-123";

function toBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.readAsDataURL(file);
    r.onload=()=>res(r.result); r.onerror=rej; });
}
async function uploadMemoAttachment(file) {
  const b64 = await toBase64(file);
  const res = await fetch(GAS_URL,{method:'POST',body:JSON.stringify({
    action:'upload',secret:GAS_SECRET,
    file:b64.split(',')[1],fileName:file.name,mimeType:file.type,
  })});
  const d = await res.json();
  if (!d.success) throw new Error(d.error||'Upload failed');
  return d; // { fileId, url, name }
}
async function deleteMemoAttachment(fileId) {
  if (!fileId) return;
  await fetch(GAS_URL,{method:'POST',body:JSON.stringify({
    action:'delete',secret:GAS_SECRET,fileId,
  })}).catch(()=>{});
}

// ── Bangla font + print CSS ──────────────────────────────────────────────────
const BANGLA_CSS = `
  @import url('https://fonts.maateen.me/solaiman-lipi/font.css');
  .bn { font-family: 'SolaimanLipi', 'Noto Sans Bengali', sans-serif; }
`;
const ADMIN_PRINT_CSS = `
  @media print {
    body * { visibility: hidden !important; }
    #admin-memo-print, #admin-memo-print * { visibility: visible !important; }
    #admin-memo-print { position: fixed !important; top: 0; left: 0; width: 100%;
      font-family: 'SolaimanLipi', 'Times New Roman', serif; }
    .no-print { display: none !important; }
    @page { margin: 15mm 18mm; }
  }
  @import url('https://fonts.maateen.me/solaiman-lipi/font.css');
  .bn { font-family: 'SolaimanLipi', 'Noto Sans Bengali', sans-serif; }
`;

// ── Category config ───────────────────────────────────────────────────────────
const CATS = {
  NOT: { label:'Notice / Circular',       labelBn:'নোটিশ ও সার্কুলার',     color:'#1d4ed8', bg:'#eff6ff'  },
  MIN: { label:'Meeting Minutes',          labelBn:'সভার কার্যবিবরণী',       color:'#15803d', bg:'#f0fdf4'  },
  FIN: { label:'Financial Report',         labelBn:'আর্থিক রিপোর্ট',         color:'#92400e', bg:'#fef3c7'  },
  INV: { label:'Investment',               labelBn:'বিনিয়োগ সংক্রান্ত',      color:'#7c3aed', bg:'#faf5ff'  },
  MEM: { label:'Membership',              labelBn:'সদস্যপদ সংক্রান্ত',      color:'#0369a1', bg:'#f0f9ff'  },
  LTR: { label:'Letter / Application',    labelBn:'চিঠিপত্র ও আবেদন',      color:'#b45309', bg:'#fffbeb'  },
  COM: { label:'Committee Order',         labelBn:'কমিটি আদেশ ও সিদ্ধান্ত', color:'#be185d', bg:'#fdf2f8'  },
  SHR: { label:"Shari'ah Opinion",        labelBn:'শরীআহ মতামত',            color:'#064e3b', bg:'#ecfdf5'  },
};

const STATUS_CFG = {
  draft:    { label:'Draft',    bg:'#f1f5f9', color:'#475569', dot:'#94a3b8' },
  issued:   { label:'Issued',   bg:'#dcfce7', color:'#15803d', dot:'#16a34a' },
  archived: { label:'Archived', bg:'#f3f4f6', color:'#6b7280', dot:'#9ca3af' },
};

function fmt(ts) {
  if (!ts) return '—';
  const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}

function CatBadge({ code }) {
  const c = CATS[code] || { label:code, color:'#475569', bg:'#f1f5f9' };
  return (
    <span style={{ padding:'2px 8px', borderRadius:5, fontSize:11, fontWeight:700,
      background:c.bg, color:c.color, whiteSpace:'nowrap' }}>
      {code} · {c.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_CFG[status] || STATUS_CFG.draft;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px',
      borderRadius:99, fontSize:11, fontWeight:700, background:s.bg, color:s.color }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:s.dot, display:'inline-block' }}/>
      {s.label}
    </span>
  );
}

// ── Memo number generator ─────────────────────────────────────────────────────
function nextMemoNo(memos, category, year, orgCode) {
  const prefix = orgCode || 'ORG';
  const existing = memos
    .filter(m => m.category === category && m.year === year)
    .map(m => {
      const parts = (m.memoNo||'').split('/');
      return parseInt(parts[parts.length-1])||0;
    });
  const next = existing.length ? Math.max(...existing)+1 : 1;
  return `${prefix}/${category}/${year}/${String(next).padStart(3,'0')}`;
}

// ── Memo file attach component ───────────────────────────────────────────────
function MemoFileAttach({ fileId, fileName, fileUrl, onAttached, onRemove }) {
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const ref = useRef(null);

  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50*1024*1024) { setError('Max 50 MB'); return; }
    setUploading(true); setError('');
    try {
      const data = await uploadMemoAttachment(file);
      onAttached(data.fileId, data.url, data.name||file.name);
    } catch(err) { setError(err.message); }
    setUploading(false);
    if (ref.current) ref.current.value='';
  };

  return (
    <div>
      <label className="form-label">Attachment</label>
      {fileId ? (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
          borderRadius:8,border:'1px solid #e2e8f0',background:'#f0fdf4'}}>
          <span style={{fontSize:20}}>📎</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:'#0f172a',
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {fileName||'Attached file'}
            </div>
            <a href={`https://drive.google.com/file/d/${fileId}/view`}
              target="_blank" rel="noreferrer"
              style={{fontSize:11,color:'#2563eb'}}>View in Drive ↗</a>
          </div>
          <button onClick={()=>{deleteMemoAttachment(fileId);onRemove();}}
            style={{padding:'4px 10px',borderRadius:6,border:'1px solid #fca5a5',
              background:'#fff',color:'#dc2626',fontSize:12,cursor:'pointer'}}>
            Remove
          </button>
        </div>
      ) : (
        <div>
          <div onClick={()=>ref.current?.click()}
            style={{border:'2px dashed #cbd5e1',borderRadius:8,padding:'14px',
              textAlign:'center',cursor:'pointer',background:'#f8fafc',transition:'border 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#2563eb'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='#cbd5e1'}>
            {uploading ? (
              <span style={{fontSize:13,color:'#64748b'}}>⏳ Uploading…</span>
            ) : (
              <span style={{fontSize:13,color:'#64748b'}}>
                📎 Click to attach a file <span style={{fontSize:11}}>(optional · max 50 MB)</span>
              </span>
            )}
          </div>
          {error && <div style={{fontSize:12,color:'#dc2626',marginTop:4}}>{error}</div>}
        </div>
      )}
      <input ref={ref} type="file" style={{display:'none'}} onChange={handlePick}/>
    </div>
  );
}

// ── Form Modal ────────────────────────────────────────────────────────────────
function MemoModal({ memo, memos, orgCode, onClose, onSave, saving }) {
  const isEdit = !!memo?.id;
  const year   = new Date().getFullYear();

  const [form, setForm] = useState({
    category:         memo?.category        || 'NOT',
    year:             memo?.year            || year,
    date:             memo?.date            || new Date().toISOString().split('T')[0],
    title:            memo?.title           || '',
    content:          memo?.content         || '',
    sender:           memo?.sender          || '',
    recipient:        memo?.recipient       || '',
    preparedBy:       memo?.preparedBy      || '',
    approvedBy:       memo?.approvedBy      || '',
    status:           memo?.status          || 'draft',
    visibleToMembers: memo?.visibleToMembers ?? false,
    fileUrl:          memo?.fileUrl         || '',
    fileId:           memo?.fileId          || '',
    fileName:         memo?.fileName        || '',
    notes:            memo?.notes           || '',
  });
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const autoNo = isEdit ? memo.memoNo
    : nextMemoNo(memos, form.category, Number(form.year), orgCode);

  return (
    <Modal title={isEdit ? `Edit — ${memo.memoNo}` : 'New Memorandum'} onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
        {/* Memo number preview */}
        <div style={{ padding:'8px 12px', borderRadius:8, background:'#f0f9ff',
          border:'1px solid #bae6fd', fontSize:13 }}>
          <span style={{ color:'#64748b' }}>Memo No: </span>
          <strong style={{ color:'#1d4ed8', fontFamily:'monospace' }}>{autoNo}</strong>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label className="form-label">Category *</label>
            <select value={form.category} onChange={e=>set('category',e.target.value)} disabled={isEdit}>
              {Object.entries(CATS).map(([k,v])=>(
                <option key={k} value={k}>{k} — {v.labelBn}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Year *</label>
            <input type="number" value={form.year} onChange={e=>set('year',Number(e.target.value))}
              min={2020} max={2099} disabled={isEdit}/>
          </div>
          <div>
            <label className="form-label">Date *</label>
            <input type="date" value={form.date} onChange={e=>set('date',e.target.value)}/>
          </div>
          <div>
            <label className="form-label">Status</label>
            <select value={form.status} onChange={e=>set('status',e.target.value)}>
              {Object.entries(STATUS_CFG).map(([k,v])=>(
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="form-label">Title / Subject *</label>
          <input value={form.title} onChange={e=>set('title',e.target.value)}
            placeholder="Brief title of this memorandum"/>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label className="form-label">Sender / Issuer</label>
            <input value={form.sender} onChange={e=>set('sender',e.target.value)}
              placeholder="e.g. Committee, President"/>
          </div>
          <div>
            <label className="form-label">Recipient</label>
            <input value={form.recipient} onChange={e=>set('recipient',e.target.value)}
              placeholder="e.g. All Members, Secretary"/>
          </div>
          <div>
            <label className="form-label">Prepared By</label>
            <input value={form.preparedBy} onChange={e=>set('preparedBy',e.target.value)}/>
          </div>
          <div>
            <label className="form-label">Approved By</label>
            <input value={form.approvedBy} onChange={e=>set('approvedBy',e.target.value)}/>
          </div>
        </div>

        <div>
          <label className="form-label">Content / Body</label>
          <textarea value={form.content} onChange={e=>set('content',e.target.value)}
            rows={5} placeholder="Full text of the memorandum…"/>
        </div>

        {/* File attachment via GAS */}
        <MemoFileAttach
          fileId={form.fileId}
          fileName={form.fileName}
          fileUrl={form.fileUrl}
          onAttached={(fileId,fileUrl,fileName)=>{
            set('fileId',fileId); set('fileUrl',fileUrl); set('fileName',fileName);
          }}
          onRemove={()=>{set('fileId','');set('fileUrl','');set('fileName','');}}
        />

        <div>
          <label className="form-label">Internal Notes</label>
          <input value={form.notes} onChange={e=>set('notes',e.target.value)}
            placeholder="Admin-only notes"/>
        </div>

        {/* Visibility toggle */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
          borderRadius:8, background:'#f8fafc', border:'1px solid #e2e8f0' }}>
          <input type="checkbox" id="vis" checked={form.visibleToMembers}
            onChange={e=>set('visibleToMembers',e.target.checked)}
            style={{ width:16, height:16, cursor:'pointer' }}/>
          <label htmlFor="vis" style={{ fontSize:13, color:'#0f172a', cursor:'pointer', flex:1 }}>
            <strong>Visible to members</strong>
            <span style={{ fontSize:11, color:'#64748b', display:'block' }}>
              Members will see this in their Notices page
            </span>
          </label>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginTop:20, paddingTop:20,
        borderTop:'1px solid #e2e8f0' }}>
        <button onClick={() => onSave(form, autoNo, isEdit ? memo.id : null)}
          disabled={saving || !form.title.trim()}
          className="btn-primary" style={{ padding:'10px 24px' }}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Memo'}
        </button>
        <button onClick={onClose}
          style={{ padding:'10px 20px', borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', cursor:'pointer', fontSize:13, color:'#64748b' }}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ── Letterhead preview portal ────────────────────────────────────────────────
function LetterheadPreview({ memo, orgData, onClose }) {
  const org = orgData || {};
  const c   = CATS[memo.category] || { color:'#475569', bg:'#f1f5f9' };

  if (typeof document === 'undefined') return null;

  const fmtDateBn = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('bn-BD',
        {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/,/g,'');
    } catch { return dateStr; }
  };

  return createPortal(
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,0.7)',
        display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <style>{ADMIN_PRINT_CSS}</style>

      <div style={{background:'#fff',borderRadius:14,
        width:'min(760px,100%)',height:'calc(100dvh - 32px)',
        display:'flex',flexDirection:'column',overflow:'hidden',
        boxShadow:'0 32px 80px rgba(0,0,0,0.4)'}}>

        {/* Controls */}
        <div className="no-print" style={{display:'flex',alignItems:'center',gap:8,
          padding:'10px 14px',borderBottom:'1px solid #e2e8f0',flexShrink:0,
          background:'#f8fafc'}}>
          <span style={{fontSize:13,fontWeight:700,color:'#0f172a',flex:1}}>
            Letterhead Preview — {memo.memoNo}
          </span>
          <button onClick={()=>window.print()}
            style={{padding:'6px 16px',borderRadius:8,background:'#0f172a',
              color:'#fff',border:'none',cursor:'pointer',fontSize:12,fontWeight:700}}>
            🖨 Print / PDF
          </button>
          <button onClick={onClose}
            style={{width:32,height:32,borderRadius:8,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:16,color:'#64748b',
              display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>

        {/* Scrollable print area */}
        <div style={{flex:1,minHeight:0,overflowY:'auto',background:'#f0f0f0',padding:20}}>
          <div id="admin-memo-print"
            style={{background:'#fff',maxWidth:700,margin:'0 auto',
              padding:'28px 32px',
              fontFamily:"'SolaimanLipi','Times New Roman',serif",
              boxShadow:'0 2px 12px rgba(0,0,0,0.1)'}}>

            {/* Letterhead */}
            <div style={{borderBottom:'2.5px solid #000',paddingBottom:14,marginBottom:18,
              display:'flex',alignItems:'flex-start',gap:16}}>
              {org.logoURL && (
                <img src={org.logoURL} alt=""
                  style={{width:72,height:72,objectFit:'contain',flexShrink:0,
                    mixBlendMode:'multiply',filter:'contrast(1.1)'}}/>
              )}
              <div style={{flex:1}}>
                <div style={{fontSize:20,fontWeight:900,color:'#000',lineHeight:1.2,
                  fontFamily:"'SolaimanLipi','Arial',sans-serif"}}>
                  {org.name_bn || org.name || 'Organization'}
                </div>
                {(org.name_en && org.name_bn) && (
                  <div style={{fontSize:12,color:'#555',marginTop:1}}>
                    {org.name_en || org.name}
                  </div>
                )}
                {org.slogan && (
                  <div className="bn" style={{fontSize:11,color:'#555',
                    fontStyle:'italic',marginTop:3}}>{org.slogan}</div>
                )}
                <div style={{marginTop:5,fontSize:10.5,color:'#333',
                  display:'flex',flexWrap:'wrap',gap:'3px 14px'}}>
                  {org.email   && <span>✉ {org.email}</span>}
                  {org.phone   && <span>☎ {org.phone}</span>}
                  {org.website && <span>🌐 {org.website}</span>}
                </div>
              </div>
            </div>

            {/* Memo ref + date */}
            <div style={{display:'flex',justifyContent:'space-between',
              marginBottom:16,fontSize:11,color:'#444'}}>
              <span>
                <strong>স্মারক নং:</strong>{' '}
                <span style={{fontFamily:'monospace',color:'#1d4ed8',fontWeight:700}}>
                  {memo.memoNo}
                </span>
              </span>
              <span>
                <strong>তারিখ:</strong>{' '}
                {memo.date ? fmtDateBn(memo.date) : fmt(memo.createdAt)}
              </span>
            </div>

            {/* Category banner */}
            <div style={{textAlign:'center',marginBottom:16}}>
              <div style={{display:'inline-block',padding:'4px 20px',borderRadius:4,
                background:c.bg,border:`1px solid ${c.color}44`,
                fontSize:11,fontWeight:700,color:c.color,
                letterSpacing:'0.06em',textTransform:'uppercase'}}>
                {CATS[memo.category]?.labelBn || memo.category}
              </div>
            </div>

            {/* Title */}
            <div style={{textAlign:'center',marginBottom:20}}>
              <div className="bn" style={{fontSize:16,fontWeight:900,color:'#000',
                borderBottom:'1px solid #ccc',paddingBottom:8,
                display:'inline-block',minWidth:'60%',
                fontFamily:"'SolaimanLipi','Arial',sans-serif"}}>
                {memo.title}
              </div>
            </div>

            {/* Body */}
            {memo.content && (
              <div className="bn" style={{fontSize:13,color:'#111',lineHeight:1.9,
                marginBottom:20,whiteSpace:'pre-wrap',
                padding:'12px 0',borderTop:'1px solid #eee',borderBottom:'1px solid #eee'}}>
                {memo.content}
              </div>
            )}

            {/* Attachment (hidden on print) */}
            {memo.fileId && (
              <div className="no-print" style={{marginBottom:16}}>
                <a href={`https://drive.google.com/file/d/${memo.fileId}/view`}
                  target="_blank" rel="noreferrer"
                  style={{display:'inline-flex',alignItems:'center',gap:6,
                    padding:'8px 14px',borderRadius:8,background:'#eff6ff',
                    color:'#1d4ed8',textDecoration:'none',fontSize:13,fontWeight:600}}>
                  📎 View Attachment ↗
                </a>
              </div>
            )}

            {/* Signature */}
            {memo.approvedBy && (
              <div style={{marginTop:36,display:'flex',justifyContent:'flex-end',
                fontSize:10.5,color:'#555'}}>
                <div style={{textAlign:'center',minWidth:160}}>
                  <div style={{borderTop:'1px solid #aaa',paddingTop:4,marginTop:24}}>
                    {memo.approvedBy}<br/>
                    <span style={{color:'#888'}}>{org.name_bn||org.name||'Organization'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{marginTop:32,paddingTop:8,borderTop:'1px solid #ddd',
              display:'flex',justifyContent:'space-between',fontSize:8.5,color:'#888'}}>
              <span>{org.name_bn||org.name||'Organization'}</span>
              <span>{memo.memoNo} | {memo.date||fmt(memo.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Detail view modal ─────────────────────────────────────────────────────────
function DetailModal({ memo, orgData, onClose, onEdit, onDelete, onToggleVisibility, saving, canWrite }) {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <Modal title={memo.memoNo} onClose={onClose}>
      {/* Header row */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16, alignItems:'center' }}>
        <CatBadge code={memo.category}/>
        <StatusBadge status={memo.status}/>
        <span style={{ fontSize:12, color:'#94a3b8' }}>{fmt(memo.createdAt)}</span>
        <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6,
          padding:'4px 10px', borderRadius:8, fontSize:12, fontWeight:600,
          background: memo.visibleToMembers ? '#dcfce7' : '#f1f5f9',
          color: memo.visibleToMembers ? '#15803d' : '#64748b' }}>
          {memo.visibleToMembers ? '👁 Visible to members' : '🔒 Admin only'}
        </span>
      </div>

      <div style={{ fontWeight:700, fontSize:15, color:'#0f172a', marginBottom:10 }}>
        {memo.title}
      </div>

      {memo.content && (
        <div style={{ padding:'12px 14px', borderRadius:8, background:'#f8fafc',
          border:'1px solid #e2e8f0', fontSize:13, color:'#475569',
          lineHeight:1.7, marginBottom:14, whiteSpace:'pre-wrap' }}>
          {memo.content}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
        {[
          ['Date',        memo.date],
          ['Sender',      memo.sender],
          ['Recipient',   memo.recipient],
          ['Prepared By', memo.preparedBy],
          ['Approved By', memo.approvedBy],
        ].filter(([,v])=>v).map(([l,v])=>(
          <div key={l} style={{ background:'#f8fafc', borderRadius:7, padding:'8px 10px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
              textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{l}</div>
            <div style={{ fontSize:12, color:'#0f172a' }}>{v}</div>
          </div>
        ))}
      </div>

      {memo.fileId && (
        <div style={{marginBottom:12,display:'flex',alignItems:'center',gap:10,
          padding:'8px 12px',borderRadius:8,background:'#eff6ff',border:'1px solid #bfdbfe'}}>
          <span style={{fontSize:18}}>📎</span>
          <div style={{flex:1,fontSize:13,color:'#1d4ed8',fontWeight:600}}>
            {memo.fileName||'Attached document'}
          </div>
          <a href={`https://drive.google.com/file/d/${memo.fileId}/view`}
            target="_blank" rel="noreferrer"
            style={{padding:'4px 10px',borderRadius:6,background:'#1d4ed8',
              color:'#fff',fontSize:12,fontWeight:700,textDecoration:'none'}}>
            ↗ Open
          </a>
        </div>
      )}
      {!memo.fileId && memo.fileUrl && (
        <a href={memo.fileUrl} target="_blank" rel="noreferrer"
          style={{display:'block',padding:'8px 12px',borderRadius:8,
            background:'#eff6ff',color:'#1d4ed8',fontSize:13,fontWeight:600,
            textDecoration:'none',marginBottom:12}}>
          📎 Open Attached File ↗
        </a>
      )}

      {memo.notes && (
        <div style={{ padding:'8px 12px', borderRadius:8, background:'#fffbeb',
          border:'1px solid #fde68a', fontSize:12, color:'#92400e' }}>
          📝 {memo.notes}
        </div>
      )}

      {showPreview && (
        <LetterheadPreview
          memo={memo}
          orgData={orgData}
          onClose={() => setShowPreview(false)}
        />
      )}

      <div style={{ display:'flex', gap:8, marginTop:20, paddingTop:16,
        borderTop:'1px solid #e2e8f0', flexWrap:'wrap' }}>
        <button onClick={() => setShowPreview(true)}
          style={{ padding:'8px 16px', borderRadius:8, border:'none',
            background:'#0f172a', color:'#fff', cursor:'pointer', fontSize:13, fontWeight:600 }}>
          🖨 Preview with Letterhead
        </button>
        {canWrite && (
          <button onClick={() => onToggleVisibility(memo)} disabled={saving}
            style={{ padding:'8px 16px', borderRadius:8, fontSize:13, fontWeight:600,
              cursor:'pointer', border:'none',
              background: memo.visibleToMembers ? '#fef3c7' : '#dcfce7',
              color:      memo.visibleToMembers ? '#92400e' : '#15803d' }}>
            {memo.visibleToMembers ? '🔒 Hide from Members' : '👁 Show to Members'}
          </button>
        )}
        {canWrite && (
          <button onClick={() => onEdit(memo)} className="btn-primary"
            style={{ padding:'8px 16px' }}>
            ✏️ Edit
          </button>
        )}
        {canWrite && (
          <button onClick={() => onDelete(memo)}
            style={{ padding:'8px 14px', borderRadius:8, border:'1px solid #fca5a5',
              background:'#fff', cursor:'pointer', fontSize:13, color:'#dc2626' }}>
            Delete
          </button>
        )}
        <button onClick={onClose}
          style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', cursor:'pointer', fontSize:13, color:'#64748b',
            marginLeft:'auto' }}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminMemoranda() {
  const { user, userData, orgData, isOrgAdmin, isOfficeSecretary, isSecretary } = useAuth();
  const orgId   = userData?.activeOrgId;
  const orgCode = orgData?.settings?.memoOrgCode || 'ABSIS';

  const [memos,    setMemos]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [catFilter,setCatFilter]= useState('all');
  const [yearFilter,setYearFilter]= useState(String(new Date().getFullYear()));
  const [statusFilter,setStatusFilter]= useState('all');
  const [search,   setSearch]   = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  // ONE fetch on load — all memos, filter client-side
  useEffect(() => {
    if (!orgId) return;
    getDocs(query(
      collection(db,'organizations',orgId,'memoranda'),
      orderBy('createdAt','desc')
    )).then(snap => {
      setMemos(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    });
  }, [orgId]);

  const handleSave = useCallback(async (form, memoNo, editId) => {
    setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db,'organizations',orgId,'memoranda',editId), {
          ...form, updatedAt: serverTimestamp(),
        });
        setMemos(prev => prev.map(m => m.id===editId ? {...m,...form} : m));
        setSelected(prev => prev?.id===editId ? {...prev,...form} : prev);
        showToast('✅ Memo updated!');
      } else {
        const ref = await addDoc(collection(db,'organizations',orgId,'memoranda'), {
          ...form, memoNo, createdBy: user.uid, createdAt: serverTimestamp(),
        });
        const newMemo = { id:ref.id, ...form, memoNo,
          createdAt:{seconds:Date.now()/1000} };
        setMemos(prev => [newMemo, ...prev]);
        showToast('✅ Memo created!');
      }
      setEditing(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  }, [orgId, user?.uid]);

  const handleDelete = useCallback(async (memo) => {
    if (!confirm(`Delete "${memo.memoNo}"?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db,'organizations',orgId,'memoranda',memo.id));
      setMemos(prev => prev.filter(m => m.id !== memo.id));
      setSelected(null);
      showToast('Deleted.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  }, [orgId]);

  const handleToggleVisibility = useCallback(async (memo) => {
    const val = !memo.visibleToMembers;
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'memoranda',memo.id),
        { visibleToMembers: val });
      setMemos(prev => prev.map(m => m.id===memo.id ? {...m,visibleToMembers:val} : m));
      setSelected(prev => prev?.id===memo.id ? {...prev,visibleToMembers:val} : prev);
      showToast(val ? '✅ Now visible to members' : '🔒 Hidden from members');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  }, [orgId]);

  const router = useRouter();
  if (!isOrgAdmin && !isSecretary) { router.replace('/dashboard'); return null; }
  // Office secretary: full access. Joint secretary: read-only (cannot create/edit/delete).
  const canWrite = isOrgAdmin || isOfficeSecretary;

  // Client-side filtering — no extra reads
  const years = [...new Set(memos.map(m=>String(m.year)))].sort((a,b)=>b-a);
  const filtered = memos.filter(m => {
    if (catFilter !== 'all' && m.category !== catFilter) return false;
    if (yearFilter && String(m.year) !== yearFilter) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (search && !m.title?.toLowerCase().includes(search.toLowerCase())
      && !m.memoNo?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const visibleCount = memos.filter(m=>m.visibleToMembers).length;

  return (
    <div className="page-wrap animate-fade">
      {isSecretary && !canWrite && (
        <div style={{ padding:'10px 14px', borderRadius:8, background:'#eff6ff',
          border:'1px solid #bfdbfe', fontSize:12, color:'#1e40af', marginBottom:12 }}>
          👁 <strong>View-only access</strong> — Joint Secretaries can read memoranda but cannot create, edit, or delete them.
        </div>
      )}

      <div className="page-header">
        <div style={{ display:'flex', justifyContent:'space-between',
          alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
          <div>
            <div className="page-title">Memoranda Register</div>
            <div className="page-subtitle">
              {memos.length} records · {visibleCount} visible to members.
              Memo format: {orgCode}/[CODE]/[YEAR]/[NO]
            </div>
          </div>
          {canWrite && (
            <button onClick={() => setEditing({})} className="btn-primary"
              style={{ padding:'10px 20px', flexShrink:0 }}>
              + New Memo
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div style={{ padding:'10px 16px', borderRadius:8, marginBottom:16,
          fontSize:13, fontWeight:600,
          background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',
          color:toast.startsWith('Error')?'#b91c1c':'#15803d' }}>
          {toast}
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search title or memo no…"
          style={{ flex:1, minWidth:180, padding:'8px 12px', borderRadius:8,
            border:'1px solid #e2e8f0', fontSize:13 }}/>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
          style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0',
            fontSize:13, color:'#475569' }}>
          <option value="all">All Categories</option>
          {Object.entries(CATS).map(([k,v])=>(
            <option key={k} value={k}>{k} — {v.labelBn}</option>
          ))}
        </select>
        <select value={yearFilter} onChange={e=>setYearFilter(e.target.value)}
          style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0',
            fontSize:13, color:'#475569' }}>
          <option value="">All Years</option>
          {[...new Set([String(new Date().getFullYear()), ...years])].sort((a,b)=>b-a).map(y=>(
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
          style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0',
            fontSize:13, color:'#475569' }}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_CFG).map(([k,v])=>(
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'60px', color:'#94a3b8' }}>Loading…</div>
      ) : filtered.length===0 ? (
        <div style={{ textAlign:'center', padding:'60px' }}>
          <div style={{ fontSize:36, marginBottom:10 }}>📋</div>
          <div style={{ fontWeight:600, color:'#0f172a', marginBottom:4 }}>No memoranda yet</div>
          <button onClick={()=>setEditing({})} className="btn-primary"
            style={{ padding:'10px 24px', marginTop:8 }}>
            + Create First Memo
          </button>
        </div>
      ) : (
        <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:'1.5fr 3fr 1fr 1fr 1fr',
            padding:'9px 16px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
            {['Memo No.','Title','Category','Status','Visibility'].map(h=>(
              <div key={h} style={{ fontSize:11, fontWeight:700, color:'#64748b',
                textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</div>
            ))}
          </div>
          {filtered.map((m,i) => (
            <div key={m.id}
              onClick={()=>setSelected(m)}
              style={{ display:'grid', gridTemplateColumns:'1.5fr 3fr 1fr 1fr 1fr',
                padding:'11px 16px', cursor:'pointer', alignItems:'center',
                background:i%2===0?'#fff':'#fafafa',
                borderBottom:'1px solid #f1f5f9',
                transition:'background 0.1s' }}
              onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
              onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}>
              <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:600,
                color:'#1d4ed8' }}>{m.memoNo}</div>
              <div>
                <div style={{ fontWeight:600, fontSize:13, color:'#0f172a',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {m.title}
                </div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{fmt(m.createdAt)}</div>
              </div>
              <div><CatBadge code={m.category}/></div>
              <div><StatusBadge status={m.status}/></div>
              <div>
                {/* Inline toggle — stop propagation so clicking it doesn't open detail */}
                <button
                  onClick={e=>{e.stopPropagation();handleToggleVisibility(m);}}
                  disabled={saving}
                  style={{ padding:'3px 10px', borderRadius:99, fontSize:11,
                    fontWeight:700, border:'none', cursor:'pointer',
                    background: m.visibleToMembers?'#dcfce7':'#f1f5f9',
                    color:      m.visibleToMembers?'#15803d':'#64748b' }}>
                  {m.visibleToMembers ? '👁 Visible' : '🔒 Hidden'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && !editing && (
        <DetailModal
          memo={selected}
          orgData={orgData}
          onClose={()=>setSelected(null)}
          onEdit={m=>{setEditing(m);setSelected(null);}}
          onDelete={handleDelete}
          onToggleVisibility={handleToggleVisibility}
          saving={saving}
          canWrite={canWrite}
        />
      )}

      {editing && canWrite && (
        <MemoModal
          memo={editing?.id ? editing : null}
          memos={memos}
          orgCode={orgCode}
          onClose={()=>setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}