// src/app/superadmin/features/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// All features the super admin can unlock per organisation.
// Once unlocked (org.features.X = true), the org admin sees it in their
// Settings → Features tab and can activate/deactivate it (org.orgFeatures.X).
// Pages and sidebar always read org.orgFeatures — never org.features directly.

const ALL_FEATURES = [
  // ── Core ──────────────────────────────────────────────────────────────────
  {
    group: 'Core',
    key: 'cashierRole',
    label: 'Cashier Role',
    icon: '💳',
    color: '#0891b2',
    bg: '#e0f2fe',
    description: 'Assign cashier role to members. Cashiers verify payments for their assigned accounts and transfer collected funds to admin.',
  },
  {
    group: 'Core',
    key: 'memberDirectory',
    label: 'Member Directory',
    icon: '👥',
    color: '#059669',
    bg: '#d1fae5',
    description: 'Approved members can view the member directory — name, phone, email, blood group, and committee role.',
  },
  {
    group: 'Core',
    key: 'committeeRoles',
    label: 'Committee Roles',
    icon: '🎖️',
    color: '#7c3aed',
    bg: '#f3e8ff',
    description: 'Admin can assign display-only committee roles (President, Secretary, Treasurer, etc.) to members.',
  },
  {
    group: 'Core',
    key: 'fileLibrary',
    label: 'File Library',
    icon: '📁',
    color: '#7c3aed',
    bg: '#ede9fe',
    description: 'Upload and share documents, images, and files with all members of the organisation.',
  },
  {
    group: 'Core',
    key: 'advancedReports',
    label: 'Advanced Reports',
    icon: '📈',
    color: '#2563eb',
    bg: '#dbeafe',
    description: 'Export detailed financial reports with charts, trends, and per-member breakdowns.',
  },
  {
    group: 'Core',
    key: 'charityTracking',
    label: 'Charity Tracking',
    icon: '❤️',
    color: '#dc2626',
    bg: '#fee2e2',
    description: 'Track donations sent to charity or external causes with notes and receipts.',
  },

  // ── Member Management ──────────────────────────────────────────────────────
  {
    group: 'Member Management',
    key: 'nomineeTracking',
    label: 'Nominee / Beneficiary',
    icon: '👨‍👩‍👧',
    color: '#0f766e',
    bg: '#ccfbf1',
    description: 'Each member records a nominated heir who receives their capital balance in the event of death.',
  },
  {
    group: 'Member Management',
    key: 'entryFeeTracking',
    label: 'Entry Fee Tracking',
    icon: '🎫',
    color: '#b45309',
    bg: '#fef3c7',
    description: 'Record and track the one-time non-refundable entry fee paid by each new member when joining.',
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    group: 'Finance',
    key: 'capitalLedger',
    label: 'Capital Ledger',
    icon: '💰',
    color: '#15803d',
    bg: '#dcfce7',
    description: 'Per-member running capital balance computed from all verified payments. Members can view their own capital account.',
  },
  {
    group: 'Finance',
    key: 'fundStructure',
    label: 'Fund Structure',
    icon: '🏦',
    color: '#1d4ed8',
    bg: '#dbeafe',
    description: 'Split total capital and profit into named buckets (Investment, Reserve, Welfare, Operations) with fully customisable percentages.',
  },
  {
    group: 'Finance',
    key: 'investmentPortfolio',
    label: 'Investment Portfolio',
    icon: '💹',
    color: '#d97706',
    bg: '#fef3c7',
    description: 'Track investment projects with type, sector, invested amount, return rate, status, and document attachments.',
  },
  {
    group: 'Finance',
    key: 'profitDistribution',
    label: 'Profit Distribution',
    icon: '📊',
    color: '#16a34a',
    bg: '#dcfce7',
    description: 'Declare annual profit, auto-deduct reserve / welfare / operations shares, and distribute the remainder to members by capital ratio.',
  },
  {
    group: 'Finance',
    key: 'qardHasana',
    label: 'Interest-Free Loans',
    icon: '🤝',
    color: '#0369a1',
    bg: '#e0f2fe',
    description: 'Members apply for interest-free loans. Admin approves, tracks repayment schedules, and auto-deducts outstanding balance on member exit.',
  },
  {
    group: 'Finance',
    key: 'assetRegistry',
    label: 'Asset Registry',
    icon: '🏗️',
    color: '#7e22ce',
    bg: '#f3e8ff',
    description: 'Track assets owned by the organisation — purchase price, current valuation, annual revaluation log, insurance status.',
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    group: 'Reports',
    key: 'quarterlyReports',
    label: 'Quarterly Reports',
    icon: '📆',
    color: '#9333ea',
    bg: '#faf5ff',
    description: 'Generate and distribute quarterly financial summaries to all members — capital, investments, profit, loans, and fund status.',
  },
];

