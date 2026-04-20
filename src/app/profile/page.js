// src/app/profile/page.js
'use client';
import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { createPortal } from 'react-dom';

// ✅ GAS CONFIG
const GAS_URL = "https://script.google.com/macros/s/AKfycbyQ6L2d3SfAynofqAHfb1jHSn6ZA18pv2ABgXZDLNDR-DHtEyIxYEb8tCCsDBwbk0RF/exec";
const SECRET = "absis-secret-123";

// 🔹 Upload to GAS (with user folder)
async function uploadUserFileToGAS(file, idNo, userName, type, memberId, userFolderId) {
  const base64 = await toBase64(file);
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight
    body: JSON.stringify({
      action:       "uploadProfileFile",
      secret:       SECRET,
      file:         base64.split(",")[1],
      fileName:     file.name,
      mimeType:     file.type,
      userId:       idNo,
      userName,
      memberId,
      userFolderId,
      type,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

const BLOOD_GROUPS   = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const MARITAL_STATUS = ['Single','Married','Divorced','Widowed'];
const EDUCATION      = ["No Formal Education","Primary","Secondary (SSC)",
  "Higher Secondary (HSC)","Diploma","Bachelor's","Master's","PhD","Other"];

function fmtTS(ts) {
  if (!ts) return null;
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload  = () => resolve(reader.result);
  reader.onerror = (error) => reject(error);
});

function Section({ title, children }) {
  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
      overflow:'hidden',marginBottom:16}}>
      <div style={{padding:'11px 16px',background:'#f8fafc',
        borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#0f172a'}}>
        {title}
      </div>
      <div style={{padding:'16px',display:'grid',
        gridTemplateColumns:'repeat(auto-fit, minmax(220px,1fr))',gap:14}}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div style={{gridColumn:full?'1/-1':undefined}}>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',
        textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:5}}>
        {label}
      </label>
      {children}
    </div>
  );
}

function BiField({ labelEn, labelBn, keyEn, keyBn, form, set }) {
  return (
    <>
      <Field label={labelEn}>
        <input value={form[keyEn]||''} onChange={e=>set(keyEn,e.target.value)}
          placeholder={`${labelEn} (English)`}/>
      </Field>
      <Field label={labelBn}>
        <input value={form[keyBn]||''} onChange={e=>set(keyBn,e.target.value)}
          placeholder={`${labelBn} (বাংলা)`}/>
      </Field>
    </>
  );
}

// ── File preview modal ────────────────────────────────────────────────────────
function FilePreviewModal({ file, onClose }) {
  if (!file || typeof document === 'undefined') return null;
  const fIcon = (mime='') => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf'))      return '📕';
    if (mime.includes('word')||mime.includes('document')) return '📝';
    return '📄';
  };
  const fileUrl = file.url || file.viewUrl;
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
          <a href={fileUrl} target="_blank" rel="noreferrer"
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
              <img src={fileUrl} alt={file.name}
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
              <a href={fileUrl} target="_blank" rel="noreferrer"
                style={{color:'#2563eb',marginLeft:4}}>Open in Drive ↗</a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Uploaded files viewer (read-only for member) ──────────────────────────────
