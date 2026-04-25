// src/app/files/page.js
'use client';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const CATS = ['All','General','Finance','Legal','Minutes','Announcement','Form','Other'];

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/'))                                    return '🖼️';
  if (mime.includes('pdf'))                                         return '📕';
  if (mime.includes('word') || mime.includes('document'))           return '📝';
  if (mime.includes('sheet') || mime.includes('excel'))             return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📑';
  if (mime.includes('zip') || mime.includes('rar'))                 return '🗜️';
  if (mime.startsWith('video/'))                                    return '🎬';
  if (mime.startsWith('audio/'))                                    return '🎵';
  if (mime.includes('text/'))                                       return '📃';
  return '📄';
}

function fileType(mime) {
  if (!mime) return { label:'File',       color:'#475569', bg:'#f1f5f9' };
  if (mime.startsWith('image/'))                           return { label:'Image',      color:'#7c3aed', bg:'#f5f3ff' };
  if (mime.includes('pdf'))                               return { label:'PDF',         color:'#dc2626', bg:'#fef2f2' };
  if (mime.includes('word') || mime.includes('document')) return { label:'Word Doc',    color:'#1d4ed8', bg:'#eff6ff' };
  if (mime.includes('sheet') || mime.includes('excel'))   return { label:'Spreadsheet', color:'#15803d', bg:'#f0fdf4' };
  if (mime.includes('presentation') || mime.includes('powerpoint')) return { label:'Slides', color:'#d97706', bg:'#fffbeb' };
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar')) return { label:'Archive', color:'#92400e', bg:'#fef3c7' };
  if (mime.includes('video'))  return { label:'Video',  color:'#be185d', bg:'#fdf2f8' };
  if (mime.includes('audio'))  return { label:'Audio',  color:'#0369a1', bg:'#f0f9ff' };
  return { label:'File', color:'#475569', bg:'#f1f5f9' };
}

function FileTypeBadge({ mime }) {
  const t = fileType(mime);
  return (
    <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:5,
      fontSize:10, fontWeight:700, color:t.color, background:t.bg, whiteSpace:'nowrap' }}>
      {t.label}
    </span>
  );
}

