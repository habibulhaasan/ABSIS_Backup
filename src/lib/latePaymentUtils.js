// src/lib/latePaymentUtils.js
/**
 * Late payment tracking and re-registration fee logic
 */

import { db } from '@/lib/firebase';
import {
  collection, getDocs, query, where, updateDoc, doc, 
  serverTimestamp, addDoc, getDoc
} from 'firebase/firestore';

/**
 * Calculate days delayed for an investment payment
 * Returns: { isLate: bool, daysDelayed: number, originalDueDate: Date }
 */
export function calculateDaysDelayed(investment, settings) {
  if (!investment || investment.status === 'verified') {
    return { isLate: false, daysDelayed: 0, originalDueDate: null };
  }
  
  // Determine due date: from settings or 30 days after creation
  const settingsDueDay = settings?.dueDate || 30;
  const createdAt = investment.createdAt?.seconds 
    ? new Date(investment.createdAt.seconds * 1000) 
    : new Date(investment.createdAt);
  
  const dueDate = new Date(createdAt);
  dueDate.setDate(dueDate.getDate() + settingsDueDay);
  
  const now = new Date();
  const daysDelayed = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
  
  return {
    isLate: daysDelayed > 0,
    daysDelayed: Math.max(0, daysDelayed),
    originalDueDate: dueDate,
  };
}

/**
 * Get all pending investments for a member
 */
export async function getMemberPendingInvestments(orgId, memberId) {
  const invSnap = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'investments'),
      where('userId', '==', memberId),
      where('status', '==', 'pending')
    )
  );
  
  return invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Calculate late payment details for a member
 * Returns info about consecutive late months
 */
export async function calculateMemberLatePaymentStatus(orgId, memberId, settings) {
  const investments = await getMemberPendingInvestments(orgId, memberId);
  
  // Get member's payment history
  const memberRef = doc(db, 'organizations', orgId, 'members', memberId);
  const memberSnap = await getDoc(memberRef);
  
  if (!memberSnap.exists()) {
    throw new Error('Member not found');
  }
  
  const memberData = memberSnap.data();
  const paidMonths = new Set();
  
  // Collect all paid months
  const verifiedInv = await getDocs(
    query(
      collection(db, 'organizations', orgId, 'investments'),
      where('userId', '==', memberId),
      where('status', '==', 'verified')
    )
  );
  
  verifiedInv.docs.forEach(d => {
    const inv = d.data();
    if (inv.paidMonths && Array.isArray(inv.paidMonths)) {
      inv.paidMonths.forEach(m => paidMonths.add(m));
    }
  });
  
  // Analyze pending investments to find late ones
  let currentDelayedMonths = 0;
  let lastLatePaymentDate = null;
  let consecutiveUnpaidMonths = 0;
  
  // Group pending by month
  const pendingByMonth = {};
  investments.forEach(inv => {
    if (inv.paidMonths && Array.isArray(inv.paidMonths)) {
      inv.paidMonths.forEach(month => {
        if (!pendingByMonth[month]) {
          pendingByMonth[month] = [];
        }
        pendingByMonth[month].push(inv);
      });
    }
  });
  
  // Check each month going back
  const months = Object.keys(pendingByMonth).sort().reverse();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  let lastLateMonth = null;
  let consecutiveFromRecent = 0;
  
  months.forEach(month => {
    const monthDate = new Date(month + '-01');
    const monthDueDate = new Date(monthDate);
    monthDueDate.setDate(monthDueDate.getDate() + (settings?.dueDate || 30));
    
    if (monthDueDate < now && !paidMonths.has(month)) {
      // This month is late and unpaid
      if (!lastLateMonth || isConsecutiveMonth(lastLateMonth, month)) {
        consecutiveFromRecent++;
        lastLateMonth = month;
        lastLatePaymentDate = monthDueDate;
      } else {
        // Gap in months, reset counter
        consecutiveFromRecent = 0;
        lastLateMonth = month;
        lastLatePaymentDate = monthDueDate;
      }
    }
  });
  
  currentDelayedMonths = consecutiveFromRecent;
  
  // Calculate total delayed months (all time)
  let totalDelayedMonths = 0;
  months.forEach(month => {
    const monthDate = new Date(month + '-01');
    const monthDueDate = new Date(monthDate);
    monthDueDate.setDate(monthDueDate.getDate() + (settings?.dueDate || 30));
    
    if (monthDueDate < now && !paidMonths.has(month)) {
      totalDelayedMonths++;
    }
  });
  
  return {
    isLatePayer: currentDelayedMonths > 0,
    currentDelayedMonths,
    totalDelayedMonths,
    consecutiveUnpaidMonths: currentDelayedMonths,
    lastLatePaymentDate,
  };
}

