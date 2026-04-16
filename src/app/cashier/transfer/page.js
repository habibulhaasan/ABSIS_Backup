// src/app/cashier/transfer/page.js  — Cashier fund transfer
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, addDoc, getDocs, getDoc, doc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

const fmt = n => `৳${(n||0).toLocaleString(undefined, { maximumFractionDigits:0 })}`;

export default function CashierTransfer() {
  const { user, userData, orgData, isOrgAdmin, isCashier, membership } = useAuth();
  const orgId = userData?.activeOrgId;

  const [transfers,  setTransfers]  = useState([]);
  const [payments,   setPayments]   = useState([]); // verified payments for balance calc
  const [cashiers,   setCashiers]   = useState([]); // eligible recipients
  const [members,    setMembers]    = useState({}); // uid → profile
  const [modal,      setModal]      = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ toUserId:'', amount:'', method:'', txId:'', fee:'', feeNotes:'', notes:'' });

  const cashierAccountIds = membership?.cashierAccountIds || [];
  const cashierMethods    = membership?.cashierMethods    || [];
  const myUid = user?.uid;

  // ── Load transfers ──
  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, 'organizations', orgId, 'cashierTransfers'), orderBy('createdAt','desc'));
    return onSnapshot(q, snap => {
      let all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (isCashier && !isOrgAdmin) all = all.filter(t => t.fromUserId === myUid || t.toUserId === myUid);
      setTransfers(all);
    });
  }, [orgId, isCashier, isOrgAdmin, myUid]);

  // ── Load verified payments for balance calculation ──
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(collection(db, 'organizations', orgId, 'investments'), snap => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status === 'verified'));
    });
  }, [orgId]);

  // ── Load member profiles and cashier list ──
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const snap = await getDocs(collection(db, 'organizations', orgId, 'members'));
      const map  = {};
      const list = [];
      await Promise.all(snap.docs.map(async d => {
        const mem = d.data();
        let profile = mem;
        try {
          const uSnap = await getDoc(doc(db, 'users', d.id));
          if (uSnap.exists()) profile = { ...uSnap.data(), ...mem, id: d.id };
          else profile = { ...mem, id: d.id };
        } catch { profile = { ...mem, id: d.id }; }
        map[d.id] = profile;
        if (d.id !== myUid && (mem.role === 'cashier' || mem.role === 'admin') && mem.approved) {
          list.push(profile);
        }
      }));
      setMembers(map);
      setCashiers(list.sort((a,b) => (a.nameEnglish||'').localeCompare(b.nameEnglish||'')));
    })();
  }, [orgId, myUid]);

  // ── Balance calculation for a given cashier uid ──
  // Balance = (verified payments sent to their accounts) + (transfers received) - (transfers sent) - (fees from their transfers)
  const calcBalance = (uid) => {
    const m = uid === myUid ? membership : (members[uid] || {});
    const accIds  = m?.cashierAccountIds || [];
    const methods = m?.cashierMethods    || [];

    const collected = payments.reduce((s, p) => {
      const match = p.accountId ? accIds.includes(p.accountId) : methods.includes(p.method);
      return match ? s + (p.amount||0) : s;
    }, 0);

    const sent     = transfers.filter(t => t.fromUserId === uid).reduce((s,t) => s + (t.amount||0) + (t.fee||0), 0);
    const received = transfers.filter(t => t.toUserId   === uid).reduce((s,t) => s + (t.amount||0), 0);

    return collected + received - sent;
  };

  const myBalance = calcBalance(myUid);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.toUserId || !form.amount || !form.method) {
      alert('Recipient, amount, and method are required.');
      return;
    }
    const amount = Number(form.amount);
    const fee    = form.fee ? Number(form.fee) : 0;
    if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }

    // Balance check
    const totalOut = amount + fee;
    if (totalOut > myBalance) {
      alert(`Insufficient balance. You have ${fmt(myBalance)} available but are trying to send ${fmt(amount)}${fee ? ` + ${fmt(fee)} fee` : ''} = ${fmt(totalOut)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const toName   = members[form.toUserId]?.nameEnglish || form.toUserId.slice(0,8);
      const fromName = members[myUid]?.nameEnglish || 'A cashier';

      // 1. Record the transfer (adds to recipient balance automatically via calcBalance)
      await addDoc(collection(db, 'organizations', orgId, 'cashierTransfers'), {
        fromUserId: myUid,
        toUserId:   form.toUserId,
        amount,
        method:     form.method,
        txId:       form.txId.trim(),
        fee,
        feeNotes:   form.feeNotes.trim(),
        notes:      form.notes.trim(),
        createdAt:  serverTimestamp(),
      });

      // 2. If fee, record as expense with full transfer context in notes
      if (fee > 0) {
        const feeDesc = form.feeNotes.trim() ? form.feeNotes.trim() : `${form.method} transfer fee`;
        await addDoc(collection(db, 'organizations', orgId, 'expenses'), {
          title:     `Transfer Fee — ${feeDesc}`,
          amount:    fee,
          category:  'Operations',
          date:      new Date().toISOString().slice(0,10),
          notes:     `Fund transfer: ${fmt(amount)} sent from ${fromName} to ${toName} via ${form.method}. Fee: ${fmt(fee)}.${form.notes ? ' Note: '+form.notes : ''}`,
          createdAt: serverTimestamp(),
          createdBy: myUid,
          autoGenerated: true,
          transferRef: true,
        });
      }

      // 3. Notify recipient
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId:    form.toUserId,
        message:   `💸 Fund transfer received from ${fromName}: ${fmt(amount)} via ${form.method}.${fee ? ` (Fee deducted: ${fmt(fee)})` : ''}${form.notes ? ' — '+form.notes : ''}`,
        read:      false,
        createdAt: serverTimestamp(),
      });

      setForm({ toUserId:'', amount:'', method:'', txId:'', fee:'', feeNotes:'', notes:'' });
      setModal(false);
    } catch (err) { alert(err.message); }
    setSubmitting(false);
  };

  // Stats
  const sentTotal     = transfers.filter(t => t.fromUserId===myUid).reduce((s,t) => s+t.amount, 0);
  const receivedTotal = transfers.filter(t => t.toUserId===myUid).reduce((s,t) => s+t.amount, 0);
  const allTotal      = transfers.reduce((s,t) => s+t.amount, 0);
  const totalFees     = transfers.reduce((s,t) => s+(t.fee||0), 0);
  const getName       = uid => members[uid]?.nameEnglish || uid?.slice(0,8) || '—';

  // Methods available to this cashier for transfer
  const transferMethods = cashierMethods.length > 0
    ? cashierMethods
    : ['bKash','Nagad','Rocket','Bank Transfer','Cash'];

  return (
    <div className="page-wrap animate-fade">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {orgData?.logoURL && (
            <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
              <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
            </div>
          )}
          <div>
            <div className="page-title">Fund Transfers</div>
            <div className="page-subtitle">
              {isCashier && !isOrgAdmin ? 'Your transfers and balance' : 'All cashier transfers'}
            </div>
          </div>
        </div>
        {(isCashier || isOrgAdmin) && (
          <button onClick={() => setModal(true)} className="btn-primary">+ New Transfer</button>
        )}
      </div>

      {/* Stats */}
      <div className="stats-row" style={{ gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', marginBottom:20 }}>
        {isCashier && !isOrgAdmin ? (
          <>
            <div className="stat-card">
              <div className="stat-label">Available Balance</div>
              <div className="stat-value" style={{ color: myBalance >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(myBalance)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Sent</div>
              <div className="stat-value" style={{ color:'#dc2626' }}>{fmt(sentTotal)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Received</div>
              <div className="stat-value" style={{ color:'#16a34a' }}>{fmt(receivedTotal)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-label">Total Transferred</div>
              <div className="stat-value" style={{ color:'#2563eb' }}>{fmt(allTotal)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Fees</div>
              <div className="stat-value" style={{ color:'#dc2626' }}>{fmt(totalFees)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Transfers</div>
              <div className="stat-value">{transfers.length}</div>
            </div>
          </>
        )}
      </div>

      {/* Table */}
      {transfers.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8' }}>
          No transfers recorded yet.
        </div>
      ) : (
        <div className="table-wrap"><div className="table-scroll">
          <table>
            <thead>
              <tr><th>Date</th><th>From</th><th>To</th><th>Method</th><th>Tx ID</th><th>Amount</th><th>Fee</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id}>
                  <td style={{ whiteSpace:'nowrap', fontSize:12, color:'#64748b' }}>
                    {t.createdAt?.seconds ? new Date(t.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td style={{ fontWeight:600, fontSize:13, color: t.fromUserId===myUid ? '#dc2626' : '#0f172a' }}>
                    {getName(t.fromUserId)}
                    {t.fromUserId===myUid && <span style={{ fontSize:10, color:'#94a3b8', marginLeft:4 }}>(you)</span>}
                  </td>
                  <td style={{ fontWeight:600, fontSize:13, color: t.toUserId===myUid ? '#16a34a' : '#0f172a' }}>
                    {getName(t.toUserId)}
                    {t.toUserId===myUid && <span style={{ fontSize:10, color:'#94a3b8', marginLeft:4 }}>(you)</span>}
                  </td>
                  <td style={{ fontSize:12 }}>{t.method}</td>
                  <td style={{ fontFamily:'monospace', fontSize:11, color:'#475569' }}>{t.txId||'—'}</td>
                  <td style={{ fontWeight:700 }}>{fmt(t.amount)}</td>
                  <td style={{ fontSize:12, color: t.fee ? '#dc2626' : '#94a3b8' }}>
                    {t.fee ? fmt(t.fee) : '—'}
                    {t.feeNotes && <div style={{ fontSize:10, color:'#94a3b8' }}>{t.feeNotes}</div>}
                  </td>
                  <td style={{ fontSize:12, color:'#64748b', maxWidth:140 }}>{t.notes||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {/* New Transfer Modal */}
      {modal && (
        <Modal title="Record Fund Transfer" onClose={() => setModal(false)}>
          {isCashier && !isOrgAdmin && (
            <div style={{ padding:'12px 14px', background: myBalance > 0 ? '#f0fdf4' : '#fef2f2', border:`1px solid ${myBalance > 0 ? '#bbf7d0' : '#fecaca'}`, borderRadius:8, marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:13, color:'#475569' }}>Your available balance</span>
              <span style={{ fontSize:16, fontWeight:700, color: myBalance > 0 ? '#15803d' : '#dc2626' }}>{fmt(myBalance)}</span>
            </div>
          )}
          <div className="alert alert-info" style={{ fontSize:13, marginBottom:16 }}>
            Record handing over collected funds to another cashier or admin. Fees are auto-logged as expenses.
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Transfer To *</label>
              <select value={form.toUserId} onChange={e => set('toUserId', e.target.value)} required>
                <option value="">Select recipient…</option>
                {cashiers.map(c => {
                  const bal = calcBalance(c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.nameEnglish || c.id.slice(0,8)} ({c.role}) — balance: {fmt(bal)}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Amount *</label>
                <input type="number" min="1" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0" required />
              </div>
              <div className="form-group">
                <label className="form-label">Method *</label>
                <select value={form.method} onChange={e => set('method', e.target.value)} required>
                  <option value="">Select…</option>
                  {transferMethods.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Live balance check */}
            {form.amount && Number(form.amount) > 0 && (() => {
              const totalOut = Number(form.amount) + (form.fee ? Number(form.fee) : 0);
              const ok = totalOut <= myBalance;
              return (
                <div style={{ padding:'10px 14px', borderRadius:8, background: ok ? '#f0fdf4' : '#fef2f2', border:`1px solid ${ok?'#bbf7d0':'#fecaca'}`, marginBottom:14, fontSize:13 }}>
                  {ok
                    ? <span style={{ color:'#15803d' }}>✓ Balance sufficient. After transfer: {fmt(myBalance - totalOut)}</span>
                    : <span style={{ color:'#dc2626' }}>✗ Insufficient balance. You need {fmt(totalOut)} but have {fmt(myBalance)}.</span>}
                </div>
              );
            })()}

            <div className="form-group">
              <label className="form-label">Transaction ID / Reference</label>
              <input value={form.txId} onChange={e => set('txId', e.target.value)} placeholder="Optional" />
            </div>

            <div style={{ padding:'12px 14px', background:'#fffbeb', border:'1px solid #fed7aa', borderRadius:8, marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, color:'#92400e', marginBottom:8 }}>Transfer Fee (Optional)</div>
              <div className="form-row">
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Fee Amount</label>
                  <input type="number" min="0" value={form.fee} onChange={e => set('fee', e.target.value)} placeholder="0" />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Fee Description</label>
                  <input value={form.feeNotes} onChange={e => set('feeNotes', e.target.value)} placeholder="e.g. bKash charge" />
                </div>
              </div>
              {form.fee && Number(form.fee) > 0 && (
                <div style={{ fontSize:11, color:'#92400e', marginTop:8 }}>
                  ⚠️ {fmt(Number(form.fee))} will be auto-recorded as an expense with transfer details in notes.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Any additional context…" style={{ resize:'vertical' }} />
            </div>

            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              <button type="button" onClick={() => setModal(false)} className="btn-ghost" style={{ flex:1, justifyContent:'center' }}>Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary" style={{ flex:2, justifyContent:'center' }}>
                {submitting ? 'Recording…' : 'Record Transfer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
