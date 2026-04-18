// src/lib/reverseAccountingUtils.js
/**
 * Reverse accounting utilities
 * Handles reversals of transactions while maintaining audit trail
 */

import { db } from '@/lib/firebase';
import {
  doc, getDoc, updateDoc, collection, serverTimestamp, addDoc
} from 'firebase/firestore';

/**
 * Reverse an entry fee payment
 * Creates reversal ledger entries and marks original as reversed
 */
export async function reverseEntryFee(orgId, entryFeeId, reason = 'Manual reversal', adminUid = 'system') {
  if (!orgId || !entryFeeId) throw new Error('orgId and entryFeeId required');
  
  const feeRef = doc(db, 'organizations', orgId, 'entryFees', entryFeeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Entry fee not found');
  }
  
  const feeData = feeSnap.data();
  
  if (feeData.isReversed) {
    return { reversed: false, reason: 'Already reversed' };
  }
  
  // Mark original as reversed
  await updateDoc(feeRef, {
    isReversed: true,
    reversedAt: serverTimestamp(),
    reversalReason: reason,
  });
  
  // Create fund ledger reversal entry
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  try {
    await createFundLedgerEntry(orgId, {
      type: 'entry_fee',
      fundName: 'expenses_fund',
      transactionId: `reversal_ef_${entryFeeId}`,
      amount: feeData.amount,
      operation: 'reversal',
      description: `Reversal of entry fee (৳${feeData.amount})`,
      relatedUserId: feeData.userId,
      recordedBy: adminUid,
      reverseOfId: entryFeeId,
      reversalReason: reason,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  // If this was the last entry fee for this member, clear the flag
  const { getDocs, query, where } = await import('firebase/firestore');
  
  const otherFees = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'entryFees'),
      where('userId', '==', feeData.userId),
      where('isReversed', '==', false)
    )
  );
  
  if (otherFees.empty) {
    const memberRef = doc(db, 'organizations', orgId, 'members', feeData.userId);
    await updateDoc(memberRef, {
      entryFeePaid: false,
    });
  }
  
  return { reversed: true, feeId: entryFeeId };
}

/**
 * Reverse a re-registration fee
 */
