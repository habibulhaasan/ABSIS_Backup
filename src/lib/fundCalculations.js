// src/lib/fundCalculations.js
// ─────────────────────────────────────────────────────────────────────────────
// Core financial calculation engine for ABSIS Capital Sync.
// ALL functions are pure — no Firestore reads/writes.
// Data is passed in; results are computed and returned.
// This makes calculations safe to use retroactively on live data without
// any schema migration.
// ─────────────────────────────────────────────────────────────────────────────

// ── Currency formatter ────────────────────────────────────────────────────────
// Bengali-style: 1,00,000 (South Asian grouping)
export function fmtBDT(n) {
  const num = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';

  // Bengali number grouping: last 3 digits, then groups of 2
  const str = Math.round(num).toString();
  if (str.length <= 3) return `${sign}৳${str}`;

  const last3 = str.slice(-3);
  const rest   = str.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}৳${grouped},${last3}`;
}

// Compact version for small spaces: ৳1.2L, ৳45K
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
    desc: 'Operational expenses and running costs' },
};

// ── Fund allocation (budget) computation ──────────────────────────────────────
// Supports:
//   type === 'pct'    → value% of totalCapital, with optional cap
//   type === 'amount' → fixed BDT value
//
// Cap (maxAmount) can itself be:
//   capType === 'fixed'   → fixed BDT ceiling
//   capType === 'percent' → % of totalCapital ceiling
//   (default)             → fixed BDT (backward-compatible)
//
// Returns { allocated, cappedAt, overflowToReserve }
export function computeFundAllocDetailed(key, totalCapital, settings) {
  const fb = settings?.fundBudgets?.[key];
  if (!fb || !fb.value) return { allocated: 0, cappedAt: null, overflowToReserve: 0 };

  const raw = fb.type === 'amount'
    ? Number(fb.value) || 0
    : Math.round(totalCapital * (Number(fb.value) || 0) / 100);

  // Resolve cap ceiling
  let ceiling = null;
  if (fb.maxAmount && Number(fb.maxAmount) > 0) {
    if (fb.capType === 'percent') {
      ceiling = Math.round(totalCapital * Number(fb.maxAmount) / 100);
    } else {
      ceiling = Number(fb.maxAmount);
    }
  }

  if (ceiling !== null && raw > ceiling) {
    return {
      allocated:          ceiling,
      cappedAt:           ceiling,
      overflowToReserve:  raw - ceiling,
    };
  }

  return { allocated: raw, cappedAt: null, overflowToReserve: 0 };
}

// Simplified version — returns just the allocated number (drop-in for old computeFundAlloc)
export function computeFundAlloc(key, totalCapital, settings) {
  return computeFundAllocDetailed(key, totalCapital, settings).allocated;
}

// ── Org-level fund summary ────────────────────────────────────────────────────
// Computes allocated budget and actual usage for every fund.
//
// payments     — array of investment docs (installments), filter verified outside if needed
// expenses     — array of expense docs
// projects     — array of investmentProject docs
// loans        — array of loan docs
// settings     — org settings object (contains fundBudgets)
// Gateway fees are always excluded from capital — they are transaction costs, not contributions.
//
// Returns:
// {
//   totalCapital,
//   funds: {
//     investment: { allocated, used, remaining, cappedAt, overflowToReserve },
//     reserve:    { ... },
//     benevolent: { ... },
//     expenses:   { ... },
//   },
//   expensesCapOverflow,   // total amount redirected to reserve due to cap
// }
export function calcFundSummary({ payments, expenses, projects, loans, settings }) {
  // Total verified capital
  const totalCapital = (payments || [])
    .filter(p => p.status === 'verified')
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);

  // Expenses used
  const usedExpenses = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0);

  // Investment projects split by fund source
  let usedInvestment = 0, usedReserveFromInvest = 0;
  (projects || []).forEach(p => {
    const amt = p.investedAmount || 0;
    if (p.fundSource === 'reserve') usedReserveFromInvest += amt;
    else usedInvestment += amt;
  });

  // Benevolent: loans disbursed
  const usedBenevolent = (loans || [])
    .filter(l => l.status === 'disbursed' || l.status === 'repaid')
    .reduce((s, l) => s + (l.amount || 0), 0);

  // Compute each fund allocation with cap logic
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
    const allocated = detail.allocated + (key === 'reserve' ? totalOverflow : 0); // overflow adds to reserve budget
    const remaining = allocated - used;

    fundResults[key] = {
      allocated,
      used,
      remaining,
      cappedAt:           detail.cappedAt,
      overflowToReserve:  detail.overflowToReserve,
      usedPct:            allocated > 0 ? Math.min(100, (used / allocated) * 100) : 0,
      overBudget:         used > allocated && allocated > 0,
    };
  });

  return {
    totalCapital,
    funds: fundResults,
    expensesCapOverflow: totalOverflow,
  };
}

// ── Member fund portions ──────────────────────────────────────────────────────
// Given a member's total capital contribution, compute their virtual share
// of each fund based on the org's fund structure percentages.
//
// memberCapital  — number: total verified contribution for this member
// totalCapital   — number: total verified contributions for the whole org
// orgExpenses    — number: total org expenses charged so far
// settings       — org settings object
//
// Returns per-fund object:
// {
//   investment: { portion, usedAmount, remaining, pct },
//   reserve:    { ... },
//   benevolent: { ... },
//   expenses:   { ... },
// }
export function calcMemberFundPortions({ memberCapital, totalCapital, orgExpenses, settings }) {
  if (!totalCapital || totalCapital === 0) {
    return FUND_KEYS.reduce((acc, key) => {
      acc[key] = { portion: 0, usedAmount: 0, remaining: 0, pct: 0 };
      return acc;
    }, {});
  }

  const memberRatio = memberCapital / totalCapital; // e.g. 0.05 for 5% share
  const fb = settings?.fundBudgets || {};

  const result = {};

  FUND_KEYS.forEach(key => {
    // Get the raw % allocation for this fund
    const fundCfg = fb[key] || {};
    let pct = 0;
    if (fundCfg.type === 'pct') {
      pct = Number(fundCfg.value) || 0;
    } else if (fundCfg.type === 'amount' && totalCapital > 0) {
      pct = ((Number(fundCfg.value) || 0) / totalCapital) * 100;
    }

    // Member's portion of this fund
    const portion = Math.round(memberCapital * pct / 100);

    // Member's share of org expenses (only for expenses fund)
    let usedAmount = 0;
    if (key === 'expenses') {
      usedAmount = Math.round(orgExpenses * memberRatio);
    }
    // For other funds: usedAmount calculated when we have project/loan data
    // (passed separately in extended version below)

    result[key] = {
      portion,
      usedAmount,
      remaining: portion - usedAmount,
      pct,
    };
  });

  return result;
}

// Extended version with full used amounts per fund
export function calcMemberFundPortionsExtended({
  memberCapital,
  totalCapital,
  orgExpenses,
  orgInvestmentUsed,
  orgReserveUsed,
  orgBenevolentUsed,
  settings,
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
    if (fundCfg.type === 'pct') {
      pct = Number(fundCfg.value) || 0;
    } else if (fundCfg.type === 'amount' && totalCapital > 0) {
      pct = ((Number(fundCfg.value) || 0) / totalCapital) * 100;
    }

    const portion    = Math.round(memberCapital * pct / 100);
    const usedAmount = Math.round((orgUsedMap[key] || 0) * memberRatio);
    const remaining  = portion - usedAmount;

    result[key] = {
      portion,
      usedAmount,
      remaining,
      pct,
      overUsed: remaining < 0,
    };
  });

  return result;
}

// ── Late joiner share calculation ─────────────────────────────────────────────
// For a member who joined late and chose NOT to back-pay:
// Their share in any investment is proportional to their contribution
// at the TIME that investment was made.
//
// investmentDate  — Date or Firestore timestamp of when investment was committed
// memberPayments  — array of { createdAt, amount, status } for this member
// allPayments     — array of { createdAt, amount, status, userId } for all members
// investedAmount  — total amount invested in this project
//
// Returns { memberShare, memberSharePct }
export function calcLateJoinerInvestmentShare({
  investmentDate,
  memberPayments,
  allPayments,
  investedAmount,
}) {
  const cutoff = investmentDate?.seconds
    ? investmentDate.seconds * 1000
    : new Date(investmentDate).getTime();

  // Total org capital at investment date (verified payments before cutoff)
  const orgCapitalAtDate = (allPayments || [])
    .filter(p => p.status === 'verified')
    .filter(p => {
      const t = p.createdAt?.seconds
        ? p.createdAt.seconds * 1000
        : new Date(p.createdAt).getTime();
      return t <= cutoff;
    })
    .reduce((s, p) => s + (p.amount || 0), 0);

  // Member's capital at investment date
  const memberCapitalAtDate = (memberPayments || [])
    .filter(p => p.status === 'verified')
    .filter(p => {
      const t = p.createdAt?.seconds
        ? p.createdAt.seconds * 1000
        : new Date(p.createdAt).getTime();
      return t <= cutoff;
    })
    .reduce((s, p) => s + (p.amount || 0), 0);

  if (!orgCapitalAtDate || !memberCapitalAtDate) {
    return { memberShare: 0, memberSharePct: 0 };
  }

  const memberSharePct = (memberCapitalAtDate / orgCapitalAtDate) * 100;
  const memberShare    = Math.round((investedAmount || 0) * memberCapitalAtDate / orgCapitalAtDate);

  return { memberShare, memberSharePct };
}

// ── Payment type classification ───────────────────────────────────────────────
// Determines whether a payment counts as a member capital contribution
// and which fund it routes to.
//
// paymentType  — 'installment' | 'special_sub' | 'entry_fee' | 'reregistration_fee'
// subMeta      — for special subs: the specialSubscription doc (has .type, .countAsContribution)
//
// Returns { isContribution, fundRoute }
//   isContribution: true  → counts toward member capital, split per fund structure
//   isContribution: false → does NOT count toward capital
//   fundRoute: 'split' | 'expenses'
export function classifyPayment(paymentType, subMeta = null) {
  // Monthly installments are always contributions, split per fund structure
  if (paymentType === 'installment') {
    return { isContribution: true, fundRoute: 'split' };
  }

  // Special subscriptions — depends on type and admin toggle
  if (paymentType === 'special_sub' && subMeta) {
    // Re-registration fees always go to expenses, never capital
    if (subMeta.type === 'reregistration_fee') {
      return { isContribution: false, fundRoute: 'expenses' };
    }
    // Entry fees: admin chooses via countAsContribution
    if (subMeta.type === 'entry_fee') {
      return {
        isContribution: !!subMeta.countAsContribution,
        fundRoute: subMeta.countAsContribution ? 'split' : 'expenses',
      };
    }
    // General special subs — treated as contribution by default
    return { isContribution: true, fundRoute: 'split' };
  }

  // Standalone entry fees (from entryFees collection) — always expenses fund
  if (paymentType === 'entry_fee') {
    return { isContribution: false, fundRoute: 'expenses' };
  }

  // Default: treat as contribution
  return { isContribution: true, fundRoute: 'split' };
}

// Human-readable fund route label
export function fundRouteLabel(fundRoute) {
  if (fundRoute === 'expenses') return 'Expenses Fund';
  if (fundRoute === 'split')    return 'Fund Structure (split)';
  return fundRoute || '—';
}

// ── Member exit settlement ────────────────────────────────────────────────────
// Calculates what a member is owed when they exit the organisation.
//
// memberCapital   — total verified contributions
// expensesCharged — member's proportional share of org expenses
// outstandingLoans — total unpaid loan principal
// adminAdjustment  — manual admin adjustment (positive = bonus, negative = deduction)
//
// Returns { grossReturn, deductions, netReturn, breakdown }
export function calcMemberExitSettlement({
  memberCapital,
  expensesCharged,
  outstandingLoans,
  adminAdjustment = 0,
}) {
  const deductions = {
    expenses: Math.max(0, expensesCharged || 0),
    loans:    Math.max(0, outstandingLoans || 0),
    admin:    adminAdjustment < 0 ? Math.abs(adminAdjustment) : 0,
  };

  const totalDeductions = deductions.expenses + deductions.loans + deductions.admin;
  const bonus           = adminAdjustment > 0 ? adminAdjustment : 0;
  const netReturn       = Math.max(0, memberCapital - totalDeductions + bonus);

  return {
    grossReturn:     memberCapital,
    deductions,
    totalDeductions,
    bonus,
    netReturn,
    breakdown: [
      { label: 'Total Contributions',       amount: memberCapital,         type: 'credit' },
      { label: 'Expenses (proportional)',   amount: -deductions.expenses,  type: 'debit'  },
      { label: 'Outstanding Loans',         amount: -deductions.loans,     type: 'debit'  },
      ...(deductions.admin > 0 ? [{ label: 'Admin Deduction', amount: -deductions.admin, type: 'debit' }] : []),
      ...(bonus > 0            ? [{ label: 'Admin Bonus',     amount: bonus,             type: 'credit' }] : []),
      { label: 'Net Return Amount',         amount: netReturn,             type: 'total'  },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert Firestore timestamp or date string to JS Date
export function toDate(ts) {
  if (!ts) return null;
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

// Format date in dd MMM yyyy (en-GB)
export function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Member's total verified capital from payments array
export function calcMemberCapital(payments, memberId) {
  return (payments || [])
    .filter(p => p.status === 'verified' && p.userId === memberId)
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);
}

// Total org verified capital
export function calcTotalCapital(payments) {
  return (payments || [])
    .filter(p => p.status === 'verified')
    .reduce((s, p) => s + (p.amount || 0) - (p.gatewayFee || 0), 0);
}

// ── Investment commitment per member ──────────────────────────────────────────
// Given all investment projects and a member's capital,
// calculates how much of their Investment Fund allocation is committed.
//
// projects       — array of investmentProject docs
// memberCapital  — this member's verified capital
// totalCapital   — org total verified capital
// settings       — org settings (for fund budget pcts)
//
// Returns { committed, available, projects: [{title, memberShare}] }
export function calcMemberInvestmentCommitment({ projects, memberCapital, totalCapital, settings }) {
  if (!totalCapital || !memberCapital) return { committed: 0, available: 0, commitments: [] };

  const memberRatio = memberCapital / totalCapital;
  const fb          = settings?.fundBudgets?.investment || {};
  let investPct = 0;
  if (fb.type === 'pct') investPct = Number(fb.value) || 0;
  else if (fb.type === 'amount' && totalCapital > 0) {
    investPct = ((Number(fb.value) || 0) / totalCapital) * 100;
  }
  const memberInvestAlloc = Math.round(memberCapital * investPct / 100);

  const activeProjects = (projects || []).filter(p =>
    p.status === 'active' || p.status === 'proposed'
  );

  const commitments = activeProjects.map(p => {
    const invAmt = p.fundSources?.investment ?? (p.fundSource !== 'reserve' ? (p.investedAmount || 0) : 0);
    const participating = !p.participatingMembers || p.participatingMembers === 'all'
      || (Array.isArray(p.participatingMembers) && p.participatingMembers.includes('__member__'));
    const memberShare = participating ? Math.round(invAmt * memberRatio) : 0;
    return { id: p.id, title: p.title, investedAmount: invAmt, memberShare, participating };
  }).filter(c => c.memberShare > 0);

  const committed  = commitments.reduce((s, c) => s + c.memberShare, 0);
  const available  = Math.max(0, memberInvestAlloc - committed);

  return { committed, available, memberInvestAlloc, commitments };
}