// src/components/Sidebar.js
'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc,
  orderBy, limit, getDocs, getDoc } from 'firebase/firestore';

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const PATHS = {
  home:          'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  pay:           'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  ledger:        'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  expenses:      'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  invest:        'M22 12h-4l-3 9L9 3l-3 9H2',
  profile:       'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  verify:        'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  members:       'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  settings:      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  bell:          'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  logout:        'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  summary:       'M18 20V10M12 20V4M6 20v-6',
  income:        'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  penalty:       'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  orgs:          'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  shield:        'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  chevron:       'M9 18l6-6-6-6',
  grid:          'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  heart:         'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  menu:          'M3 12h18M3 6h18M3 18h18',
  x:             'M18 6L6 18M6 6l12 12',
  star:          'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  folder:        'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  distribute:    'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6',
  charity:       'M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z',
  subscription:  'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
  transfer:      'M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01',
  directory:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  asset:         'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  loan:          'M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM2 20c0-4 4.5-7 10-7s10 3 10 7M12 14v8M8 18h8',
  entryFee:      'M20 12V22H4V12M22 7H2v5h20V7zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  accountBook:   'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM8 7h8M8 11h8M8 15h5',
  memo:          'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-4M9 15l3 3 3-3',
  export:        'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  coins:         'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM7 13s.5 1 2.5 1 2.5-1 2.5-1M7 11s.5-1 2.5-1 2.5 1 2.5 1',
};

const PUBLIC = ['/', '/login', '/register', '/forgot-password', '/create-org', '/select-org', '/join', '/pending-approval'];
const NAV_STYLE_KEY = 'cs_nav_style';

// ── Nav Style Switcher Bar ────────────────────────────────────────────────────
const NAV_STYLES = [
  { id: 'dots',   label: 'Dots' },
  { id: 'tiles',  label: 'Tiles' },
  { id: 'accent', label: 'Lines' },
];

