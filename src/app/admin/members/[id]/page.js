// src/app/admin/members/[id]/page.js
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, addDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { createPortal } from 'react-dom';

const BLOOD_GROUPS   = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const MARITAL_STATUS = ['Single','Married','Divorced','Widowed'];
const EDUCATION      = ["No Formal Education","Primary","Secondary (SSC)",
  "Higher Secondary (HSC)","Diploma","Bachelor's","Master's","PhD","Other"];

// ── GAS CONFIG ────────────────────────────────────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbyQ6L2d3SfAynofqAHfb1jHSn6ZA18pv2ABgXZDLNDR-DHtEyIxYEb8tCCsDBwbk0RF/exec";
const SECRET  = "absis-secret-123";

const FILE_CATEGORIES = [
  'Legal Document',
  'Agreement / Contract',
  'Identity Document',
  'Financial Record',
  'Application Form',
  'Certificate',
  'Other',
];

// ── Utility ───────────────────────────────────────────────────────────────────
const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload  = () => resolve(reader.result);
  reader.onerror = (err) => reject(err);
});

function fmt(n)  { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function fmtTS(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : (typeof ts==='string'?new Date(ts):ts);
  if (!(d instanceof Date)||isNaN(d)) return ts;
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
}

// ── Upload legal file to GAS (admin version) ──────────────────────────────────
// File will be named: {Category}_{memberId}_{memberName}_{fileTitle}
async function uploadLegalFileToGAS(file, memberId, memberName, category, title, userFolderId) {
  const base64 = await toBase64(file);

  // Build the formatted file name: Category_MemberId_MemberName_FileTitle
  const safeCategory = (category || 'Other').replace(/[\s/]+/g, '-');
  const safeName     = memberName.replace(/\s+/g, '_');
  const safeTitle    = title.trim().replace(/\s+/g, '-');
  const ext          = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
  const legalFileName = `${safeCategory}_${memberId}_${safeName}_${safeTitle}${ext}`;

  const payload = {
    action:       'uploadLegalFile',
    secret:       SECRET,
    file:         base64.split(',')[1],
    fileName:     legalFileName,  // formatted: Category_MemberId_Name_Title.ext
    mimeType:     file.type,
    memberId:     memberId,
    memberName:   memberName,
    userFolderId: userFolderId || null,
  };

  const res = await fetch(GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids preflight for GAS
    body:    JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ── CSV export ────────────────────────────────────────────────────────────────
function memberToCSVRow(m) {
  const esc = v => `"${(v||'').toString().replace(/"/g,'""')}"`;
  return [
    m.idNo, m.nameEnglish, m.nameBengali,
    m.fatherNameEn, m.fatherNameBn, m.motherNameEn, m.motherNameBn,
    m.dob, m.nid, m.bloodGroup, m.maritalStatus,
    m.spouseNameEn, m.spouseNameBn,
    m.education, m.occupation, m.monthlyIncome,
    m.phone, m.alternativePhone, m.email,
    m.presentAddressEn, m.presentAddressBn, m.permanentAddressEn, m.permanentAddressBn,
    m.heirNameEn, m.heirNameBn, m.heirRelation,
    m.heirFatherHusbandEn, m.heirFatherHusbandBn,
    m.heirNID, m.heirPhone, m.heirAddressEn, m.heirAddressBn,
    m.applicationNo, m.applicationDate, m.agreementNo, m.agreementDate,
    m.legalPapersLink,
    m.approved ? 'Active' : 'Pending',
    fmtTS(m.joiningDate||m.createdAt),
    fmtTS(m.profileUpdatedAt),
  ].map(esc).join(',');
}

const CSV_HEADER = [
  'Member ID','Name (English)','Name (Bangla)',
  "Father's Name (En)","Father's Name (Bn)","Mother's Name (En)","Mother's Name (Bn)",
  'DOB','NID','Blood Group','Marital Status',
  'Spouse Name (En)','Spouse Name (Bn)',
  'Education','Occupation','Monthly Income',
  'Phone','Alternative Phone','Email',
  'Present Address (En)','Present Address (Bn)','Permanent Address (En)','Permanent Address (Bn)',
  'Heir Name (En)','Heir Name (Bn)','Relationship',
  "Heir Father/Husband (En)","Heir Father/Husband (Bn)",
  'Heir NID','Heir Phone','Heir Address (En)','Heir Address (Bn)',
  'Application No','Application Date','Agreement No','Agreement Date',
  'Legal Papers Link','Status','Joining Date','Profile Updated',
].map(h=>`"${h}"`).join(',');

function downloadCSV(rows, filename) {
  const blob = new Blob([[CSV_HEADER,'\n',rows.join('\n')].join(''),],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'),{href:url,download:filename});
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },100);
}

// ── Print CSS ─────────────────────────────────────────────────────────────────
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #mpp, #mpp * { visibility: visible !important; }
  #mpp { position:fixed!important; top:0; left:0; width:100%;
    font-family:'Times New Roman',serif; font-size:10.5pt; color:#000; }
  .no-print { display:none!important; }
  @page { margin:18mm 20mm; size:A4; }
  table { page-break-inside:auto; }
  tr    { page-break-inside:avoid; }
}
`;

function Letterhead({ org }) {
  return (
    <div style={{borderBottom:'2.5px solid #000',paddingBottom:14,marginBottom:18,
      display:'flex',alignItems:'flex-start',gap:16}}>
      {org.logoURL && (
        <img src={org.logoURL} alt="" style={{width:72,height:72,objectFit:'contain',flexShrink:0}}/>
      )}
      <div style={{flex:1}}>
        <div style={{fontSize:22,fontWeight:900,color:'#000',letterSpacing:'0.01em',lineHeight:1.2}}>
          {org.name||'Organization'}
        </div>
        {org.slogan && (
          <div style={{fontSize:11,color:'#444',fontStyle:'italic',marginTop:2,marginBottom:4}}>
            {org.slogan}
          </div>
        )}
        <div style={{fontSize:10,color:'#333',display:'flex',flexWrap:'wrap',gap:'3px 14px',marginTop:4}}>
          {org.email   && <span>✉ {org.email}</span>}
          {org.phone   && <span>☎ {org.phone}</span>}
          {org.website && <span>🌐 {org.website}</span>}
        </div>
      </div>
    </div>
  );
}

function TR({ label, value, shade }) {
  if (!value) return null;
  return (
    <tr style={{background:shade?'#f7f7f7':'#fff'}}>
      <td style={{padding:'5px 10px',fontWeight:700,fontSize:10,color:'#444',
        width:'34%',borderBottom:'1px solid #e8e8e8',verticalAlign:'top'}}>
        {label}
      </td>
      <td style={{padding:'5px 10px',fontSize:10.5,color:'#111',
        borderBottom:'1px solid #e8e8e8',verticalAlign:'top',whiteSpace:'pre-wrap'}}>
        {value}
      </td>
    </tr>
  );
}

function SectionTable({ title, rows }) {
  const filtered = rows.filter(([,v])=>v);
  if (!filtered.length) return null;
  return (
    <div style={{marginBottom:18,pageBreakInside:'avoid'}}>
      <div style={{background:'#1a1a1a',color:'#fff',fontWeight:800,fontSize:10,
        letterSpacing:'0.07em',textTransform:'uppercase',
        padding:'5px 10px',borderRadius:'3px 3px 0 0'}}>
        {title}
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',
        border:'1px solid #ddd',borderTop:'none'}}>
        <tbody>
          {filtered.map(([l,v],i)=><TR key={l} label={l} value={v} shade={i%2!==0}/>)}
        </tbody>
      </table>
    </div>
  );
}

function PrintModal({ member, orgData, capital, onClose }) {
  const org = orgData||{};
  if (typeof document==='undefined') return null;

  const INFO = [
    ['Member ID',             member.idNo],
    ['Full Name (English)',   member.nameEnglish],
    ['Full Name (বাংলা)',     member.nameBengali],
    ["Father's Name (En)",   member.fatherNameEn||member.fatherName],
    ["Father's Name (বাংলা)",member.fatherNameBn],
    ["Mother's Name (En)",   member.motherNameEn||member.motherName],
    ["Mother's Name (বাংলা)",member.motherNameBn],
    ['Date of Birth',        member.dob],
    ['National ID (NID)',    member.nid],
    ['Blood Group',          member.bloodGroup],
    ['Marital Status',       member.maritalStatus],
    ['Spouse Name (English)',member.spouseNameEn],
    ['Spouse Name (বাংলা)',  member.spouseNameBn],
    ['Education',            member.education],
    ['Occupation',           member.occupation],
    ['Monthly Income',       member.monthlyIncome],
    ['Phone',                member.phone],
    ['Alternative Phone',    member.alternativePhone],
    ['Email',                member.email],
    ['Joining Date',         fmtDate(member.joiningDate||member.createdAt)],
  ];
  const ADDR = [
    ['Present Address (English)', member.presentAddressEn||member.presentAddress||member.address],
    ['Present Address (বাংলা)',   member.presentAddressBn],
    ['Permanent Address (English)',member.permanentAddressEn||member.permanentAddress],
    ['Permanent Address (বাংলা)', member.permanentAddressBn],
  ];
  const HEIR = [
    ['Heir Name (English)',          member.heirNameEn||member.heirName||member.nomineeNameEnglish],
    ['Heir Name (বাংলা)',            member.heirNameBn||member.nomineenameBengali],
    ['Relationship',                 member.heirRelation||member.nomineeRelationship],
    ["Husband's/Father's Name (En)", member.heirFatherHusbandEn],
    ["Husband's/Father's Name (বাংলা)",member.heirFatherHusbandBn],
    ['NID / Birth Certificate',      member.heirNID||member.nomineeNID],
    ['Heir Phone',                   member.heirPhone||member.nomineePhone],
    ['Heir Address (English)',        member.heirAddressEn||member.heirAddress],
    ['Heir Address (বাংলা)',          member.heirAddressBn],
  ];
  const LEGAL = [
    ['Application No.',      member.applicationNo],
    ['Application Date',     member.applicationDate],
    ['Agreement No.',        member.agreementNo],
    ['Agreement Date',       member.agreementDate],
    ['Legal Papers Link',    member.legalPapersLink],
  ];

  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.65)',
      display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <style>{PRINT_CSS}</style>
      <div style={{background:'#fff',borderRadius:12,width:'min(860px,100%)',
        height:'calc(100dvh - 32px)',display:'flex',flexDirection:'column',
        overflow:'hidden',boxShadow:'0 32px 80px rgba(0,0,0,0.35)'}}>

        <div className="no-print" style={{padding:'10px 16px',borderBottom:'1px solid #e2e8f0',
          display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{flex:1,fontWeight:700,fontSize:14,color:'#0f172a'}}>
            Print Preview — {member.nameEnglish}
          </div>
          <button onClick={()=>window.print()}
            style={{padding:'7px 18px',borderRadius:8,background:'#0f172a',
              color:'#fff',border:'none',cursor:'pointer',fontSize:13,fontWeight:700}}>
            🖨 Print / PDF
          </button>
          <button onClick={()=>downloadCSV([memberToCSVRow(member)],`member-${member.idNo||'profile'}.csv`)}
            style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:13,color:'#475569'}}>
            ⬇ CSV
          </button>
          <button onClick={onClose}
            style={{padding:'7px 12px',borderRadius:8,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:16,color:'#64748b'}}>
            ✕
          </button>
        </div>

        <div style={{flex:1,minHeight:0,overflowY:'auto',background:'#f0f0f0',padding:'20px'}}>
          <div id="mpp" style={{background:'#fff',maxWidth:780,margin:'0 auto',
            padding:'28px 32px',fontFamily:'serif',boxShadow:'0 2px 12px rgba(0,0,0,0.12)'}}>

            <Letterhead org={org}/>

            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:14,fontWeight:900,letterSpacing:'0.1em',
                textTransform:'uppercase',color:'#000',
                borderBottom:'1px solid #ccc',paddingBottom:6,display:'inline-block',
                paddingLeft:20,paddingRight:20}}>
                Member Information Record
              </div>
              <div style={{fontSize:9,color:'#666',marginTop:5}}>
                Printed: {new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}
                {member.profileUpdatedAt && ` · Last updated: ${fmtTS(member.profileUpdatedAt)}`}
              </div>
            </div>

            <div style={{display:'flex',gap:20,marginBottom:20,
              border:'1px solid #ddd',borderRadius:6,padding:'14px 16px',
              background:'#fafafa'}}>
              <div style={{width:90,height:110,border:'1.5px solid #999',borderRadius:4,
                overflow:'hidden',flexShrink:0,background:'#eee',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:32,fontWeight:700,color:'#555'}}>
                {member.photoURL
                  ? <img src={member.photoURL} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  : (member.nameEnglish?.[0]||'?')}
              </div>
              <div style={{flex:1,display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 20px'}}>
                {[
                  ['Member ID',   member.idNo],
                  ['Joining Date',fmtDate(member.joiningDate||member.createdAt)],
                  ['Status',      member.approved?'Active':'Pending'],
                  ['Blood Group', member.bloodGroup],
                  ['NID',         member.nid],
                  ['Phone',       member.phone],
                ].map(([l,v])=>v?(
                  <div key={l}>
                    <div style={{fontSize:8,fontWeight:700,color:'#888',
                      textTransform:'uppercase',letterSpacing:'0.05em'}}>{l}</div>
                    <div style={{fontSize:11,fontWeight:600,color:'#111'}}>{v}</div>
                  </div>
                ):null)}
              </div>
              {member.nomineePhotoURL && (
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',
                  gap:4,flexShrink:0}}>
                  <div style={{width:60,height:75,border:'1px solid #999',borderRadius:3,
                    overflow:'hidden',background:'#eee'}}>
                    <img src={member.nomineePhotoURL} alt=""
                      style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  </div>
                  <div style={{fontSize:8,color:'#666',textAlign:'center'}}>Nominee</div>
                </div>
              )}
            </div>

            <SectionTable title="Personal Information"    rows={INFO}/>
            <SectionTable title="Address Information"     rows={ADDR}/>
            <SectionTable title="Nominee / Heir Details"  rows={HEIR}/>
            {capital && (
              <SectionTable title="Capital Summary" rows={[
                ['Total Capital',    fmt(capital.total)],
                ['Verified Payments',`${capital.verifiedCount} payments`],
                ['Pending Payments', `${capital.pendingCount} pending`],
              ]}/>
            )}
            <SectionTable title="Legal & Agreement Details" rows={LEGAL}/>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:48,marginTop:40}}>
              {['Member Signature','Authorized Signatory'].map(l=>(
                <div key={l} style={{textAlign:'center'}}>
                  <div style={{borderBottom:'1px solid #000',height:36,marginBottom:6}}/>
                  <div style={{fontSize:9,color:'#555',letterSpacing:'0.03em'}}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{marginTop:32,paddingTop:8,borderTop:'1px solid #ddd',
              display:'flex',justifyContent:'space-between',fontSize:8,color:'#888'}}>
              <span>{org.name||'Organization'} — Confidential</span>
              <span>Member ID: {member.idNo||'—'} | Page 1</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Section for view/edit ─────────────────────────────────────────────────────
function ViewSection({ title, rows }) {
  const r = rows.filter(([,v])=>v);
  if (!r.length) return null;
  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
      overflow:'hidden',marginBottom:12}}>
      <div style={{padding:'10px 16px',background:'#f8fafc',
        borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#0f172a'}}>
        {title}
      </div>
      <div style={{padding:'4px 0'}}>
        {r.map(([label,value],i)=>(
          <div key={label} style={{display:'flex',gap:8,padding:'7px 16px',
            background:i%2===0?'#fff':'#fafafa',borderBottom:'1px solid #f8fafc',fontSize:13}}>
            <span style={{width:200,flexShrink:0,color:'#64748b',fontWeight:500,fontSize:12}}>
              {label}
            </span>
            <span style={{color:'#0f172a',whiteSpace:'pre-wrap'}}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditSection({ title, fields, form, set, disabled }) {
  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
      overflow:'hidden',marginBottom:12}}>
      <div style={{padding:'10px 16px',background:'#f8fafc',
        borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#0f172a'}}>
        {title}
      </div>
      <div style={{padding:'16px',display:'grid',
        gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
        {fields.map(([key,label,type,opts,full])=>(
          <div key={key} style={{gridColumn:full?'1/-1':undefined}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
              textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
              {label}
            </label>
            {type==='select' ? (
              <select value={form[key]||''} onChange={e=>set(key,e.target.value)} disabled={disabled}>
                <option value="">Select…</option>
                {opts.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            ) : type==='textarea' ? (
              <textarea value={form[key]||''} rows={2} disabled={disabled}
                onChange={e=>set(key,e.target.value)}/>
            ) : (
              <input type={type||'text'} value={form[key]||''} disabled={disabled}
                onChange={e=>set(key,e.target.value)}/>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── File preview portal ───────────────────────────────────────────────────────
function FilePreviewModal({ file, onClose }) {
  if (!file || typeof document === 'undefined') return null;
  const fIcon = (mime='') => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf'))      return '📕';
    if (mime.includes('word')||mime.includes('document')) return '📝';
    return '📄';
  };
  return createPortal(
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}}
      style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.65)',
        display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:12,width:'min(900px,100%)',
        height:'calc(100dvh - 32px)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',
          borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
          <span style={{fontSize:18}}>{fIcon(file.mimeType)}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,color:'#0f172a',
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {file.title || file.name}
            </div>
            {file.category && (
              <div style={{fontSize:11,color:'#64748b',marginTop:1}}>{file.category}</div>
            )}
          </div>
          <a href={file.url || file.viewUrl} target="_blank" rel="noreferrer"
            style={{padding:'5px 12px',borderRadius:7,background:'#eff6ff',
              color:'#1d4ed8',fontSize:12,fontWeight:700,textDecoration:'none'}}>
            ↗ Open
          </a>
          <button onClick={onClose}
            style={{width:32,height:32,borderRadius:8,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:17,color:'#64748b'}}>✕</button>
        </div>
        {file.description && (
          <div style={{padding:'8px 16px',fontSize:12,color:'#475569',
            background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
            {file.description}
          </div>
        )}
        <div style={{flex:1,minHeight:0,overflow:'hidden',background:'#f8fafc'}}>
          {file.mimeType?.startsWith('image/') ? (
            <div style={{height:'100%',display:'flex',alignItems:'center',
              justifyContent:'center',padding:16}}>
              <img src={file.url || file.viewUrl} alt={file.name}
                style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',borderRadius:8}}/>
            </div>
          ) : file.fileId ? (
            <iframe src={`https://drive.google.com/file/d/${file.fileId}/preview`}
              title={file.name} allow="autoplay"
              style={{width:'100%',height:'100%',border:'none',display:'block'}}/>
          ) : (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',
              height:'100%',color:'#94a3b8',fontSize:13}}>
              Preview not available.{' '}
              <a href={file.url || file.viewUrl} target="_blank" rel="noreferrer"
                style={{color:'#2563eb',marginLeft:4}}>Open in Drive ↗</a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Admin photo upload helper ─────────────────────────────────────────────────
