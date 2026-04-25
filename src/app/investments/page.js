'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, query, orderBy, onSnapshot,
  getDocs, getDoc, doc,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES = [
  { key: 'proposed',  label: 'Proposed',  color: '#92400e', bg: '#fef3c7', dot: '#f59e0b' },
  { key: 'active',    label: 'Active',    color: '#1e40af', bg: '#dbeafe', dot: '#2563eb' },
  { key: 'completed', label: 'Completed', color: '#14532d', bg: '#dcfce7', dot: '#16a34a' },
  { key: 'cancelled', label: 'Cancelled', color: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt       = n  => `৳${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtSigned = n  => { const v = Number(n) || 0; const s = `৳${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; return v < 0 ? `−${s}` : `+${s}`; };
const pct       = n  => `${(Number(n) || 0).toFixed(2)}%`;
const cap       = s  => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const tsDate    = ts => { if (!ts) return '—'; const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };

// ── Shared UI ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.proposed;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
      {s.label}
    </span>
  );
}

function Stat({ label, value, sub, color = '#0f172a', bg = '#f8fafc' }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Transaction list (returns + expenses) ────────────────────────────────────

function TransactionsTab({ project, orgId }) {
  const [returns,  setReturns]  = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!project?.id) return;
    let doneR = false, doneE = false;
    const check = () => { if (doneR && doneE) setLoading(false); };

    const unsubR = onSnapshot(
      query(collection(db, 'organizations', orgId, 'investmentProjects', project.id, 'returns'),
        orderBy('date', 'desc')),
      snap => { setReturns(snap.docs.map(d => ({ id: d.id, ...d.data() }))); doneR = true; check(); },
      () => { doneR = true; check(); }
    );
    const unsubE = onSnapshot(
      query(collection(db, 'organizations', orgId, 'investmentProjects', project.id, 'projectExpenses'),
        orderBy('date', 'desc')),
      snap => { setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))); doneE = true; check(); },
      () => { doneE = true; check(); }
    );
    return () => { unsubR(); unsubE(); };
  }, [project?.id, orgId]);

  // Merge + sort by date desc
  const all = [
    ...returns.map(r  => ({ ...r,  _kind: 'return'  })),
    ...expenses.map(e => ({ ...e,  _kind: 'expense' })),
  ].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

  const totalReturns  = returns.reduce((s, r) => s + (r.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>;

  return (
    <div>
      {/* Mini summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <Stat label="Returns"  value={fmt(totalReturns)}            color="#15803d" bg="#f0fdf4" />
        <Stat label="Expenses" value={fmt(totalExpenses)}           color="#dc2626" bg="#fef2f2" />
        <Stat label="Net"
          value={fmtSigned(totalReturns - totalExpenses)}
          color={(totalReturns - totalExpenses) >= 0 ? '#15803d' : '#dc2626'}
          bg={(totalReturns - totalExpenses) >= 0 ? '#f0fdf4' : '#fef2f2'} />
      </div>

      {all.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 20px', color: '#94a3b8',
          fontSize: 13, background: '#fafafa', borderRadius: 10 }}>
          No transactions recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {all.map(tx => {
            const isReturn = tx._kind === 'return';
            return (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10,
                border: `1px solid ${isReturn ? '#bbf7d0' : '#fecaca'}`,
                background: isReturn ? '#f0fdf4' : '#fef2f2' }}>
                {/* Icon */}
                <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
                  background: isReturn ? '#dcfce7' : '#fee2e2' }}>
                  {isReturn ? '↑' : '↓'}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                      {tx.description || cap(tx.category?.replace('_', ' '))}
                    </span>
                    <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: isReturn ? '#dcfce7' : '#fee2e2',
                      color: isReturn ? '#15803d' : '#dc2626' }}>
                      {cap(tx.category?.replace('_', ' '))}
                    </span>
                    {isReturn && tx.distributedInDistributionId && (
                      <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10,
                        fontWeight: 700, background: '#dbeafe', color: '#1d4ed8' }}>
                        Distributed
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{tx.date}</div>
                </div>
                {/* Amount */}
                <span style={{ fontWeight: 700, fontSize: 14, flexShrink: 0,
                  color: isReturn ? '#15803d' : '#dc2626' }}>
                  {isReturn ? '+' : '−'}{fmt(tx.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Simple tab bar ────────────────────────────────────────────────────────────

function SheetTabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 16 }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
          style={{ padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: active === id ? 700 : 400,
            color: active === id ? '#2563eb' : '#64748b',
            borderBottom: active === id ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -2 }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Project Detail Sheet ──────────────────────────────────────────────────────

function ProjectSheet({ project, myShare, orgId, onClose }) {
  const [tab, setTab] = useState('overview');
  const isPeriodic = project.returnType === 'periodic';
  const netProfit  = isPeriodic
    ? (project.totalReturns || 0) - (project.totalExpenses || 0)
    : (project.profit ?? null);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }} />

      {/* Sheet */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0,
        maxHeight: '90vh', overflowY: 'auto',
        background: '#fff', borderRadius: '20px 20px 0 0',
        zIndex: 201, padding: '0 0 32px' }}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '12px 20px 16px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                {project.title}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusBadge status={project.status} />
                <span style={{ padding: '3px 10px', borderRadius: 6,
                  background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 700 }}>
                  {project.type}
                </span>
                <span style={{ padding: '3px 10px', borderRadius: 6,
                  background: isPeriodic ? '#faf5ff' : '#f0fdf4',
                  color: isPeriodic ? '#7e22ce' : '#14532d', fontSize: 12, fontWeight: 700 }}>
                  {isPeriodic ? '🔄 Periodic' : '📦 Lump Sum'}
                </span>
                {myShare && (
                  <span style={{ padding: '3px 10px', borderRadius: 6,
                    background: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: 700 }}>
                    👤 You participate
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose}
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%',
                width: 32, height: 32, cursor: 'pointer', fontSize: 16, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ padding: '12px 20px 0' }}>
          <SheetTabBar
            tabs={[
              ['overview',      'Overview'],
              ['transactions',  isPeriodic ? 'Transactions' : 'Returns'],
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {/* ── OVERVIEW TAB ── */}
        {tab === 'overview' && (
          <div style={{ padding: '4px 20px 0' }}>

            {project.description && (
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6,
                padding: '10px 14px', background: '#f8fafc', borderRadius: 8, marginBottom: 16 }}>
                {project.description}
              </p>
            )}

            {/* Project financials */}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b',
              textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Project Financials
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 10, marginBottom: 20 }}>
              <Stat label="Invested" value={fmt(project.investedAmount)} bg="#fef3c7" color="#92400e" />
              {project.expectedReturnPct > 0 && (
                <Stat label="Expected Return"
                  value={pct(project.expectedReturnPct)}
                  sub={fmt(project.investedAmount * project.expectedReturnPct / 100)}
                  bg="#f0fdf4" color="#15803d" />
              )}
              {isPeriodic ? (
                <>
                  <Stat label="Total Returns"  value={fmt(project.totalReturns || 0)}  color="#15803d" bg="#f0fdf4" />
                  <Stat label="Total Expenses" value={fmt(project.totalExpenses || 0)} color="#dc2626" bg="#fef2f2" />
                  <Stat label="Net Profit / Loss"
                    value={fmtSigned(netProfit)}
                    bg={netProfit >= 0 ? '#f0fdf4' : '#fef2f2'}
                    color={netProfit >= 0 ? '#15803d' : '#dc2626'} />
                </>
              ) : (
                project.actualReturnAmount != null && (
                  <>
                    <Stat label="Returned" value={fmt(project.actualReturnAmount)} bg="#eff6ff" color="#1d4ed8" />
                    {netProfit !== null && (
                      <Stat
                        label={netProfit >= 0 ? 'Profit' : 'Loss'}
                        value={fmtSigned(netProfit)}
                        sub={`${netProfit >= 0 ? '+' : ''}${pct(project.investedAmount > 0 ? (netProfit / project.investedAmount) * 100 : 0)} ROI`}
                        bg={netProfit >= 0 ? '#f0fdf4' : '#fef2f2'}
                        color={netProfit >= 0 ? '#15803d' : '#dc2626'} />
                    )}
                  </>
                )
              )}
            </div>

            {/* My Share */}
            {myShare ? (
              <div style={{ borderRadius: 12, border: '2px solid #fde68a',
                background: '#fffbeb', overflow: 'hidden', marginBottom: 20 }}>
                <div style={{ padding: '10px 14px', background: '#fef3c7',
                  fontWeight: 700, fontSize: 13, color: '#92400e', display: 'flex',
                  alignItems: 'center', gap: 8 }}>
                  <span>👤</span> Your Share
                </div>
                <div style={{ padding: '14px 14px 16px' }}>
                  <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                    <Stat label="Your Capital"    value={fmt(myShare.capital)}           bg="#fff" />
                    <Stat label="Capital Share"   value={pct(myShare.capPct)}            bg="#fff" />
                    <Stat label="Eff. Investment" value={fmt(myShare.effectiveInvested)} bg="#fff" />
                    <Stat
                      label={myShare.profitShare >= 0 ? 'Your Profit' : 'Your Loss'}
                      value={fmtSigned(myShare.profitShare)}
                      color={myShare.profitShare >= 0 ? '#15803d' : '#dc2626'}
                      bg={myShare.profitShare >= 0 ? '#f0fdf4' : '#fef2f2'} />
                  </div>
                  {myShare.profitShare === 0 && netProfit === null && (
                    <p style={{ fontSize: 12, color: '#92400e', marginTop: 10 }}>
                      Profit / loss will be calculated once the project has an outcome.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f8fafc',
                border: '1px solid #e2e8f0', fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                ℹ️ You are not a direct participant in this project. Your capital still
                contributes to the organisation but is not counted in this investment's
                profit/loss share.
              </div>
            )}

            {/* Dates */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              {project.startDate     && <div style={{ fontSize: 12, color: '#64748b' }}>📅 Started: <strong>{project.startDate}</strong></div>}
              {project.completedDate && <div style={{ fontSize: 12, color: '#64748b' }}>🏁 Completed: <strong>{project.completedDate}</strong></div>}
              <div style={{ fontSize: 12, color: '#64748b' }}>📝 Created: <strong>{tsDate(project.createdAt)}</strong></div>
            </div>

            {project.notes && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fffbeb',
                border: '1px solid #fde68a', fontSize: 13, color: '#78350f' }}>
                <strong>Notes:</strong> {project.notes}
              </div>
            )}
          </div>
        )}

        {/* ── TRANSACTIONS TAB ── */}
        {tab === 'transactions' && (
          <div style={{ padding: '4px 20px 0' }}>
            {!isPeriodic && project.actualReturnAmount != null && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#eff6ff',
                border: '1px solid #bfdbfe', fontSize: 13, color: '#1e40af', marginBottom: 14 }}>
                📦 This is a lump-sum project. The final return of{' '}
                <strong>{fmt(project.actualReturnAmount)}</strong> was recorded when the project
                was marked complete.
              </div>
            )}
            <TransactionsTab project={project} orgId={orgId} />
          </div>
        )}
      </div>
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MemberInvestments() {
  const { userData, orgData, viewUid } = useAuth();
  const orgId = userData?.activeOrgId;

  const [projects,  setProjects]  = useState([]);
  const [payments,  setPayments]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [filter,    setFilter]    = useState('all');

  useEffect(() => {
    if (!orgId || !viewUid) return;
    const unsubProj = onSnapshot(
      query(collection(db, 'organizations', orgId, 'investmentProjects'), orderBy('createdAt', 'desc')),
      snap => {
        setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      }
    );
    // Load member's own payments to calculate capital share
    getDocs(collection(db, 'organizations', orgId, 'investments'))
      .then(snap => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => unsubProj();
  }, [orgId, viewUid]);

  // ── Compute member's capital share across all projects ────────────────────
  const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;

  // Total capital per member (verified contribution payments)
  const capitalMap = {};
  payments
    .filter(p => p.status === 'verified' && p.isContribution !== false)
    .forEach(p => {
      const net = (p.amount || 0) - (feeInAcct ? 0 : (p.gatewayFee || 0));
      if (p.userId) capitalMap[p.userId] = (capitalMap[p.userId] || 0) + net;
    });
  const myCapital = capitalMap[viewUid] || 0;

  // Per-project share for the current member
  function getMyShare(project) {
    const participatingMembers = project.participatingMembers;
    const allParticipate = !participatingMembers || participatingMembers === 'all';
    const participantIds = allParticipate ? null : new Set(participatingMembers);

    // Am I excluded?
    if (!allParticipate && !participantIds.has(viewUid)) return null;
    if (myCapital <= 0) return null;

    // Total capital of participating members only
    const totalCapital = Object.entries(capitalMap)
      .filter(([uid]) => allParticipate || participantIds.has(uid))
      .reduce((s, [, v]) => s + v, 0);

    if (totalCapital <= 0) return null;

    const capShare = myCapital / totalCapital;

    const isPeriodic = project.returnType === 'periodic';
    let netProfit = 0;
    if (isPeriodic) {
      netProfit = (project.totalReturns || 0) - (project.totalExpenses || 0);
    } else {
      if (project.actualReturnAmount != null) {
        netProfit = (project.actualReturnAmount || 0) - (project.investedAmount || 0);
      }
    }

    return {
      capital:           Math.round(myCapital),
      capPct:            capShare * 100,
      effectiveInvested: Math.round(capShare * (project.investedAmount || 0)),
      profitShare:       Math.round(capShare * netProfit),
      totalCapital,
    };
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const myProjects = projects.filter(p => getMyShare(p) !== null);
  const totalMyProfit = myProjects
    .filter(p => p.status === 'completed' || p.returnType === 'periodic')
    .reduce((s, p) => s + (getMyShare(p)?.profitShare || 0), 0);

  const totalOrgInvested = projects.reduce((s, p) => s + (p.investedAmount || 0), 0);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = projects.filter(p => {
    if (filter === 'mine') return getMyShare(p) !== null;
    if (filter === 'all')  return true;
    return p.status === filter;
  });

  if (loading) {
    return (
      <div className="page-wrap animate-fade">
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💹</div>
          Loading projects…
        </div>
      </div>
    );
  }

  const selectedShare = selected ? getMyShare(selected) : null;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Investment Projects</div>
        <div className="page-subtitle">
          Track the organisation's investment portfolio and your personal share.
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 24 }}>
        <Stat label="My Capital" value={fmt(myCapital)} bg="#fef3c7" color="#92400e"
          sub="Your verified contributions" />
        <Stat label="My Projects" value={myProjects.length} bg="#dbeafe" color="#1e40af"
          sub={`of ${projects.length} total`} />
        <Stat label="My Profit / Loss"
          value={totalMyProfit !== 0 ? fmtSigned(totalMyProfit) : '—'}
          bg={totalMyProfit >= 0 ? '#f0fdf4' : '#fef2f2'}
          color={totalMyProfit >= 0 ? '#15803d' : '#dc2626'}
          sub="Across active & completed" />
        <Stat label="Org Invested" value={fmt(totalOrgInvested)} bg="#f8fafc"
          sub={`${projects.filter(p => p.status === 'active').length} active project(s)`} />
      </div>

      {/* No capital warning */}
      {myCapital === 0 && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: '#fffbeb',
          border: '1px solid #fde68a', fontSize: 13, color: '#92400e', marginBottom: 20 }}>
          ⚠️ You have no verified capital payments yet — your profit share will be calculated
          once your installments are verified.
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          ['all',       'All Projects',  projects.length],
          ['mine',      'My Projects',   myProjects.length],
          ['active',    'Active',        projects.filter(p => p.status === 'active').length],
          ['completed', 'Completed',     projects.filter(p => p.status === 'completed').length],
        ].map(([key, label, count]) => (
          <button key={key} onClick={() => setFilter(key)}
            style={{ padding: '6px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
              fontWeight: filter === key ? 700 : 400, border: 'none',
              background: filter === key ? '#0f172a' : '#f1f5f9',
              color: filter === key ? '#fff' : '#64748b' }}>
            {label}
            {count > 0 && <span style={{ opacity: 0.7 }}> ({count})</span>}
          </button>
        ))}
      </div>

      {/* Project list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💹</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: '#0f172a', marginBottom: 6 }}>
            {filter === 'mine' ? "You don't participate in any projects yet" : 'No projects found'}
          </div>
          <p style={{ fontSize: 13, color: '#94a3b8' }}>
            {filter === 'mine'
              ? 'Your capital will be counted once the admin creates projects and your payments are verified.'
              : 'No investment projects match this filter.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(p => {
            const myShare    = getMyShare(p);
            const isPeriodic = p.returnType === 'periodic';
            const sc         = STATUS_MAP[p.status] || STATUS_MAP.proposed;
            const netProfit  = isPeriodic
              ? (p.totalReturns || 0) - (p.totalExpenses || 0)
              : (p.profit ?? null);

            return (
              <div key={p.id} onClick={() => setSelected(p)}
                style={{ borderRadius: 12, border: `1.5px solid ${myShare ? '#fde68a' : '#e2e8f0'}`,
                  background: myShare ? '#fffdf5' : '#fff', padding: '14px 16px',
                  cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = myShare ? '#f59e0b' : '#bfdbfe';
                  e.currentTarget.style.background  = myShare ? '#fefce8' : '#eff6ff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = myShare ? '#fde68a' : '#e2e8f0';
                  e.currentTarget.style.background  = myShare ? '#fffdf5' : '#fff';
                }}>

                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                        {p.title}
                      </span>
                      {myShare && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px',
                          borderRadius: 99, background: '#fef3c7', color: '#92400e' }}>
                          👤 Participating
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <StatusBadge status={p.status} />
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.type}</span>
                      {p.sector && <span style={{ fontSize: 11, color: '#94a3b8' }}>· {p.sector}</span>}
                      <span style={{ fontSize: 11, color: isPeriodic ? '#7e22ce' : '#15803d' }}>
                        {isPeriodic ? '🔄 Periodic' : '📦 Lump Sum'}
                      </span>
                    </div>
                  </div>

                  {/* Profit / Loss pill */}
                  {netProfit !== null ? (
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Org net</div>
                      <span style={{ fontWeight: 700, fontSize: 14,
                        color: netProfit >= 0 ? '#15803d' : '#dc2626' }}>
                        {fmtSigned(netProfit)}
                      </span>
                    </div>
                  ) : (
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Invested</div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#92400e' }}>
                        {fmt(p.investedAmount)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Bottom row — my share preview */}
                {myShare ? (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap',
                    paddingTop: 10, borderTop: '1px solid #fde68a' }}>
                    {[
                      ['My Capital',    fmt(myShare.capital),           '#92400e'],
                      ['My Share',      pct(myShare.capPct),            '#1e40af'],
                      ['Eff. Invested', fmt(myShare.effectiveInvested), '#475569'],
                      ['My P&L',
                        myShare.profitShare !== 0 ? fmtSigned(myShare.profitShare) : '—',
                        myShare.profitShare > 0 ? '#15803d' : myShare.profitShare < 0 ? '#dc2626' : '#94a3b8'],
                    ].map(([lbl, val, col]) => (
                      <div key={lbl} style={{ background: '#fff8e1', borderRadius: 8,
                        padding: '6px 10px', minWidth: 80 }}>
                        <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                          {lbl}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ paddingTop: 8, borderTop: '1px solid #f1f5f9',
                    fontSize: 12, color: '#94a3b8' }}>
                    Invested: <strong style={{ color: '#92400e' }}>{fmt(p.investedAmount)}</strong>
                    {p.expectedReturnPct > 0 && (
                      <span> · Expected return: <strong>{pct(p.expectedReturnPct)}</strong></span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail sheet */}
      {selected && (
        <ProjectSheet
          project={selected}
          myShare={selectedShare}
          orgId={orgId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}