const GROUPS = [...new Set(ALL_FEATURES.map(f => f.group))];

function Toggle({ enabled, onChange, saving }) {
  return (
    <button type="button" onClick={onChange} disabled={saving}
      style={{ width: 44, height: 24, borderRadius: 99, border: 'none', position: 'relative', flexShrink: 0,
        cursor: saving ? 'wait' : 'pointer',
        background: enabled ? '#2563eb' : '#e2e8f0',
        opacity: saving ? 0.6 : 1, transition: 'background 0.2s' }}>
      <span style={{ position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 20, height: 20,
        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        transition: 'left 0.2s' }} />
    </button>
  );
}

function FeatureCard({ feature, enabled, onToggle, saving }) {
  const { key, label, icon, color, bg, description } = feature;
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16,
      border: `1.5px solid ${enabled ? color + '55' : '#e2e8f0'}`,
      transition: 'border 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flex: 1 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
            {icon}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{description}</div>
          </div>
        </div>
        <Toggle enabled={enabled} onChange={() => onToggle(key)} saving={saving === key} />
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9',
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
          background: enabled ? color : '#cbd5e1' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: enabled ? color : '#94a3b8' }}>
          {enabled ? 'Unlocked for this org' : 'Not unlocked'}
        </span>
      </div>
    </div>
  );
}