function AdminPhotoUpload({ label, orgId, orgData, memberId, memberFolderId, onUploaded }) {
  const [status, setStatus] = useState('');
  const ref = useRef(null);

  const handle = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('uploading');
    try {
      const fd = new FormData();
      fd.append('file',    file);
      fd.append('orgId',   orgId   || '');
      fd.append('orgName', orgData?.name || '');
      fd.append('subfolder', 'members-papers');
      if (memberFolderId) fd.append('memberFolderId', memberFolderId);
      else if (orgData?.driveFolderId) fd.append('driveFolderId', orgData.driveFolderId);
      const res  = await fetch('/api/upload', { method:'POST', body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUploaded(data.viewUrl);
      setStatus('done');
    } catch(err) {
      setStatus('error');
      alert('Upload failed: ' + err.message);
    }
    if (ref.current) ref.current.value = '';
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
      <button onClick={() => ref.current?.click()} disabled={status==='uploading'}
        style={{ padding:'5px 12px', borderRadius:7, border:'1px solid #e2e8f0',
          background:'#fff', cursor:'pointer', fontSize:11, color:'#475569', fontWeight:600,
          opacity: status==='uploading' ? 0.6 : 1 }}>
        {status==='uploading' ? '⏳ Uploading…' : status==='done' ? '✅ Done' : `📷 ${label}`}
      </button>
      <input ref={ref} type="file" accept="image/*" style={{ display:'none' }} onChange={handle}/>
    </div>
  );
}

// ── File row ─────────────────────────────────────────────────────────────────
function FileRow({ file, index, onPreview }) {
  const fIcon = (mime='') => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf'))      return '📕';
    if (mime.includes('word')||mime.includes('document')) return '📝';
    return '📄';
  };
  const isAdmin  = file.uploadedBy === 'admin';
  const fileUrl  = file.url || file.viewUrl;

  return (
    <div style={{display:'flex',alignItems:'flex-start',gap:10,
      padding:'10px 16px',background:index%2===0?'#fff':'#fafafa',
      borderBottom:'1px solid #f1f5f9'}}>
      <span style={{fontSize:20,flexShrink:0,marginTop:2}}>{fIcon(file.mimeType)}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:13,color:'#0f172a',
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {file.title || file.name}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:3,alignItems:'center'}}>
          {file.category && (
            <span style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:999,
              background: isAdmin ? '#eff6ff' : '#f0fdf4',
              color: isAdmin ? '#1d4ed8' : '#15803d',
              border: `1px solid ${isAdmin ? '#bfdbfe' : '#bbf7d0'}`}}>
              {file.category}
            </span>
          )}
          <span style={{fontSize:10,padding:'1px 7px',borderRadius:999,
            background: isAdmin ? '#fef3c7' : '#f1f5f9',
            color: isAdmin ? '#92400e' : '#64748b',
            border: `1px solid ${isAdmin ? '#fde68a' : '#e2e8f0'}`}}>
            {isAdmin ? '👤 Admin' : '🧑 Member'}
          </span>
          {file.uploadedAt && (
            <span style={{fontSize:10,color:'#94a3b8'}}>
              {new Date(file.uploadedAt).toLocaleDateString('en-GB')}
            </span>
          )}
        </div>
        {file.description && (
          <div style={{fontSize:11,color:'#64748b',marginTop:4,
            overflow:'hidden',textOverflow:'ellipsis',
            display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
            {file.description}
          </div>
        )}
      </div>
      <div style={{display:'flex',gap:6,flexShrink:0,alignSelf:'center'}}>
        <button onClick={()=>onPreview(file)}
          style={{padding:'4px 10px',borderRadius:6,border:'1px solid #e2e8f0',
            background:'#eff6ff',color:'#1d4ed8',fontSize:12,fontWeight:600,cursor:'pointer'}}>
          👁 Preview
        </button>
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noreferrer"
            style={{padding:'4px 10px',borderRadius:6,background:'#f1f5f9',
              color:'#475569',fontSize:12,fontWeight:600,textDecoration:'none'}}>
            ↗ Open
          </a>
        )}
      </div>
    </div>
  );
}