export default function MemberFiles() {
  const { userData, orgData } = useAuth();
  const [files,    setFiles]    = useState([]);
  const [filter,   setFilter]   = useState('All');
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [preview,  setPreview]  = useState(null);
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, 'organizations', orgId, 'files'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => setFiles(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
  }, [orgId]);

  const shown = files.filter(f => {
    const matchCat    = filter === 'All' || f.category === filter;
    const matchSearch = !search
      || f.title.toLowerCase().includes(search.toLowerCase())
      || (f.description||'').toLowerCase().includes(search.toLowerCase());
    const isVisible   = f.visible !== false;   // ← ADD THIS
    return matchCat && matchSearch && isVisible; // ← ADD isVisible here
  });


  // Responsive CSS for table/card toggle
  const responsiveStyle = `
    .files-table-wrap { display: none; }
    .files-card-wrap  { display: block; }
    @media (min-width: 768px) {
      .files-table-wrap { display: block; }
      .files-card-wrap  { display: none; }
    }
  `;

  return (
    <div className="page-wrap animate-fade">
      {/* Preview modal rendered via portal → always true viewport centre */}
      {preview && typeof document !== 'undefined' && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}
          style={{
            position:'fixed', inset:0, zIndex:9999,
            background:'rgba(0,0,0,0.65)',
            display:'flex', alignItems:'center', justifyContent:'center',
            padding:16,
            /* lock body scroll while open */
          }}
        >
          <div style={{
            background:'#fff', borderRadius:14,
            width:'min(920px,100%)',
            height:'calc(100dvh - 32px)',
            display:'flex', flexDirection:'column',
            overflow:'hidden',
            boxShadow:'0 32px 80px rgba(0,0,0,0.35)',
          }}>
            {/* Header */}
            <div style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'10px 14px',
              borderBottom:'1px solid #e2e8f0',
              flexShrink:0,
            }}>
              <FileTypeBadge mime={preview.mimeType}/>
              <div style={{
                flex:1, fontWeight:700, fontSize:14, color:'#0f172a',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>
                {preview.title}
              </div>
              <a href={preview.viewUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  padding:'5px 12px', borderRadius:7,
                  background:'#eff6ff', color:'#1d4ed8',
                  fontSize:12, fontWeight:700, textDecoration:'none',
                  flexShrink:0, whiteSpace:'nowrap',
                }}>
                ↗ Open
              </a>
              <button
                onClick={() => setPreview(null)}
                style={{
                  width:32, height:32, borderRadius:8,
                  border:'1px solid #e2e8f0', background:'#fff',
                  cursor:'pointer', fontSize:17, color:'#64748b',
                  flexShrink:0, display:'flex',
                  alignItems:'center', justifyContent:'center',
                  lineHeight:1,
                }}>
                ✕
              </button>
            </div>

            {/* Preview body — flex:1 + minHeight:0 fills exactly what remains */}
            <div style={{
              flex:1, minHeight:0,
              overflow:'hidden',
              background:'#f8fafc',
              display:'flex', flexDirection:'column',
            }}>
              {preview.mimeType?.startsWith('image/') ? (
                <div style={{
                  flex:1, minHeight:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  padding:16, overflow:'hidden',
                }}>
                  <img
                    src={`https://drive.google.com/thumbnail?id=${preview.fileId}&sz=w1600`}
                    alt={preview.title}
                    style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', borderRadius:8 }}
                  />
                </div>
              ) : preview.fileId ? (
                <iframe
                  src={`https://drive.google.com/file/d/${preview.fileId}/preview`}
                  title={preview.title}
                  allow="autoplay"
                  style={{ flex:1, width:'100%', border:'none', display:'block', minHeight:0 }}
                />
              ) : (
                <div style={{
                  flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                  color:'#94a3b8', fontSize:13,
                }}>
                  Preview not available for this file type.
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}


      <style>{responsiveStyle}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        {orgData?.logoURL && (
          <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">File Library</div>
          <div className="page-subtitle">{files.length} file{files.length!==1?'s':''} available</div>
        </div>
      </div>

      {/* Search + filter */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files\u2026"
          style={{ flex:1, minWidth:160, padding:'9px 14px', borderRadius:8, border:'1.5px solid #e2e8f0', fontSize:13, outline:'none' }} />
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {CATS.map(c => (
            <button key={c} onClick={() => setFilter(c)}
              style={{ padding:'7px 12px', borderRadius:8, fontSize:12, fontWeight:filter===c?700:400,
                border:filter===c?'2px solid #2563eb':'1px solid #e2e8f0',
                background:filter===c?'#eff6ff':'#fff', color:filter===c?'#1d4ed8':'#475569', cursor:'pointer', whiteSpace:'nowrap' }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* File grid */}
      {shown.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>
          {files.length === 0 ? 'No files available yet.' : 'No files match your search.'}
        </div>
      ) : (
        <>
          {/* ── DESKTOP: table view ── */}
          <div className="files-table-wrap">
            <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
              {/* Table header */}
              <div style={{ display:'grid', gridTemplateColumns:'auto 3fr 80px 1fr 1fr 1fr auto',
                padding:'9px 16px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', gap:12, alignItems:'center' }}>
                {['','Title','Type','Category','Size','Uploaded by',''].map((h,i) => (
                  <div key={i} style={{ fontSize:11, fontWeight:700, color:'#64748b',
                    textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</div>
                ))}
              </div>

              {shown.map((f, i) => (
                <div key={f.id}>
                  {/* Main row */}
                  <div
                    onClick={() => setPreview(f)}
                    style={{ display:'grid', gridTemplateColumns:'auto 3fr 80px 1fr 1fr 1fr auto',
                      padding:'10px 16px', gap:12, alignItems:'center', cursor:'pointer',
                      background: i%2===0 ? '#fff' : '#fafafa',
                      borderBottom:'1px solid #f1f5f9', transition:'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background='#f0f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background=i%2===0?'#fff':'#fafafa'}
                  >
                    {/* Icon */}
                    <div style={{ fontSize:20, width:28, textAlign:'center', flexShrink:0 }}>
                      {fileIcon(f.mimeType)}
                    </div>
                    {/* Title + description */}
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:13, color:'#0f172a',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {f.title}
                      </div>
                      {f.description && (
                        <div style={{ fontSize:11, color:'#94a3b8',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.description}
                        </div>
                      )}
                    </div>
                    {/* Type */}
                    <div><FileTypeBadge mime={f.mimeType}/></div>
                    {/* Category */}
                    <div>
                      <span className="badge badge-gray" style={{ fontSize:10 }}>{f.category}</span>
                    </div>
                    {/* Size */}
                    <div style={{ fontSize:12, color:'#64748b' }}>
                      {f.size ? fmtSize(f.size) : '—'}
                    </div>
                    {/* Uploaded by */}
                    <div style={{ fontSize:12, color:'#64748b',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {f.uploadedBy || '—'}
                    </div>
                    {/* Preview button */}
                    <div onClick={e => e.stopPropagation()}>
                      <button onClick={() => setPreview(f)}
                        style={{ padding:'5px 10px', borderRadius:6, background:'#eff6ff',
                          color:'#1d4ed8', fontSize:12, fontWeight:600, border:'none',
                          cursor:'pointer', whiteSpace:'nowrap' }}>
                        👁 Preview
                      </button>
                    </div>
                  </div>


                </div>
              ))}
            </div>
          </div>

          {/* ── MOBILE: card grid (unchanged) ── */}
          <div className="files-card-wrap">
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:12 }}>
              {shown.map(f => (
                <div key={f.id}
                  style={{ background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:12, overflow:'hidden', cursor:'pointer', transition:'all 0.15s' }}
                  onClick={() => setPreview(f)}
                  onMouseEnter={e => e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
                >
                  <div style={{ height:80, display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', fontSize:36 }}>
                  {fileIcon(f.mimeType)}
                </div>
                  <div style={{ padding:'12px 14px 14px' }}>
                    <div style={{ fontWeight:600, fontSize:13, color:'#0f172a', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.title}</div>
                    {f.description && (
                      <div style={{ fontSize:11, color:'#64748b', marginBottom:6, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                        {f.description}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:4 }}>
                      <FileTypeBadge mime={f.mimeType}/>
                      <span className="badge badge-gray" style={{ fontSize:10 }}>{f.category}</span>
                    </div>
                    {f.size && <div style={{ fontSize:10, color:'#94a3b8' }}>{fmtSize(f.size)}</div>}

                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