export default function SuperAdminFeatures() {
  const { isSuperAdmin } = useAuth();
  const [orgs,         setOrgs]         = useState([]);
  const [selOrg,       setSelOrg]       = useState(null);
  const [saving,       setSaving]       = useState('');
  const [toast,        setToast]        = useState('');
  const [limitsForm,   setLimitsForm]   = useState({ maxAdmins: '', maxCashiers: '', maxMembers: '' });
  const [savingLimits, setSavingLimits] = useState(false);
  const [search,       setSearch]       = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    return onSnapshot(collection(db, 'organizations'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setOrgs(list);
      setSelOrg(prev => prev ? (list.find(o => o.id === prev.id) || null) : null);
    });
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!selOrg) return;
    const lim = selOrg.limits || {};
    setLimitsForm({ maxAdmins: lim.maxAdmins ?? '', maxCashiers: lim.maxCashiers ?? '', maxMembers: lim.maxMembers ?? '' });
  }, [selOrg?.id]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Toggle a feature in org.features (superadmin unlock layer)
  const toggleFeature = async (key) => {
    if (!selOrg) return;
    const current = selOrg.features?.[key] || false;
    setSaving(key);
    try {
      await updateDoc(doc(db, 'organizations', selOrg.id), { [`features.${key}`]: !current });
      showToast(`${!current ? '✅ Unlocked' : '🔒 Locked'} — ${key}`);
    } catch (e) { showToast('Error: ' + e.message); }
    setSaving('');
  };

  const saveLimits = async () => {
    if (!selOrg) return;
    setSavingLimits(true);
    try {
      const limits = {};
      if (limitsForm.maxAdmins   !== '') limits.maxAdmins   = Number(limitsForm.maxAdmins)   || 0;
      if (limitsForm.maxCashiers !== '') limits.maxCashiers = Number(limitsForm.maxCashiers) || 0;
      if (limitsForm.maxMembers  !== '') limits.maxMembers  = Number(limitsForm.maxMembers)  || 0;
      await updateDoc(doc(db, 'organizations', selOrg.id), { limits });
      showToast('✅ Limits saved!');
    } catch (e) { showToast('Error: ' + e.message); }
    setSavingLimits(false);
  };

  if (!isSuperAdmin) return null;

  const enabledCount = ALL_FEATURES.filter(f => selOrg?.features?.[f.key]).length;
  const filteredFeatures = search
    ? ALL_FEATURES.filter(f => f.label.toLowerCase().includes(search.toLowerCase()) || f.description.toLowerCase().includes(search.toLowerCase()))
    : ALL_FEATURES;
  const filteredGroups = [...new Set(filteredFeatures.map(f => f.group))];

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{ fontSize: 11, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Super Admin</div>
        <div className="page-title">Org Features & Limits</div>
        <div className="page-subtitle">Unlock features per organisation. Org admins then activate them from their own Settings → Features tab.</div>
      </div>

      {toast && (
        <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
          background: toast.startsWith('Error') ? '#fee2e2' : '#dcfce7',
          color:      toast.startsWith('Error') ? '#b91c1c' : '#15803d' }}>
          {toast}
        </div>
      )}

      {/* Org picker */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Select Organisation</div>
        {orgs.length === 0
          ? <p style={{ fontSize: 13, color: '#94a3b8' }}>No organisations yet.</p>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {orgs.map(o => (
                <button key={o.id} onClick={() => setSelOrg(o)}
                  style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                    fontWeight: selOrg?.id === o.id ? 600 : 400,
                    border:     selOrg?.id === o.id ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    background: selOrg?.id === o.id ? '#eff6ff' : '#fff',
                    color:      selOrg?.id === o.id ? '#1d4ed8' : '#475569' }}>
                  {o.name}
                  <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.6, textTransform: 'capitalize' }}>
                    ({o.status || 'active'})
                  </span>
                </button>
              ))}
            </div>
        }
      </div>

      {!selOrg ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 20px', fontSize: 14 }}>
          ↑ Select an organisation to manage its features and limits
        </div>
      ) : (
        <>
          {/* Org header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            {selOrg.logoURL && (
              <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                <img src={selOrg.logoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              </div>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{selOrg.name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{selOrg.type} · {selOrg.status || 'active'}</div>
            </div>
            <div style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 99,
              background: enabledCount > 0 ? '#eff6ff' : '#f8fafc',
              border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600,
              color: enabledCount > 0 ? '#2563eb' : '#94a3b8' }}>
              {enabledCount} / {ALL_FEATURES.length} unlocked
            </div>
          </div>

          {/* How it works callout */}
          <div style={{ padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a',
            fontSize: 12, color: '#92400e', marginBottom: 20, lineHeight: 1.6 }}>
            <strong>How it works:</strong> Unlocking a feature here gives the org admin <em>permission</em> to use it.
            The org admin then goes to <strong>Admin Settings → Features</strong> to activate it for their members.
            You can also lock a feature at any time to hide it from the org.
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search features…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 20, boxSizing: 'border-box' }}
          />

          {/* Feature groups */}
          {filteredGroups.map(group => (
            <div key={group} style={{ marginBottom: 28 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                {group}
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                  ({filteredFeatures.filter(f => f.group === group && selOrg.features?.[f.key]).length}
                  /{filteredFeatures.filter(f => f.group === group).length} unlocked)
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
                {filteredFeatures.filter(f => f.group === group).map(f => (
                  <FeatureCard
                    key={f.key}
                    feature={f}
                    enabled={selOrg.features?.[f.key] || false}
                    onToggle={toggleFeature}
                    saving={saving}
                  />
                ))}
              </div>
            </div>
          ))}

          {filteredGroups.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 20px', fontSize: 13 }}>
              No features match "{search}"
            </div>
          )}

          {/* Limits */}
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4, marginTop: 8 }}>
            📏 Member & Role Limits
          </div>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
            Set maximum counts per role. Leave blank for unlimited.
          </p>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
              {[
                ['maxAdmins',   '👤 Max Admins',   'Limit how many admins'],
                ['maxCashiers', '💳 Max Cashiers',  'Limit how many cashiers'],
                ['maxMembers',  '👥 Max Members',   'Limit total approved members'],
              ].map(([k, l, sub]) => (
                <div key={k}>
                  <label className="form-label">{l}</label>
                  <input type="number" min="0"
                    value={limitsForm[k]}
                    onChange={e => setLimitsForm(p => ({ ...p, [k]: e.target.value }))}
                    placeholder="Unlimited" />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={saveLimits} disabled={savingLimits} className="btn-primary" style={{ padding: '10px 24px' }}>
                {savingLimits ? 'Saving…' : 'Save Limits'}
              </button>
              {selOrg.limits && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Current: {selOrg.limits.maxAdmins ?? '∞'} admins ·{' '}
                  {selOrg.limits.maxCashiers ?? '∞'} cashiers ·{' '}
                  {selOrg.limits.maxMembers ?? '∞'} members
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