// ── Upload progress row (for multi-file feedback) ─────────────────────────────
function UploadProgressRow({ fileName, status, error }) {
  const color  = status === 'done'     ? '#15803d'
               : status === 'error'    ? '#b91c1c'
               : '#64748b';
  const bg     = status === 'done'     ? '#f0fdf4'
               : status === 'error'    ? '#fee2e2'
               : '#f8fafc';
  const icon   = status === 'done'     ? '✅'
               : status === 'error'    ? '❌'
               : '⏳';
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',
      borderRadius:6,background:bg,marginBottom:4,fontSize:12}}>
      <span>{icon}</span>
      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
        color,fontWeight:600}}>{fileName}</span>
      {error && <span style={{color:'#b91c1c',fontSize:11}}>{error}</span>}
    </div>
  );
}

// ── Admin Member Files section ────────────────────────────────────────────────
function AdminMemberFiles({ member, orgId, onMemberUpdate }) {
  const [preview,        setPreview]        = useState(null);
  const [uploading,      setUploading]      = useState(false);
  const [toast,          setToast]          = useState('');
  const [activeTab,      setActiveTab]      = useState('all');
  const [uploadTitle,    setUploadTitle]    = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadDesc,     setUploadDesc]     = useState('');
  const [uploadFiles,    setUploadFiles]    = useState([]); // array of File objects
  const [uploadProgress, setUploadProgress] = useState([]); // [{name, status, error}]
  const [showUploadForm, setShowUploadForm] = useState(false);

  const fileRef = useRef(null);

  const showToast = (msg, err=false) => {
    setToast({msg,err}); setTimeout(()=>setToast(''),4000);
  };

  const allFiles = member.legalFiles || [];
  const filtered = activeTab === 'all'    ? allFiles
                 : activeTab === 'admin'  ? allFiles.filter(f => f.uploadedBy === 'admin')
                 : allFiles.filter(f => f.uploadedBy !== 'admin');

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    setUploadFiles(files);
    setUploadProgress(files.map(f => ({ name: f.name, status: 'pending', error: null })));
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) { showToast('Please select at least one file.', true); return; }
    if (!uploadTitle.trim())      { showToast('Please enter a title.', true); return; }

    setUploading(true);
    const memberName = member.nameEnglish || member.nameBengali || 'Member';
    const memberId   = member.idNo || member.id;

    let currentFiles  = [...allFiles];
    let currentFolder = member.driveFolderId || null;

    // Upload files one by one so we can show per-file progress
    const progCopy = uploadFiles.map(f => ({ name: f.name, status: 'uploading', error: null }));
    setUploadProgress([...progCopy]);

    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      try {
        const res = await uploadLegalFileToGAS(
          file, memberId, memberName,
          uploadCategory || 'Other',
          uploadFiles.length === 1 ? uploadTitle.trim() : `${uploadTitle.trim()}-${i + 1}`,
          currentFolder,
        );

        if (!res.success) throw new Error(res.error || 'Upload failed');

        // Save folder ID back on first successful upload
        if (res.folderId && !currentFolder) {
          currentFolder = res.folderId;
          await updateDoc(doc(db,'organizations',orgId,'members',member.id),{
            driveFolderId: res.folderId,
          });
          onMemberUpdate({ driveFolderId: res.folderId });
        }

        const newFile = {
          // Display name uses the title for single uploads, or title + index for multi
          name:        file.name,
          title:       uploadFiles.length === 1
                         ? uploadTitle.trim()
                         : `${uploadTitle.trim()} (${i + 1})`,
          category:    uploadCategory || 'Other',
          description: uploadDesc.trim(),
          url:         res.url,
          fileId:      res.fileId,
          mimeType:    file.type,
          uploadedBy:  'admin',
          uploadedAt:  new Date().toISOString(),
          // Store the GAS-formatted file name for reference
          driveFileName: res.name,
        };

        currentFiles = [...currentFiles, newFile];

        progCopy[i] = { name: file.name, status: 'done', error: null };
        setUploadProgress([...progCopy]);

      } catch(err) {
        progCopy[i] = { name: file.name, status: 'error', error: err.message };
        setUploadProgress([...progCopy]);
      }
    }

    // Persist all successfully uploaded files to Firestore in one write
    const newlyAdded = currentFiles.length - allFiles.length;
    if (newlyAdded > 0) {
      await updateDoc(doc(db,'organizations',orgId,'members',member.id),{
        legalFiles: currentFiles,
      });
      onMemberUpdate({ legalFiles: currentFiles });
    }

    const successCount = progCopy.filter(p => p.status === 'done').length;
    const failCount    = progCopy.filter(p => p.status === 'error').length;

    if (successCount > 0 && failCount === 0) {
      showToast(`✅ ${successCount} file${successCount > 1 ? 's' : ''} uploaded successfully!`);
      // Reset form after a short delay so user can see the progress
      setTimeout(() => {
        setUploadTitle('');
        setUploadCategory('');
        setUploadDesc('');
        setUploadFiles([]);
        setUploadProgress([]);
        if (fileRef.current) fileRef.current.value = '';
        setShowUploadForm(false);
      }, 1500);
    } else if (successCount > 0) {
      showToast(`⚠️ ${successCount} uploaded, ${failCount} failed.`, false);
    } else {
      showToast(`Upload failed for all ${failCount} file${failCount > 1 ? 's' : ''}.`, true);
    }

    setUploading(false);
  };

  const TAB_COUNTS = {
    all:    allFiles.length,
    admin:  allFiles.filter(f=>f.uploadedBy==='admin').length,
    member: allFiles.filter(f=>f.uploadedBy!=='admin').length,
  };

  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
      overflow:'hidden',marginBottom:12}}>

      {/* Header */}
      <div style={{padding:'12px 16px',background:'#f8fafc',
        borderBottom:'1px solid #e2e8f0',display:'flex',
        justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>
            📁 Legal Papers &amp; Documents
          </span>
          <span style={{fontSize:11,color:'#64748b',fontWeight:500}}>
            {allFiles.length} file{allFiles.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={()=>{ setShowUploadForm(v=>!v); setUploadProgress([]); }}
          style={{padding:'6px 14px',borderRadius:8,border:'none',cursor:'pointer',
            fontSize:12,fontWeight:700,
            background: showUploadForm ? '#f1f5f9' : '#0f172a',
            color:      showUploadForm ? '#475569'  : '#fff'}}>
          {showUploadForm ? '✕ Cancel' : '+ Upload Files'}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{padding:'8px 16px',fontSize:12,fontWeight:600,
          background:toast.err?'#fee2e2':'#dcfce7',
          color:toast.err?'#b91c1c':'#15803d'}}>
          {toast.msg}
        </div>
      )}

      {/* Upload form */}
      {showUploadForm && (
        <div style={{padding:'16px',borderBottom:'1px solid #e2e8f0',background:'#fafafa'}}>

          <div style={{padding:'8px 12px',borderRadius:7,background:'#eff6ff',
            border:'1px solid #bfdbfe',fontSize:11,color:'#1e40af',marginBottom:14}}>
            📌 Files will be named: <strong>{uploadCategory || 'Category'}_{member.idNo}_{(member.nameEnglish||'Member').replace(/\s+/g,'_')}_File-Title.ext</strong>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',
            gap:12,marginBottom:12}}>

            {/* Title */}
            <div style={{gridColumn:'1/-1'}}>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
                Title <span style={{color:'#ef4444'}}>*</span>
              </label>
              <input
                value={uploadTitle}
                onChange={e=>setUploadTitle(e.target.value)}
                placeholder="e.g. NID Copy, Agreement Form…"
                style={{width:'100%',padding:'8px 10px',borderRadius:7,
                  border:'1px solid #e2e8f0',fontSize:13,boxSizing:'border-box'}}
              />
              {uploadFiles.length > 1 && (
                <div style={{fontSize:11,color:'#64748b',marginTop:3}}>
                  For multiple files, titles will be suffixed with (1), (2), etc.
                </div>
              )}
            </div>

            {/* Category */}
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
                Category
              </label>
              <select
                value={uploadCategory}
                onChange={e=>setUploadCategory(e.target.value)}
                style={{width:'100%',padding:'8px 10px',borderRadius:7,
                  border:'1px solid #e2e8f0',fontSize:13,boxSizing:'border-box',
                  background:'#fff'}}>
                <option value="">Select category…</option>
                {FILE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* File — multiple allowed */}
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
                Files <span style={{color:'#ef4444'}}>*</span>{' '}
                <span style={{fontWeight:400,fontSize:10,color:'#94a3b8',textTransform:'none'}}>
                  (select one or more)
                </span>
              </label>
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={handleFileChange}
                style={{width:'100%',padding:'6px 0',fontSize:12}}
              />
              {uploadFiles.length > 0 && (
                <div style={{fontSize:11,color:'#475569',marginTop:4,
                  padding:'6px 8px',background:'#f1f5f9',borderRadius:6}}>
                  {uploadFiles.length} file{uploadFiles.length > 1 ? 's' : ''} selected:{' '}
                  {uploadFiles.map(f=>`${f.name} (${(f.size/1024).toFixed(1)}KB)`).join(', ')}
                </div>
              )}
            </div>

            {/* Description */}
            <div style={{gridColumn:'1/-1'}}>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:4}}>
                Description{' '}
                <span style={{color:'#94a3b8',fontWeight:400}}>(optional)</span>
              </label>
              <textarea
                value={uploadDesc}
                onChange={e=>setUploadDesc(e.target.value)}
                rows={2}
                placeholder="Additional notes about this file…"
                style={{width:'100%',padding:'8px 10px',borderRadius:7,
                  border:'1px solid #e2e8f0',fontSize:13,resize:'vertical',
                  boxSizing:'border-box'}}
              />
            </div>
          </div>

          {/* Per-file progress */}
          {uploadProgress.length > 0 && (
            <div style={{marginBottom:12}}>
              {uploadProgress.map((p, i) => (
                <UploadProgressRow key={i} fileName={p.name} status={p.status} error={p.error}/>
              ))}
            </div>
          )}

          <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
            <button onClick={()=>{ setShowUploadForm(false); setUploadProgress([]); }}
              style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
              Cancel
            </button>
            <button onClick={handleUpload} disabled={uploading || uploadFiles.length === 0}
              style={{padding:'8px 20px',borderRadius:8,border:'none',cursor:'pointer',
                fontSize:13,fontWeight:700,
                background: (uploading || uploadFiles.length === 0) ? '#94a3b8' : '#0f172a',
                color:'#fff',
                opacity: (uploading || uploadFiles.length === 0) ? 0.8 : 1}}>
              {uploading
                ? `⏳ Uploading… (${uploadProgress.filter(p=>p.status==='done').length}/${uploadFiles.length})`
                : `⬆ Upload ${uploadFiles.length > 1 ? `${uploadFiles.length} Files` : 'File'} to Drive`}
            </button>
          </div>
        </div>
      )}

      {/* Drive folder link */}
      {member.driveFolderId && (
        <div style={{padding:'6px 16px',fontSize:11,color:'#64748b',
          borderBottom:'1px solid #f1f5f9'}}>
          📂 Drive folder:{' '}
          <a href={`https://drive.google.com/drive/folders/${member.driveFolderId}`}
            target="_blank" rel="noreferrer"
            style={{color:'#2563eb'}}>
            Open in Google Drive ↗
          </a>
        </div>
      )}

      {/* Tabs */}
      {allFiles.length > 0 && (
        <div style={{display:'flex',gap:0,borderBottom:'1px solid #e2e8f0',background:'#f8fafc'}}>
          {[['all','All'],['admin','Admin Uploads'],['member','Member Uploads']].map(([key,label])=>(
            <button key={key} onClick={()=>setActiveTab(key)}
              style={{padding:'8px 14px',border:'none',cursor:'pointer',fontSize:12,
                fontWeight: activeTab===key ? 700 : 500,
                color:      activeTab===key ? '#0f172a' : '#64748b',
                background: activeTab===key ? '#fff' : 'transparent',
                borderBottom: activeTab===key ? '2px solid #0f172a' : '2px solid transparent',
                transition:'all 0.15s'}}>
              {label}
              <span style={{marginLeft:5,fontSize:10,padding:'1px 5px',borderRadius:99,
                background: activeTab===key ? '#0f172a' : '#e2e8f0',
                color:      activeTab===key ? '#fff' : '#64748b'}}>
                {TAB_COUNTS[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* File list */}
      {filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'32px 20px',color:'#94a3b8',fontSize:13}}>
          {allFiles.length === 0
            ? 'No documents uploaded yet.'
            : 'No files in this category.'}
        </div>
      ) : (
        <div>
          {filtered.map((f,i)=>(
            <FileRow key={i} file={f} index={i} onPreview={setPreview}/>
          ))}
        </div>
      )}

      <FilePreviewModal file={preview} onClose={()=>setPreview(null)}/>
    </div>
  );
}


// ── Exit Workflow component ────────────────────────────────────────────────────
function ExitWorkflow({ member, capital, orgId, orgData, memberId, onExited }) {
  const [showModal, setShowModal] = useState(false);
  const [exitType,  setExitType]  = useState('archived');
  const [reason,    setReason]    = useState('');
  const [exitDate,  setExitDate]  = useState(new Date().toISOString().split('T')[0]);
  const [saving,    setSaving]    = useState(false);

  const c          = capital || {};
  const returnable = c.returnable ?? 0;
  const raw        = c.returnableRaw ?? 0;

  const handleExit = async () => {
    if (!reason.trim()) { alert('Please enter a reason.'); return; }
    if (!confirm(
      `${exitType === 'archived' ? 'Archive' : 'Terminate'} ${member.nameEnglish}?\n\n` +
      `Returnable capital: ৳${returnable.toLocaleString()}\n\nContinue?`
    )) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,'organizations',orgId,'members',memberId), {
        approved:       false,
        memberStatus:   exitType,
        exitDate,
        exitReason:     reason.trim(),
        exitType,
        returnableCapital: returnable,
        exitAccountingSummary: {
          totalCapital:       c.total            || 0,
          memberExpenseShare: c.memberExpenseShare || 0,
          feesTotal:          c.feesTotal         || 0,
          loanOutstanding:    c.loanOutstanding   || 0,
          profitTotal:        c.profitTotal        || 0,
          returnableCapital:  returnable,
          recordedAt:         new Date().toISOString(),
        },
      });
      await addDoc(collection(db,'organizations',orgId,'notifications'), {
        userId:    memberId,
        message:   `Your membership has been ${exitType}. Exit date: ${exitDate}. Returnable capital: ৳${returnable.toLocaleString()}. Reason: ${reason.trim()}`,
        type:      'exit',
        read:      false,
        createdAt: serverTimestamp(),
      });
      setShowModal(false);
      onExited(exitType);
    } catch(e) { alert('Error: '+e.message); }
    setSaving(false);
  };

  // ── Already exited: show summary ──────────────────────────────────────────
  if (member.memberStatus === 'archived' || member.memberStatus === 'terminated') {
    const isArchived = member.memberStatus === 'archived';
    const ac = member.exitAccountingSummary || {};
    return (
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
        overflow:'hidden',marginTop:16}}>
        <div style={{padding:'12px 16px',
          background: isArchived ? '#f0fdf4' : '#fef2f2',
          borderBottom:'1px solid #e2e8f0',
          display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:18}}>{isArchived ? '📦' : '⛔'}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:13,
              color: isArchived ? '#15803d' : '#dc2626'}}>
              Member {isArchived ? 'Archived' : 'Terminated'}
            </div>
            <div style={{fontSize:11,color:'#64748b'}}>
              {member.exitDate && `Exit date: ${member.exitDate}`}
              {member.exitReason && ` · ${member.exitReason}`}
            </div>
          </div>
        </div>
        {Object.keys(ac).length > 0 && (
          <div style={{padding:'14px 16px'}}>
            <div style={{fontWeight:600,fontSize:13,color:'#0f172a',marginBottom:10}}>
              Exit Accounting Summary
            </div>
            <div style={{display:'grid',
              gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>
              {[
                ['Contributions',   ac.totalCapital,        '#15803d','#f0fdf4'],
                ['Expense Share',  -ac.memberExpenseShare,  '#d97706','#fffbeb'],
                ['Fees (non-ref)', -ac.feesTotal,           '#7c3aed','#faf5ff'],
                ['Loan Balance',   -ac.loanOutstanding,     '#dc2626','#fef2f2'],
                ['Profit Received', ac.profitTotal,         '#0369a1','#e0f2fe'],
                ['Returned',        ac.returnableCapital,   '#0f172a','#f8fafc'],
              ].map(([l,v,c,bg])=>(
                <div key={l} style={{background:bg,borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#94a3b8',
                    textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{l}</div>
                  <div style={{fontSize:15,fontWeight:700,color:c}}>
                    {(v||0)>=0?'+':''}{fmt(v||0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Active member: show exit button ──────────────────────────────────────
  return (
    <>
      <div style={{marginTop:16,padding:'14px 16px',borderRadius:12,
        border:'1px solid #fca5a5',background:'#fff'}}>
        <div style={{display:'flex',justifyContent:'space-between',
          alignItems:'center',gap:12}}>
          <div>
            <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>
              Member Exit
            </div>
            <div style={{fontSize:12,color:'#64748b',marginTop:2}}>
              Archive (voluntary) or terminate this member with full accounting.
            </div>
          </div>
          <button onClick={()=>setShowModal(true)}
            style={{padding:'8px 18px',borderRadius:8,
              border:'1.5px solid #fca5a5',background:'#fff',
              color:'#dc2626',cursor:'pointer',fontSize:13,
              fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>
            Exit Member
          </button>
        </div>
      </div>

      {showModal && typeof document !== 'undefined' && createPortal(
        <div onClick={e=>{if(e.target===e.currentTarget)setShowModal(false);}}
          style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.6)',
            display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:14,width:'min(600px,100%)',
            maxHeight:'calc(100dvh - 32px)',overflowY:'auto',
            boxShadow:'0 32px 80px rgba(0,0,0,0.3)'}}>

            <div style={{padding:'16px 20px',borderBottom:'1px solid #e2e8f0',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontWeight:700,fontSize:16,color:'#0f172a'}}>
                Exit Member — {member.nameEnglish}
              </div>
              <button onClick={()=>setShowModal(false)}
                style={{width:32,height:32,borderRadius:8,border:'1px solid #e2e8f0',
                  background:'#fff',cursor:'pointer',fontSize:16,color:'#64748b',
                  display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>

            <div style={{padding:'20px'}}>
              {/* Accounting breakdown */}
              <div style={{background:'#f8fafc',borderRadius:10,
                border:'1px solid #e2e8f0',padding:'16px',marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:12}}>
                  📊 Exit Accounting Breakdown
                </div>
                {[
                  { label:'Total capital contributions',
                    value: c.total||0, sign:'+', color:'#15803d' },
                  { label:`Proportional expense share (${((c.expenseProportion||0)*100).toFixed(2)}% of org total)`,
                    value:-(c.memberExpenseShare||0), sign:'−', color:'#d97706' },
                  { label:'Entry & re-registration fees (non-refundable)',
                    value:-(c.feesTotal||0), sign:'−', color:'#7c3aed' },
                  { label:'Outstanding loan balance',
                    value:-(c.loanOutstanding||0), sign:'−', color:'#dc2626' },
                  { label:'Profit distributions received',
                    value:+(c.profitTotal||0), sign:'+', color:'#0369a1' },
                ].map((item,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',
                    alignItems:'center',padding:'7px 0',
                    borderBottom:'1px solid #f1f5f9'}}>
                    <div style={{fontSize:12,color:'#475569'}}>{item.label}</div>
                    <div style={{fontSize:13,fontWeight:600,color:item.color}}>
                      {item.sign}{fmt(Math.abs(item.value))}
                    </div>
                  </div>
                ))}
                <div style={{display:'flex',justifyContent:'space-between',
                  alignItems:'center',paddingTop:10,marginTop:6,
                  borderTop:'2px solid #0f172a'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>
                    Returnable to Member
                  </div>
                  <div style={{fontSize:20,fontWeight:800,
                    color:raw>=0?'#15803d':'#dc2626'}}>
                    {fmt(returnable)}
                    {raw<0 && (
                      <div style={{fontSize:11,color:'#dc2626',fontWeight:600}}>
                        (capped at ৳0)
                      </div>
                    )}
                  </div>
                </div>
                {raw<0 && (
                  <div style={{marginTop:8,padding:'8px 12px',borderRadius:8,
                    background:'#fef2f2',border:'1px solid #fca5a5',
                    fontSize:12,color:'#b91c1c'}}>
                    ⚠️ Obligations exceed capital. Resolve outstanding loans before exit.
                  </div>
                )}
              </div>

              {/* Exit type */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                  textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>
                  Exit Type
                </label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[
                    ['archived',  '📦 Archive',   'Voluntary exit. Member can rejoin later.'],
                    ['terminated','⛔ Terminate', 'Removed by admin. Cannot rejoin without approval.'],
                  ].map(([val,label,desc])=>(
                    <button key={val} type="button" onClick={()=>setExitType(val)}
                      style={{padding:'10px 12px',borderRadius:10,textAlign:'left',
                        cursor:'pointer',
                        border:`2px solid ${exitType===val
                          ?(val==='archived'?'#16a34a':'#dc2626'):'#e2e8f0'}`,
                        background:exitType===val
                          ?(val==='archived'?'#f0fdf4':'#fef2f2'):'#fff'}}>
                      <div style={{fontWeight:700,fontSize:13,
                        color:exitType===val
                          ?(val==='archived'?'#15803d':'#dc2626'):'#0f172a'}}>
                        {label}
                      </div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:3}}>{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                  textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>
                  Exit Date
                </label>
                <input type="date" value={exitDate}
                  onChange={e=>setExitDate(e.target.value)}
                  style={{width:'100%',padding:'9px 12px',borderRadius:8,
                    border:'1px solid #e2e8f0',fontSize:13}}/>
              </div>

              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
                  textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>
                  Reason *
                </label>
                <textarea value={reason} onChange={e=>setReason(e.target.value)}
                  rows={3} placeholder="e.g. Personal reasons, relocation, loan default…"
                  style={{width:'100%',padding:'9px 12px',borderRadius:8,resize:'vertical',
                    border:'1px solid #e2e8f0',fontSize:13,boxSizing:'border-box'}}/>
              </div>

              <div style={{display:'flex',gap:10,paddingTop:16,
                borderTop:'1px solid #e2e8f0'}}>
                <button onClick={handleExit} disabled={saving}
                  style={{padding:'11px 24px',borderRadius:8,border:'none',
                    cursor:saving?'not-allowed':'pointer',
                    fontSize:13,fontWeight:700,
                    background:exitType==='archived'?'#16a34a':'#dc2626',
                    color:'#fff',opacity:saving?0.7:1}}>
                  {saving?'Processing…'
                    :exitType==='archived'?'📦 Archive Member':'⛔ Terminate Member'}
                </button>
                <button onClick={()=>setShowModal(false)}
                  style={{padding:'11px 20px',borderRadius:8,
                    border:'1px solid #e2e8f0',background:'#fff',
                    cursor:'pointer',fontSize:13,color:'#64748b'}}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminMemberProfile() {
  const params   = useParams();
  const router   = useRouter();
  const memberId = params?.id;
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;

  const [member,   setMember]    = useState(null);
  const [form,     setForm]      = useState(null);
  const [capital,  setCapital]   = useState(null);
  const [loading,  setLoading]   = useState(true);
  const [saving,   setSaving]    = useState(false);
  const [toast,    setToast]     = useState('');
  const [showPrint,setShowPrint] = useState(false);
  const [editMode, setEditMode]  = useState(false);
  const [memberStatus, setMemberStatus] = useState(null); // track live exit state

  const showToast = (msg,err=false) => { setToast({msg,err}); setTimeout(()=>setToast(''),3000); };
  const set = (k,v) => setForm(p=>({...p,[k]:v}));

  const handleMemberUpdate = useCallback((patch) => {
    setMember(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!orgId||!memberId) return;
    (async () => {
      const [uSnap,mSnap,paySnap,feeSnap,distSnap,loanSnap,expSnap,allPaySnap] = await Promise.all([
        getDoc(doc(db,'users',memberId)),
        getDoc(doc(db,'organizations',orgId,'members',memberId)),
        getDocs(query(collection(db,'organizations',orgId,'investments'),where('userId','==',memberId))),
        getDocs(query(collection(db,'organizations',orgId,'entryFees'),where('userId','==',memberId))),
        getDocs(collection(db,'organizations',orgId,'profitDistributions')),
        getDocs(query(collection(db,'organizations',orgId,'loans'),where('userId','==',memberId))),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'investments')),  // org-wide for expense ratio
      ]);
      const u  = uSnap.exists() ? uSnap.data() : {};
      const m  = mSnap.exists() ? mSnap.data() : {};
      const merged = {id:memberId,...u,...m};
      setMember(merged);
      setForm({...merged});
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;

      // Capital: only contribution payments
      const myPay = paySnap.docs.map(d=>d.data());
      const ver   = myPay.filter(p=>p.status==='verified' && p.isContribution !== false);
      const memberCapital = ver.reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);

      // Org-wide capital (for expense proportion)
      const orgCapital = allPaySnap.docs.map(d=>d.data())
        .filter(p=>p.status==='verified' && p.isContribution !== false)
        .reduce((s,p)=>s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)),0);

      // Entry & re-reg fees paid (non-refundable)
      const feesTotal = feeSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);

      // Profit distributions received
      const profitTotal = distSnap.docs
        .filter(d=>d.data().status==='distributed')
        .reduce((s,d)=>{
          const share = (d.data().memberShares||[]).find(ms=>ms.userId===memberId);
          return s + (share?.shareAmount||0);
        },0);

      // Active loan outstanding
      const loanOutstanding = loanSnap.docs.map(d=>d.data())
        .filter(l=>l.status==='disbursed')
        .reduce((s,l)=>s+(l.outstandingBalance||0),0);

      // Member's proportional share of org expenses
      const orgExpenses = expSnap.docs.reduce((s,d)=>s+(d.data().amount||0),0);
      const expenseProportion = orgCapital > 0 ? memberCapital / orgCapital : 0;
      const memberExpenseShare = Math.round(orgExpenses * expenseProportion);

      // Returnable capital
      const returnable = memberCapital - memberExpenseShare - feesTotal - loanOutstanding + profitTotal;

      setCapital({
        total:           memberCapital,
        verifiedCount:   ver.length,
        pendingCount:    myPay.filter(p=>p.status==='pending').length,
        // Exit accounting fields
        feesTotal,
        profitTotal,
        loanOutstanding,
        orgExpenses,
        memberExpenseShare,
        expenseProportion,
        returnable:      Math.max(0, returnable),  // can't return negative
        returnableRaw:   returnable,               // show actual even if negative
      });
      setLoading(false);
    })();
  }, [orgId, memberId]);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const now = serverTimestamp();
      await updateDoc(doc(db,'organizations',orgId,'members',memberId),{
        nameEnglish:        form.nameEnglish,
        nameBengali:         form.nameBengali,
        fatherNameEn:       form.fatherNameEn,
        fatherNameBn:       form.fatherNameBn,
        motherNameEn:       form.motherNameEn,
        motherNameBn:       form.motherNameBn,
        dob:                form.dob,
        nid:                form.nid,
        bloodGroup:         form.bloodGroup,
        maritalStatus:      form.maritalStatus,
        spouseNameEn:       form.spouseNameEn,       // ← new
        spouseNameBn:       form.spouseNameBn,       // ← new
        education:          form.education,
        occupation:         form.occupation,
        monthlyIncome:      form.monthlyIncome,      // ← new
        phone:              form.phone,
        alternativePhone:   form.alternativePhone,   // ← new
        presentAddressEn:   form.presentAddressEn,
        presentAddressBn:   form.presentAddressBn,
        permanentAddressEn: form.permanentAddressEn,
        permanentAddressBn: form.permanentAddressBn,
        joiningDate:        form.joiningDate,
        heirNameEn:         form.heirNameEn,
        heirNameBn:         form.heirNameBn,
        heirRelation:       form.heirRelation,
        heirFatherHusbandEn:form.heirFatherHusbandEn,
        heirFatherHusbandBn:form.heirFatherHusbandBn,
        heirNID:            form.heirNID,
        heirPhone:          form.heirPhone,
        heirAddressEn:      form.heirAddressEn,
        heirAddressBn:      form.heirAddressBn,
        applicationNo:      form.applicationNo,
        applicationDate:    form.applicationDate,
        agreementNo:        form.agreementNo,
        agreementDate:      form.agreementDate,
        legalPapersLink:    form.legalPapersLink,
        profileUpdatedAt:   now,
        profileSubmitted:   true,
      });
      await updateDoc(doc(db,'users',memberId),{
        nameEnglish: form.nameEnglish,
        nameBengali:  form.nameBengali,
        bloodGroup:  form.bloodGroup,
        occupation:  form.occupation,
        phone:       form.phone,
      });
      setMember(prev=>({...prev,...form,profileUpdatedAt:{seconds:Date.now()/1000}}));
      setEditMode(false);
      showToast('✅ Profile updated!');
    } catch(e) { showToast(e.message,true); }
    setSaving(false);
  };

  const photoRef = useRef(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const handleAdminPhotoUpload = async (file) => {
    if (!file) return;
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file',    file);
      fd.append('orgId',   orgId   || '');
      fd.append('orgName', orgData?.name || '');
      fd.append('subfolder', 'members-papers');
      if (member.memberDriveFolderId) fd.append('memberFolderId', member.memberDriveFolderId);
      else if (orgData?.driveFolderId) fd.append('driveFolderId', orgData.driveFolderId);
      const res  = await fetch('/api/upload', { method:'POST', body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await updateDoc(doc(db,'organizations',orgId,'members',memberId),
        { photoURL: data.viewUrl,
          ...(data.newMemberFolderId?{memberDriveFolderId:data.newMemberFolderId}:{}) });
      await updateDoc(doc(db,'users',memberId), { photoURL: data.viewUrl });
      setMember(prev=>({...prev,photoURL:data.viewUrl}));
      setForm(prev=>({...prev,photoURL:data.viewUrl}));
      showToast('✅ Photo updated!');
    } catch(e) { showToast(e.message,true); }
    setPhotoUploading(false);
  };

  if (!isOrgAdmin) return null;
  if (loading) return <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>;
  if (!member) return <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Member not found.</div>;

  const displayData = editMode ? form : member;

  const VIEW_PERSONAL = [
    ['Name (English)',         displayData.nameEnglish],
    ['Name (বাংলা)',            displayData.nameBengali],
    ["Father's (English)",     displayData.fatherNameEn||displayData.fatherName],
    ["Father's (বাংলা)",       displayData.fatherNameBn],
    ["Mother's (English)",     displayData.motherNameEn||displayData.motherName],
    ["Mother's (বাংলা)",       displayData.motherNameBn],
    ['Date of Birth',          displayData.dob],
    ['NID',                    displayData.nid],
    ['Blood Group',            displayData.bloodGroup],
    ['Marital Status',         displayData.maritalStatus],
    ['Spouse Name (English)',  displayData.spouseNameEn],   // ← new
    ['Spouse Name (বাংলা)',    displayData.spouseNameBn],   // ← new
    ['Education',              displayData.education],
    ['Occupation',             displayData.occupation],
    ['Monthly Income',         displayData.monthlyIncome],  // ← new
    ['Phone',                  displayData.phone],
    ['Alternative Phone',      displayData.alternativePhone], // ← new
    ['Email',                  displayData.email],
    ['Joining Date',           fmtDate(displayData.joiningDate||displayData.createdAt)],
  ];
  const VIEW_ADDR = [
    ['Present (English)',   displayData.presentAddressEn||displayData.presentAddress||displayData.address],
    ['Present (বাংলা)',     displayData.presentAddressBn],
    ['Permanent (English)', displayData.permanentAddressEn||displayData.permanentAddress],
    ['Permanent (বাংলা)',   displayData.permanentAddressBn],
  ];
  const VIEW_HEIR = [
    ['Heir Name (En)',            displayData.heirNameEn||displayData.heirName||displayData.nomineeNameEnglish],
    ['Heir Name (বাংলা)',         displayData.heirNameBn||displayData.nomineenameBengali],
    ['Relationship',             displayData.heirRelation||displayData.nomineeRelationship],
    ["Father/Husband (En)",      displayData.heirFatherHusbandEn],
    ["Father/Husband (বাংলা)",   displayData.heirFatherHusbandBn],
    ['Heir NID / Birth Cert',    displayData.heirNID||displayData.nomineeNID],
    ['Heir Phone',               displayData.heirPhone||displayData.nomineePhone],
    ['Heir Address (En)',        displayData.heirAddressEn||displayData.heirAddress],
    ['Heir Address (বাংলা)',      displayData.heirAddressBn],
  ];
  const VIEW_LEGAL = [
    ['Application No.',  displayData.applicationNo],
    ['Application Date', displayData.applicationDate],
    ['Agreement No.',    displayData.agreementNo],
    ['Agreement Date',   displayData.agreementDate],
    ['Legal Papers Link',displayData.legalPapersLink],
  ];

  const EDIT_PERSONAL = [
    ['nameEnglish','Name (English)','text'],
    ['nameBengali','Name (বাংলা)','text'],
    ['fatherNameEn',"Father's Name (English)",'text'],
    ['fatherNameBn',"Father's Name (বাংলা)",'text'],
    ['motherNameEn',"Mother's Name (English)",'text'],
    ['motherNameBn',"Mother's Name (বাংলা)",'text'],
    ['dob','Date of Birth','date'],
    ['nid','NID','text'],
    ['bloodGroup','Blood Group','select',BLOOD_GROUPS],
    ['maritalStatus','Marital Status','select',MARITAL_STATUS],
    ['spouseNameEn','Spouse Name (English)','text'],   // ← new
    ['spouseNameBn','Spouse Name (বাংলা)','text'],     // ← new
    ['education','Education','select',EDUCATION],
    ['occupation','Occupation','text'],
    ['monthlyIncome','Monthly Income','text'],          // ← new
    ['phone','Phone','text'],
    ['alternativePhone','Alternative Phone','text'],    // ← new
    ['joiningDate','Joining Date','date'],
  ];
  const EDIT_ADDR = [
    ['presentAddressEn','Present Address (English)','textarea',null,true],
    ['presentAddressBn','Present Address (বাংলা)','textarea',null,true],
    ['permanentAddressEn','Permanent Address (English)','textarea',null,true],
    ['permanentAddressBn','Permanent Address (বাংলা)','textarea',null,true],
  ];
  const EDIT_HEIR = [
    ['heirNameEn','Heir Name (English)','text'],
    ['heirNameBn','Heir Name (বাংলা)','text'],
    ['heirRelation','Relationship','text'],
    ['heirFatherHusbandEn',"Father/Husband (En)",'text'],
    ['heirFatherHusbandBn',"Father/Husband (বাংলা)",'text'],
    ['heirNID','Heir NID / Birth Cert','text'],
    ['heirPhone','Heir Phone','text'],
    ['heirAddressEn','Heir Address (English)','textarea',null,true],
    ['heirAddressBn','Heir Address (বাংলা)','textarea',null,true],
  ];
  const EDIT_LEGAL = [
    ['applicationNo','Application No.','text'],
    ['applicationDate','Application Date','date'],
    ['agreementNo','Agreement No.','text'],
    ['agreementDate','Agreement Date','date'],
    ['legalPapersLink','Google Drive Link (Legal Papers)','text'],
  ];

  return (
    <div className="page-wrap animate-fade">
      {showPrint && (
        <PrintModal member={editMode?form:member} orgData={orgData}
          capital={capital} onClose={()=>setShowPrint(false)}/>
      )}

      {/* Header */}
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',
          alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <button onClick={()=>router.push('/admin/members')}
              style={{background:'none',border:'none',cursor:'pointer',
                color:'#64748b',fontSize:13,fontWeight:600,padding:'4px 0'}}>
              ← Members
            </button>
            <div>
              <div className="page-title">{member.nameEnglish||'Member Profile'}</div>
              <div className="page-subtitle">
                ID: {member.idNo||'—'} ·{' '}
                {(member.memberStatus==='archived'||memberStatus==='archived')
                  ? <span style={{color:'#d97706',fontWeight:700}}>📦 Archived</span>
                  : (member.memberStatus==='terminated'||memberStatus==='terminated')
                  ? <span style={{color:'#dc2626',fontWeight:700}}>⛔ Terminated</span>
                  : member.approved
                  ? <span style={{color:'#15803d',fontWeight:700}}>✅ Active</span>
                  : <span style={{color:'#d97706',fontWeight:700}}>⏳ Pending</span>}
                {member.profileUpdatedAt &&
                  ` · Updated: ${fmtTS(member.profileUpdatedAt)}`}
              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={()=>setShowPrint(true)}
              style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,fontWeight:600,color:'#475569'}}>
              🖨 Print / PDF
            </button>
            <button onClick={()=>downloadCSV([memberToCSVRow(member)],`member-${member.idNo||memberId}.csv`)}
              style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,fontWeight:600,color:'#475569'}}>
              ⬇ CSV
            </button>
            {editMode ? (
              <>
                <button onClick={handleSave} disabled={saving}
                  className="btn-primary" style={{padding:'8px 20px'}}>
                  {saving?'Saving…':'Save'}
                </button>
                <button onClick={()=>{setForm({...member});setEditMode(false);}}
                  style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e2e8f0',
                    background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={()=>setEditMode(true)}
                className="btn-primary" style={{padding:'8px 18px'}}>
                ✏️ Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,
          fontSize:13,fontWeight:600,
          background:toast.err?'#fee2e2':'#dcfce7',
          color:toast.err?'#b91c1c':'#15803d'}}>
          {toast.msg}
        </div>
      )}

      {/* Photo strip */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
        padding:'16px 20px',marginBottom:14,
        display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{position:'relative',flexShrink:0}}>
          <div style={{width:80,height:80,borderRadius:'50%',overflow:'hidden',
            border:'3px solid #bfdbfe',background:'#dbeafe',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:28,fontWeight:700,color:'#1d4ed8',cursor:'pointer'}}
            onClick={()=>photoRef.current?.click()}>
            {member.photoURL
              ? <img src={member.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
              : (member.nameEnglish?.[0]||'?')}
          </div>
          <button onClick={()=>photoRef.current?.click()} disabled={photoUploading}
            style={{position:'absolute',bottom:0,right:0,width:24,height:24,
              borderRadius:'50%',background:'#0f172a',border:'2px solid #fff',
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:11,color:'#fff'}}>
            {photoUploading?'…':'📷'}
          </button>
          <input ref={photoRef} type="file" accept="image/*" style={{display:'none'}}
            onChange={e=>handleAdminPhotoUpload(e.target.files?.[0])}/>
        </div>
        {member.nomineePhotoURL && (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
            <div style={{width:56,height:56,borderRadius:8,overflow:'hidden',
              border:'2px solid #e2e8f0',background:'#f1f5f9'}}>
              <img src={member.nomineePhotoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt="Nominee"/>
            </div>
            <span style={{fontSize:9,color:'#94a3b8',fontWeight:600}}>NOMINEE</span>
          </div>
        )}
        <div style={{flex:1,display:'grid',
          gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}>
          {[
            {label:'Member ID',    value:member.idNo},
            {label:'Capital',      value:capital?fmt(capital.total):'…'},
            {label:'Blood Group',  value:member.bloodGroup},
            {label:'Status',
              value: (member.memberStatus==='archived'||memberStatus==='archived') ? '📦 Archived'
                   : (member.memberStatus==='terminated'||memberStatus==='terminated') ? '⛔ Terminated'
                   : member.approved ? '✅ Active' : '⏳ Pending'},
            {label:'Profile',      value:member.profileSubmitted?'Submitted':'Not submitted'},
            {label:'Last Updated', value:fmtTS(member.profileUpdatedAt)},
          ].map(({label,value})=>(
            <div key={label} style={{background:'#f8fafc',borderRadius:7,padding:'8px 10px'}}>
              <div style={{fontSize:9,fontWeight:700,color:'#94a3b8',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{label}</div>
              <div style={{fontSize:12,fontWeight:600,color:'#0f172a'}}>{value||'—'}</div>
            </div>
          ))}
        </div>
      </div>

      {editMode ? (
        <>
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0',
            padding:'16px 20px', marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:13, color:'#0f172a', marginBottom:12 }}>📷 Photos</div>
            <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <div style={{ width:80, height:80, borderRadius:'50%', overflow:'hidden',
                  border:'3px solid #bfdbfe', background:'#dbeafe',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:28, fontWeight:700, color:'#1d4ed8' }}>
                  {form.photoURL
                    ? <img src={form.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt=""/>
                    : (form.nameEnglish?.[0]||'?')}
                </div>
                <AdminPhotoUpload
                  label="Member Photo"
                  currentUrl={form.photoURL}
                  orgId={orgId} orgData={orgData}
                  memberId={memberId} memberFolderId={form.memberDriveFolderId}
                  onUploaded={url => set('photoURL', url)}
                />
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <div style={{ width:60, height:75, borderRadius:8, overflow:'hidden',
                  border:'2px solid #e2e8f0', background:'#f1f5f9',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>
                  {form.nomineePhotoURL
                    ? <img src={form.nomineePhotoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt=""/>
                    : '👤'}
                </div>
                <AdminPhotoUpload
                  label="Nominee Photo"
                  currentUrl={form.nomineePhotoURL}
                  orgId={orgId} orgData={orgData}
                  memberId={memberId} memberFolderId={form.memberDriveFolderId}
                  onUploaded={url => set('nomineePhotoURL', url)}
                />
              </div>
            </div>
          </div>
          <EditSection title="👤 Personal" fields={EDIT_PERSONAL} form={form} set={set}/>
          <EditSection title="📍 Address" fields={EDIT_ADDR}     form={form} set={set}/>
          <EditSection title="👨‍👩‍👧 Nominee" fields={EDIT_HEIR}     form={form} set={set}/>
          <EditSection title="📋 Legal & Agreement" fields={EDIT_LEGAL} form={form} set={set}/>
        </>
      ) : (
        <>
          <ViewSection title="👤 Personal Information" rows={VIEW_PERSONAL}/>
          <ViewSection title="📍 Address Information"  rows={VIEW_ADDR}/>
          <ViewSection title="👨‍👩‍👧 Nominee / Heir"       rows={VIEW_HEIR}/>
          <ViewSection title="📋 Legal & Agreement"    rows={VIEW_LEGAL}/>
        </>
      )}

      {/* Documents section — always visible */}
      <AdminMemberFiles
        member={member}
        orgId={orgId}
        onMemberUpdate={handleMemberUpdate}
      />

      {/* Exit Workflow — always shown at bottom for admin */}
      <ExitWorkflow
        member={member}
        capital={capital}
        orgId={orgId}
        orgData={orgData}
        memberId={memberId}
        onExited={(type) => {
          setMemberStatus(type);
          setMember(prev => ({...prev, memberStatus:type, approved:false}));
          showToast(type==='archived'
            ? '📦 Member archived successfully.'
            : '⛔ Member terminated.');
        }}
      />
    </div>
  );
}