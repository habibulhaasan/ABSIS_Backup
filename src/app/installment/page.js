'use client';
import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, onSnapshot, serverTimestamp, query, where } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const DEFAULT_METHODS = ['bKash','Nagad','Rocket','Bank Transfer','Cash'];

function getMonths(startDate) {
  if (!startDate) return [];
  const months = [];
  const start  = new Date(startDate);
  const now    = new Date();
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= now) {
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

export default function Installment() {
  const { user, userData, orgData, membership, isSuperAdmin, impersonateMemberId } = useAuth();
  // When superadmin is impersonating, load that member's payment data
  const viewUid = (isSuperAdmin && impersonateMemberId) ? impersonateMemberId : user?.uid;
  const [paidMonths,      setPaidMonths]      = useState(new Set());
  const [paidSpecial,     setPaidSpecial]     = useState(new Set());
  const [specialSubs,     setSpecialSubs]     = useState([]);
  const [selected,        setSelected]        = useState([]);
  const [selectedSpecial, setSelectedSpecial] = useState(null);
  const [method,          setMethod]          = useState('');
  const [selectedAccount, setSelectedAccount] = useState(null); // { id, label, number }
  const [customSpecialAmount, setCustomSpecialAmount] = useState(''); // for allowCustomAmount subs
  const [txId,            setTxId]            = useState('');
  const [loading,         setLoading]         = useState(false);
  const [success,         setSuccess]         = useState(false);
  const [payMode,         setPayMode]         = useState('monthly');

  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};

  const monthlyEnabled  = settings.monthlyEnabled !== false;
  const enabledMethods  = settings.paymentMethods  || DEFAULT_METHODS;
  // New multi-account format; fall back to old accountDetails for legacy display
  const paymentAccounts = settings.paymentAccounts || {};
  const accountDetails  = settings.accountDetails  || {};

  const getGatewayFee = m => {
    const cfg = settings.gatewayFees?.[m];
    return (cfg?.enabled && cfg?.rate) ? Number(cfg.rate) / 100 : 0;
  };

  const baseAmount = (settings.uniformAmount === false && membership?.customAmount != null)
    ? membership.customAmount : (settings.baseAmount || 0);

  // Set initial method
  useEffect(() => {
    if (enabledMethods.length > 0 && !method) {
      setMethod(enabledMethods[0]);
    }
  }, [enabledMethods.join(',')]);

  // When method changes, auto-select first account if only one
  useEffect(() => {
    if (!method || method === 'Cash') { setSelectedAccount(null); return; }
    const accs = paymentAccounts[method] || [];
    if (accs.length === 1) setSelectedAccount(accs[0]);
    else setSelectedAccount(null);
  }, [method]);

  // Load paid months
  useEffect(() => {
    if (!user || !orgId) return;
    const q = query(collection(db,'organizations',orgId,'investments'), where('userId','==',viewUid));
    getDocs(q).then(snap => {
      const paid  = new Set();
      const pSpec = new Set();
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.status !== 'rejected') (data.paidMonths || []).forEach(m => paid.add(m));
        if (data.specialSubId && data.status !== 'rejected') pSpec.add(data.specialSubId);
      });
      setPaidMonths(paid);
      setPaidSpecial(pSpec);
    });
  }, [user, orgId]);

  // Load special subs
  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'specialSubscriptions'), snap => {
      const now = new Date();
      setSpecialSubs(
        snap.docs.map(d => ({ id:d.id, ...d.data() }))
          .filter(s => s.active && s.deadline && new Date(s.deadline) >= now)
          .sort((a,b) => a.deadline.localeCompare(b.deadline))
      );
    });
    return unsub;
  }, [orgId]);

  // Fix payMode if monthly is disabled
  useEffect(() => {
    if (!monthlyEnabled) setPayMode('special');
  }, [monthlyEnabled]);

  // Phase 7: determine effective start date for this member
  // requireBackpayment ON  → start from org startDate (pay everything)
  // requireBackpayment OFF → start from member's joiningDate (no back-dues)
  const requireBackpayment = !!settings.requireBackpayment;
  const joiningDateStr     = membership?.joiningDate || '';  // stored as 'YYYY-MM-DD'

  const effectiveStartDate = (() => {
    const orgStart    = settings.startDate || '';
    if (requireBackpayment || !joiningDateStr) return orgStart;
    // Use whichever is later: joiningDate or orgStart
    // (a member can't owe before the org even started)
    if (!orgStart) return joiningDateStr;
    return joiningDateStr > orgStart ? joiningDateStr : orgStart;
  })();

  // Months before the member's join date (only relevant when backpayment not required)
  const preJoinMonths = (!requireBackpayment && joiningDateStr && settings.startDate
    && joiningDateStr > settings.startDate)
    ? getMonths(settings.startDate).filter(m => m < effectiveStartDate.slice(0,7))
    : [];

  const allMonths    = getMonths(effectiveStartDate);
  const unpaidMonths = allMonths.filter(m => !paidMonths.has(m));
  const dueDay       = settings.dueDate || 10;
  const penalty      = settings.lateFeeEnabled ? (settings.penalty || 0) : 0;
  const isLate       = m => { const [y,mo] = m.split('-').map(Number); return new Date() > new Date(y,mo-1,dueDay); };
  const toggle       = m => setSelected(p => p.includes(m) ? p.filter(x => x !== m) : [...p,m]);

  const isSpecialMode = payMode === 'special' && selectedSpecial;
  // If special sub allows custom amount, use the user-entered value (fallback to sub's fixed amount)
  const specialBaseAmount = isSpecialMode
    ? (selectedSpecial.allowCustomAmount
        ? (Number(customSpecialAmount) || selectedSpecial.amount || 0)
        : (selectedSpecial.amount || 0))
    : 0;
  const totalBase     = isSpecialMode ? specialBaseAmount : selected.length * baseAmount;
  const totalPenalty  = isSpecialMode ? 0 : selected.filter(m => isLate(m)).length * penalty;
  const feeRate       = getGatewayFee(method);
  const fee           = Math.round((totalBase + totalPenalty) * feeRate);
  const grandTotal    = totalBase + totalPenalty + fee;

  // Only show accounts that are enabled (enabled === false means admin disabled it)
  const methodAccounts = method && method !== 'Cash'
    ? (paymentAccounts[method] || []).filter(a => a.enabled !== false)
    : [];
  const needsAccountPick = methodAccounts.length > 1 && !selectedAccount;

  const handleSubmit = async e => {
    e.preventDefault();
    if (payMode === 'monthly' && !selected.length) { alert('Please select at least one month.'); return; }
    if (payMode === 'special' && !selectedSpecial)  { alert('Please select a special subscription.'); return; }
    if (!method) { alert('Please select a payment method.'); return; }
    if (method !== 'Cash' && methodAccounts.length > 1 && !selectedAccount) {
      alert('Please select which account you sent the payment to.'); return;
    }
    if (method !== 'Cash' && !txId.trim()) { alert('Please enter the Transaction ID.'); return; }
    setLoading(true);
    try {
      const acc = selectedAccount || (methodAccounts.length === 1 ? methodAccounts[0] : null);
      const payload = {
        userId:    user.uid,
        amount:    grandTotal,
        method,
        txId:      txId.trim(),
        status:    'pending',
        createdAt: serverTimestamp(),
        // account info for cashier routing
        accountId:     acc?.id     || null,
        accountLabel:  acc?.label  || null,
        accountNumber: acc?.number || null,
      };
      if (payMode === 'monthly') {
        payload.paidMonths     = selected;
        payload.baseAmount     = totalBase;
        payload.penaltyPaid    = totalPenalty;
        payload.gatewayFee     = fee;
        payload.paymentType    = 'monthly';
        payload.isContribution = true;
      } else {
        const subType = selectedSpecial.type || 'general';
        // entry_fee and reregistration_fee always go to Expenses Fund — never capital
        const subIsContrib = subType === 'general'; // only 'general' subs count as contributions
        payload.specialSubId       = selectedSpecial.id;
        payload.specialSubTitle    = selectedSpecial.title;
        payload.specialSubType     = subType;
        payload.baseAmount         = selectedSpecial.amount;
        payload.gatewayFee         = fee;
        payload.paidMonths         = [];
        payload.paymentType        = subType;
        payload.isContribution     = subIsContrib;
        payload.countAsContribution = subIsContrib;
      }
      await addDoc(collection(db,'organizations',orgId,'investments'), payload);
      // If this is an entry fee special sub, also mark the member's entryFeePaid flag
      // so the entry-fees page shows them as paid
      if (payMode === 'special' && (selectedSpecial?.type === 'entry_fee' || selectedSpecial?.type === 'reregistration_fee')) {
        const { doc: d2, updateDoc: ud } = await import('firebase/firestore');
        try {
          await ud(d2(db,'organizations',orgId,'members',user.uid), { entryFeePaid: true });
        } catch (_) { /* non-critical — entry fee page can still read from investments */ }
      }
      setSuccess(true);
      setSelected([]);
      setSelectedSpecial(null);
      setSelectedAccount(null);
      setCustomSpecialAmount('');
      setTxId('');
    } catch (err) { alert('Error: ' + err.message); }
    setLoading(false);
  };

  if (success) return (
    <div style={{ padding:24, maxWidth:500, margin:'40px auto', textAlign:'center' }}>
      <div className="card">
        <div className="alert alert-success" style={{ fontSize:15, fontWeight:600 }}>
          ✓ Payment submitted — awaiting admin verification
        </div>
        <p style={{ fontSize:13, color:'#64748b', marginBottom:20 }}>
          Your payment has been recorded. An admin will verify it shortly.
        </p>
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <button onClick={() => setSuccess(false)} className="btn-primary">Pay Again</button>
          <a href="/ledger" className="btn-ghost" style={{ textDecoration:'none' }}>View My Ledger</a>
        </div>
      </div>
    </div>
  );

  const hasAnything = monthlyEnabled || specialSubs.length > 0;

  // Build account display for the info card
  // Only count methods that have at least one enabled account
  const hasMultiAccounts = enabledMethods.some(m => m !== 'Cash' && (paymentAccounts[m]||[]).some(a => a.enabled !== false));
  const hasLegacyAccounts = Object.keys(accountDetails).length > 0 && !hasMultiAccounts;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div>
          <div className="page-title">Pay Installment</div>
          <div className="page-subtitle">{orgData?.name}{monthlyEnabled ? ` · Monthly: ৳${baseAmount.toLocaleString()}` : ''}</div>
        </div>
      </div>

      {!hasAnything && (
        <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>
          <div style={{ fontSize:32, marginBottom:12 }}>⏸️</div>
          <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Payments paused</div>
          <div style={{ fontSize:13 }}>Monthly installments are currently disabled. Check back later.</div>
        </div>
      )}

      {hasAnything && (
        <form onSubmit={handleSubmit} style={{ display:'grid', gap:16 }}>

          {/* Impersonation notice */}
          {isSuperAdmin && impersonateMemberId && (
            <div style={{ padding:'10px 14px', borderRadius:8, background:'#fef3c7',
              border:'1px solid #fde68a', fontSize:12, color:'#92400e' }}>
              👤 <strong>Viewing as member</strong> — You are in superadmin impersonation mode.
              Payment submission is disabled.
            </div>
          )}

          {/* Phase 7: joining date info banner */}
          {monthlyEnabled && joiningDateStr && (
            <div style={{ padding:'10px 14px', borderRadius:8,
              background: requireBackpayment ? '#fffbeb' : '#f0fdf4',
              border: `1px solid ${requireBackpayment ? '#fde68a' : '#bbf7d0'}`,
              fontSize:12,
              color: requireBackpayment ? '#92400e' : '#15803d' }}>
              {requireBackpayment ? (
                <>
                  📅 <strong>Member since {joiningDateStr}</strong> — backpayment required.
                  All months from the organisation start date are shown.
                </>
              ) : (
                <>
                  📅 <strong>Member since {joiningDateStr}</strong>.
                  Showing installments from your joining date
                  {preJoinMonths.length > 0 && (
                    <span style={{ color:'#64748b' }}>
                      {' '}({preJoinMonths.length} month{preJoinMonths.length!==1?'s':''} before joining not required)
                    </span>
                  )}.
                </>
              )}
            </div>
          )}

          {/* Payment accounts reference card */}
          {(hasMultiAccounts || hasLegacyAccounts) && (
            <div className="card" style={{ background:'#f0fdf4', border:'1px solid #bbf7d0' }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#15803d', marginBottom:10 }}>
                📋 Send your payment to one of these accounts:
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {hasMultiAccounts ? (
                  enabledMethods.filter(m => m !== 'Cash').map(m => {
                    // Only show accounts that are enabled
                    const accs = (paymentAccounts[m] || []).filter(a => a.enabled !== false);
                    if (accs.length === 0) return null;
                    return accs.map(a => (
                      <div key={a.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #bbf7d0' }}>
                        <div>
                          <span style={{ fontSize:12, fontWeight:700, color:'#475569' }}>{m}</span>
                          <span style={{ fontSize:11, color:'#94a3b8', marginLeft:8 }}>{a.label}</span>
                        </div>
                        <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:'#0f172a' }}>{a.number}</span>
                      </div>
                    ));
                  })
                ) : (
                  enabledMethods.filter(m => m !== 'Cash' && accountDetails[m]).map(m => (
                    <div key={m} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #bbf7d0' }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#475569', minWidth:110 }}>{m}</span>
                      <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:700, color:'#0f172a' }}>{accountDetails[m]}</span>
                    </div>
                  ))
                )}
                {enabledMethods.includes('Cash') && (
                  <div style={{ fontSize:12, color:'#15803d', padding:'4px 12px' }}>
                    💵 Cash — pay directly to your organization admin
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mode switcher */}
          {monthlyEnabled && specialSubs.length > 0 && (
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" onClick={() => { setPayMode('monthly'); setSelectedSpecial(null); }}
                style={{ flex:1, padding:'10px', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer', border:'2px solid',
                  borderColor: payMode==='monthly' ? '#2563eb' : '#e2e8f0',
                  background:  payMode==='monthly' ? '#eff6ff' : '#fff',
                  color:       payMode==='monthly' ? '#1d4ed8' : '#64748b' }}>
                📅 Monthly Installment
              </button>
              <button type="button" onClick={() => { setPayMode('special'); setSelected([]); }}
                style={{ flex:1, padding:'10px', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer', border:'2px solid',
                  borderColor: payMode==='special' ? '#2563eb' : '#e2e8f0',
                  background:  payMode==='special' ? '#eff6ff' : '#fff',
                  color:       payMode==='special' ? '#1d4ed8' : '#64748b' }}>
                🎯 Special Subscription
              </button>
            </div>
          )}

          {/* Monthly months picker */}
          {payMode === 'monthly' && monthlyEnabled && (
            <div className="card">
              <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Select Months to Pay</div>
              <p style={{ fontSize:12, color:'#94a3b8', marginBottom:14 }}>Only unpaid months are shown.</p>
              {unpaidMonths.length === 0 ? (
                <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8' }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>🎉</div>
                  <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>All caught up!</div>
                  <div style={{ fontSize:13 }}>No pending months to pay.</div>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px,1fr))', gap:8 }}>
                  {unpaidMonths.map(m => {
                    const sel  = selected.includes(m);
                    const late = isLate(m);
                    return (
                      <button key={m} type="button" onClick={() => toggle(m)}
                        style={{ padding:'10px 12px', borderRadius:8, fontSize:12, fontWeight:500, cursor:'pointer', transition:'all 0.15s', textAlign:'left',
                          border:     sel ? '2px solid #2563eb' : '1px solid #e2e8f0',
                          background: sel ? '#eff6ff' : '#fff',
                          color:      sel ? '#1d4ed8' : '#475569' }}>
                        <div style={{ fontWeight:600 }}>{m.replace('-', ' / ')}</div>
                        {late && <div style={{ fontSize:10, color: sel ? '#1d4ed8' : '#f59e0b', marginTop:2 }}>+ ৳{penalty} late fee</div>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Special subs picker */}
          {(payMode === 'special' || (!monthlyEnabled && specialSubs.length > 0)) && (
            <div className="card">
              <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Special Subscriptions</div>
              <p style={{ fontSize:12, color:'#94a3b8', marginBottom:14 }}>Select one to pay.</p>
              {specialSubs.filter(s => !paidSpecial.has(s.id) &&
                // Hide entry_fee / reregistration_fee subs if member already paid via entry-fees page
                !(membership?.entryFeePaid && (s.type === 'entry_fee' || s.type === 'reregistration_fee'))
              ).length === 0 ? (
                <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8' }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
                  <div style={{ fontSize:13 }}>No pending special subscriptions.</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {specialSubs.filter(s => !paidSpecial.has(s.id) &&
                    !(membership?.entryFeePaid && (s.type === 'entry_fee' || s.type === 'reregistration_fee'))
                  ).map(s => {
                    const sel      = selectedSpecial?.id === s.id;
                    const deadline = new Date(s.deadline);
                    const daysLeft = Math.ceil((deadline - new Date()) / (1000*60*60*24));
                    return (
                      <React.Fragment key={s.id}>
                      <button type="button" onClick={() => { setSelectedSpecial(sel ? null : s); setCustomSpecialAmount(''); }}
                        style={{ padding:'14px 16px', borderRadius:10, textAlign:'left', cursor:'pointer', transition:'all 0.15s', width:'100%',
                          border:     sel ? '2px solid #2563eb' : '1px solid #e2e8f0',
                          background: sel ? '#eff6ff' : '#fff' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:600, fontSize:13, color: sel?'#1d4ed8':'#0f172a' }}>{s.title}</div>
                            {s.description && <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>{s.description}</div>}
                            <div style={{ fontSize:11, color: daysLeft <= 3 ? '#dc2626' : '#f59e0b', marginTop:4, fontWeight:500 }}>
                              Due: {s.deadline} ({daysLeft > 0 ? `${daysLeft} day${daysLeft!==1?'s':''} left` : 'Today!'})
                            </div>
                            {/* Payment type badge */}
                            {s.type === 'entry_fee' && (
                              <div style={{ marginTop:5, display:'flex', gap:6, flexWrap:'wrap' }}>
                                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#dbeafe', color:'#1d4ed8' }}>Entry Fee</span>
                                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:'#92400e' }}>
                                  → Expenses Fund
                                </span>
                              </div>
                            )}
                            {s.type === 'reregistration_fee' && (
                              <div style={{ marginTop:5 }}>
                                <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#ede9fe', color:'#7c3aed' }}>Re-Registration Fee</span>
                                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:'#92400e', marginLeft:4 }}>→ Expenses Fund</span>
                              </div>
                            )}
                            {s.allowCustomAmount && (
                              <div style={{ fontSize:11, color:'#7c3aed', marginTop:3, fontWeight:600 }}>✏️ Pay any amount you choose</div>
                            )}
                          </div>
                          <div style={{ fontWeight:700, fontSize:16, color: sel?'#1d4ed8':'#2563eb', flexShrink:0 }}>
                            {s.allowCustomAmount ? `৳${s.amount?.toLocaleString()}+` : `৳${s.amount?.toLocaleString()}`}
                          </div>
                        </div>
                      </button>

                      {/* Custom amount input — shown when this sub is selected and allows custom amount */}
                      {sel && s.allowCustomAmount && (
                        <div style={{ padding:'12px 14px', background:'#faf5ff', border:'1px solid #ddd6fe', borderRadius:8, marginTop:4 }}
                          onClick={e => e.stopPropagation()}>
                          <label className="form-label" style={{ color:'#7c3aed', marginBottom:6 }}>
                            Enter your contribution amount
                          </label>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <span style={{ fontWeight:700, color:'#7c3aed' }}>৳</span>
                            <input
                              type="number" min="1"
                              value={customSpecialAmount}
                              onChange={e => setCustomSpecialAmount(e.target.value)}
                              placeholder={`Suggested: ${s.amount?.toLocaleString()}`}
                              style={{ flex:1 }}
                            />
                          </div>
                          <div style={{ fontSize:11, color:'#7c3aed', marginTop:6 }}>
                            Suggested amount: ৳{s.amount?.toLocaleString()}. You can pay more or less.
                          </div>
                        </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Payment method + account picker + TxID */}
          {((payMode === 'monthly' && selected.length > 0) || (payMode === 'special' && selectedSpecial) || (!monthlyEnabled && selectedSpecial)) && (
            <div className="card">
              <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:14 }}>Payment Method</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
                {enabledMethods.map(m => (
                  <button key={m} type="button" onClick={() => { setMethod(m); setTxId(''); setSelectedAccount(null); }}
                    style={{ padding:'9px 18px', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', transition:'all 0.15s',
                      border:     method === m ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      background: method === m ? '#eff6ff' : '#fff',
                      color:      method === m ? '#1d4ed8' : '#475569' }}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Account picker — shown when method has multiple accounts */}
              {method !== 'Cash' && methodAccounts.length > 1 && (
                <div style={{ marginBottom:16 }}>
                  <label className="form-label">Which account did you send to? *</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {methodAccounts.map(acc => {
                      const sel = selectedAccount?.id === acc.id;
                      return (
                        <button key={acc.id} type="button" onClick={() => setSelectedAccount(sel ? null : acc)}
                          style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:8, textAlign:'left', cursor:'pointer',
                            border:     sel ? '2px solid #2563eb' : '1px solid #e2e8f0',
                            background: sel ? '#eff6ff' : '#fafafa' }}>
                          <div style={{ width:16, height:16, borderRadius:'50%', border:`2px solid ${sel?'#2563eb':'#cbd5e1'}`, background: sel?'#2563eb':'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                            {sel && <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13, color: sel?'#1d4ed8':'#0f172a' }}>{acc.label}</div>
                            <div style={{ fontFamily:'monospace', fontSize:12, color:'#475569' }}>{acc.number}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Show selected account info if only one */}
              {method !== 'Cash' && methodAccounts.length === 1 && (
                <div style={{ marginBottom:14, padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8 }}>
                  <div style={{ fontSize:12, color:'#15803d', fontWeight:600 }}>
                    Send to: <span style={{ fontFamily:'monospace' }}>{methodAccounts[0].number}</span>
                    <span style={{ fontWeight:400, marginLeft:6 }}>({methodAccounts[0].label})</span>
                  </div>
                </div>
              )}

              {method === 'Cash' && (
                <div className="alert alert-info" style={{ marginBottom:14, fontSize:13 }}>
                  Pay cash directly to your organization admin.
                </div>
              )}

              {method && method !== 'Cash' && (
                <div className="form-group">
                  <label className="form-label">Transaction ID (TxID) *</label>
                  <input value={txId} onChange={e => setTxId(e.target.value)}
                    placeholder={`Paste your ${method} transaction ID`} required />
                </div>
              )}

              {/* Summary */}
              <div style={{ background:'#f8fafc', borderRadius:8, padding:'14px 16px', marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Payment Summary</div>
                {payMode === 'monthly' ? (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'#64748b' }}>Donation ({selected.length} month{selected.length>1?'s':''} × ৳{baseAmount.toLocaleString()})</span>
                    <span style={{ fontWeight:600 }}>৳{totalBase.toLocaleString()}</span>
                  </div>
                ) : (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'#64748b' }}>
                      {selectedSpecial?.title}
                      {selectedSpecial?.allowCustomAmount && <span style={{ color:'#7c3aed', marginLeft:4 }}>(custom)</span>}
                    </span>
                    <span style={{ fontWeight:600 }}>৳{totalBase.toLocaleString()}</span>
                  </div>
                )}
                {totalPenalty > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'#64748b' }}>Late fee</span>
                    <span style={{ fontWeight:600, color:'#dc2626' }}>৳{totalPenalty.toLocaleString()}</span>
                  </div>
                )}
                {fee > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'#64748b' }}>Gateway fee ({(feeRate*100).toFixed(2)}%)</span>
                    <span style={{ fontWeight:600 }}>৳{fee.toLocaleString()}</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:16, fontWeight:700, borderTop:'1px solid #e2e8f0', paddingTop:10, marginTop:6 }}>
                  <span>Total to send</span>
                  <span style={{ color:'#2563eb' }}>৳{grandTotal.toLocaleString()}</span>
                </div>
              </div>

              <button type="submit" disabled={loading || needsAccountPick} className="btn-primary"
                style={{ width:'100%', justifyContent:'center', padding:'13px', opacity: needsAccountPick ? .5 : 1 }}>
                {loading ? 'Submitting…' : needsAccountPick ? 'Select account above first' : `Submit Payment — ৳${grandTotal.toLocaleString()}`}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}