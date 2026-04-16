// src/app/admin/subscriptiongrid/page.js
// Installment Tracker Grid — full featured
'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { fmtBDT } from '@/lib/fundCalculations';
import Modal from '@/components/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m-1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function currentYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

function sortByMemberId(members) {
  return [...members].sort((a, b) => {
    const aNum = parseInt((a.idNo || '').replace(/\D/g, ''), 10);
    const bNum = parseInt((b.idNo || '').replace(/\D/g, ''), 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    return (a.idNo || '').localeCompare(b.idNo || '') ||
           (a.nameEnglish || '').localeCompare(b.nameEnglish || '');
  });
}

// ── CSV Export — transposed layout ───────────────────────────────────────────
// Columns = members, Rows = months
// Row order: UID, Name, Member ID, [month rows], Comments, Total
function downloadCSV(members, allMonths, payMap, feeInAcct, orgName) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = [];

  // Header rows (member info as columns)
  rows.push(['Field', ...members.map(m => esc(m.id))].map(esc).join(','));           // UID row
  rows.push(['Member Name', ...members.map(m => esc(m.nameEnglish || m.nameBengali || ''))].map(esc).join(','));
  rows.push(['Member ID', ...members.map(m => esc(m.idNo || ''))].map(esc).join(','));
  rows.push(['', ...members.map(() => '')].join(',')); // blank separator

  // Month rows — numbers only, oldest first
  allMonths.slice().reverse().forEach(month => {
    const amtRow = [esc(monthLabel(month)), ...members.map(m => {
      const rec = payMap[m.id]?.[month];
      if (!rec || rec.status === 'rejected') return '';
      const net = (rec.amount || 0) - (feeInAcct ? 0 : (rec.gatewayFee || 0));
      return net > 0 ? net : '';
    })];
    rows.push(amtRow.join(','));
  });

  // Blank separator
  rows.push(['', ...members.map(() => '')].join(','));

  // Total row — verified amounts only, numbers
  const totalRow = [esc('TOTAL (verified)'), ...members.map(m => {
    const total = Object.values(payMap[m.id] || {})
      .filter(p => p.status === 'verified')
      .reduce((s, p) => s + (p.amount || 0) - (feeInAcct ? 0 : (p.gatewayFee || 0)), 0);
    return total > 0 ? total : 0;
  })];
  rows.push(totalRow.join(','));

  // Verified count row
  const cntRow = [esc('Verified Months'), ...members.map(m =>
    Object.values(payMap[m.id] || {}).filter(p => p.status === 'verified').length
  )];
  rows.push(cntRow.join(','));

  // Pending count row
  const pendRow = [esc('Pending Months'), ...members.map(m =>
    Object.values(payMap[m.id] || {}).filter(p => p.status === 'pending').length
  )];
  rows.push(pendRow.join(','));

  // Single notes column — one cell per member, all their notes concatenated
  const notesRow = [esc('Notes'), ...members.map(m => {
    const notes = Object.entries(payMap[m.id] || {})
      .filter(([, p]) => p.notes)
      .map(([month, p]) => `${month}: ${p.notes}`)
      .join('; ');
    return esc(notes);
  })];
  rows.push(notesRow.join(','));

  const csv  = rows.join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `installments-${currentYM()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
// Opens for any cell — including already-verified ones
function EditModal({ member, month, paymentRec, defaultAmount, orgId, userId, onClose, onRefresh, feeInAcct }) {
  const { user } = useAuth();
  const isNew    = !paymentRec;

  const [amount,  setAmount]  = useState(paymentRec?.amount ?? defaultAmount ?? '');
  const [status,  setStatus]  = useState(paymentRec?.status ?? 'verified');
  const [method,  setMethod]  = useState(paymentRec?.method ?? 'Cash');
  const [notes,   setNotes]   = useState(paymentRec?.notes  ?? '');
  const [saving,  setSaving]  = useState(false);
  const [confirm, setConfirm] = useState(false); // confirm delete

  const handleSave = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { alert('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      if (isNew) {
        await addDoc(collection(db, 'organizations', orgId, 'investments'), {
          userId: member.id, paidMonths: [month], amount: amt,
          baseAmount: amt, penaltyPaid: 0, gatewayFee: 0,
          method, notes, txId: '',
          status, adminEntered: true,
          createdAt: serverTimestamp(),
          ...(status === 'verified' ? { verifiedAt: serverTimestamp(), verifiedBy: user.uid } : {}),
        });
      } else {
        await updateDoc(doc(db, 'organizations', orgId, 'investments', paymentRec.id), {
          amount: amt, method, notes, status,
          ...(status === 'verified' && paymentRec.status !== 'verified'
            ? { verifiedAt: serverTimestamp(), verifiedBy: user.uid } : {}),
        });
      }
      await onRefresh();
      onClose();
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!paymentRec) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'investments', paymentRec.id));
      await onRefresh();
      onClose();
    } catch (e) { alert('Error: ' + e.message); }
    setSaving(false);
  };

  const STATUS_OPTS = [
    { val:'verified', label:'✓ Verified', color:'#15803d', bg:'#dcfce7' },
    { val:'pending',  label:'⏳ Pending',  color:'#92400e', bg:'#fef3c7' },
    { val:'rejected', label:'✕ Rejected', color:'#b91c1c', bg:'#fee2e2' },
  ];

  return (
    <Modal
      title={`${isNew ? 'Add' : 'Edit'} Payment — ${member.nameEnglish || member.id} · ${monthLabel(month)} (${month})`}
      onClose={onClose}
    >
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

        {/* Member info strip */}
        <div style={{ padding:'10px 14px', borderRadius:9, background:'#f8fafc', border:'1px solid #e2e8f0',
          display:'flex', gap:16, flexWrap:'wrap', fontSize:12 }}>
          <span><strong>Member:</strong> {member.nameEnglish || '—'}</span>
          <span><strong>ID:</strong> {member.idNo || '—'}</span>
          <span><strong>Month:</strong> {month}</span>
          {paymentRec?.adminEntered && (
            <span style={{ color:'#7c3aed', fontWeight:600 }}>Admin entry</span>
          )}
        </div>

        {/* Amount */}
        <div>
          <label style={{ fontSize:12, fontWeight:700, color:'#475569', display:'block', marginBottom:6 }}>
            Amount (৳) *
          </label>
          <input
            type="number" min="1" value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1.5px solid #e2e8f0',
              fontSize:15, fontWeight:700 }}
          />
          {defaultAmount > 0 && (
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>
              Standard amount: {fmtBDT(defaultAmount)}
              {Number(amount) !== defaultAmount && (
                <button onClick={() => setAmount(defaultAmount)}
                  style={{ marginLeft:8, fontSize:11, color:'#2563eb', background:'none',
                    border:'none', cursor:'pointer', fontWeight:600 }}>
                  Reset
                </button>
              )}
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <label style={{ fontSize:12, fontWeight:700, color:'#475569', display:'block', marginBottom:8 }}>
            Status
          </label>
          <div style={{ display:'flex', gap:8 }}>
            {STATUS_OPTS.map(opt => (
              <button key={opt.val} type="button" onClick={() => setStatus(opt.val)}
                style={{
                  flex:1, padding:'10px 6px', borderRadius:8, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:700,
                  background: status === opt.val ? opt.bg : '#f1f5f9',
                  color:      status === opt.val ? opt.color : '#94a3b8',
                  outline:    status === opt.val ? `2px solid ${opt.color}` : 'none',
                  outlineOffset: 1,
                }}>
                {opt.label}
              </button>
            ))}
          </div>
          {status === 'verified' && paymentRec?.status === 'verified' && (
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:5 }}>
              ⚠️ Changing status from Verified will affect the member's ledger and capital balance.
            </div>
          )}
        </div>

        {/* Method */}
        <div>
          <label style={{ fontSize:12, fontWeight:700, color:'#475569', display:'block', marginBottom:6 }}>
            Method
          </label>
          <select value={method} onChange={e => setMethod(e.target.value)}
            style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13 }}>
            {['Cash','bKash','Nagad','Rocket','Bank Transfer','Other'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize:12, fontWeight:700, color:'#475569', display:'block', marginBottom:6 }}>
            Notes (optional)
          </label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Paid late, partial payment, correction…"
            style={{ width:'100%', padding:'8px 12px', borderRadius:8,
              border:'1px solid #e2e8f0', fontSize:13 }} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:8, marginTop:20, paddingTop:16, borderTop:'1px solid #e2e8f0' }}>
        {/* Delete button — only for existing records */}
        {!isNew && !confirm && (
          <button onClick={() => setConfirm(true)}
            style={{ padding:'10px 16px', borderRadius:8, border:'1px solid #fca5a5',
              background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600, color:'#b91c1c' }}>
            🗑 Delete
          </button>
        )}
        {!isNew && confirm && (
          <>
            <span style={{ fontSize:12, color:'#b91c1c', alignSelf:'center', fontWeight:600 }}>
              Confirm delete?
            </span>
            <button onClick={handleDelete} disabled={saving}
              style={{ padding:'10px 16px', borderRadius:8, border:'none',
                background:'#fee2e2', cursor:'pointer', fontSize:13, fontWeight:700, color:'#b91c1c' }}>
              {saving ? '…' : 'Yes, Delete'}
            </button>
            <button onClick={() => setConfirm(false)}
              style={{ padding:'10px 14px', borderRadius:8, border:'1px solid #e2e8f0',
                background:'#fff', cursor:'pointer', fontSize:13, color:'#64748b' }}>
              Cancel
            </button>
          </>
        )}

        <div style={{ flex:1 }} />

        <button onClick={onClose}
          style={{ padding:'10px 18px', borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', cursor:'pointer', fontSize:13, color:'#64748b' }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-primary"
          style={{ padding:'10px 24px' }}>
          {saving ? 'Saving…' : isNew ? 'Add Payment' : 'Save Changes'}
        </button>
      </div>
    </Modal>
  );
}

// ── Undo Toast ────────────────────────────────────────────────────────────────
function UndoToast({ toast, onUndo, onDismiss }) {
  if (!toast) return null;
  return (
    <div style={{
      position:'fixed', top:16, left:'50%', transform:'translateX(-50%)',
      background:'#0f172a', color:'#fff', borderRadius:10,
      padding:'12px 20px', display:'flex', alignItems:'center', gap:16,
      fontSize:13, fontWeight:500, zIndex:9999,
      boxShadow:'0 4px 24px rgba(0,0,0,0.32)',
    }}>
      <span>{toast.msg}</span>
      {toast.undoFn && (
        <button onClick={onUndo} style={{
          padding:'5px 14px', borderRadius:7, border:'1.5px solid #3b82f6',
          background:'transparent', color:'#93c5fd', cursor:'pointer',
          fontSize:12, fontWeight:700, whiteSpace:'nowrap',
        }}>↩ Undo</button>
      )}
      <button onClick={onDismiss} style={{
        background:'none', border:'none', color:'#64748b',
        cursor:'pointer', fontSize:16, padding:'0 4px', lineHeight:1,
      }}>×</button>
    </div>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────────────
// All cells are clickable — opens EditModal for both paid and unpaid
function Cell({ member, month, paymentRec, defaultAmount, onOpen, saving, isCurrentMonth }) {
  const status     = paymentRec?.status;
  const isVerified = status === 'verified';
  const isPending  = status === 'pending';
  const isRejected = status === 'rejected';
  const hasPay     = !!paymentRec;
  const amount     = paymentRec?.amount;
  const isSaving   = saving === `${member.id}-${month}`;

  let bg, border, textColor, icon;
  if (isVerified)      { bg='#dcfce7'; border='#86efac'; textColor='#15803d'; icon='✓'; }
  else if (isPending)  { bg='#fef3c7'; border='#fde68a'; textColor='#92400e'; icon='⏳'; }
  else if (isRejected) { bg='#fee2e2'; border='#fca5a5'; textColor='#b91c1c'; icon='✕'; }
  else {
    bg = isCurrentMonth ? '#eff6ff' : '#fafafa';
    border = isCurrentMonth ? '#bfdbfe' : '#e2e8f0';
    textColor = '#94a3b8'; icon = '';
  }

  return (
    <div
      onClick={() => onOpen(member, month, paymentRec)}
      title={
        isVerified  ? `${fmtBDT(amount)} verified${paymentRec?.adminEntered?' (admin)':''} — click to edit`
        : isPending  ? `${fmtBDT(amount)} pending — click to edit`
        : isRejected ? `${fmtBDT(amount)} rejected — click to edit`
        : 'Click to add payment'
      }
      style={{
        background: bg, border:`1px solid ${border}`, borderRadius:7,
        padding:'5px 7px', cursor:'pointer', minHeight:38,
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        transition:'all 0.12s', opacity: isSaving ? 0.6 : 1,
        position:'relative',
      }}
    >
      {/* Edit pencil hint on hover — CSS only via title attr, show via outline */}
      {isSaving ? (
        <span style={{ fontSize:10, color:'#94a3b8' }}>…</span>
      ) : hasPay ? (
        <>
          <span style={{ fontSize:10, fontWeight:700, color:textColor }}>{icon}</span>
          <span style={{ fontSize:11, fontWeight:700, color:textColor, marginTop:1 }}>
            {fmtBDT(amount)}
          </span>
          {paymentRec?.notes && (
            <span style={{ fontSize:8, color:textColor, opacity:0.7, marginTop:1 }}>📝</span>
          )}
        </>
      ) : (
        <span style={{ fontSize:16, color: isCurrentMonth ? '#93c5fd' : '#e2e8f0' }}>+</span>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SubscriptionGrid() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};

  const [members,   setMembers]   = useState([]);
  const [payments,  setPayments]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(null);
  const [search,    setSearch]    = useState('');
  const [editState, setEditState] = useState(null); // { member, month, paymentRec }
  const [undoToast, setUndoToast] = useState(null);
  const undoTimer = useRef(null);

  const dismissUndo = () => { clearTimeout(undoTimer.current); setUndoToast(null); };
  const showUndo = (msg, undoFn) => {
    clearTimeout(undoTimer.current);
    setUndoToast({ msg, undoFn });
    undoTimer.current = setTimeout(() => setUndoToast(null), undoFn ? 6000 : 2500);
  };

  const refreshPayments = async () => {
    const s = await getDocs(
      query(collection(db, 'organizations', orgId, 'investments'), orderBy('createdAt', 'asc'))
    );
    setPayments(s.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    if (!orgId || !isOrgAdmin) return;
    (async () => {
      setLoading(true);
      const [memSnap, paySnap] = await Promise.all([
        getDocs(collection(db, 'organizations', orgId, 'members')),
        getDocs(query(collection(db, 'organizations', orgId, 'investments'), orderBy('createdAt', 'asc'))),
      ]);
      const raw = memSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.approved);
      const enriched = await Promise.all(raw.map(async m => {
        try { const u = await getDoc(doc(db, 'users', m.id)); return u.exists() ? { ...u.data(), ...m } : m; }
        catch { return m; }
      }));
      setMembers(sortByMemberId(enriched));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, [orgId, isOrgAdmin]);

  const allMonths = useMemo(() => [...getMonths(settings.startDate)].reverse(), [settings.startDate]);
  const curYM     = currentYM();
  const feeInAcct = !!settings.gatewayFeeInAccounting;

  const payMap = useMemo(() => {
    const map = {};
    payments.forEach(p => {
      if (!p.userId) return;
      if (!map[p.userId]) map[p.userId] = {};
      (p.paidMonths || []).forEach(mo => {
        if (!map[p.userId][mo] || p.status === 'verified') map[p.userId][mo] = p;
      });
    });
    return map;
  }, [payments]);

  const memberTotal = (memberId) =>
    Object.values(payMap[memberId] || {})
      .filter(p => p.status === 'verified')
      .reduce((s, p) => s + (p.amount || 0) - (feeInAcct ? 0 : (p.gatewayFee || 0)), 0);

  // Smart click handler:
  // - Empty cell or rejected → one-click auto-verify (no modal, instant)
  // - Existing record (pending/verified) → open edit modal
  const handleOpenEdit = async (member, month, paymentRec) => {
    if (!paymentRec || paymentRec.status === 'rejected') {
      // One-click instant payment entry — auto-verified
      const defaultAmt = (settings.uniformAmount === false && member.customAmount != null)
        ? member.customAmount : (settings.baseAmount || 0);
      if (!defaultAmt || defaultAmt <= 0) {
        // No default amount configured — open modal so admin can enter amount
        setEditState({ member, month, paymentRec });
        return;
      }
      setSaving(`${member.id}-${month}`);
      try {
        const baseAmount = defaultAmt;
        const newRef = await addDoc(collection(db, 'organizations', orgId, 'investments'), {
          userId: member.id, paidMonths: [month], amount: baseAmount, baseAmount,
          penaltyPaid: 0, gatewayFee: 0, method: 'Cash', txId: '',
          status: 'verified', adminEntered: true,
          createdAt: serverTimestamp(), verifiedAt: serverTimestamp(), verifiedBy: user.uid,
        });
        await refreshPayments();
        // Undo available for 6 seconds
        showUndo(`✓ ${member.nameEnglish?.split(' ')[0] || 'Member'} — ${month} marked paid`, async () => {
          await deleteDoc(doc(db, 'organizations', orgId, 'investments', newRef.id));
          await refreshPayments();
          showUndo('↩ Undone', null);
        });
      } catch (e) { showUndo('Error: ' + e.message, null); }
      setSaving(null);
    } else {
      // Has existing record — open edit modal
      setEditState({ member, month, paymentRec });
    }
  };

  if (!isOrgAdmin) return null;

  const filtered = members.filter(m =>
    !search ||
    (m.nameEnglish || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.idNo || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalVerifiedAmt  = payments.filter(p => p.status === 'verified')
    .reduce((s, p) => s + (p.amount || 0) - (feeInAcct ? 0 : (p.gatewayFee || 0)), 0);
  const totalPendingCount = payments.filter(p => p.status === 'pending').length;

  return (
    <div className="page-wrap animate-fade">
      <UndoToast
        toast={undoToast}
        onUndo={async () => { dismissUndo(); if (undoToast?.undoFn) await undoToast.undoFn(); }}
        onDismiss={dismissUndo}
      />

      {/* Edit modal */}
      {editState && (
        <EditModal
          member={editState.member}
          month={editState.month}
          paymentRec={editState.paymentRec}
          defaultAmount={
            (settings.uniformAmount === false && editState.member.customAmount != null)
              ? editState.member.customAmount : (settings.baseAmount || 0)
          }
          orgId={orgId}
          userId={user?.uid}
          onClose={() => setEditState(null)}
          onRefresh={refreshPayments}
          feeInAcct={feeInAcct}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
          <div>
            <div className="page-title">Installment Tracker</div>
            <div className="page-subtitle">
              Click any cell to add or edit a payment. Sorted by Member ID.
            </div>
          </div>
          <button
            onClick={() => downloadCSV(filtered, allMonths, payMap, feeInAcct, orgData?.name)}
            style={{ padding:'9px 18px', borderRadius:8, border:'1px solid #e2e8f0',
              background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600,
              color:'#475569', display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:12, marginBottom:20 }}>
        {[
          { label:'Total Verified',  value: fmtBDT(totalVerifiedAmt), color:'#15803d', bg:'#f0fdf4' },
          { label:'Pending',         value: totalPendingCount,         color:'#d97706', bg:'#fffbeb' },
          { label:'Active Members',  value: members.length,            color:'#1d4ed8', bg:'#eff6ff' },
          { label:'Total Months',    value: allMonths.length,          color:'#475569', bg:'#f8fafc' },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>{s.label}</div>
            <div style={{ fontSize:20, fontWeight:700, color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:14, marginBottom:14, flexWrap:'wrap', fontSize:11, fontWeight:600 }}>
        {[
          { bg:'#dcfce7', border:'#86efac', color:'#15803d', label:'✓ Verified' },
          { bg:'#fef3c7', border:'#fde68a', color:'#92400e', label:'⏳ Pending' },
          { bg:'#fee2e2', border:'#fca5a5', color:'#b91c1c', label:'✕ Rejected' },
          { bg:'#eff6ff', border:'#bfdbfe', color:'#93c5fd', label:'+ Unpaid' },
        ].map(l => (
          <div key={l.label} style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:14, height:14, borderRadius:3, background:l.bg, border:`1px solid ${l.border}` }} />
            <span style={{ color:l.color }}>{l.label}</span>
          </div>
        ))}
        <div style={{ color:'#94a3b8', marginLeft:4 }}>📝 = has note · Click any cell to add/edit/delete</div>
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search member name or ID…"
        style={{ width:'100%', padding:'9px 14px', borderRadius:8, border:'1px solid #e2e8f0',
          fontSize:13, marginBottom:14, boxSizing:'border-box' }} />

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign:'center', padding:'60px 20px', color:'#94a3b8' }}>Loading tracker…</div>
      ) : (
        <div style={{ overflowX:'auto', borderRadius:12, border:'1px solid #e2e8f0' }}>
          <table style={{ borderCollapse:'collapse', minWidth:'100%', tableLayout:'fixed' }}>
            <colgroup>
              <col style={{ width:150 }} />{/* merged: ID + Name + Total */}
              {allMonths.map(m => <col key={m} style={{ width: m === curYM ? 82 : 72 }} />)}
            </colgroup>

            {/* Header */}
            <thead>
              <tr style={{ background:'#0f172a' }}>
                <th style={{ padding:'10px 10px', textAlign:'left', fontSize:11, fontWeight:700,
                  color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.07em',
                  position:'sticky', left:0, zIndex:10, background:'#0f172a', borderRight:'2px solid #334155' }}>
                  Member · Total
                </th>
                {allMonths.map(month => {
                  const isCur = month === curYM;
                  return (
                    <th key={month} style={{
                      padding:'10px 6px', textAlign:'center', fontSize:11, fontWeight:700,
                      color: isCur ? '#fff' : '#64748b',
                      background: isCur ? '#2563eb' : '#0f172a',
                      borderLeft: isCur ? '2px solid #1d4ed8' : '1px solid #1e293b',
                      whiteSpace:'nowrap',
                    }}>
                      {monthLabel(month)}
                      {isCur && <div style={{ fontSize:9, opacity:0.8, fontWeight:400, marginTop:1 }}>Current</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={1 + allMonths.length}
                  style={{ textAlign:'center', padding:'48px 20px', color:'#94a3b8', fontSize:13 }}>
                  No members found
                </td></tr>
              ) : filtered.map((member, ri) => {
                const mpm        = payMap[member.id] || {};
                const verCount   = allMonths.filter(m => mpm[m]?.status === 'verified').length;
                const pendCount  = allMonths.filter(m => mpm[m]?.status === 'pending').length;
                const rowTotal   = memberTotal(member.id);
                const rowBg      = ri % 2 === 0 ? '#fff' : '#fafafa';

                return (
                  <tr key={member.id} style={{ background:rowBg, borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'6px 10px', position:'sticky', left:0, zIndex:5,
                      background:rowBg, borderRight:'2px solid #e2e8f0', minWidth:0 }}>
                      {/* ID */}
                      <div style={{ fontSize:10, fontWeight:700, color:'#64748b', letterSpacing:'0.04em' }}>
                        {member.idNo || '—'}
                      </div>
                      {/* Name */}
                      <div style={{ fontWeight:600, fontSize:12, color:'#0f172a',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:1 }}>
                        {member.nameEnglish || member.nameBengali || '—'}
                      </div>
                      {/* Total + count */}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:3 }}>
                        <div style={{ fontSize:10, color:'#94a3b8' }}>
                          <span style={{ color:'#15803d', fontWeight:600 }}>{verCount}✓</span>
                          {pendCount > 0 && <span style={{ color:'#d97706', marginLeft:4 }}>{pendCount}⏳</span>}
                          <span style={{ marginLeft:4 }}>/{allMonths.length}</span>
                        </div>
                        <div style={{ fontSize:11, fontWeight:700, color: rowTotal>0 ? '#15803d' : '#94a3b8' }}>
                          {rowTotal > 0 ? fmtBDT(rowTotal) : ''}
                        </div>
                      </div>
                    </td>
                    {allMonths.map(month => {
                      const isCur = month === curYM;
                      return (
                        <td key={month} style={{
                          padding:'4px 5px',
                          background: isCur ? (ri%2===0 ? '#f8faff' : '#f3f7ff') : 'inherit',
                          borderLeft: isCur ? '2px solid #bfdbfe' : '1px solid #f1f5f9',
                        }}>
                          <Cell
                            member={member} month={month} paymentRec={mpm[month]}
                            defaultAmount={
                              (settings.uniformAmount===false && member.customAmount!=null)
                                ? member.customAmount : (settings.baseAmount||0)
                            }
                            onOpen={handleOpenEdit}
                            saving={saving} isCurrentMonth={isCur}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>

            {/* Footer */}
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ background:'#0f172a' }}>
                  <td style={{ padding:'8px 10px', position:'sticky', left:0, background:'#0f172a',
                    borderRight:'2px solid #334155' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#e2e8f0' }}>Totals</div>
                    <div style={{ fontSize:13, fontWeight:800, color:'#86efac', marginTop:2 }}>
                      {fmtBDT(filtered.reduce((s, m) => s + memberTotal(m.id), 0))}
                    </div>
                  </td>
                  {allMonths.map(month => {
                    const vc  = filtered.filter(m => payMap[m.id]?.[month]?.status==='verified').length;
                    const pc  = filtered.filter(m => payMap[m.id]?.[month]?.status==='pending').length;
                    const amt = filtered.reduce((s, m) => {
                      const r = payMap[m.id]?.[month];
                      return r?.status==='verified' ? s+(r.amount||0)-(feeInAcct?0:(r.gatewayFee||0)) : s;
                    }, 0);
                    const isCur = month === curYM;
                    return (
                      <td key={month} style={{
                        padding:'6px 5px', textAlign:'center',
                        borderLeft: isCur ? '2px solid #1d4ed8' : '1px solid #1e293b',
                        background: isCur ? '#1d4ed8' : '#0f172a',
                      }}>
                        {vc>0  && <div style={{ fontSize:10, fontWeight:700, color:'#86efac' }}>{vc}✓</div>}
                        {pc>0  && <div style={{ fontSize:10, color:'#fde68a' }}>{pc}⏳</div>}
                        {amt>0 && <div style={{ fontSize:9, color:'#6ee7b7', marginTop:1 }}>{fmtBDT(amt)}</div>}
                        {vc===0 && pc===0 && <div style={{ fontSize:10, color:'#334155' }}>—</div>}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div style={{ marginTop:8, padding:'10px 14px', borderRadius:8, background:'#fffbeb',
        border:'1px solid #fde68a', fontSize:11, color:'#92400e' }}>
        ℹ️ Payments stored in <code>investments</code> collection (legacy name — rename to <code>installments</code> planned as a future migration task).
      </div>
    </div>
  );
}
