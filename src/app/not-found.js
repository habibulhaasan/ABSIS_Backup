import Link from 'next/link';
export default function NotFound() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', padding:24, background:'#f8fafc' }}>
      <div>
        <div style={{ fontSize:64, fontWeight:800, color:'#e2e8f0', marginBottom:8 }}>404</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Page not found</h1>
        <p style={{ color:'#64748b', marginBottom:24 }}>This page doesn't exist or you don't have access.</p>
        <Link href="/dashboard" className="btn-primary" style={{ textDecoration:'none', display:'inline-flex' }}>← Go to Dashboard</Link>
      </div>
    </div>
  );
}
