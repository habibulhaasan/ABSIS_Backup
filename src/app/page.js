'use client';
import Link from 'next/link';

export default function Landing() {
  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', display:'flex', flexDirection:'column' }}>
      {/* Nav */}
      <header style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'0 32px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'#2563eb', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </div>
          <span style={{ fontWeight:700, fontSize:16, color:'#0f172a' }}>ABSIS Capital Sync</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <Link href="/login" style={{ fontSize:14, color:'#475569', textDecoration:'none', fontWeight:500 }}>Sign in</Link>
          <Link href="/register" className="btn-primary" style={{ padding:'8px 18px', fontSize:13 }}>Get Started</Link>
        </div>
      </header>

      {/* Hero */}
      <main style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 24px', textAlign:'center' }}>
        <div className="badge badge-blue" style={{ marginBottom:20, fontSize:12 }}>Where Faith Meets Financial Growth</div>
        <h1 style={{ fontSize:42, fontWeight:800, color:'#0f172a', lineHeight:1.15, marginBottom:16, maxWidth:560 }}>
          ABSIS Capital Sync<br />
        </h1>
        <p style={{ fontSize:16, color:'#64748b', maxWidth:440, lineHeight:1.7, marginBottom:40 }}>
          Track member contributions, verify payments, manage projects and expenses — all in one place for your organization.
        </p>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
          <Link href="/register" className="btn-primary" style={{ fontSize:15, padding:'12px 28px' }}>Create Free Account</Link>
          <Link href="/login" className="btn-ghost" style={{ fontSize:15, padding:'12px 28px' }}>Sign In</Link>
        </div>

        {/* Feature pills */}
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center', marginTop:48 }}>
          {['Payment Verification','Member Management','Expense Tracking','Project Investments','Invite System','Multi-Organization'].map(f => (
            <span key={f} className="badge badge-gray" style={{ fontSize:12, padding:'6px 14px' }}>{f}</span>
          ))}
        </div>
      </main>

      <footer style={{ textAlign:'center', padding:'20px 24px', borderTop:'1px solid #e2e8f0', fontSize:13, color:'#94a3b8' }}>
        © 2025 ABSIS Capital Sync. All rights reserved.
      </footer>
    </div>
  );
}
