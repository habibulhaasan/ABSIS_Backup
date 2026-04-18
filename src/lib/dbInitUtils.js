// src/lib/dbInitUtils.js
/**
 * Database initialization and migration utilities
 * Handles schema version updates without data loss
 */

import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Ensure organization has all required settings
 * Safe to call multiple times - checks version before updating
 */
export async function initializeOrgSettings(orgId) {
  if (!orgId) throw new Error('orgId required');
  
  const orgRef = doc(db, 'organizations', orgId);
  const orgSnap = await getDoc(orgRef);
  
  if (!orgSnap.exists()) {
    throw new Error('Organization not found');
  }
  
  const orgData = orgSnap.data();
  const settingsVersion = orgData.settings?.metadata?.version || 0;
  
  // Current schema version
  const CURRENT_VERSION = 2;
  
  if (settingsVersion >= CURRENT_VERSION) {
    return { upgraded: false, version: settingsVersion };
  }
  
  const updates = { settings: { ...orgData.settings } };
  
  // Version 1→2: Add late payment and re-registration settings
  if (settingsVersion < 2) {
    updates.settings.latePaymentSettings = updates.settings.latePaymentSettings || {
      enabled: true,
      consecutiveMonthsThreshold: 3,
      unpaidMonthsThreshold: 4,
      autoAssignReRegistration: true,
    };
    
    updates.settings.reRegistrationFeeAmount = 
      updates.settings.reRegistrationFeeAmount || 5000;
    
    updates.settings.allowRebate = 
      updates.settings.allowRebate !== undefined ? updates.settings.allowRebate : true;
    
    // Ensure gateway fee setting exists
    if (updates.settings.gatewayFeeInAccounting === undefined) {
      updates.settings.gatewayFeeInAccounting = false; // default: separate column
    }
  }
  
  // Ensure metadata exists
  if (!updates.settings.metadata) {
    updates.settings.metadata = {};
  }
  
  updates.settings.metadata.version = CURRENT_VERSION;
  updates.settings.metadata.lastUpdated = serverTimestamp();
  
  await updateDoc(orgRef, updates);
  
  return { upgraded: true, version: CURRENT_VERSION };
}

/**
 * Initialize a member with late payment tracking fields
 * Safe to call on existing members - only adds missing fields
 */
export async function initializeMemberTracking(orgId, memberId) {
  if (!orgId || !memberId) throw new Error('orgId and memberId required');
  
  const memberRef = doc(db, 'organizations', orgId, 'members', memberId);
  const memberSnap = await getDoc(memberRef);
  
  if (!memberSnap.exists()) {
    throw new Error('Member not found');
  }
  
  const memberData = memberSnap.data();
  const schemaVersion = memberData.metadata?.version || 0;
  
  const CURRENT_VERSION = 2;
  
  if (schemaVersion >= CURRENT_VERSION) {
    return { initialized: false, version: schemaVersion };
  }
  
  const updates = {};
  
  // Version 1→2: Add late payment and re-registration fields
  if (schemaVersion < 2) {
    if (!memberData.latePaymentDetails) {
      updates.latePaymentDetails = {
        isLatePayer: false,
        currentDelayedMonths: 0,
        totalDelayedMonths: 0,
        consecutiveUnpaidMonths: 0,
        lastLatePaymentDate: null,
      };
    }
    
    if (!memberData.reRegistrationStatus) {
      updates.reRegistrationStatus = {
        requiresReRegistration: false,
        autoAssignedAt: null,
        grantedRebateAmount: 0,
        rebateGrantedAt: null,
        rebateGrantedBy: null,
        paymentNotes: '',
      };
    }
    
    if (!memberData.metadata) {
      updates.metadata = {
        createdAt: memberData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        version: CURRENT_VERSION,
      };
    } else {
      updates.metadata = {
        ...memberData.metadata,
        updatedAt: serverTimestamp(),
        version: CURRENT_VERSION,
      };
    }
  }
  
  if (Object.keys(updates).length > 0) {
    await updateDoc(memberRef, updates);
    return { initialized: true, version: CURRENT_VERSION };
  }
  
  return { initialized: false, version: schemaVersion };
}

/**
 * Update an investment record with new fund tracking fields
 */