function MemberFileViewer({ legalFiles = [] }) {
  const [preview,   setPreview]   = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  const adminFiles  = legalFiles.filter(f => f.uploadedBy === 'admin');
  const memberFiles = legalFiles.filter(f => f.uploadedBy !== 'admin');
  const filtered    = activeTab === 'all'    ? legalFiles
                    : activeTab === 'admin'  ? adminFiles
                    : memberFiles;

  const fIcon = (mime='') => {
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.includes('pdf'))      return '📕';
    if (mime.includes('word')||mime.includes('document')) return '📝';
    return '📄';
  };

  if (legalFiles.length === 0) {
    return (
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
        overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'11px 16px',background:'#f8fafc',
          borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#0f172a'}}>
          📁 My Documents
        </div>
        <div style={{textAlign:'center',padding:'32px 20px',color:'#94a3b8',fontSize:13}}>
          No documents uploaded yet.
        </div>
      </div>
    );
  }

  return (
    <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
      overflow:'hidden',marginBottom:16}}>

      {/* Header */}
      <div style={{padding:'11px 16px',background:'#f8fafc',
        borderBottom:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#0f172a',
        display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>📁 My Documents</span>
        <span style={{fontSize:11,fontWeight:500,color:'#64748b'}}>
          {legalFiles.length} file{legalFiles.length!==1?'s':''}
        </span>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:0,borderBottom:'1px solid #e2e8f0',background:'#f8fafc'}}>
        {[
          ['all',    'All Files',       legalFiles.length],
          ['admin',  'From Admin',      adminFiles.length],
          ['member', 'My Uploads',      memberFiles.length],
        ].map(([key,label,count])=>(
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
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Files */}
      {filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'24px',color:'#94a3b8',fontSize:13}}>
          No files in this category.
        </div>
      ) : (
        <div>
          {filtered.map((f, i) => {
            const isAdmin = f.uploadedBy === 'admin';
            const fileUrl = f.url || f.viewUrl;
            return (
              <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,
                padding:'10px 16px',background:i%2===0?'#fff':'#fafafa',
                borderBottom:'1px solid #f1f5f9'}}>
                <span style={{fontSize:20,flexShrink:0,marginTop:2}}>{fIcon(f.mimeType)}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#0f172a',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {f.title || f.name}
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:3,alignItems:'center'}}>
                    {f.category && (
                      <span style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:999,
                        background: isAdmin ? '#eff6ff' : '#f0fdf4',
                        color:      isAdmin ? '#1d4ed8' : '#15803d',
                        border:`1px solid ${isAdmin?'#bfdbfe':'#bbf7d0'}`}}>
                        {f.category}
                      </span>
                    )}
                    <span style={{fontSize:10,padding:'1px 7px',borderRadius:999,
                      background: isAdmin ? '#fef3c7' : '#f1f5f9',
                      color:      isAdmin ? '#92400e' : '#64748b',
                      border:`1px solid ${isAdmin?'#fde68a':'#e2e8f0'}`}}>
                      {isAdmin ? '👤 From Admin' : '🧑 My Upload'}
                    </span>
                    {f.uploadedAt && (
                      <span style={{fontSize:10,color:'#94a3b8'}}>
                        {new Date(f.uploadedAt).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </div>
                  {f.description && (
                    <div style={{fontSize:11,color:'#64748b',marginTop:4,
                      overflow:'hidden',textOverflow:'ellipsis',
                      display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
                      {f.description}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',gap:6,flexShrink:0,alignSelf:'center'}}>
                  <button onClick={()=>setPreview(f)}
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
          })}
        </div>
      )}

      <FilePreviewModal file={preview} onClose={()=>setPreview(null)}/>
    </div>
  );
}

