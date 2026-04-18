// src/lib/fundLedgerUtils.js
/**
 * Fund ledger querying and calculations
 * Provides immutable audit trail and fund balance tracking
 */

import { db } from '@/lib/firebase';
import {
  collection, getDocs, query, where, orderBy, doc, getDoc,
  writeBatch, serverTimestamp
} from 'firebase/firestore';

/**
 * Get all transactions for a specific fund
 */
export async function getFundLedger(orgId, fundName, options = {}) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  const {
    startDate = null,
    endDate = null,
    limit = 1000,
  } = options;
  
  let q = query(
    collection(db, 'organizations', orgId, 'fundLedgers'),
    where('fundName', '==', fundName),
    orderBy('createdAt', 'desc')
  );
  
  const snapshot = await getDocs(q);
  let entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  
  // Client-side filtering if dates specified
  if (startDate || endDate) {
    entries = entries.filter(e => {
      const entryDate = e.createdAt?.seconds 
        ? new Date(e.createdAt.seconds * 1000)
        : new Date(e.createdAt);
      
      if (startDate && entryDate < new Date(startDate)) return false;
      if (endDate && entryDate > new Date(endDate)) return false;
      
      return true;
    });
  }
  
  return entries.slice(0, limit);
}

/**
 * Get current balance for a fund
 */
export async function getCurrentFundBalance(orgId, fundName) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  const ledger = await getFundLedger(orgId, fundName, { limit: 1 });
  
  if (ledger.length === 0) {
    return 0;
  }
  
  return ledger[0].balance || 0;
}

/**
 * Get fund summary (opening, closing, totals)
 */
export async function getFundSummary(orgId, fundName, startDate = null, endDate = null) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  const ledger = await getFundLedger(orgId, fundName, { startDate, endDate });
  
  if (ledger.length === 0) {
    return {
      fundName,
      opening: 0,
      closing: 0,
      totalDebits: 0,
      totalCredits: 0,
      netChange: 0,
      transactionCount: 0,
    };
  }
  
  const sorted = [...ledger].sort((a, b) => {
    const aDate = a.createdAt?.seconds || 0;
    const bDate = b.createdAt?.seconds || 0;
    return aDate - bDate;
  });
  
  const closing = sorted[sorted.length - 1]?.balance || 0;
  const opening = closing - (sorted[0]?.balance || 0);
  
  const totalDebits = ledger.reduce((sum, e) => sum + (e.debit || 0), 0);
  const totalCredits = ledger.reduce((sum, e) => sum + (e.credit || 0), 0);
  
  return {
    fundName,
    opening,
    closing,
    totalDebits,
    totalCredits,
    netChange: totalDebits - totalCredits,
    transactionCount: ledger.length,
  };
}

/**
 * Get transactions by type within a fund
 */
export async function getFundTransactionsByType(orgId, fundName, transactionType = null) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  let q;
  if (transactionType) {
    q = query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('fundName', '==', fundName),
      where('type', '==', transactionType),
      orderBy('createdAt', 'desc')
    );
  } else {
    q = query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('fundName', '==', fundName),
      orderBy('createdAt', 'desc')
    );
  }
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get all available funds for organization
 */
export async function getOrgFunds(orgId) {
  if (!orgId) throw new Error('orgId required');
  
  const snapshot = await getDocs(collection(db, 'organizations', orgId, 'fundLedgers'));
  
  const fundSet = new Set();
  snapshot.docs.forEach(d => {
    const fundName = d.data().fundName;
    if (fundName) fundSet.add(fundName);
  });
  
  return Array.from(fundSet).sort();
}

/**
 * Get fund performance across all funds
 */
export async function getOrgFundPerformance(orgId, startDate = null, endDate = null) {
  if (!orgId) throw new Error('orgId required');
  
  const funds = await getOrgFunds(orgId);
  
  const performance = {};
  
  for (const fund of funds) {
    performance[fund] = await getFundSummary(orgId, fund, startDate, endDate);
  }
  
  return performance;
}

/**
 * Export fund ledger to array format (for CSV/Excel)
 */
export async function exportFundLedger(orgId, fundName) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  const ledger = await getFundLedger(orgId, fundName, { limit: 10000 });
  
  return ledger.map(entry => ({
    Date: entry.createdAt?.seconds
      ? new Date(entry.createdAt.seconds * 1000).toLocaleDateString('en-GB')
      : '—',
    Type: entry.type || '—',
    Description: entry.description || '—',
    'Related User': entry.relatedUserId || '—',
    'Related Project': entry.relatedProjectId || '—',
    Debit: entry.debit || 0,
    Credit: entry.credit || 0,
    Balance: entry.balance || 0,
    'Recorded By': entry.recordedBy || 'system',
    'Is Reversal': entry.operation === 'reversal' ? 'Yes' : 'No',
    'Reversal Reason': entry.reversalReason || '—',
  }));
}

