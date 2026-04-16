'use client';
import { useAuth } from '@/context/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Link from 'next/link';

export default function OrgPending() {
  const { userData, orgData } = useAuth();
  const orgName = orgData?.name || userData?.pendingOrgName || 'your organization';

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, background:'#f8fafc' }}>
      <div style={{ textAlign:'center', maxWidth:440 }}>
        <div style={{ width:64, height:64, borderRadius:16, background:'#fffbeb', border:'2px solid #fde68a', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 24px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <h1 style={{ fontSize:22, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Awaiting Platform Approval</h1>
        <p style={{ fontSize:15, fontWeight:600, color:'#2563eb', marginBottom:12 }}>{orgName}</p>
        <p style={{ fontSize:14, color:'#64748b', lineHeight:1.7, marginBottom:28 }}>
          Your organization has been created and is pending review by a platform administrator.
          You'll be able to manage it once it's approved. This usually takes less than 24 hours.
        </p>
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          <Link href="/select-org" className="btn-ghost">← My Organizations</Link>
          <button onClick={() => { signOut(auth); window.location.href = '/login'; }}
            style={{ padding:'10px 20px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', cursor:'pointer', fontSize:14 }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