export async function upgradeInvestmentRecord(orgId, investmentId) {
  if (!orgId || !investmentId) throw new Error('orgId and investmentId required');
  
  const invRef = doc(db, 'organizations', orgId, 'investments', investmentId);
  const invSnap = await getDoc(invRef);
  
  if (!invSnap.exists()) {
    throw new Error('Investment not found');
  }
  
  const invData = invSnap.data();
  const version = invData.metadata?.version || 0;
  
  const CURRENT_VERSION = 2;
  
  if (version >= CURRENT_VERSION) {
    return { upgraded: false };
  }
  
  const updates = {};
  
  if (version < 2) {
    // Add late payment tracking if missing
    if (!invData.latePaymentInfo) {
      updates.latePaymentInfo = {
        isLate: false,
        daysDelayed: 0,
        originalDueDate: null,
        actualPaymentDate: null,
        paidMonths: invData.paidMonths || [],
      };
    }
    
    // Ensure base amount is set
    if (!invData.baseAmount && invData.amount) {
      updates.baseAmount = invData.amount;
    }
    
    // Ensure transaction fee tracking
    if (invData.gatewayFee && !('transactionFeeIncludedInAmount' in invData)) {
      updates.transactionFeeIncludedInAmount = false;
    }
    
    // Ensure fund destination
    if (!invData.fundDestination) {
      updates.fundDestination = invData.paymentType === 'entry_fee' 
        ? 'expenses_fund' 
        : 'member_contribution';
    }
    
    // Reverse accounting fields
    if (!('isReversed' in invData)) {
      updates.isReversed = false;
    }
    
    // Metadata
    updates.metadata = {
      createdAt: invData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: CURRENT_VERSION,
    };
  }
  
  if (Object.keys(updates).length > 0) {
    await updateDoc(invRef, updates);
    return { upgraded: true, version: CURRENT_VERSION };
  }
  
  return { upgraded: false, version };
}

/**
 * Update an entry fee record with new tracking fields
 */
export async function upgradeEntryFeeRecord(orgId, feeId) {
  if (!orgId || !feeId) throw new Error('orgId and feeId required');
  
  const feeRef = doc(db, 'organizations', orgId, 'entryFees', feeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Entry fee not found');
  }
  
  const feeData = feeSnap.data();
  const version = feeData.metadata?.version || 0;
  
  const CURRENT_VERSION = 2;
  
  if (version >= CURRENT_VERSION) {
    return { upgraded: false };
  }
  
  const updates = {};
  
  if (version < 2) {
    // Add fund destination
    if (!feeData.fundDestination) {
      updates.fundDestination = 'expenses_fund';
    }
    
    // Add reverse accounting fields
    if (!('isReversed' in feeData)) {
      updates.isReversed = false;
    }
    
    // Metadata
    updates.metadata = {
      createdAt: feeData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: CURRENT_VERSION,
    };
  }
  
  if (Object.keys(updates).length > 0) {
    await updateDoc(feeRef, updates);
    return { upgraded: true, version: CURRENT_VERSION };
  }
  
  return { upgraded: false, version };
}

/**
 * Update an expense record with fund source tracking
 */
export async function upgradeExpenseRecord(orgId, expenseId) {
  if (!orgId || !expenseId) throw new Error('orgId and expenseId required');
  
  const expRef = doc(db, 'organizations', orgId, 'expenses', expenseId);
  const expSnap = await getDoc(expRef);
  
  if (!expSnap.exists()) {
    throw new Error('Expense not found');
  }
  
  const expData = expSnap.data();
  const version = expData.metadata?.version || 0;
  
  const CURRENT_VERSION = 2;
  
  if (version >= CURRENT_VERSION) {
    return { upgraded: false };
  }
  
  const updates = {};
  
  if (version < 2) {
    // Add fund source
    if (!expData.fundSource) {
      updates.fundSource = 'expenses_fund';
    }
    
    // Add reverse accounting fields
    if (!('isReversed' in expData)) {
      updates.isReversed = false;
    }
    
    // Metadata
    updates.metadata = {
      createdAt: expData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: CURRENT_VERSION,
    };
  }
  
  if (Object.keys(updates).length > 0) {
    await updateDoc(expRef, updates);
    return { upgraded: true, version: CURRENT_VERSION };
  }
  
  return { upgraded: false, version };
}

/**
 * Create a new re-registration fee record
 */
export async function createReRegistrationFee(orgId, data) {
  if (!orgId) throw new Error('orgId required');
  if (!data.userId || !data.amount) throw new Error('userId and amount required');
  
  const newFee = {
    userId: data.userId,
    amount: Number(data.amount),
    reason: data.reason || 'Late payment - auto-assigned',
    autoAssigned: data.autoAssigned !== false,
    assignedAt: serverTimestamp(),
    assignedBy: data.assignedBy || 'system',
    
    // Payment tracking
    status: data.status || 'pending',
    paidAt: data.paidAt || null,
    paidAmount: data.paidAmount || 0,
    method: data.method || '',
    
    // Rebate
    rebateAmount: data.rebateAmount || 0,
    rebateGrantedAt: null,
    rebateGrantedBy: null,
    rebateReason: '',
    
    // Fund classification
    fundDestination: 'expenses_fund',
    
    // Reverse accounting
    parentTransactionId: data.parentTransactionId || null,
    isReversed: false,
    reversedAt: null,
    reversalReason: '',
    
    // Metadata
    metadata: {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 2,
    },
  };
  
  const feeRef = doc(db, 'organizations', orgId, 'reRegistrationFees', '__doc_id__');
  await setDoc(feeRef, newFee);
  
  return { id: feeRef.id, ...newFee };
}