// ── Upload status badge ───────────────────────────────────────────────────────
function UploadStatus({ result }) {
  if (!result) return null;
  return (
    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,padding:'5px 8px',
      borderRadius:6,background:'#f0fdf4',border:'1px solid #bbf7d0'}}>
      <span style={{fontSize:11}}>✅</span>
      <a href={result.url} target="_blank" rel="noreferrer"
        style={{fontSize:11,color:'#15803d',fontWeight:600,textDecoration:'none',
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
        {result.name} ↗
      </a>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, userData, orgData, viewUid, isViewingAsMember } = useAuth();
  const orgId    = userData?.activeOrgId;
  const photoRef   = useRef(null);
  const nomineeRef = useRef(null);
  const otherRef   = useRef(null); // ref for the "other" file input

  const [form,          setForm]          = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [processing,    setProcessing]    = useState(false);
  const [toast,         setToast]         = useState('');
  const [lastUpdated,   setLastUpdated]   = useState(null);
  const [profileLocked, setProfileLocked] = useState(false);
  const [legalFiles,    setLegalFiles]    = useState([]);

  // Track upload results per type for inline status
  const [uploadResults, setUploadResults] = useState({
    nid:          null,
    nomineeNid:   null,
    nomineePhoto: null,
    others:       [], // array of {name, url} for multi-file
  });

  // Upload a single file and save to Firestore
  const handleUserFileUpload = async (file, type) => {
    if (!file) return;
    setProcessing(true);
    try {
      const res = await uploadUserFileToGAS(
        file,
        form?.idNo,
        form.nameEnglish || "User",
        type,
        form?.idNo,
        userData?.driveFolderId
      );

      if (res.folderId) {
        await updateDoc(doc(db, "users", viewUid), {
          driveFolderId: res.folderId
        });
      }

      if (!res.success) throw new Error(res.error);

      // Build file record — always include fileId so preview iframe works
      const newFile = {
        name:       file.name,
        title:      file.name,
        url:        res.url,
        fileId:     res.fileId,   // ← required for Google Drive iframe preview
        mimeType:   file.type,
        uploadedBy: 'member',
        uploadedAt: new Date().toISOString(),
        category:   type === 'nid'           ? 'Identity Document'
                  : type === 'nomineeNid'    ? 'Identity Document'
                  : type === 'nomineePhoto'  ? 'Identity Document'
                  : 'Other',
      };

      const updatedFiles = [...legalFiles, newFile];

      // Persist to Firestore — admin can see it on the member details page
      await updateDoc(doc(db, 'organizations', orgId, 'members', viewUid), {
        legalFiles: updatedFiles,
      });
      setLegalFiles(updatedFiles);

      // Update inline status
      setUploadResults(prev => {
        if (type === 'other') {
          return { ...prev, others: [...prev.others, res] };
        }
        return { ...prev, [type]: res };
      });

      showToast("File uploaded successfully ✅");
    } catch (e) {
      showToast(e.message || 'Upload failed', true);
    }
    setProcessing(false);
  };

  // Handle multiple "other" file uploads sequentially
  const handleMultipleOtherUploads = async (files) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await handleUserFileUpload(file, 'other');
    }
    // Reset the input so the same files can be re-selected if needed
    if (otherRef.current) otherRef.current.value = '';
  };

  const showToast = (msg, err=false) => {
    setToast({msg,err}); setTimeout(()=>setToast(''),4000);
  };

  useEffect(() => {
    if (!user || !orgId) return;
    const load = async () => {
      const [uSnap, mSnap] = await Promise.all([
        getDoc(doc(db, 'users', viewUid)),
        getDoc(doc(db, 'organizations', orgId, 'members', viewUid)),
      ]);
      const u = uSnap.exists() ? uSnap.data() : {};
      const m = mSnap.exists() ? mSnap.data() : {};
      const idNo = m.idNo || u.idNo || '';

      setForm({
        nameEnglish:        u.nameEnglish || u.displayName || '',
        nameBengali:        u.nameBengali || m.nameBengali || '',
        // fatherName / motherName are old join-page keys; fatherNameEn is the new standard
        fatherNameEn:       m.fatherNameEn || u.fatherNameEn || u.fatherName || '',
        fatherNameBn:       m.fatherNameBn || u.fatherNameBn || '',
        motherNameEn:       m.motherNameEn || u.motherNameEn || u.motherName || '',
        motherNameBn:       m.motherNameBn || u.motherNameBn || '',
        dob:                m.dob || u.dob || '',
        // nid lives on both docs; prefer member doc
        nid:                m.nid || u.nid || '',
        bloodGroup:         m.bloodGroup || '',
        maritalStatus:      m.maritalStatus || '',
        spouseNameEn:       m.spouseNameEn || '',
        spouseNameBn:       m.spouseNameBn || '',
        education:          m.education || '',
        occupation:         m.occupation  || u.occupation  || '',
        monthlyIncome:      m.monthlyIncome || '',
        phone:              u.phone || m.phone || '',
        alternativePhone:   m.alternativePhone || '',
        email:              u.email || '',
        // address: old join-page stored as 'address'; new standard is presentAddressEn
        presentAddressEn:   m.presentAddressEn || u.presentAddressEn || u.address || '',
        presentAddressBn:   m.presentAddressBn || '',
        permanentAddressEn: m.permanentAddressEn || '',
        permanentAddressBn: m.permanentAddressBn || '',
        heirNameEn:         m.heirNameEn || '',
        heirNameBn:         m.heirNameBn || '',
        heirRelation:       m.heirRelation || '',
        heirFatherHusbandEn:m.heirFatherHusbandEn || '',
        heirFatherHusbandBn:m.heirFatherHusbandBn || '',
        heirNID:            m.heirNID || '',
        heirPhone:          m.heirPhone || '',
        heirAddressEn:      m.heirAddressEn || '',
        heirAddressBn:      m.heirAddressBn || '',
        photoURL:           u.photoURL || '',
        nomineePhotoURL:    m.nomineePhotoURL || '',
        idNo,
      });

      // Load existing legal files
      setLegalFiles(m.legalFiles || []);
      setProfileLocked(!!m.profileSubmitted);
      setLastUpdated(m.profileUpdatedAt || u.profileUpdatedAt || null);
    };
    load();
  }, [viewUid, orgId]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handlePhotoUpload = async (file, isNominee=false) => {
    if (!file) return;
    if (file.size > 700 * 1024) {
      showToast("Image is too large. Please use a file under 700KB.", true);
      return;
    }
    setProcessing(true);
    try {
      const base64 = await toBase64(file);
      const urlKey = isNominee ? 'nomineePhotoURL' : 'photoURL';
      setForm(p => ({...p, [urlKey]: base64}));
    } catch(e) {
      showToast(`Processing failed: ${e.message}`, true);
    }
    setProcessing(false);
  };

  const handleSave = async () => {
    if (!form || effectiveLocked) return;
    setSaving(true);
    try {
      const now = serverTimestamp();
      await updateDoc(doc(db,'users',viewUid), {
        idNo:             form.idNo,
        nameEnglish:      form.nameEnglish,
        nameBengali:       form.nameBengali,
        phone:            form.phone,
        photoURL:         form.photoURL,
        bloodGroup:       form.bloodGroup,
        occupation:       form.occupation,
        profileUpdatedAt: now,
      });
      await setDoc(doc(db,'organizations',orgId,'members',viewUid), {
        ...form,
        profileUpdatedAt: now,
        profileSubmitted: true,
      }, { merge: true });
      setProfileLocked(true);
      setLastUpdated({ seconds: Date.now()/1000 });
      showToast('✅ Profile saved! Changes locked.');
    } catch(e) {
      console.error(e);
      showToast(e.message, true);
    }
    setSaving(false);
  };

  if (!form) return <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading…</div>;

  // SuperAdmin viewing as member: profile is read-only (SA sees the data, can't accidentally save)
  const effectiveLocked = profileLocked || isViewingAsMember;

  const memberId    = userData?.idNo || '—';
  const joiningDate = (() => {
    const ts = userData?.joiningDate||userData?.createdAt;
    if (!ts) return '—';
    const d = ts.seconds?new Date(ts.seconds*1000):new Date(ts);
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  })();

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
          <div>
            <div className="page-title">My Profile</div>
            <div className="page-subtitle">
              {profileLocked
                ? '⚠️ Profile already submitted. Contact an admin to make changes.'
                : 'Fill in all details carefully. You can submit only once.'}
            </div>
          </div>
          {!effectiveLocked && (
            <button onClick={handleSave} disabled={saving||processing}
              className="btn-primary" style={{padding:'10px 24px',flexShrink:0}}>
              {saving?'Saving…':'Submit Profile'}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,
          background:toast.err?'#fee2e2':'#dcfce7',color:toast.err?'#b91c1c':'#15803d'}}>
          {toast.msg}
        </div>
      )}

      {lastUpdated && (
        <div style={{padding:'8px 14px',borderRadius:8,background:'#f0f9ff',
          border:'1px solid #bae6fd',fontSize:12,color:'#1e40af',marginBottom:16}}>
          ✏️ Last updated: <strong>{fmtTS(lastUpdated)}</strong>
          {profileLocked && ' — Locked. Contact admin to edit.'}
        </div>
      )}

      {/* Photo + Member ID */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
        padding:'20px',marginBottom:16,display:'flex',gap:20,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,flexShrink:0}}>
          <div style={{width:96,height:96,borderRadius:'50%',overflow:'hidden',
            background:'#dbeafe',border:'3px solid #bfdbfe',
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:32,fontWeight:700,color:'#1d4ed8',cursor:profileLocked?'default':'pointer'}}
            onClick={()=>!profileLocked&&photoRef.current?.click()}>
            {form.photoURL
              ? <img src={form.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
              : (form.nameEnglish?.[0]||'?').toUpperCase()}
          </div>
          {!effectiveLocked && (
            <button onClick={()=>photoRef.current?.click()}
              disabled={processing}
              style={{padding:'5px 12px',borderRadius:7,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:11,color:'#475569',fontWeight:600}}>
              {processing?'Processing...':'📷 Photo'}
            </button>
          )}
          <input ref={photoRef} type="file" accept="image/*" style={{display:'none'}}
            onChange={e=>handlePhotoUpload(e.target.files?.[0])}/>
        </div>
        <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
          {[
            {label:'Member ID',    value:memberId},
            {label:'Joining Date', value:joiningDate},
            {label:'Email',        value:form.email},
            {label:'Status',       value:userData?.approved?'✅ Active':'⏳ Pending'},
          ].map(({label,value})=>(
            <div key={label} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#94a3b8',
                textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{label}</div>
              <div style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{value||'—'}</div>
            </div>
          ))}
        </div>
      </div>

      <Section title="👤 Personal Information">
        <BiField labelEn="Full Name (English)" labelBn="Full Name (বাংলা)"
          keyEn="nameEnglish" keyBn="nameBengali" form={form} set={set}/>
        <BiField labelEn="Father's Name (English)" labelBn="Father's Name (বাংলা)"
          keyEn="fatherNameEn" keyBn="fatherNameBn" form={form} set={set}/>
        <BiField labelEn="Mother's Name (English)" labelBn="Mother's Name (বাংলা)"
          keyEn="motherNameEn" keyBn="motherNameBn" form={form} set={set}/>
        <Field label="Date of Birth">
          <input type="date" value={form.dob} onChange={e=>set('dob',e.target.value)} disabled={effectiveLocked}/>
        </Field>
        <Field label="National ID (NID)">
          <input value={form.nid} onChange={e=>set('nid',e.target.value)} placeholder="NID number" disabled={effectiveLocked}/>
        </Field>
        <Field label="Blood Group">
          <select value={form.bloodGroup} onChange={e=>set('bloodGroup',e.target.value)} disabled={effectiveLocked}>
            <option value="">Select…</option>
            {BLOOD_GROUPS.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Marital Status">
          <select value={form.maritalStatus} onChange={e=>set('maritalStatus',e.target.value)} disabled={effectiveLocked}>
            <option value="">Select…</option>
            {MARITAL_STATUS.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <BiField labelEn="Spouse Name (English)" labelBn="Spouse Name (বাংলা)"
          keyEn="spouseNameEn" keyBn="spouseNameBn" form={form} set={set}/>
        <Field label="Education">
          <select value={form.education} onChange={e=>set('education',e.target.value)} disabled={effectiveLocked}>
            <option value="">Select…</option>
            {EDUCATION.map(e=><option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
        <Field label="Occupation">
          <input value={form.occupation} onChange={e=>set('occupation',e.target.value)} placeholder="e.g. Business" disabled={effectiveLocked}/>
        </Field>
        <Field label="Monthly Income (Approximate)">
          <input value={form.monthlyIncome} onChange={e=>set('monthlyIncome',e.target.value)} placeholder="e.g. 25000" disabled={effectiveLocked}/>
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+880…" disabled={effectiveLocked}/>
        </Field>
        <Field label="Alternative Phone">
          <input value={form.alternativePhone||''} onChange={e=>set('alternativePhone',e.target.value)} placeholder="+880…" disabled={effectiveLocked}/>
        </Field>
      </Section>

      <Section title="📍 Address Information">
        <Field label="Present Address (English)" full>
          <textarea value={form.presentAddressEn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('presentAddressEn',e.target.value)} placeholder="Present address (English)"/>
        </Field>
        <Field label="Present Address (বাংলা)" full>
          <textarea value={form.presentAddressBn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('presentAddressBn',e.target.value)} placeholder="বর্তমান ঠিকানা"/>
        </Field>
        <Field label="Permanent Address (English)" full>
          <textarea value={form.permanentAddressEn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('permanentAddressEn',e.target.value)} placeholder="Permanent address (English)"/>
        </Field>
        <Field label="Permanent Address (বাংলা)" full>
          <textarea value={form.permanentAddressBn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('permanentAddressBn',e.target.value)} placeholder="স্থায়ী ঠিকানা"/>
        </Field>
      </Section>

      <Section title="👨‍👩‍👧 Nominee / Heir Information">
        <Field label="Nominee Photo">
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:56,height:56,borderRadius:8,overflow:'hidden',
              background:'#f1f5f9',border:'1px solid #e2e8f0',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>
              {form.nomineePhotoURL
                ? <img src={form.nomineePhotoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>
                : '👤'}
            </div>
            {!effectiveLocked && (
              <button onClick={()=>nomineeRef.current?.click()}
                disabled={processing}
                style={{padding:'5px 12px',borderRadius:7,border:'1px solid #e2e8f0',
                  background:'#fff',cursor:'pointer',fontSize:11,color:'#475569',fontWeight:600}}>
                {processing?'Processing...':'📷 Upload'}
              </button>
            )}
            <input ref={nomineeRef} type="file" accept="image/*" style={{display:'none'}}
              onChange={e=>handlePhotoUpload(e.target.files?.[0],true)}/>
          </div>
        </Field>
        <BiField labelEn="Heir Name (English)" labelBn="Heir Name (বাংলা)"
          keyEn="heirNameEn" keyBn="heirNameBn" form={form} set={set}/>
        <Field label="Relationship">
          <input value={form.heirRelation} onChange={e=>set('heirRelation',e.target.value)}
            placeholder="e.g. Wife, Son, Father" disabled={effectiveLocked}/>
        </Field>
        <BiField labelEn="Husband's/Father's Name (En)" labelBn="Husband's/Father's Name (বাংলা)"
          keyEn="heirFatherHusbandEn" keyBn="heirFatherHusbandBn" form={form} set={set}/>
        <Field label="NID / Birth Certificate No.">
          <input value={form.heirNID} onChange={e=>set('heirNID',e.target.value)}
            placeholder="NID or birth cert number" disabled={effectiveLocked}/>
        </Field>
        <Field label="Heir Phone">
          <input value={form.heirPhone} onChange={e=>set('heirPhone',e.target.value)}
            placeholder="+880…" disabled={effectiveLocked}/>
        </Field>
        <Field label="Heir Address (English)" full>
          <textarea value={form.heirAddressEn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('heirAddressEn',e.target.value)} placeholder="Heir's address (English)"/>
        </Field>
        <Field label="Heir Address (বাংলা)" full>
          <textarea value={form.heirAddressBn} rows={2} disabled={effectiveLocked}
            onChange={e=>set('heirAddressBn',e.target.value)} placeholder="উত্তরাধিকারীর ঠিকানা"/>
        </Field>
      </Section>

      {/* Document Uploads — always show, but inputs disabled when locked */}
      <Section title="📂 Document Uploads">

        {/* NID */}
        <Field label="NID Document">
          <input type="file"
            disabled={profileLocked || processing}
            onChange={e => handleUserFileUpload(e.target.files?.[0], 'nid')}
          />
          <UploadStatus result={uploadResults.nid}/>
        </Field>

        {/* Nominee NID */}
        <Field label="Nominee NID">
          <input type="file"
            disabled={profileLocked || processing}
            onChange={e => handleUserFileUpload(e.target.files?.[0], 'nomineeNid')}
          />
          <UploadStatus result={uploadResults.nomineeNid}/>
        </Field>

        {/* Nominee Photo */}
        <Field label="Nominee Photo File">
          <input type="file"
            disabled={profileLocked || processing}
            onChange={e => handleUserFileUpload(e.target.files?.[0], 'nomineePhoto')}
          />
          <UploadStatus result={uploadResults.nomineePhoto}/>
          {!effectiveLocked && (
            <span style={{fontSize:12,color:'#fd0909',display:'block',marginTop:4}}>
              If not uploaded in Nominee / Heir section above
            </span>
          )}
        </Field>

        {/* Other files — multi-file */}
        <Field label="Other Documents" full>
          <input
            ref={otherRef}
            type="file"
            multiple
            disabled={profileLocked || processing}
            onChange={e => handleMultipleOtherUploads(e.target.files)}
          />
          <div style={{fontSize:11,color:'#64748b',marginTop:4}}>
            You can select multiple files at once.
          </div>
          {uploadResults.others.length > 0 && (
            <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:4}}>
              {uploadResults.others.map((f, i) => (
                <UploadStatus key={i} result={f}/>
              ))}
            </div>
          )}
        </Field>

        {/* Processing indicator */}
        {processing && (
          <Field label="" full>
            <div style={{fontSize:12,color:'#64748b',display:'flex',alignItems:'center',gap:6}}>
              <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⏳</span>
              Uploading to Drive, please wait…
            </div>
          </Field>
        )}
      </Section>

      {/* ── Uploaded files viewer ── */}
      <MemberFileViewer legalFiles={legalFiles}/>

      {!effectiveLocked && (
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8,gap:10}}>
          {processing ? (
            <span style={{fontSize:12,color:'#64748b',alignSelf:'center'}}>
              ⏳ Waiting for upload to complete…
            </span>
          ) : null}
          <button onClick={handleSave} disabled={saving||processing}
            className="btn-primary" style={{padding:'12px 32px',fontSize:14}}>
            {saving?'Saving…':'Submit Profile'}
          </button>
        </div>
      )}
    </div>
  );
}