export async function reverseReRegistrationFee(orgId, reRegFeeId, reason = 'Manual reversal', adminUid = 'system') {
  if (!orgId || !reRegFeeId) throw new Error('orgId and reRegFeeId required');
  
  const feeRef = doc(db, 'organizations', orgId, 'reRegistrationFees', reRegFeeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Re-registration fee not found');
  }
  
  const feeData = feeSnap.data();
  
  if (feeData.isReversed) {
    return { reversed: false, reason: 'Already reversed' };
  }
  
  // Mark original as reversed
  await updateDoc(feeRef, {
    isReversed: true,
    reversedAt: serverTimestamp(),
    reversalReason: reason,
  });
  
  // Create fund ledger reversal entry
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  try {
    await createFundLedgerEntry(orgId, {
      type: 'reregistration_fee',
      fundName: 'expenses_fund',
      transactionId: `reversal_rereg_${reRegFeeId}`,
      amount: feeData.amount,
      operation: 'reversal',
      description: `Reversal of re-registration fee (৳${feeData.amount})`,
      relatedUserId: feeData.userId,
      recordedBy: adminUid,
      reverseOfId: reRegFeeId,
      reversalReason: reason,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  // Update member's re-registration status
  const memberRef = doc(db, 'organizations', orgId, 'members', feeData.userId);
  await updateDoc(memberRef, {
    'reRegistrationStatus.requiresReRegistration': false,
  });
  
  return { reversed: true, feeId: reRegFeeId };
}

/**
 * Reverse an investment payment
 */
export async function reverseInvestment(orgId, investmentId, reason = 'Manual reversal', adminUid = 'system') {
  if (!orgId || !investmentId) throw new Error('orgId and investmentId required');
  
  const invRef = doc(db, 'organizations', orgId, 'investments', investmentId);
  const invSnap = await getDoc(invRef);
  
  if (!invSnap.exists()) {
    throw new Error('Investment not found');
  }
  
  const invData = invSnap.data();
  
  if (invData.isReversed) {
    return { reversed: false, reason: 'Already reversed' };
  }
  
  // Mark original as reversed
  await updateDoc(invRef, {
    isReversed: true,
    reversedAt: serverTimestamp(),
    reversalReason: reason,
  });
  
  // Create fund ledger reversal entry
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  const fundName = invData.fundDestination || 'member_contribution';
  
  try {
    await createFundLedgerEntry(orgId, {
      type: 'investment',
      fundName,
      transactionId: `reversal_inv_${investmentId}`,
      amount: invData.amount,
      operation: 'reversal',
      description: `Reversal of investment (৳${invData.amount})`,
      relatedUserId: invData.userId,
      recordedBy: adminUid,
      reverseOfId: investmentId,
      reversalReason: reason,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  return { reversed: true, investmentId };
}

/**
 * Reverse an expense entry
 */
export async function reverseExpense(orgId, expenseId, reason = 'Manual reversal', adminUid = 'system') {
  if (!orgId || !expenseId) throw new Error('orgId and expenseId required');
  
  const expRef = doc(db, 'organizations', orgId, 'expenses', expenseId);
  const expSnap = await getDoc(expRef);
  
  if (!expSnap.exists()) {
    throw new Error('Expense not found');
  }
  
  const expData = expSnap.data();
  
  if (expData.isReversed) {
    return { reversed: false, reason: 'Already reversed' };
  }
  
  // Mark original as reversed
  await updateDoc(expRef, {
    isReversed: true,
    reversedAt: serverTimestamp(),
    reversalReason: reason,
  });
  
  // Create fund ledger reversal entry
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  const fundName = expData.fundSource || 'expenses_fund';
  
  try {
    await createFundLedgerEntry(orgId, {
      type: 'expense',
      fundName,
      transactionId: `reversal_exp_${expenseId}`,
      amount: expData.amount,
      operation: 'reversal',
      description: `Reversal of expense: ${expData.description || expData.category}`,
      relatedProjectId: expData.relatedProjectId || null,
      recordedBy: adminUid,
      reverseOfId: expenseId,
      reversalReason: reason,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  return { reversed: true, expenseId };
}

/**
 * Edit entry fee amount (creates reversal + new entry)
 */
export async function editEntryFeeAmount(orgId, entryFeeId, newAmount, adminUid = 'system') {
  if (!orgId || !entryFeeId) throw new Error('orgId and entryFeeId required');
  if (!newAmount || newAmount <= 0) throw new Error('newAmount must be positive');
  
  const feeRef = doc(db, 'organizations', orgId, 'entryFees', entryFeeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Entry fee not found');
  }
  
  const feeData = feeSnap.data();
  const oldAmount = feeData.amount;
  const newAmountNum = Number(newAmount);
  
  if (oldAmount === newAmountNum) {
    return { updated: false, reason: 'Amount unchanged' };
  }
  
  // Create reversal for old amount
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  try {
    // Reversal of old amount
    await createFundLedgerEntry(orgId, {
      type: 'entry_fee',
      fundName: 'expenses_fund',
      transactionId: `adj_rev_ef_${entryFeeId}`,
      amount: oldAmount,
      operation: 'reversal',
      description: `Adjustment reversal of entry fee (৳${oldAmount})`,
      relatedUserId: feeData.userId,
      recordedBy: adminUid,
      reverseOfId: entryFeeId,
      reversalReason: 'Amount adjustment',
    });
    
    // New entry for new amount
    await createFundLedgerEntry(orgId, {
      type: 'entry_fee',
      fundName: 'expenses_fund',
      transactionId: `adj_new_ef_${entryFeeId}`,
      amount: newAmountNum,
      operation: 'add',
      description: `Adjusted entry fee amount (৳${newAmountNum})`,
      relatedUserId: feeData.userId,
      recordedBy: adminUid,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entries:', err);
  }
  
  // Update the fee record
  await updateDoc(feeRef, {
    amount: newAmountNum,
  });
  
  return {
    updated: true,
    feeId: entryFeeId,
    oldAmount,
    newAmount: newAmountNum,
    difference: newAmountNum - oldAmount,
  };
}

/**
 * Grant rebate on re-registration fee
 */
export async function grantRebate(orgId, reRegFeeId, rebateAmount, rebateReason = '', adminUid = 'system') {
  if (!orgId || !reRegFeeId) throw new Error('orgId and reRegFeeId required');
  if (!rebateAmount || rebateAmount <= 0) throw new Error('rebateAmount must be positive');
  
  const feeRef = doc(db, 'organizations', orgId, 'reRegistrationFees', reRegFeeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Re-registration fee not found');
  }
  
  const feeData = feeSnap.data();
  const rebateNum = Number(rebateAmount);
  
  if (rebateNum >= feeData.amount) {
    throw new Error('Rebate cannot be equal to or greater than fee amount');
  }
  
  // Create fund ledger adjustment entry
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  try {
    await createFundLedgerEntry(orgId, {
      type: 'reregistration_fee',
      fundName: 'expenses_fund',
      transactionId: `rebate_${reRegFeeId}`,
      amount: rebateNum,
      operation: 'reversal',
      description: `Rebate granted on re-registration fee (৳${rebateNum}): ${rebateReason}`,
      relatedUserId: feeData.userId,
      recordedBy: adminUid,
      reversalReason: `Rebate: ${rebateReason}`,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  // Update the fee record
  await updateDoc(feeRef, {
    rebateAmount: rebateNum,
    rebateGrantedAt: serverTimestamp(),
    rebateGrantedBy: adminUid,
    rebateReason,
  });
  
  return {
    granted: true,
    feeId: reRegFeeId,
    rebateAmount: rebateNum,
    finalAmount: feeData.amount - rebateNum,
  };
}

/**
 * Process re-registration fee payment with member contribution recording
 */
export async function markReRegistrationFeePaid(orgId, reRegFeeId, paidAmount, method = 'Cash', adminUid = 'system') {
  if (!orgId || !reRegFeeId) throw new Error('orgId and reRegFeeId required');
  if (!paidAmount || paidAmount <= 0) throw new Error('paidAmount must be positive');
  
  const feeRef = doc(db, 'organizations', orgId, 'reRegistrationFees', reRegFeeId);
  const feeSnap = await getDoc(feeRef);
  
  if (!feeSnap.exists()) {
    throw new Error('Re-registration fee not found');
  }
  
  const feeData = feeSnap.data();
  
  if (feeData.status === 'paid') {
    return { marked: false, reason: 'Already paid' };
  }
  
  const paidNum = Number(paidAmount);
  
  // Update fee record
  await updateDoc(feeRef, {
    status: 'paid',
    paidAt: serverTimestamp(),
    paidAmount: paidNum,
    method,
  });
  
  // Create investment record for tracking (with special marking)
  const { addDoc, collection } = await import('firebase/firestore');
  
  try {
    await addDoc(collection(db, 'organizations', orgId, 'investments'), {
      userId: feeData.userId,
      amount: paidNum,
      baseAmount: paidNum,
      status: 'verified',
      verifiedAt: serverTimestamp(),
      verifiedBy: adminUid,
      method,
      paymentType: 'reregistration_fee',
      isContribution: false,
      countAsContribution: false,
      fundDestination: 'expenses_fund',
      notes: `Re-registration fee payment. Original fee: ৳${feeData.amount}. Rebate: ৳${feeData.rebateAmount}`,
      createdAt: serverTimestamp(),
      metadata: {
        version: 2,
      },
    });
  } catch (err) {
    console.error('Failed to create payment record:', err);
  }
  
  return {
    marked: true,
    feeId: reRegFeeId,
    paidAmount: paidNum,
    originalFee: feeData.amount,
    rebateGiven: feeData.rebateAmount,
  };
}