/**
 * Create a fund ledger entry (immutable audit trail)
 */
export async function createFundLedgerEntry(orgId, data) {
  if (!orgId) throw new Error('orgId required');
  if (!data.fundName || !data.transactionId) {
    throw new Error('fundName and transactionId required');
  }
  
  const entry = {
    type: data.type || 'investment',
    fundName: data.fundName,
    transactionId: data.transactionId,
    
    amount: Number(data.amount) || 0,
    operation: data.operation || 'add', // 'add' | 'deduct' | 'reversal'
    
    // Debit/Credit
    debit: data.operation === 'add' ? Number(data.amount) || 0 : 0,
    credit: data.operation === 'deduct' || data.operation === 'reversal' 
      ? Math.abs(Number(data.amount) || 0) 
      : 0,
    
    description: data.description || '',
    relatedUserId: data.relatedUserId || null,
    relatedProjectId: data.relatedProjectId || null,
    
    balance: Number(data.balance) || 0,
    
    recordedBy: data.recordedBy || 'system',
    createdAt: serverTimestamp(),
    
    // For reversals
    reverseOfId: data.reverseOfId || null,
    reversalReason: data.reversalReason || '',
  };
  
  const ledgerRef = doc(db, 'organizations', orgId, 'fundLedgers', '__doc_id__');
  await setDoc(ledgerRef, entry);
  
  return { id: ledgerRef.id, ...entry };
}

/**
 * Get current fund balance
 */
export async function getFundBalance(orgId, fundName) {
  if (!orgId || !fundName) throw new Error('orgId and fundName required');
  
  const { getDocs, collection, query, where, orderBy } = await import('firebase/firestore');
  
  const ledgerSnap = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'fundLedgers'),
      where('fundName', '==', fundName),
      orderBy('createdAt', 'desc')
    )
  );
  
  if (ledgerSnap.empty) {
    return 0;
  }
  
  // Get the most recent balance (last entry has the running balance)
  const lastEntry = ledgerSnap.docs[0].data();
  return lastEntry.balance || 0;
}

/**
 * Validate schema across organization
 * Returns report of records needing migration
 */
export async function validateOrgSchema(orgId) {
  if (!orgId) throw new Error('orgId required');
  
  const { getDocs, collection } = await import('firebase/firestore');
  
  const report = {
    members: { total: 0, needsUpgrade: 0 },
    investments: { total: 0, needsUpgrade: 0 },
    entryFees: { total: 0, needsUpgrade: 0 },
    expenses: { total: 0, needsUpgrade: 0 },
    orgSettings: { total: 1, needsUpgrade: 0 },
  };
  
  try {
    // Check members
    const memberSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
    report.members.total = memberSnap.size;
    memberSnap.docs.forEach(d => {
      const version = d.data().metadata?.version || 0;
      if (version < 2) report.members.needsUpgrade++;
    });
    
    // Check investments
    const invSnap = await getDocs(collection(db, 'organizations', orgId, 'investments'));
    report.investments.total = invSnap.size;
    invSnap.docs.forEach(d => {
      const version = d.data().metadata?.version || 0;
      if (version < 2) report.investments.needsUpgrade++;
    });
    
    // Check entry fees
    const feeSnap = await getDocs(collection(db, 'organizations', orgId, 'entryFees'));
    report.entryFees.total = feeSnap.size;
    feeSnap.docs.forEach(d => {
      const version = d.data().metadata?.version || 0;
      if (version < 2) report.entryFees.needsUpgrade++;
    });
    
    // Check expenses
    const expSnap = await getDocs(collection(db, 'organizations', orgId, 'expenses'));
    report.expenses.total = expSnap.size;
    expSnap.docs.forEach(d => {
      const version = d.data().metadata?.version || 0;
      if (version < 2) report.expenses.needsUpgrade++;
    });
    
    // Check org settings
    const orgSnap = await getDoc(doc(db, 'organizations', orgId));
    if (orgSnap.exists()) {
      const version = orgSnap.data().settings?.metadata?.version || 0;
      if (version < 2) report.orgSettings.needsUpgrade = 1;
    }
  } catch (error) {
    report.error = error.message;
  }
  
  return report;
}