/**
 * Get member's contribution total (entries counted as contribution)
 */
export async function getMemberContributionTotal(orgId, memberId) {
  if (!orgId || !memberId) throw new Error('orgId and memberId required');
  
  const { getDocs, query, where } = await import('firebase/firestore');
  
  const snapshot = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'investments'),
      where('userId', '==', memberId),
      where('status', '==', 'verified'),
      where('isContribution', '!=', false)
    )
  );
  
  let total = 0;
  snapshot.docs.forEach(d => {
    const inv = d.data();
    const amount = inv.baseAmount || inv.amount || 0;
    const gatewayFee = inv.gatewayFee || 0;
    total += (amount - gatewayFee);
  });
  
  return total;
}

/**
 * Get fund allocation vs actual usage
 */
export async function getFundAllocationAnalysis(orgId, settings) {
  if (!orgId || !settings) throw new Error('orgId and settings required');
  
  const totalCapital = await getMemberContributionTotal(orgId, '%all%')
    .catch(() => 0); // Simplified - would need separate logic
  
  // Get each fund's budget allocation and current balance
  const analysis = {};
  
  const fundBudgets = settings?.fundBudgets || {};
  
  for (const [fundKey, budget] of Object.entries(fundBudgets)) {
    const fundName = fundKey; // Maps directly: investment_fund -> investment_fund
    
    let allocated = 0;
    if (budget.type === 'amount') {
      allocated = Number(budget.value) || 0;
    } else if (budget.type === 'pct') {
      allocated = Math.round(totalCapital * (Number(budget.value) / 100));
      if (budget.maxAmount) {
        allocated = Math.min(allocated, Number(budget.maxAmount));
      }
    }
    
    const current = await getCurrentFundBalance(orgId, fundName).catch(() => 0);
    
    analysis[fundName] = {
      allocated,
      current,
      used: allocated - current,
      usedPercent: allocated > 0 ? Math.round((allocated - current) / allocated * 100) : 0,
      available: Math.max(0, current),
    };
  }
  
  return analysis;
}

/**
 * Check if fund has sufficient balance for expense
 */
export async function checkFundBalance(orgId, fundName, requiredAmount) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  if (!requiredAmount || requiredAmount <= 0) throw new Error('requiredAmount must be positive');
  
  const balance = await getCurrentFundBalance(orgId, fundName);
  
  return {
    fundName,
    balance,
    requiredAmount,
    sufficient: balance >= requiredAmount,
    shortfall: Math.max(0, requiredAmount - balance),
  };
}

/**
 * Get transactions related to a member
 */
export async function getMemberFundTransactions(orgId, memberId) {
  if (!orgId || !memberId) throw new Error('orgId and memberId required');
  
  const snapshot = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('relatedUserId', '==', memberId),
      orderBy('createdAt', 'desc')
    )
  );
  
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get transactions related to a project
 */
export async function getProjectFundTransactions(orgId, projectId) {
  if (!orgId || !projectId) throw new Error('orgId and projectId required');
  
  const snapshot = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('relatedProjectId', '==', projectId),
      orderBy('createdAt', 'desc')
    )
  );
  
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Generate monthly fund report
 */
export async function generateMonthlyFundReport(orgId, year, month) {
  if (!orgId || !year || !month) throw new Error('orgId, year, month required');
  
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const startDate = new Date(`${monthStr}-01`);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);
  
  const funds = await getOrgFunds(orgId);
  
  const report = {
    period: monthStr,
    funds: {},
  };
  
  for (const fund of funds) {
    report.funds[fund] = await getFundSummary(orgId, fund, startDate, endDate);
  }
  
  return report;
}

/**
 * Audit trail for specific transaction
 */
export async function getTransactionAuditTrail(orgId, transactionId) {
  if (!orgId || !transactionId) throw new Error('orgId and transactionId required');
  
  const snapshot = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('transactionId', '==', transactionId)
    )
  );
  
  // Include reversal if this is reversing something
  const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  
  // Also get any reversals of this transaction
  const reverseSnapshot = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('reverseOfId', '==', transactionId)
    )
  );
  
  reverseSnapshot.docs.forEach(d => {
    entries.push({ id: d.id, ...d.data() });
  });
  
  return entries.sort((a, b) => {
    const aTime = a.createdAt?.seconds || 0;
    const bTime = b.createdAt?.seconds || 0;
    return aTime - bTime;
  });
}