/**
 * Check if two months are consecutive (month1 is immediately after month2)
 */
function isConsecutiveMonth(month1, month2) {
  const [y1, m1] = month1.split('-').map(Number);
  const [y2, m2] = month2.split('-').map(Number);
  
  if (y1 === y2) {
    return m1 + 1 === m2;
  }
  
  // Different years
  return y1 === y2 + 1 && m1 === 1 && m2 === 12;
}

/**
 * Update member's late payment tracking
 */
export async function updateMemberLatePaymentStatus(orgId, memberId, settings) {
  const lateStatus = await calculateMemberLatePaymentStatus(orgId, memberId, settings);
  
  const memberRef = doc(db, 'organizations', orgId, 'members', memberId);
  
  await updateDoc(memberRef, {
    latePaymentDetails: {
      isLatePayer: lateStatus.isLatePayer,
      currentDelayedMonths: lateStatus.currentDelayedMonths,
      totalDelayedMonths: lateStatus.totalDelayedMonths,
      consecutiveUnpaidMonths: lateStatus.consecutiveUnpaidMonths,
      lastLatePaymentDate: lateStatus.lastLatePaymentDate,
    },
  });
  
  return lateStatus;
}

/**
 * Check if member should have re-registration fee assigned
 * Returns: { shouldAssign: bool, reason: string }
 */
export async function checkReRegistrationRequired(orgId, memberId, settings) {
  const lateSettings = settings?.latePaymentSettings;
  
  if (!lateSettings?.enabled) {
    return { shouldAssign: false, reason: 'Late payment tracking disabled' };
  }
  
  const lateStatus = await calculateMemberLatePaymentStatus(orgId, memberId, settings);
  
  const consecutiveThreshold = lateSettings.consecutiveMonthsThreshold || 3;
  const unpaidThreshold = lateSettings.unpaidMonthsThreshold || 4;
  
  // Check both conditions
  if (
    lateStatus.currentDelayedMonths >= consecutiveThreshold &&
    lateStatus.consecutiveUnpaidMonths >= unpaidThreshold
  ) {
    return {
      shouldAssign: true,
      reason: `Late for ${lateStatus.currentDelayedMonths} months, unpaid for ${lateStatus.consecutiveUnpaidMonths} months`,
    };
  }
  
  return { shouldAssign: false, reason: 'Thresholds not met' };
}

/**
 * Auto-assign re-registration fee if conditions met
 * Called during verification or periodically
 */
