// src/components/PlatformGate.js
// Wraps a page and shows a friendly block screen when a platform flag is off.
'use client';

export default function PlatformGate({ type, settings, loading, children }) {
  if (loading) return null; // parent already shows a spinner usually

  const messages = {
    maintenance: {
      icon: '🔧',
      title: 'Under Maintenance',
      body: 'We\'re making some improvements. Please check back soon.',
      color: '#f59e0b',
      bg:    '#fffbeb',
      border:'#fcd34d',
      textColor: '#92400e',
    },
    registration: {
      icon: '🚫',
      title: 'Registrations Closed',
      body: 'New account registrations are currently disabled by the platform administrator.',
      color: '#dc2626',
      bg:    '#fef2f2',
      border:'#fecaca',
      textColor: '#991b1b',
    },
    orgCreation: {
      icon: '🏢',
      title: 'Org Creation Disabled',
      body: 'Creating new organizations is currently disabled by the platform administrator.',
      color: '#2563eb',
      bg:    '#eff6ff',
      border:'#bfdbfe',
      textColor: '#1e40af',
    },
  };

  const blocked =
    (type === 'maintenance' && settings.maintenanceMode) ||
    (type === 'registration' && !settings.allowNewRegistrations) ||
    (type === 'orgCreation'  && !settings.allowOrgCreation);

  if (!blocked) return children;

  const m = messages[type];

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', padding:24 }}>
      <div style={{ maxWidth:420, width:'100%', background: m.bg, border:`1.5px solid ${m.border}`, borderRadius:16, padding:36, textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>{m.icon}</div>
        <div style={{ fontSize:20, fontWeight:700, color: m.textColor, marginBottom:10 }}>{m.title}</div>
        <p style={{ fontSize:14, color: m.textColor, lineHeight:1.7, marginBottom:24, opacity:0.85 }}>{m.body}</p>
        <a href="/" style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'10px 22px', borderRadius:8, border:`1px solid ${m.border}`, background:'#fff', color: m.textColor, fontWeight:600, fontSize:13, textDecoration:'none' }}>
          ← Back to Home
        </a>
      </div>
    </div>
  );
}