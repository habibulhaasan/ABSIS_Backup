// src/lib/fundCalculations.js
// ─────────────────────────────────────────────────────────────────────────────
// Core financial calculation engine for ABSIS Capital Sync.
// ALL functions are pure — no Firestore reads/writes.
// ─────────────────────────────────────────────────────────────────────────────

// ── Currency formatter ────────────────────────────────────────────────────────
export function fmtBDT(n) {
  const num  = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  const str  = Math.round(num).toString();
  if (str.length <= 3) return `${sign}৳${str}`;
  const last3  = str.slice(-3);
  const rest   = str.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}৳${grouped},${last3}`;
}

export function fmtBDTCompact(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 100000) return `৳${(num / 100000).toFixed(1)}L`;
  if (Math.abs(num) >= 1000)   return `৳${(num / 1000).toFixed(1)}K`;
  return fmtBDT(num);
}

// ── Fund keys ─────────────────────────────────────────────────────────────────
export const FUND_KEYS = ['investment', 'reserve', 'benevolent', 'expenses'];

export const FUND_META = {
  investment: { label: 'Investment Fund', icon: '📈', color: '#2563eb', bg: '#eff6ff',
    desc: 'Capital deployed in investment projects' },
  reserve:    { label: 'Reserve Fund',    icon: '🛡️',  color: '#16a34a', bg: '#f0fdf4',
    desc: 'Emergency buffer; overflow from Expenses Fund' },
  benevolent: { label: 'Benevolent Fund', icon: '🤝', color: '#7c3aed', bg: '#faf5ff',
    desc: 'Welfare, charity, interest-free loans' },
  expenses:   { label: 'Expenses Fund',   icon: '🧾', color: '#d97706', bg: '#fffbeb',
    desc: 'Operational expenses + entry fees + re-registration fees' },
};

// ── Payment classification ────────────────────────────────────────────────────
// Single source of truth for what counts as capital contribution.
//
// RULE: isContribution === true  → counts toward member capital
//       isContribution === false → does NOT count toward capital
//
// Monthly installments  → isContribution: true  → splits per fund structure
// General special subs  → isContribution: true  → splits per fund structure
// Entry fees            → isContribution: false → Expenses Fund
// Re-registration fees  → isContribution: false → Expenses Fund
// Gateway fees          → NEVER added to any fund or capital (always excluded)
//
export function isCapitalContribution(payment) {
  if (!payment) return false;
  // Explicit flag takes precedence (set at write-time)
  if (typeof payment.isContribution === 'boolean') return payment.isContribution;
  // Legacy records: infer from paymentType
  const t = payment.paymentType;
  if (t === 'entry_fee' || t === 'reregistration_fee') return false;
  // Monthly installments + general subs → contribution by default
  return true;
}

// Net capital credit for a payment (excludes gateway fee — it's a transaction cost)
// RULE: Gateway fees must NEVER be added to org funds or member capital
export function paymentNetCapital(payment) {
  if (!isCapitalContribution(payment)) return 0;
  return (payment.amount || 0) - (payment.gatewayFee || 0) - (payment.penaltyPaid || 0);
}

// Gross amount paid by member (what they actually transferred)
export function paymentGrossAmount(payment) {
  return payment.amount || 0;
}

// Gateway fee portion (transaction cost — shown separately, never in capital)
export function paymentGatewayFee(payment) {
  return payment.gatewayFee || 0;
}

// ── Fund allocation ───────────────────────────────────────────────────────────
export function computeFundAllocDetailed(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb || !fb.value) return { allocated: 0, cappedAt: null, overflowToReserve: 0 };

  const raw = fb.type === 'amount'
    ? Number(fb.value) || 0
    : Math.round(totalCapital * (Number(fb.value) || 0) / 100);

  let ceiling = null;
  if (fb.maxAmount && Number(fb.maxAmount) > 0) {
    ceiling = fb.capType === 'percent'
      ? Math.round(totalCapital * Number(fb.maxAmount) / 100)
      : Number(fb.maxAmount);
  }

  if (ceiling !== null && raw > ceiling) {
    return { allocated: ceiling, cappedAt: ceiling, overflowToReserve: raw - ceiling };
  }
  return { allocated: raw, cappedAt: null, overflowToReserve: 0 };
}

export function computeFundAlloc(key, totalCapital, settings) {
  return computeFundAllocDetailed(key, totalCapital, settings).allocated;
}

// ── Org-level fund summary ────────────────────────────────────────────────────
// payments      — all investment docs
// expenses      — expense docs
// projects      — investmentProject docs
// loans         — loan docs
// entryFees     — entryFees collection docs (admin-recorded)
// settings      — org settings
//
// IMPORTANT: gateway fees are EXCLUDED from all fund calculations.
// IMPORTANT: entry fees + re-reg fees → expenses fund used amount.
export function calcFundSummary({ payments, expenses, projects, loans, entryFees = [], settings }) {
  // Total verified capital = contributions only, gateway fee excluded
  const totalCapital = (payments || [])
    .filter(p => p.status === 'verified' && isCapitalContribution(p))
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);

  // Expenses fund usage:
  // 1. Admin-recorded expenses
  const usedAdminExpenses = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
  // 2. Entry fees from entryFees collection
  const usedEntryFees = (entryFees || []).reduce((s, f) => s + (f.amount || 0), 0);
  // 3. Entry/re-reg fees from investments (paid via installment page)
  const usedSubFees = (payments || [])
    .filter(p => p.status === 'verified' && !isCapitalContribution(p) &&
      (p.paymentType === 'entry_fee' || p.paymentType === 'reregistration_fee'))
    .reduce((s, p) => s + (p.amount || 0), 0);
  const usedExpenses = usedAdminExpenses + usedEntryFees + usedSubFees;

  // Investment projects split by fund source
  let usedInvestment = 0, usedReserveFromInvest = 0;
  (projects || []).forEach(p => {
    if (p.fundSources) {
      usedInvestment += Number(p.fundSources.investment) || 0;
      usedReserveFromInvest += Number(p.fundSources.reserve) || 0;
    } else {
      const amt = p.investedAmount || 0;
      if (p.fundSource === 'reserve') usedReserveFromInvest += amt;
      else usedInvestment += amt;
    }
  });

  // Benevolent: loans disbursed
  const usedBenevolent = (loans || [])
    .filter(l => l.status === 'disbursed' || l.status === 'repaid')
    .reduce((s, l) => s + (l.amount || 0), 0);

  const fundResults = {};
  let totalOverflow = 0;

  FUND_KEYS.forEach(key => {
    const detail = computeFundAllocDetailed(key, totalCapital, settings);
    totalOverflow += detail.overflowToReserve;

    const usedMap = {
      investment: usedInvestment,
      reserve:    usedReserveFromInvest,
      benevolent: usedBenevolent,
      expenses:   usedExpenses,
    };

    const used      = usedMap[key] || 0;
    const allocated = detail.allocated + (key === 'reserve' ? totalOverflow : 0);
    const remaining = allocated - used;

    fundResults[key] = {
      allocated, used, remaining,
      cappedAt:          detail.cappedAt,
      overflowToReserve: detail.overflowToReserve,
      usedPct:    allocated > 0 ? Math.min(100, (used / allocated) * 100) : 0,
      overBudget: used > allocated && allocated > 0,
    };
  });

  return {
    totalCapital,
    funds: fundResults,
    expensesCapOverflow: totalOverflow,
    breakdown: {
      usedAdminExpenses, usedEntryFees, usedSubFees,
      usedInvestment, usedReserveFromInvest, usedBenevolent,
    },
  };
}

// ── Member capital ────────────────────────────────────────────────────────────
// gateway fees are always excluded
export function calcMemberCapital(payments, memberId) {
  return (payments || [])
    .filter(p => p.status === 'verified' && p.userId === memberId && isCapitalContribution(p))
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);
}

export function calcTotalCapital(payments) {
  return (payments || [])
    .filter(p => p.status === 'verified' && isCapitalContribution(p))
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);
}

// ── Member gateway fee total ──────────────────────────────────────────────────
export function calcMemberGatewayFees(payments, memberId) {
  return (payments || [])
    .filter(p => p.status === 'verified' && p.userId === memberId)
    .reduce((s, p) => s + (p.gatewayFee || 0), 0);
}

// ── Late payment detection ────────────────────────────────────────────────────
// Returns days late for a payment made after the due date.
// dueDay: day of month (e.g. 10 = 10th of the month)
// month: 'YYYY-MM' string
// paymentDate: JS Date or Firestore timestamp
export function calcDaysLate(month, dueDay, paymentDate) {
  if (!month || !paymentDate) return 0;
  const [y, m] = month.split('-').map(Number);
  const dueDate     = new Date(y, m - 1, dueDay || 10);
  const paidDate    = paymentDate?.seconds
    ? new Date(paymentDate.seconds * 1000)
    : new Date(paymentDate);
  const diffMs      = paidDate.getTime() - dueDate.getTime();
  return diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
}

// Count how many months a member has NOT paid (starting from effectiveStart)
export function countMissedMonths(memberMonths, paidMonthsSet, upToMonth = null) {
  const cutoff = upToMonth || new Date().toISOString().slice(0, 7);
  return memberMonths
    .filter(m => m <= cutoff && !paidMonthsSet.has(m))
    .length;
}

// ── Member fund portions ──────────────────────────────────────────────────────
export function calcMemberFundPortions({ memberCapital, totalCapital, orgExpenses, settings }) {
  if (!totalCapital || totalCapital === 0) {
    return FUND_KEYS.reduce((acc, key) => {
      acc[key] = { portion: 0, usedAmount: 0, remaining: 0, pct: 0 };
      return acc;
    }, {});
  }
  const memberRatio = memberCapital / totalCapital;
  const fb = settings?.fundBudgets || {};
  const result = {};
  FUND_KEYS.forEach(key => {
    const fundCfg = fb[key] || {};
    let pct = 0;
    if (fundCfg.type === 'pct') pct = Number(fundCfg.value) || 0;
    else if (fundCfg.type === 'amount' && totalCapital > 0)
      pct = ((Number(fundCfg.value) || 0) / totalCapital) * 100;
    const portion    = Math.round(memberCapital * pct / 100);
    const usedAmount = key === 'expenses' ? Math.round(orgExpenses * memberRatio) : 0;
    result[key] = { portion, usedAmount, remaining: portion - usedAmount, pct };
  });
  return result;
}

export function calcMemberFundPortionsExtended({
  memberCapital, totalCapital, orgExpenses,
  orgInvestmentUsed, orgReserveUsed, orgBenevolentUsed, settings,
}) {
  if (!totalCapital || totalCapital === 0) {
    return FUND_KEYS.reduce((acc, key) => {
      acc[key] = { portion: 0, usedAmount: 0, remaining: 0, pct: 0 };
      return acc;
    }, {});
  }
  const memberRatio = memberCapital / totalCapital;
  const fb = settings?.fundBudgets || {};
  const orgUsedMap = {
    investment: orgInvestmentUsed || 0,
    reserve:    orgReserveUsed    || 0,
    benevolent: orgBenevolentUsed || 0,
    expenses:   orgExpenses       || 0,
  };
  const result = {};
  FUND_KEYS.forEach(key => {
    const fundCfg = fb[key] || {};
    let pct = 0;
    if (fundCfg.type === 'pct') pct = Number(fundCfg.value) || 0;
    else if (fundCfg.type === 'amount' && totalCapital > 0)
      pct = ((Number(fundCfg.value) || 0) / totalCapital) * 100;
    const portion    = Math.round(memberCapital * pct / 100);
    const usedAmount = Math.round((orgUsedMap[key] || 0) * memberRatio);
    result[key] = { portion, usedAmount, remaining: portion - usedAmount, pct, overUsed: (portion - usedAmount) < 0 };
  });
  return result;
}

// ── Exit settlement ───────────────────────────────────────────────────────────
export function calcMemberExitSettlement({ memberCapital, expensesCharged, outstandingLoans, adminAdjustment = 0 }) {
  const deductions = {
    expenses: Math.max(0, expensesCharged || 0),
    loans:    Math.max(0, outstandingLoans || 0),
    admin:    adminAdjustment < 0 ? Math.abs(adminAdjustment) : 0,
  };
  const totalDeductions = deductions.expenses + deductions.loans + deductions.admin;
  const bonus           = adminAdjustment > 0 ? adminAdjustment : 0;
  const netReturn       = Math.max(0, memberCapital - totalDeductions + bonus);
  return {
    grossReturn: memberCapital, deductions, totalDeductions, bonus, netReturn,
    breakdown: [
      { label: 'Total Contributions',     amount: memberCapital,        type: 'credit' },
      { label: 'Expenses (proportional)', amount: -deductions.expenses, type: 'debit'  },
      { label: 'Outstanding Loans',       amount: -deductions.loans,    type: 'debit'  },
      ...(deductions.admin > 0 ? [{ label: 'Admin Deduction', amount: -deductions.admin, type: 'debit' }] : []),
      ...(bonus > 0            ? [{ label: 'Admin Bonus',     amount: bonus,             type: 'credit' }] : []),
      { label: 'Net Return Amount',       amount: netReturn,            type: 'total'  },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function toDate(ts) {
  if (!ts) return null;
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

export function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Sort members by numeric member ID (e.g. M-001 → 1, M-012 → 12)
export function sortByMemberId(members) {
  return [...(members || [])].sort((a, b) => {
    const na = parseInt((a.idNo || '').replace(/\D/g, ''), 10);
    const nb = parseInt((b.idNo || '').replace(/\D/g, ''), 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return (a.idNo || '').localeCompare(b.idNo || '') ||
           (a.nameEnglish || '').localeCompare(b.nameEnglish || '');
  });
}

// Late payment classification for a verified payment
// Returns { daysLate, isLate, monthsLabel }
export function classifyLateness(payment, dueDay) {
  if (!payment?.createdAt) return { daysLate: 0, isLate: false };
  const months = payment.paidMonths || [];
  if (months.length === 0) return { daysLate: 0, isLate: false };
  // Use the latest month in the payment
  const latestMonth = months.slice().sort().pop();
  const days = calcDaysLate(latestMonth, dueDay || 10, payment.createdAt);
  return { daysLate: days, isLate: days > 0, month: latestMonth };
}