export async function autoAssignReRegistrationFee(orgId, memberId, adminUid, settings) {
  // Check if already assigned
  const memberRef = doc(db, 'organizations', orgId, 'members', memberId);
  const memberSnap = await getDoc(memberRef);
  
  if (!memberSnap.exists()) {
    throw new Error('Member not found');
  }
  
  const memberData = memberSnap.data();
  
  if (memberData.reRegistrationStatus?.requiresReRegistration) {
    return { assigned: false, reason: 'Already assigned' };
  }
  
  // Check conditions
  const checkResult = await checkReRegistrationRequired(orgId, memberId, settings);
  
  if (!checkResult.shouldAssign) {
    return { assigned: false, reason: checkResult.reason };
  }
  
  // Create re-registration fee record
  const { createFundLedgerEntry } = await import('@/lib/dbInitUtils');
  
  const feeAmount = settings?.reRegistrationFeeAmount || 5000;
  
  // Create fee record
  const feeRef = doc(collection(db, 'organizations', orgId, 'reRegistrationFees'));
  await setDoc(feeRef, {
    userId: memberId,
    amount: feeAmount,
    reason: `Late payment - ${checkResult.reason}`,
    autoAssigned: true,
    assignedAt: serverTimestamp(),
    assignedBy: adminUid,
    
    status: 'pending',
    paidAt: null,
    paidAmount: 0,
    method: '',
    
    rebateAmount: 0,
    rebateGrantedAt: null,
    rebateGrantedBy: null,
    rebateReason: '',
    
    fundDestination: 'expenses_fund',
    parentTransactionId: null,
    isReversed: false,
    reversedAt: null,
    reversalReason: '',
    
    metadata: {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 2,
    },
  });
  
  // Update member's re-registration status
  await updateDoc(memberRef, {
    'reRegistrationStatus.requiresReRegistration': true,
    'reRegistrationStatus.autoAssignedAt': serverTimestamp(),
  });
  
  // Create fund ledger entry
  try {
    await createFundLedgerEntry(orgId, {
      type: 'reregistration_fee',
      fundName: 'expenses_fund',
      transactionId: `rereg_${feeRef.id}`,
      amount: feeAmount,
      operation: 'add',
      description: `Re-registration fee auto-assigned to member ${memberId}`,
      relatedUserId: memberId,
      recordedBy: adminUid,
    });
  } catch (err) {
    console.error('Failed to create fund ledger entry:', err);
  }
  
  return {
    assigned: true,
    feeId: feeRef.id,
    amount: feeAmount,
  };
}

/**
 * Get all late payers in organization
 */
export async function getLatePayers(orgId, settings) {
  const memberSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
  
  const latePayers = [];
  
  for (const memberDoc of memberSnap.docs) {
    const member = { id: memberDoc.id, ...memberDoc.data() };
    
    if (member.approved) {
      const lateStatus = await calculateMemberLatePaymentStatus(orgId, member.id, settings);
      
      if (lateStatus.isLatePayer) {
        latePayers.push({
          ...member,
          lateStatus,
        });
      }
    }
  }
  
  return latePayers.sort((a, b) => 
    b.lateStatus.currentDelayedMonths - a.lateStatus.currentDelayedMonths
  );
}

/**
 * Get late payment summary for dashboard
 */
export async function getLatePagerSummary(orgId, settings) {
  const latePayers = await getLatePayers(orgId, settings);
  
  const summary = {
    totalLatePayers: latePayers.length,
    criticalCount: latePayers.filter(m => 
      m.lateStatus.currentDelayedMonths >= (settings?.latePaymentSettings?.unpaidMonthsThreshold || 4)
    ).length,
    warningCount: latePayers.filter(m => 
      m.lateStatus.currentDelayedMonths >= (settings?.latePaymentSettings?.consecutiveMonthsThreshold || 3)
      && m.lateStatus.currentDelayedMonths < (settings?.latePaymentSettings?.unpaidMonthsThreshold || 4)
    ).length,
    byDelayedMonths: {
      '1-2': latePayers.filter(m => m.lateStatus.currentDelayedMonths <= 2).length,
      '3-6': latePayers.filter(m => m.lateStatus.currentDelayedMonths >= 3 && m.lateStatus.currentDelayedMonths <= 6).length,
      '6+': latePayers.filter(m => m.lateStatus.currentDelayedMonths > 6).length,
    },
  };
  
  return summary;
}

// Missing import fix
import { setDoc } from 'firebase/firestore';