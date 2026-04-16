// src/app/members/page.js  — Member Directory (table view, feature-gated)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const getInitials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

const BLOOD_BG = { 
  'A+': '#fee2e2', 
  'A-': '#fee2e2', 
  'B+': '#fee2e2', 
  'B-': '#fee2e2', 
  'AB+': '#fee2e2', 
  'AB-': '#fee2e2', 
  'O+': '#fee2e2', 
  'O-': '#fee2e2' 
};

function Avatar({ m, size=30 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:size*0.36, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
      {m.photoURL ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : getInitials(m.nameEnglish)}
    </div>
  );
}

export default function MemberDirectory() {
  const { userData, orgData } = useAuth();
  const [members, setMembers] = useState([]);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');

  const orgId    = userData?.activeOrgId;
  const orgF     = orgData?.orgFeatures || {};

  useEffect(() => {
    if (!orgId || !orgF.memberDirectory) return;
    const unsub = onSnapshot(collection(db, 'organizations', orgId, 'members'), async snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.approved);
      const merged = await Promise.all(docs.map(async m => {
        try {
          const uSnap = await getDoc(doc(db, 'users', m.id));
          return uSnap.exists() ? { ...uSnap.data(), ...m } : m;
        } catch { return m; }
      }));
      setMembers(merged.sort((a,b) => (a.nameEnglish||'').localeCompare(b.nameEnglish||'')));
    });
    return unsub;
  }, [orgId, orgF.memberDirectory]);

  if (!orgF.memberDirectory) {
    return (
      <div className="page-wrap animate-fade">
        <div style={{ textAlign:'center', padding:'80px 20px' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
          <div style={{ fontWeight:700, fontSize:18, color:'#0f172a', marginBottom:8 }}>Member Directory Not Available</div>
          <div style={{ fontSize:14, color:'#64748b' }}>This feature is not enabled for your organization.</div>
        </div>
      </div>
    );
  }

  const bloodGroups    = [...new Set(members.map(m => m.bloodGroup).filter(Boolean))].sort();
  const committeeRoles = [...new Set(members.map(m => m.committeeRole).filter(Boolean))].sort();

  const filtered = members.filter(m => {
    const q  = search.toLowerCase();
    const sf = !search
      || (m.nameEnglish||'').toLowerCase().includes(q)
      || (m.phone||'').includes(search)
      || (m.email||'').toLowerCase().includes(q)
      || (m.bloodGroup||'').toLowerCase().includes(q)
      || (m.committeeRole||'').toLowerCase().includes(q)
      || (m.idNo||'').includes(search);
    const ff = filter === 'all' || filter === m.bloodGroup || filter === m.committeeRole;
    return sf && ff;
  });

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">Member Directory</div>
          <div className="page-subtitle">{members.length} approved member{members.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Search + filter */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, email, blood group, ID…"
          style={{ flex:1, minWidth:180 }} />
        {(bloodGroups.length > 0 || committeeRoles.length > 0) && (
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ minWidth:160 }}>
            <option value="all">All Members</option>
            {bloodGroups.length > 0 && (
              <optgroup label="Blood Group">
                {bloodGroups.map(bg => <option key={bg} value={bg}>🩸 {bg}</option>)}
              </optgroup>
            )}
            {orgF.committeeRoles && committeeRoles.length > 0 && (
              <optgroup label="Committee Role">
                {committeeRoles.map(r => <option key={r} value={r}>🎖️ {r}</option>)}
              </optgroup>
            )}
          </select>
        )}
      </div>

      {/* ── Member cards — mobile-first, no horizontal scroll ── */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>
          {search || filter !== 'all' ? 'No members match your search.' : 'No approved members yet.'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map((m, i) => {
            const role        = (orgF.committeeRoles && m.committeeRole) ? m.committeeRole : 'Member';
            const isCommittee = orgF.committeeRoles && !!m.committeeRole;
            return (
              <div key={m.id}
                style={{ background:'#fff', borderRadius:12, border:'1px solid #e2e8f0',
                  padding:'12px 14px', display:'flex', alignItems:'center', gap:12 }}>

                {/* Serial number */}
                <div style={{ fontSize:12, color:'#cbd5e1', fontWeight:600,
                  width:22, textAlign:'center', flexShrink:0 }}>
                  {i + 1}
                </div>

                {/* Avatar */}
                <Avatar m={m} size={40} />

                {/* Name + role + contact */}
                <div style={{ flex:1, minWidth:0 }}>

                  {/* Row 1: Name + Blood group pill — right edge */}
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, fontSize:13, color:'#0f172a',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {m.nameEnglish || '(no name)'}
                    </span>
                    
                    {m.bloodGroup && (
                  <div style={{ flexShrink:0 }}>
                    <span style={{ padding:'3px 10px', borderRadius:99, fontSize:12,
                      fontWeight:700, whiteSpace:'nowrap',
                      background: BLOOD_BG[m.bloodGroup] || '#f1f5f9', color:'#0f172a' }}>
                      {m.bloodGroup}
                    </span>
                  </div>
                )}
                  </div>

                  {/* Row 2: Bengali name if present */}
                  {m.nameBengali && (
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>
                      {m.nameBengali}
                    </div>
                  )}

                  {/* Row 3: Contact links */}
                  <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:4, alignItems:'center' }}>
                    {m.phone && (
                      <a href={`tel:${m.phone}`}
                        style={{ fontSize:12, color:'#2563eb', textDecoration:'none',
                          display:'flex', alignItems:'center', gap:3 }}>
                        ✆ {m.phone}
                      </a>
                    )}
                    {m.email && (
                      <a href={`mailto:${m.email}`}
                        style={{ fontSize:12, color:'#475569', textDecoration:'none',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                          maxWidth:200, display:'flex', alignItems:'center', gap:3 }}>
                        ✉ {m.email}
                      </a>
                    )}
                    {!m.phone && !m.email && (
                      <span style={{ fontSize:11, color:'#cbd5e1' }}>No contact info</span>
                    )}
                  </div>
                </div>

                {/*  role badge */}
                

                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px',
                      borderRadius:99, flexShrink:0, whiteSpace:'nowrap',
                      background: isCommittee ? '#eff6ff' : '#f1f5f9',
                      color:      isCommittee ? '#1d4ed8' : '#64748b',
                      border: isCommittee ? '1px solid #bfdbfe' : '1px solid #e2e8f0' }}>
                      {isCommittee ? '🎖️ ' : ''}{role}
                    </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}