function NavStyleSwitcher({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, padding: '6px 8px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
      {NAV_STYLES.map(s => (
        <button key={s.id} onClick={() => onChange(s.id)}
          style={{
            flex: 1, padding: '4px 0', fontSize: 10, fontWeight: value === s.id ? 700 : 400,
            border: 'none', borderRadius: 6, cursor: 'pointer',
            background: value === s.id ? '#fff' : 'transparent',
            color: value === s.id ? '#2563eb' : '#94a3b8',
            boxShadow: value === s.id ? '0 0 0 0.5px #bfdbfe' : 'none',
            transition: 'all 0.15s',
          }}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Shared section tag ────────────────────────────────────────────────────────
function SectionTag({ label }) {
  return (
    <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
      letterSpacing: '0.09em', padding: '10px 12px 3px', margin: 0 }}>
      {label}
    </p>
  );
}

// ── STYLE A: Dot rows ─────────────────────────────────────────────────────────
function DotItem({ label, path, icon, pathname, onClick }) {
  const exactOnly = path === '/admin' || path === '/superadmin';
  const active = exactOnly ? pathname === path : (pathname === path || (path !== '/' && pathname.startsWith(path + '/')));
  return (
    <Link href={path} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 12px',
        background: active ? '#eff6ff' : 'transparent', textDecoration: 'none', transition: 'background 0.1s' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f8fafc'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
        background: active ? '#2563eb' : '#cbd5e1' }} />
      <span style={{ fontSize: 12, color: active ? '#1d4ed8' : '#475569', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </Link>
  );
}

function DotSection({ label, items, pathname, onClick }) {
  return (
    <div style={{ borderBottom: '0.5px solid #f1f5f9' }}>
      <SectionTag label={label} />
      {items.map(i => i && <DotItem key={i.path} {...i} pathname={pathname} onClick={onClick} />)}
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── STYLE B: 2-col tiles ──────────────────────────────────────────────────────
function TileItem({ label, path, icon, pathname, onClick }) {
  const exactOnly = path === '/admin' || path === '/superadmin';
  const active = exactOnly ? pathname === path : (pathname === path || (path !== '/' && pathname.startsWith(path + '/')));
  return (
    <Link href={path} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6,
        background: active ? '#eff6ff' : '#f8fafc',
        border: active ? '1px solid #bfdbfe' : '1px solid #f1f5f9',
        borderRadius: 7, padding: '6px 8px', fontSize: 11, textDecoration: 'none',
        color: active ? '#1d4ed8' : '#475569', fontWeight: active ? 600 : 400,
        overflow: 'hidden', transition: 'all 0.1s' }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#e2e8f0'; }}}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#f1f5f9'; }}}>
      {icon && <span style={{ color: active ? '#2563eb' : '#94a3b8', flexShrink: 0 }}><Icon d={icon} size={12} /></span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </Link>
  );
}

function TileSection({ label, items, pathname, onClick }) {
  return (
    <div style={{ padding: '6px 8px', borderBottom: '0.5px solid #f1f5f9' }}>
      <SectionTag label={label} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
        {items.map(i => i && <TileItem key={i.path} {...i} pathname={pathname} onClick={onClick} />)}
      </div>
    </div>
  );
}

// ── STYLE C: Accent lines ─────────────────────────────────────────────────────
function AccentItem({ label, path, icon, pathname, onClick }) {
  const exactOnly = path === '/admin' || path === '/superadmin';
  const active = exactOnly ? pathname === path : (pathname === path || (path !== '/' && pathname.startsWith(path + '/')));
  return (
    <Link href={path} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px 5px 14px',
        borderLeft: active ? '2px solid #2563eb' : '2px solid transparent',
        background: active ? '#eff6ff' : 'transparent',
        textDecoration: 'none', transition: 'all 0.1s' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f8fafc'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      {icon && <span style={{ color: active ? '#2563eb' : '#94a3b8', flexShrink: 0 }}><Icon d={icon} size={13} /></span>}
      <span style={{ fontSize: 12, color: active ? '#1d4ed8' : '#64748b', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </Link>
  );
}

function AccentSection({ label, items, pathname, onClick }) {
  return (
    <div style={{ borderBottom: '0.5px solid #f1f5f9' }}>
      <SectionTag label={label} />
      {items.map(i => i && <AccentItem key={i.path} {...i} pathname={pathname} onClick={onClick} />)}
      <div style={{ height: 4 }} />
    </div>
  );
}

// ── Unified section renderer (picks style) ────────────────────────────────────
function NavSection({ navStyle, label, items, pathname, onClick }) {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return null;
  if (navStyle === 'tiles')  return <TileSection  label={label} items={filtered} pathname={pathname} onClick={onClick} />;
  if (navStyle === 'accent') return <AccentSection label={label} items={filtered} pathname={pathname} onClick={onClick} />;
  return <DotSection label={label} items={filtered} pathname={pathname} onClick={onClick} />;
}

// ── Unified single nav item (for flat items outside sections) ─────────────────
function NavItem({ navStyle = 'dots', label, path, icon, pathname, onClick }) {
  if (navStyle === 'tiles')  return <TileItem  label={label} path={path} icon={icon} pathname={pathname} onClick={onClick} />;
  if (navStyle === 'accent') return <AccentItem label={label} path={path} icon={icon} pathname={pathname} onClick={onClick} />;
  return <DotItem label={label} path={path} icon={icon} pathname={pathname} onClick={onClick} />;
}

// ── Org Picker Modal ───────────────────────────────────────────────────────────
function OrgPickerModal({ onClose, onPick }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'organizations'));
        setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [user]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 16, width: 'min(92vw,420px)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', zIndex: 9001, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Enter Organisation as Admin</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Pick any org to access as superadmin</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 12px 16px', flex: 1 }}>
          {loading ? <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>Loading…</div>
            : orgs.length === 0 ? <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>No organisations yet.</div>
            : orgs.map(o => (
              <button key={o.id} onClick={() => onPick(o.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', marginBottom: 6, textAlign: 'left', transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#1d4ed8', fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                  {o.logoURL ? <img src={o.logoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (o.name?.[0] || '?')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{o.type || '—'} · <span style={{ textTransform: 'capitalize' }}>{o.status || 'active'}</span></div>
                </div>
                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>Enter →</span>
              </button>
            ))}
        </div>
      </div>
    </>
  );
}

// ── Member Picker Modal ────────────────────────────────────────────────────────
function MemberPickerModal({ orgId, onClose, onPick }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'organizations', orgId, 'members'));
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.approved);
        const enriched = await Promise.all(raw.map(async m => {
          try { const u = await getDoc(doc(db, 'users', m.id)); return u.exists() ? { ...u.data(), ...m } : m; } catch { return m; }
        }));
        enriched.sort((a, b) => (a.nameEnglish || a.name || '').localeCompare(b.nameEnglish || b.name || ''));
        setMembers(enriched);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [orgId]);
  const filtered = members.filter(m => !search || (m.nameEnglish || m.name || '').toLowerCase().includes(search.toLowerCase()) || (m.idNo || '').includes(search));
  const initials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 16, width: 'min(92vw,440px)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', zIndex: 9001, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>View as Member</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Access the app exactly as this member sees it</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1 }}>×</button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search member name or ID…"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 12px 16px', flex: 1 }}>
          {loading ? <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>Loading members…</div>
            : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}>No members found.</div>
            : filtered.map(m => (
              <button key={m.id} onClick={() => onPick({ uid: m.id, name: m.nameEnglish || m.name || m.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', marginBottom: 6, textAlign: 'left', transition: 'all 0.12s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#fdf4ff'; e.currentTarget.style.borderColor = '#e9d5ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#7c3aed', fontSize: 13, flexShrink: 0 }}>
                  {initials(m.nameEnglish || m.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{m.nameEnglish || m.name || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.idNo ? `#${m.idNo} · ` : ''}{m.role || 'member'}</div>
                </div>
                <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>View as →</span>
              </button>
            ))}
        </div>
      </div>
    </>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────
export default function Sidebar() {
  const [open,             setOpen]             = useState(false);
  const [notifOpen,        setNotifOpen]        = useState(false);
  const [notifs,           setNotifs]           = useState([]);
  const [showOrgPicker,    setShowOrgPicker]    = useState(false);
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const pathname = usePathname();
  const {
    user, userData, orgData, membership,
    isSuperAdmin, isOrgAdmin, isCashier,
    impersonateMemberName, accessMode,
    switchToOrgMode, switchToSuperAdminMode,
    startViewingAsMember, stopViewingAsMember,
  } = useAuth();

  // ── Nav style — only available if userData.navStyleSwitcher === true ────
  const canSwitchNav = useMemo(() => !!userData?.navStyleSwitcher, [userData]);
  const [navStyle, setNavStyle] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(NAV_STYLE_KEY) || 'accent';
    }
    return 'accent';
  });
  const handleNavStyle = (s) => {
    setNavStyle(s);
    if (typeof window !== 'undefined') localStorage.setItem(NAV_STYLE_KEY, s);
  };
  // Force lines for users without switcher access
  const ns = canSwitchNav ? navStyle : 'accent';

  const isPublic     = PUBLIC.some(r => pathname === r || pathname.startsWith(r + '/'));
  const inOrgMode    = isSuperAdmin && accessMode === 'org';
  const inMemberMode = isSuperAdmin && accessMode === 'member';

  useEffect(() => {
    if (!user || isPublic || !userData?.activeOrgId) return;
    const q = query(
      collection(db, 'organizations', userData.activeOrgId, 'notifications'),
      where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20)
    );
    return onSnapshot(q, snap => setNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [user, isPublic, userData?.activeOrgId]);

  if (isPublic || !user || !userData) return null;

  const unread   = notifs.filter(n => !n.read).length;
  const initials = (userData?.nameEnglish || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const orgName  = orgData?.name || 'My Organisation';
  const orgF     = orgData?.orgFeatures || {};

  const markRead = () => {
    const orgId = userData?.activeOrgId;
    if (!orgId) return;
    notifs.filter(n => !n.read).forEach(n =>
      updateDoc(doc(db, 'organizations', orgId, 'notifications', n.id), { read: true }).catch(() => {})
    );
  };
  const toggleNotif = () => { setNotifOpen(v => !v); if (!notifOpen && unread > 0) markRead(); };
  const delNotif    = id => {
    const orgId = userData?.activeOrgId;
    if (orgId) deleteDoc(doc(db, 'organizations', orgId, 'notifications', id)).catch(() => {});
  };
  const logout      = async () => { await signOut(auth); window.location.href = '/login'; };
  const closeDrawer = () => setOpen(false);

  const modeLabel  = inMemberMode ? '👤 Member Mode'   : inOrgMode ? '🏢 Org Mode'   : '🔧 Platform Mode';
  const modeDesc   = inMemberMode ? `As: ${impersonateMemberName || 'Member'}` : inOrgMode ? orgName : 'Superadmin view';
  const chipBg     = inMemberMode ? '#fdf4ff' : inOrgMode ? '#f5f3ff' : '#eff6ff';
  const chipBorder = inMemberMode ? '#e9d5ff' : inOrgMode ? '#ddd6fe' : '#bfdbfe';
  const chipColor  = inMemberMode ? '#7c3aed' : inOrgMode ? '#7c3aed' : '#2563eb';

  // ── Shared section definitions ─────────────────────────────────────────────
  const adminNav = (
    <>
      <NavSection navStyle={ns} label="My space" pathname={pathname} onClick={closeDrawer} items={[
        { label: 'Dashboard',       path: '/dashboard',   icon: PATHS.home    },
        { label: 'Pay installment', path: '/installment', icon: PATHS.pay     },
        { label: 'My ledger',       path: '/ledger',      icon: PATHS.ledger  },
        { label: 'My profile',      path: '/profile',     icon: PATHS.profile },
        { label: 'Notices',         path: '/memoranda',   icon: PATHS.memo    },
        orgF.qardHasana    && { label: 'My loans',  path: '/loans',  icon: PATHS.loan  },
        orgF.assetRegistry && { label: 'Assets',    path: '/assets', icon: PATHS.asset },
      ]} />

      <NavSection navStyle={ns} label="Finance" pathname={pathname} onClick={closeDrawer} items={[
        { label: 'Verify payments', path: '/admin',            icon: PATHS.verify   },
        { label: 'Income',          path: '/admin/income',     icon: PATHS.income   },
        { label: 'Expenses',        path: '/admin/expenses',   icon: PATHS.expenses },
        { label: 'Penalties',       path: '/admin/penalties',  icon: PATHS.penalty  },
        orgF.entryFeeTracking && { label: 'Entry fees',     path: '/admin/entry-fees',  icon: PATHS.entryFee },
        orgF.assetRegistry    && { label: 'Asset registry', path: '/admin/assets',      icon: PATHS.asset    },
        orgF.qardHasana       && { label: 'Loans',          path: '/admin/loans',       icon: PATHS.loan     },
        orgF.cashierRole      && { label: 'Fund transfers', path: '/cashier/transfer',  icon: PATHS.transfer },
      ]} />

      <NavSection navStyle={ns} label="Members" pathname={pathname} onClick={closeDrawer} items={[
        { label: 'Member list',         path: '/admin/members',          icon: PATHS.members      },
        { label: 'Subscriptions',       path: '/admin/subscriptions',    icon: PATHS.subscription },
        { label: 'Installment tracker', path: '/admin/subscriptionsgrid', icon: PATHS.grid        },
        { label: 'Notifications',       path: '/admin/notifications',    icon: PATHS.bell         },
      ]} />

      <NavSection navStyle={ns} label="Records" pathname={pathname} onClick={closeDrawer} items={[
        { label: 'Account book',  path: '/admin/account-book', icon: PATHS.accountBook },
        { label: 'Member ledger', path: '/admin/ledger',       icon: PATHS.ledger      },
        { label: 'Memoranda',     path: '/admin/memoranda',    icon: PATHS.memo        },
        orgF.investmentPortfolio && { label: 'Projects',     path: '/admin/projects',     icon: PATHS.invest    },
        orgF.profitDistribution  && { label: 'Distribution', path: '/admin/distribution', icon: PATHS.distribute },
      ]} />

      {(orgF.fileLibrary || orgF.memberDirectory || orgF.charityTracking) && (
        <NavSection navStyle={ns} label="Library" pathname={pathname} onClick={closeDrawer} items={[
          orgF.fileLibrary     && { label: 'File library',     path: '/admin/files',   icon: PATHS.folder    },
          orgF.memberDirectory && { label: 'Member directory', path: '/members',       icon: PATHS.directory },
          orgF.charityTracking && { label: 'Charity',          path: '/admin/charity', icon: PATHS.charity   },
        ]} />
      )}

      {/* Bottom utilities */}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f5f9',
        display: ns === 'tiles' ? 'grid' : 'flex',
        gridTemplateColumns: ns === 'tiles' ? '1fr 1fr' : undefined,
        flexDirection: ns !== 'tiles' ? 'column' : undefined,
        gap: ns === 'tiles' ? 4 : 1,
        padding: ns === 'tiles' ? '6px 8px' : '6px 0',
      }}>
        <NavItem navStyle={ns} label="Export data" path="/admin/export"   icon={PATHS.export}   pathname={pathname} onClick={closeDrawer} />
        <NavItem navStyle={ns} label="Settings"    path="/admin/settings" icon={PATHS.settings} pathname={pathname} onClick={closeDrawer} />
      </div>
    </>
  );

  const memberNav = (items) => (
    <NavSection navStyle={ns} label="Member" pathname={pathname} onClick={closeDrawer} items={items} />
  );

  const sidebarContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '18px 14px 14px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
        <Link href={inOrgMode || inMemberMode ? '/dashboard' : (isSuperAdmin ? '/superadmin' : '/dashboard')}
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: inMemberMode ? '#7c3aed' : inOrgMode ? '#7c3aed' : '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {orgData?.logoURL && (inOrgMode || inMemberMode || !isSuperAdmin)
              ? <img src={orgData.logoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : <Icon d={PATHS.heart} size={16} />}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Capital Sync</div>
            <div style={{ fontSize: 11, color: (inOrgMode || inMemberMode) ? '#7c3aed' : '#94a3b8' }}>
              {inMemberMode ? orgName : inOrgMode ? orgName : (isSuperAdmin ? 'Super Admin' : orgName)}
            </div>
          </div>
        </Link>

        {isSuperAdmin && (
          <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 8, background: chipBg, border: `1px solid ${chipBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: chipColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{modeLabel}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{modeDesc}</div>
            </div>
            {inMemberMode ? (
              <button onClick={stopViewingAsMember} style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#ede9fe', color: '#7c3aed', whiteSpace: 'nowrap', flexShrink: 0 }}>← Exit</button>
            ) : inOrgMode ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setShowMemberPicker(true)} title="View as a member" style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#ede9fe', color: '#7c3aed', flexShrink: 0 }}>👤</button>
                <button onClick={switchToSuperAdminMode} style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#ede9fe', color: '#7c3aed', whiteSpace: 'nowrap', flexShrink: 0 }}>← Platform</button>
              </div>
            ) : (
              <button onClick={() => setShowOrgPicker(true)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#dbeafe', color: '#2563eb', whiteSpace: 'nowrap', flexShrink: 0 }}>Enter Org</button>
            )}
          </div>
        )}
      </div>

      {/* Nav style switcher — only for users with navStyleSwitcher: true */}
      {canSwitchNav && (
        <NavStyleSwitcher value={navStyle} onChange={handleNavStyle} />
      )}

      {/* Scrollable nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>

        {/* ── SUPERADMIN PLATFORM MODE ──────────────────────────────── */}
        {isSuperAdmin && !inOrgMode && !inMemberMode && (
          <div style={{ padding: '4px 0' }}>
            <NavSection navStyle={ns} label="Platform" pathname={pathname} onClick={closeDrawer} items={[
              { label: 'Overview',          path: '/superadmin',          icon: PATHS.grid     },
              { label: 'Organisations',     path: '/superadmin/orgs',     icon: PATHS.orgs     },
              { label: 'All members',       path: '/superadmin/members',  icon: PATHS.members  },
              { label: 'Admin management',  path: '/superadmin/admins',   icon: PATHS.shield   },
              { label: 'Org features',      path: '/superadmin/features', icon: PATHS.star     },
              { label: 'Platform settings', path: '/superadmin/settings', icon: PATHS.settings },
            ]} />
          </div>
        )}

        {/* ── ORG / MEMBER MODE ──────────────────────────────────────── */}
        {(!isSuperAdmin || inOrgMode || inMemberMode) && (
          <>
            {!inMemberMode && (
              <Link href="/select-org" onClick={closeDrawer}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', margin: '6px 8px 8px', textDecoration: 'none', background: '#f8fafc' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Current org</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</div>
                </div>
                <span style={{ color: '#94a3b8' }}><Icon d={PATHS.chevron} size={12} /></span>
              </Link>
            )}

            {/* Cashier */}
            {isCashier && !isOrgAdmin && !inMemberMode && (
              <>
                <NavSection navStyle={ns} label="Cashier" pathname={pathname} onClick={closeDrawer} items={[
                  { label: 'Verify payments', path: '/admin',            icon: PATHS.verify   },
                  { label: 'Fund transfers',  path: '/cashier/transfer', icon: PATHS.transfer },
                ]} />
                {memberNav([
                  { label: 'Dashboard',       path: '/dashboard',   icon: PATHS.home     },
                  { label: 'Pay installment', path: '/installment', icon: PATHS.pay      },
                  { label: 'My ledger',       path: '/ledger',      icon: PATHS.ledger   },
                  { label: 'Expenses',        path: '/expenses',    icon: PATHS.expenses },
                  { label: 'Projects',        path: '/investments', icon: PATHS.invest   },
                  { label: 'My profile',      path: '/profile',     icon: PATHS.profile  },
                  { label: 'Notices',         path: '/memoranda',   icon: PATHS.memo     },
                  orgF.fileLibrary     && { label: 'File library',     path: '/files',   icon: PATHS.folder    },
                  orgF.memberDirectory && { label: 'Member directory', path: '/members', icon: PATHS.directory },
                  orgF.qardHasana      && { label: 'My loans',  path: '/loans',  icon: PATHS.loan  },
                  orgF.assetRegistry   && { label: 'Assets',    path: '/assets', icon: PATHS.asset },
                ])}
              </>
            )}

            {/* Regular member */}
            {!isCashier && !isOrgAdmin && (
              <>
                {inMemberMode && (
                  <div style={{ padding: '6px 12px 8px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Viewing as member</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{impersonateMemberName}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{orgName}</div>
                  </div>
                )}
                {memberNav([
                  { label: 'Dashboard',       path: '/dashboard',   icon: PATHS.home     },
                  { label: 'Pay installment', path: '/installment', icon: PATHS.pay      },
                  { label: 'My ledger',       path: '/ledger',      icon: PATHS.ledger   },
                  { label: 'Expenses',        path: '/expenses',    icon: PATHS.expenses },
                  { label: 'Projects',        path: '/investments', icon: PATHS.invest   },
                  { label: 'My profile',      path: '/profile',     icon: PATHS.profile  },
                  { label: 'Notices',         path: '/memoranda',   icon: PATHS.memo     },
                  orgF.fileLibrary     && { label: 'File library',     path: '/files',   icon: PATHS.folder    },
                  orgF.memberDirectory && { label: 'Member directory', path: '/members', icon: PATHS.directory },
                  orgF.qardHasana      && { label: 'My loans',  path: '/loans',  icon: PATHS.loan  },
                  orgF.assetRegistry   && { label: 'Assets',    path: '/assets', icon: PATHS.asset },
                ])}
                {inMemberMode && (
                  <div style={{ margin: '10px 8px 0', padding: '10px 12px', borderRadius: 8, background: '#fdf4ff', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600, marginBottom: 6 }}>Superadmin impersonation</div>
                    <button onClick={stopViewingAsMember} style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: '1px solid #d8b4fe', background: '#fff', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 4 }}>← Exit member view</button>
                    <button onClick={() => setShowMemberPicker(true)} style={{ width: '100%', padding: '7px 12px', borderRadius: 7, border: '1px solid #e9d5ff', background: '#fff', color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Switch member</button>
                  </div>
                )}
              </>
            )}

            {/* Admin */}
            {isOrgAdmin && !inMemberMode && adminNav}
          </>
        )}
      </nav>

      {/* Notifications */}
      {(!isSuperAdmin || inOrgMode || inMemberMode) && (
        <div style={{ padding: '0 6px', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
          <button onClick={toggleNotif}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 11px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#475569', borderRadius: 8 }}>
            <div style={{ position: 'relative' }}>
              <Icon d={PATHS.bell} size={14} />
              {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, background: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 700, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>}
            </div>
            <span>Notifications</span>
            {unread > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: 99, fontWeight: 600 }}>{unread}</span>}
          </button>
        </div>
      )}

      {/* User footer */}
      <div style={{ padding: '10px 6px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: inMemberMode ? '#f3e8ff' : '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {userData?.photoURL
              ? <img src={userData.photoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : <span style={{ fontSize: 10, fontWeight: 700, color: inMemberMode ? '#7c3aed' : '#1d4ed8' }}>{initials}</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userData?.nameEnglish?.split(' ')[0] || 'User'}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>
              {inMemberMode ? 'viewing as member' : inOrgMode ? 'superadmin (org)' : (isSuperAdmin ? 'superadmin' : (isCashier ? '💳 cashier' : (membership?.role || 'member')))}
            </div>
          </div>
        </div>
        <button onClick={logout}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#94a3b8', width: '100%' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94a3b8'; }}>
          <Icon d={PATHS.logout} size={14} /><span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {inMemberMode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, background: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', fontSize: 12, fontWeight: 600 }}>
          <span>👤 Viewing as <strong>{impersonateMemberName}</strong> in {orgName}</span>
          <button onClick={stopViewingAsMember} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', cursor: 'pointer' }}>Exit ×</button>
        </div>
      )}

      <aside style={{ position: 'fixed', left: 0, top: inMemberMode ? 32 : 0, height: inMemberMode ? 'calc(100vh - 32px)' : '100vh', width: 240, borderRight: '1px solid #e2e8f0', background: '#ffffff', zIndex: 50 }} className="md-sidebar">
        {sidebarContent}
      </aside>

      <div style={{ position: 'fixed', top: inMemberMode ? 32 : 0, left: 0, right: 0, height: 56, background: '#ffffff', borderBottom: '1px solid #e2e8f0', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', zIndex: 60 }} className="mobile-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: inMemberMode ? '#7c3aed' : inOrgMode ? '#7c3aed' : '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
            {orgData?.logoURL && (inOrgMode || inMemberMode || !isSuperAdmin)
              ? <img src={orgData.logoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : <Icon d={PATHS.heart} size={14} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {inMemberMode ? (impersonateMemberName || 'Member') : inOrgMode ? orgName : (isSuperAdmin ? 'Capital Sync' : (orgData?.name || 'Capital Sync'))}
            </div>
            <div style={{ fontSize: 10, color: (inOrgMode || inMemberMode) ? '#7c3aed' : '#94a3b8' }}>
              {inMemberMode ? '👤 Member View' : inOrgMode ? '🏢 Org Mode' : (isSuperAdmin ? 'Super Admin' : 'Capital Sync')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(!isSuperAdmin || inOrgMode || inMemberMode) && (
            <button onClick={toggleNotif} style={{ position: 'relative', padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
              <Icon d={PATHS.bell} size={18} />
              {unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, background: '#dc2626', borderRadius: '50%' }} />}
            </button>
          )}
          <button onClick={() => setOpen(!open)} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}>
            <Icon d={open ? PATHS.x : PATHS.menu} size={20} />
          </button>
        </div>
      </div>

      {open && (
        <>
          <div onClick={closeDrawer} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 70 }} />
          <aside style={{ position: 'fixed', left: 0, top: inMemberMode ? 32 : 0, height: inMemberMode ? 'calc(100vh - 32px)' : '100vh', width: 260, background: '#fff', zIndex: 80, overflow: 'hidden', boxShadow: '4px 0 20px rgba(0,0,0,0.1)' }}>
            {sidebarContent}
          </aside>
        </>
      )}

      {notifOpen && (
        <div style={{ position: 'fixed', right: 0, top: 0, height: '100vh', width: 360, maxWidth: '100vw', background: '#fff', borderLeft: '1px solid #e2e8f0', zIndex: 90, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Notifications</span>
            <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notifs.length === 0
              ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginTop: 40 }}>No notifications yet</div>
              : notifs.map(n => (
                <div key={n.id} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid', borderColor: n.read ? '#e2e8f0' : '#bfdbfe', background: n.read ? '#f8fafc' : '#eff6ff', position: 'relative' }}>
                  <button onClick={() => delNotif(n.id)} style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>✕</button>
                  {!n.read && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#2563eb', marginBottom: 4 }} />}
                  <p style={{ fontSize: 13, color: '#0f172a', marginBottom: 4, paddingRight: 20 }}>{n.message}</p>
                  <p style={{ fontSize: 11, color: '#94a3b8' }}>{n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000).toLocaleString() : ''}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {showOrgPicker && (
        <OrgPickerModal
          onClose={() => setShowOrgPicker(false)}
          onPick={orgId => { setShowOrgPicker(false); closeDrawer(); switchToOrgMode(orgId); }}
        />
      )}

      {showMemberPicker && userData?.activeOrgId && (
        <MemberPickerModal
          orgId={userData.activeOrgId}
          onClose={() => setShowMemberPicker(false)}
          onPick={({ uid, name }) => { setShowMemberPicker(false); closeDrawer(); startViewingAsMember({ uid, name }); }}
        />
      )}
    </>
  );
}