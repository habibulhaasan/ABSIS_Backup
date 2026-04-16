'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function PlatformSettings() {
  const { isSuperAdmin } = useAuth();
  const [s, setS] = useState({ requireOrgApproval:true, maxOrgsPerUser:5, maxMembersFreeTier:20, platformName:'Capital Sync', supportEmail:'', maintenanceMode:false, allowNewRegistrations:true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'platform','settings'), snap => { if (snap.exists()) setS(p=>({...p,...snap.data()})); });
    return unsub;
  }, []);

  const save = async () => {
    setSaving(true);
    try { await setDoc(doc(db,'platform','settings'), s, {merge:true}); setSaved(true); setTimeout(()=>setSaved(false),3000); }
    catch (e) { alert(e.message); }
    setSaving(false);
  };

  const Toggle = ({ label, sub, k }) => (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'14px 0', borderBottom:'1px solid #f1f5f9', gap:12 }}>
      <div>
        <div style={{ fontSize:14, color:'#0f172a', fontWeight:500, marginBottom:2 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:'#64748b' }}>{sub}</div>}
      </div>
      <button type="button" onClick={()=>setS(p=>({...p,[k]:!p[k]}))}
        style={{ width:44, height:24, borderRadius:99, border:'none', cursor:'pointer', background:s[k]?'#2563eb':'#e2e8f0', position:'relative', flexShrink:0, marginTop:2 }}>
        <span style={{ position:'absolute', top:2, left:s[k]?20:2, width:20, height:20, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.15)', transition:'left 0.2s' }} />
      </button>
    </div>
  );

  if (!isSuperAdmin) return null;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{ fontSize:11, fontWeight:600, color:'#2563eb', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Super Admin</div>
        <div className="page-title">Platform Settings</div>
        <div className="page-subtitle">Global rules across all organizations</div>
      </div>
      {saved && <div className="alert alert-success">Platform settings saved.</div>}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="card">
          <div style={{ fontWeight:600, fontSize:14, marginBottom:16 }}>General</div>
          <div className="form-group"><label className="form-label">Platform Name</label><input value={s.platformName} onChange={e=>setS(p=>({...p,platformName:e.target.value}))} /></div>
          <div className="form-group"><label className="form-label">Support Email</label><input type="email" value={s.supportEmail} onChange={e=>setS(p=>({...p,supportEmail:e.target.value}))} placeholder="support@platform.com" /></div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
            <div className="form-group"><label className="form-label">Max Orgs / User</label><input type="number" min="1" value={s.maxOrgsPerUser} onChange={e=>setS(p=>({...p,maxOrgsPerUser:Number(e.target.value)}))} /></div>
            <div className="form-group"><label className="form-label">Free Members</label><input type="number" min="1" value={s.maxMembersFreeTier} onChange={e=>setS(p=>({...p,maxMembersFreeTier:Number(e.target.value)}))} /></div>
          </div>
        </div>
        <div className="card">
          <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>Access Controls</div>
          <Toggle label="Require Org Approval" sub="New orgs need superadmin approval" k="requireOrgApproval" />
          <Toggle label="Allow New Registrations" sub="Block new signups when off" k="allowNewRegistrations" />
          <Toggle label="Maintenance Mode" sub="Show maintenance page to all users" k="maintenanceMode" />
        </div>
      </div>
      <div style={{ marginTop:20 }}>
        <button onClick={save} disabled={saving} className="btn-primary" style={{ padding:'11px 32px' }}>{saving?'Saving…':'Save Settings'}</button>
      </div>
    </div>
  );
}
