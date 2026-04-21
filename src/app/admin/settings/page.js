'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, onSnapshot, updateDoc, collection, addDoc, setDoc, getDocs, deleteDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const BASE_METHODS = ['bKash','Nagad','Rocket','Bank Transfer','Cash'];

function Toggle({ label, sub, value, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #f1f5f9', gap:12 }}>
      <div>
        <div style={{ fontSize:14, color:'#0f172a', fontWeight:500 }}>{label}</div>
        {sub && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{sub}</div>}
      </div>
      <button type="button" onClick={onChange}
        style={{ width:44, height:24, borderRadius:99, border:'none', cursor:'pointer', background: value ? '#2563eb' : '#e2e8f0', position:'relative', flexShrink:0, marginTop:2 }}>
        <span style={{ position:'absolute', top:2, left: value ? 20 : 2, width:20, height:20, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.15)', transition:'left 0.2s' }} />
      </button>
    </div>
  );
}

function genId() { return Math.random().toString(36).slice(2, 9); }

export default function AdminSettings() {
  const { user, userData, orgData, isOrgAdmin} = useAuth();
  const router = useRouter();
  if (!isOrgAdmin) { typeof window !== 'undefined' && router.replace('/dashboard'); return null; }

  const [tab, setTab]           = useState('rules');
  const [settings, setSettings] = useState({});
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [members, setMembers]   = useState([]);
  const [invites, setInvites]   = useState([]);
  const [inviteDays, setInviteDays] = useState(7);

  // Multi-account state
  const [paymentAccounts, setPaymentAccounts] = useState({});
  const [addingAccount, setAddingAccount]     = useState(null);
  const [newAccLabel, setNewAccLabel]         = useState('');
  const [newAccNumber, setNewAccNumber]       = useState('');
  const [savingAccounts, setSavingAccounts]   = useState(false);

  // Special subscription state
  const [specialSubs, setSpecialSubs]   = useState([]);
  const [subForm, setSubForm]           = useState({
    title: '', description: '', amount: '', deadline: '',
    targetAll: true, targetMembers: [],
    type: 'general',                  // 'general' | 'entry_fee' | 'reregistration_fee'
    countAsContribution: false,       // only relevant for entry_fee type
  });
  const [subSaving, setSubSaving] = useState(false);
  const [subSaved, setSubSaved]   = useState(false);

  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(doc(db, 'organizations', orgId), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setSettings(d.settings || {});
        const pa = d.settings?.paymentAccounts || {};
        const methods = d.settings?.paymentMethods || BASE_METHODS;
        const migrated = { ...pa };
        methods.forEach(m => {
          if (!migrated[m] && d.settings?.accountDetails?.[m]) {
            migrated[m] = [{ id: genId(), label: 'Default', number: d.settings.accountDetails[m], enabled: true }];
          }
          if (!migrated[m]) migrated[m] = [];
        });
        setPaymentAccounts(migrated);
      }
    });
    getDocs(collection(db, 'organizations', orgId, 'members')).then(async snap => {
      const memberDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const withNames = await Promise.all(memberDocs.map(async m => {
        try {
          const uSnap = await getDoc(doc(db, 'users', m.id));
          return uSnap.exists() ? { ...uSnap.data(), ...m } : m;
        } catch { return m; }
      }));
      setMembers(withNames);
    });
    getDocs(query(collection(db, 'invites'), where('orgId', '==', orgId)))
      .then(snap => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubSubs = onSnapshot(
      collection(db, 'organizations', orgId, 'specialSubscriptions'),
      snap => setSpecialSubs(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
      )
    );
    return () => { unsub(); unsubSubs(); };
  }, [orgId]);

  const [logoPreview, setLogoPreview] = useState(null);

  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const canvas = document.createElement('canvas');
    const img    = new Image();
    const reader = new FileReader();
    reader.onload = ev => {
      img.onload = () => {
        const size = 200;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, size, size);
        setLogoPreview(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const saveLogo = async () => {
    if (!logoPreview || !orgId) return;
    try {
      await updateDoc(doc(db, 'organizations', orgId), { logoURL: logoPreview });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
  };

  const set = (k, v) => setSettings(p => ({ ...p, [k]: v }));

  const saveRules = async () => {
    setSaving(true);
    try {
      const updates = {};
      Object.entries(settings).forEach(([k, v]) => {
        if (k !== 'paymentAccounts') updates[`settings.${k}`] = v;
      });
      await updateDoc(doc(db, 'organizations', orgId), updates);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const saveMemberAmount = async (memberId, amount) => {
    try {
      await updateDoc(doc(db, 'organizations', orgId, 'members', memberId), { customAmount: Number(amount) || 0 });
    } catch (e) { console.error(e); }
  };

  const toggleMethod = (method) => {
    const current = settings.paymentMethods || BASE_METHODS;
    const updated  = current.includes(method)
      ? current.filter(m => m !== method)
      : [...current, method];
    set('paymentMethods', updated);
  };

  // Account management
  const saveAccounts = async () => {
    setSavingAccounts(true);
    try {
      await updateDoc(doc(db, 'organizations', orgId), {
        'settings.paymentAccounts': paymentAccounts,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
    setSavingAccounts(false);
  };

  const addAccount = async (method) => {
    if (!newAccNumber.trim()) { alert('Account number is required.'); return; }
    const acc = { id: genId(), label: newAccLabel.trim() || 'Account', number: newAccNumber.trim(), enabled: true };
    const updated = { ...paymentAccounts, [method]: [...(paymentAccounts[method]||[]), acc] };
    setPaymentAccounts(updated);
    setAddingAccount(null);
    setNewAccLabel(''); setNewAccNumber('');
    try {
      await updateDoc(doc(db, 'organizations', orgId), { 'settings.paymentAccounts': updated });
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  const removeAccount = async (method, id) => {
    if (!confirm('Remove this account?')) return;
    const updated = { ...paymentAccounts, [method]: paymentAccounts[method].filter(a => a.id !== id) };
    setPaymentAccounts(updated);
    try {
      await updateDoc(doc(db, 'organizations', orgId), { 'settings.paymentAccounts': updated });
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  // ── Replaced eye/🚫 toggle with Enable/Disable ──────────────────────────────
  const toggleAccountEnabled = async (method, id) => {
    const updated = {
      ...paymentAccounts,
      [method]: paymentAccounts[method].map(a =>
        a.id === id ? { ...a, enabled: a.enabled === false ? true : false } : a
      ),
    };
    setPaymentAccounts(updated);
    try {
      await updateDoc(doc(db, 'organizations', orgId), { 'settings.paymentAccounts': updated });
    } catch (e) { alert('Save failed: ' + e.message); }
  };

  const createInvite = async () => {
    if (!orgId || !orgData) return;
    try {
      const exp = new Date();
      exp.setDate(exp.getDate() + Number(inviteDays));
      const slug    = orgData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      const suffix  = Math.random().toString(36).slice(2, 7);
      const inviteId = `${slug}-${suffix}`;
      const inviteData = {
        orgId, orgName: orgData.name, orgType: orgData.type,
        orgDescription: orgData.description || '',
        orgSettings: { baseAmount: orgData.settings?.baseAmount, dueDate: orgData.settings?.dueDate },
        expiresAt: { seconds: Math.floor(exp.getTime() / 1000) },
        createdAt: serverTimestamp(), createdBy: user.uid, useCount: 0,
      };
      await setDoc(doc(db, 'invites', inviteId), inviteData);
      setInvites(p => [...p, { id: inviteId, ...inviteData }]);
    } catch (e) { alert('Error creating invite: ' + e.message); }
  };

  const delInvite = async (id) => {
    try {
      await deleteDoc(doc(db, 'invites', id));
      setInvites(p => p.filter(i => i.id !== id));
    } catch (e) { alert(e.message); }
  };

  // ── Special subscription create — now includes fee types ─────────────────────
  const createSpecialSub = async (e) => {
    e.preventDefault();
    if (!subForm.title || !subForm.amount || !subForm.deadline) {
      alert('Title, amount, and deadline are required.'); return;
    }
    setSubSaving(true);
    try {
      const targetAll     = subForm.targetAll !== false;
      const targetMembers = subForm.targetMembers || [];
      await addDoc(collection(db, 'organizations', orgId, 'specialSubscriptions'), {
        title:               subForm.title,
        description:         subForm.description,
        amount:              Number(subForm.amount),
        deadline:            subForm.deadline,
        targetAll,
        targetMembers:       targetAll ? [] : targetMembers,
        active:              true,
        // fee-type metadata
        type:                subForm.type || 'general',
        countAsContribution: false,  // entry_fee and reregistration_fee always go to Expenses Fund
        createdAt:           serverTimestamp(),
        createdBy:           user.uid,
      });

      // Notify members
      const mSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
      const toNotify = mSnap.docs.filter(d => {
        if (!d.data().approved) return false;
        return targetAll || targetMembers.includes(d.id);
      });
      const deadline = new Date(subForm.deadline).toLocaleDateString('en-GB');
      const typeLabel = subForm.type === 'entry_fee' ? 'Entry Fee'
                      : subForm.type === 'reregistration_fee' ? 'Re-Registration Fee'
                      : 'Special subscription';
      const msg = `📢 ${typeLabel}: "${subForm.title}" — ৳${Number(subForm.amount).toLocaleString()} due by ${deadline}. ${subForm.description || ''}`.trim();
      await Promise.all(toNotify.map(d =>
        addDoc(collection(db, 'organizations', orgId, 'notifications'), {
          userId: d.id, message: msg, read: false, createdAt: serverTimestamp(),
        })
      ));
      setSubForm({ title:'', description:'', amount:'', deadline:'', targetAll: true, targetMembers:[], type:'general', countAsContribution: false });
      setSubSaved(true); setTimeout(() => setSubSaved(false), 3000);
    } catch (e) { alert(e.message); }
    setSubSaving(false);
  };

  const toggleSpecialSub = async (sub) => {
    try { await updateDoc(doc(db, 'organizations', orgId, 'specialSubscriptions', sub.id), { active: !sub.active }); }
    catch (e) { alert(e.message); }
  };

  const deleteSpecialSub = async (id) => {
    if (!confirm('Delete this special subscription?')) return;
    try { await deleteDoc(doc(db, 'organizations', orgId, 'specialSubscriptions', id)); }
    catch (e) { alert(e.message); }
  };

  const enabledMethods = settings.paymentMethods || BASE_METHODS;

  const unlockedFeatures = orgData?.features    || {};
  const orgFeatures      = orgData?.orgFeatures || {};
  const hasAnyUnlocked   = Object.values(unlockedFeatures).some(Boolean);

  const TABS = [
    ['rules',         'Rules'],
    ['payments',      'Payment Accounts'],
    ['subscriptions', 'Subscriptions'],
    ['special',       'Special Subs'],
    ['invites',       'Invite Links'],
    ['budgets',       '💰 Fund Budgets'],
    ['dashboard',     '📊 Dashboard'],
    ...(hasAnyUnlocked ? [['features', '⚙️ Features']] : []),
  ];

  // ── Sub-type badge helper ────────────────────────────────────────────────────
  const subTypeBadge = (type) => {
    if (type === 'entry_fee')         return { label:'Entry Fee',        color:'#1d4ed8', bg:'#dbeafe' };
    if (type === 'reregistration_fee') return { label:'Re-Reg Fee',      color:'#7c3aed', bg:'#ede9fe' };
    return                                    { label:'General',          color:'#475569', bg:'#f1f5f9' };
  };

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Organization Settings</div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, borderBottom:'2px solid #e2e8f0', marginBottom:24, overflowX:'auto' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding:'10px 18px', background:'none', border:'none', whiteSpace:'nowrap',
              borderBottom: tab===id ? '2px solid #2563eb' : '2px solid transparent',
              fontWeight: tab===id ? 600 : 400, color: tab===id ? '#2563eb' : '#64748b',
              cursor:'pointer', fontSize:14, marginBottom:-2 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Rules ── */}
      {tab === 'rules' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {saved && <div className="alert alert-success">Settings saved.</div>}
          <div className="card">
            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:12 }}>Organization Logo</div>
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ width:72, height:72, borderRadius:14, background:'#eff6ff', border:'2px dashed #bfdbfe', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0 }}>
                {(logoPreview || orgData?.logoURL)
                  ? <img src={logoPreview || orgData?.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
                  : <span style={{ fontSize:28, color:'#93c5fd' }}>🏢</span>}
              </div>
              <div>
                <label className="btn-ghost" style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6, padding:'8px 16px', fontSize:13, marginBottom:8 }}>
                  {(logoPreview || orgData?.logoURL) ? 'Change Logo' : 'Upload Logo'}
                  <input type="file" accept="image/*" onChange={handleLogo} style={{ display:'none' }} />
                </label>
                {logoPreview && (
                  <button onClick={saveLogo} className="btn-primary" style={{ padding:'8px 16px', fontSize:13, marginLeft:8 }}>Save Logo</button>
                )}
                <p style={{ fontSize:11, color:'#94a3b8', margin:0 }}>Square image recommended</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
              {[
                ['baseAmount','Monthly Amount','number'],
                ['dueDate','Due Day (of month)','number'],
                ['penalty','Late Fee Amount','number'],
                ['startDate','Start Date','date'],
              ].map(([k, l, t]) => (
                <div key={k} className="form-group">
                  <label className="form-label">{l}</label>
                  <input type={t} value={settings[k] || ''} onChange={e => set(k, t === 'number' ? Number(e.target.value) : e.target.value)} />
                </div>
              ))}
            </div>
            <Toggle label="Enable Monthly Installments" value={settings.monthlyEnabled !== false} onChange={() => set('monthlyEnabled', settings.monthlyEnabled === false ? true : false)} sub="When OFF, members won't see monthly payment options" />
            <Toggle label="Enable Late Fees"            value={!!settings.lateFeeEnabled}         onChange={() => set('lateFeeEnabled', !settings.lateFeeEnabled)}         sub="Charge penalty for payments after the due date" />
            <Toggle label="Uniform Subscription"        value={!!settings.uniformAmount}           onChange={() => set('uniformAmount', !settings.uniformAmount)}           sub="All members pay the same base amount" />
            <Toggle label="Show Total Fund to Members"  value={settings.showFund !== false}        onChange={() => set('showFund', settings.showFund === false ? true : false)} sub="Members can see the total collected amount" />
            <Toggle label="Auto-assign Member IDs"      value={!!settings.autoMemberId}            onChange={() => set('autoMemberId', !settings.autoMemberId)}            sub="Automatically assign sequential IDs when approving members" />
            {settings.autoMemberId && (
              <div style={{ paddingLeft:16, paddingBottom:12, borderBottom:'1px solid #f1f5f9' }}>
                <label className="form-label">ID Prefix</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input value={settings.memberIdPrefix ?? 'M'}
                    onChange={e => set('memberIdPrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}
                    placeholder="M" maxLength={5} style={{ width:80 }}/>
                  <span style={{ fontSize:13, color:'#64748b' }}>
                    → next ID: <strong>{settings.memberIdPrefix||'M'}-001</strong>
                  </span>
                </div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>
                  Letters and numbers only. E.g. A → A-001, DT → DT-001
                </div>
              </div>
            )}
            <Toggle
              label="New Members Must Pay from Start Date"
              value={!!settings.requireBackpayment}
              onChange={() => set('requireBackpayment', !settings.requireBackpayment)}
              sub="ON: new members must pay all installments from the org start date before their capital is counted. OFF: members start contributing from their join date only."
            />
            <Toggle
              label="Gateway Fees Count as Income"
              value={!!settings.gatewayFeeInAccounting}
              onChange={() => set('gatewayFeeInAccounting', !settings.gatewayFeeInAccounting)}
              sub="When ON, gateway fees collected from members are included in total org balance. When OFF, they are excluded."
            />

            {/* ── Late Payer & Re-registration Threshold ── */}
            <div style={{ borderTop:'1px solid #e2e8f0', paddingTop:18, marginTop:4 }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#0f172a', marginBottom:4 }}>
                ⏱ Late Payment Rules
              </div>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
                Define when a member is flagged as a <em>late payer</em> and when they are
                automatically assigned a re-registration fee.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
                <div className="form-group">
                  <label className="form-label">
                    Mark as Late Payer After (months)
                    <span style={{ fontWeight:400, fontSize:10, color:'#94a3b8', marginLeft:4 }}>
                      0 = same month overdue
                    </span>
                  </label>
                  <input type="number" min="0" max="24"
                    value={settings.latePayerAfterMonths ?? ''}
                    onChange={e => set('latePayerAfterMonths', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 1"
                  />
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                    Member is flagged if they miss more than this many consecutive months
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Auto-assign Re-registration After (months unpaid)
                  </label>
                  <input type="number" min="0" max="36"
                    value={settings.reregAfterMonths ?? ''}
                    onChange={e => set('reregAfterMonths', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="e.g. 3"
                  />
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                    Re-registration fee is auto-assigned when unpaid months reach this threshold
                  </div>
                </div>
              </div>
              <Toggle
                label="Enable Late Payer Auto-flag"
                value={!!settings.latePayerEnabled}
                onChange={() => set('latePayerEnabled', !settings.latePayerEnabled)}
                sub="Automatically mark members as late payers based on the threshold above"
              />
              <Toggle
                label="Enable Re-registration Auto-assign"
                value={!!settings.reregAutoAssign}
                onChange={() => set('reregAutoAssign', !settings.reregAutoAssign)}
                sub="Automatically assign re-registration fee subscription when unpaid months threshold is reached"
              />
            </div>

            <button onClick={saveRules} disabled={saving} className="btn-primary" style={{ marginTop:20, padding:'10px 28px' }}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Payment Accounts ── */}
      {tab === 'payments' && (
        <div style={{ display:'grid', gap:16 }}>
          {saved && <div className="alert alert-success">Saved.</div>}
          <div className="card">
            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Payment Methods & Accounts</div>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
              Enable methods, add multiple accounts per method, and configure gateway fees.
              Use the <strong>Enable / Disable</strong> toggle on each account to control whether members see it on the payment page.
            </p>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {BASE_METHODS.map(m => {
                const enabled    = enabledMethods.includes(m);
                const accounts   = paymentAccounts[m] || [];
                const feeEnabled = settings.gatewayFees?.[m]?.enabled ?? false;
                const feeRate    = settings.gatewayFees?.[m]?.rate ?? '';
                const setFee     = (field, val) => set('gatewayFees', {
                  ...(settings.gatewayFees||{}),
                  [m]: { ...(settings.gatewayFees?.[m]||{}), [field]: val }
                });

                return (
                  <div key={m} style={{ border:`1.5px solid ${enabled?'#bfdbfe':'#e2e8f0'}`, borderRadius:10, overflow:'hidden', background: enabled?'#f8faff':'#fafafa' }}>
                    <label style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer', borderBottom: enabled?'1px solid #e2e8f0':'none' }}>
                      <input type="checkbox" checked={enabled} onChange={() => { toggleMethod(m); setSettings(p => p); }} style={{ width:16, height:16, accentColor:'#2563eb', flexShrink:0 }} />
                      <span style={{ fontWeight:600, fontSize:14, color: enabled?'#1d4ed8':'#475569', flex:1 }}>{m}</span>
                      {enabled && (
                        <span className="badge badge-green" style={{ fontSize:10 }}>
                          {accounts.filter(a => a.enabled !== false).length}/{accounts.length} enabled
                        </span>
                      )}
                    </label>

                    {enabled && (
                      <div style={{ padding:'14px 16px', display:'grid', gap:12 }}>
                        {/* Accounts list */}
                        {m !== 'Cash' && (
                          <div>
                            <div style={{ fontSize:12, fontWeight:700, color:'#64748b', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>Accounts</div>
                            {accounts.length === 0 && (
                              <div style={{ fontSize:12, color:'#94a3b8', padding:'8px 0' }}>No accounts added yet. Add one below.</div>
                            )}
                            {accounts.map(acc => {
                              const isEnabled = acc.enabled !== false;
                              return (
                                <div key={acc.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'#fff', border:`1px solid ${isEnabled ? '#e2e8f0' : '#f1f5f9'}`, borderRadius:8, marginBottom:6, opacity: isEnabled ? 1 : 0.55 }}>
                                  <div style={{ flex:1 }}>
                                    <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{acc.label}</div>
                                    <div style={{ fontSize:12, color:'#475569', fontFamily:'monospace' }}>{acc.number}</div>
                                  </div>
                                  {/* Inline toggle switch — same style as gateway fee enable */}
                                  <button
                                    type="button"
                                    onClick={() => toggleAccountEnabled(m, acc.id)}
                                    title={isEnabled ? 'Click to disable' : 'Click to enable'}
                                    style={{ width:40, height:22, borderRadius:99, border:'none', cursor:'pointer', position:'relative', flexShrink:0,
                                      background: isEnabled ? '#2563eb' : '#e2e8f0', transition:'background 0.2s' }}>
                                    <span style={{ position:'absolute', top:2, left: isEnabled ? 18 : 2, width:18, height:18,
                                      borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                                      transition:'left 0.2s' }} />
                                  </button>
                                  <button onClick={() => removeAccount(m, acc.id)}
                                    style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:16, padding:'2px 6px' }}>×</button>
                                </div>
                              );
                            })}

                            {/* Add account form */}
                            {addingAccount === m ? (
                              <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'12px', marginTop:6 }}>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                                  <div>
                                    <label className="form-label">Label</label>
                                    <input value={newAccLabel} onChange={e => setNewAccLabel(e.target.value)} placeholder="e.g. Main Account" />
                                  </div>
                                  <div>
                                    <label className="form-label">Account Number *</label>
                                    <input value={newAccNumber} onChange={e => setNewAccNumber(e.target.value)}
                                      placeholder={m === 'Bank Transfer' ? 'Bank, account no, routing…' : `${m} number`} />
                                  </div>
                                </div>
                                <div style={{ display:'flex', gap:8 }}>
                                  <button onClick={() => addAccount(m)} className="btn-primary" style={{ padding:'8px 16px', fontSize:13 }}>Add</button>
                                  <button onClick={() => { setAddingAccount(null); setNewAccLabel(''); setNewAccNumber(''); }} className="btn-ghost" style={{ padding:'8px 14px', fontSize:13 }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => { setAddingAccount(m); setNewAccLabel(''); setNewAccNumber(''); }}
                                style={{ fontSize:12, color:'#2563eb', background:'none', border:'1px dashed #bfdbfe', borderRadius:7, padding:'6px 14px', cursor:'pointer', marginTop:4, fontWeight:600 }}>
                                + Add Account
                              </button>
                            )}
                          </div>
                        )}

                        {/* Gateway Fee */}
                        {m !== 'Cash' && (
                          <div style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: feeEnabled ? 12 : 0 }}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>Gateway Fee</div>
                                <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>Automatically add fee to member payments</div>
                              </div>
                              <button type="button" onClick={() => setFee('enabled', !feeEnabled)}
                                style={{ width:40, height:22, borderRadius:99, border:'none', cursor:'pointer', background: feeEnabled ? '#2563eb' : '#e2e8f0', position:'relative', flexShrink:0 }}>
                                <span style={{ position:'absolute', top:2, left: feeEnabled ? 18 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 2px rgba(0,0,0,0.15)', transition:'left 0.18s' }} />
                              </button>
                            </div>
                            {feeEnabled && (
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <input type="number" min="0" max="100" step="0.01" value={feeRate}
                                  onChange={e => setFee('rate', e.target.value)} placeholder="e.g. 1.85" style={{ flex:1 }} />
                                <span style={{ fontSize:13, color:'#64748b', whiteSpace:'nowrap' }}>% of total</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display:'flex', gap:10, marginTop:20, flexWrap:'wrap' }}>
              <button onClick={async () => { setSaving(true); await saveRules(); setSaving(false); }} disabled={saving} className="btn-primary" style={{ padding:'10px 28px' }}>
                {saving ? 'Saving…' : 'Save Methods & Fees'}
              </button>
              <button onClick={saveAccounts} disabled={savingAccounts} className="btn-ghost" style={{ padding:'10px 24px' }}>
                {savingAccounts ? 'Saving…' : 'Save Accounts'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Subscriptions ── */}
      {tab === 'subscriptions' && (
        <div className="card">
          <div className="alert alert-info" style={{ fontSize:13, marginBottom:16 }}>
            {settings.uniformAmount
              ? 'Uniform mode is ON — all members use the base amount. Turn it off in Rules to enable custom amounts.'
              : 'Custom amounts per member are active. Edit inline and click away to save.'}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {members.filter(m => m.approved).map(m => (
              <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:500, fontSize:13, color:'#0f172a' }}>{m.nameEnglish || m.id.slice(0,10)}</div>
                  <div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo || 'No ID'}</div>
                </div>
                <div style={{ fontSize:12, color:'#64748b' }}>Custom amount:</div>
                <input type="number" disabled={!!settings.uniformAmount}
                  defaultValue={m.customAmount ?? settings.baseAmount ?? 0}
                  onBlur={e => !settings.uniformAmount && saveMemberAmount(m.id, e.target.value)}
                  style={{ width:110, textAlign:'right', opacity: settings.uniformAmount ? 0.5 : 1 }} />
              </div>
            ))}
            {members.filter(m => m.approved).length === 0 && (
              <p style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:24 }}>No approved members yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Special Subscriptions ── */}
      {tab === 'special' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {subSaved && <div className="alert alert-success">Special subscription created and members notified!</div>}

          <div className="card">
            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Create Special Subscription</div>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
              Create one-time fundraising goals, or use this for Entry Fee and Re-Registration Fee collection.
              Entry fees can optionally count as member capital contributions.
            </p>

            <form onSubmit={createSpecialSub}>

              {/* ── Type selector ── */}
              <div className="form-group">
                <label className="form-label">Subscription Type</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {[
                    ['general',           '📋 General',         'One-time fundraising or collection'],
                    ['entry_fee',         '🎫 Entry Fee',        'One-time joining fee for new members'],
                    ['reregistration_fee','🔄 Re-Registration',  'Re-registration fee (always to Expenses Fund)'],
                  ].map(([val, label, hint]) => (
                    <button type="button" key={val}
                      onClick={() => setSubForm(p => ({ ...p, type: val, countAsContribution: false }))}
                      style={{ padding:'8px 14px', borderRadius:8, border:`1.5px solid ${subForm.type === val ? '#2563eb' : '#e2e8f0'}`,
                        cursor:'pointer', fontSize:12, fontWeight: subForm.type === val ? 700 : 400,
                        background: subForm.type === val ? '#eff6ff' : '#fff',
                        color:      subForm.type === val ? '#1d4ed8' : '#475569',
                        textAlign:'left' }}>
                      <div>{label}</div>
                      <div style={{ fontSize:10, color:'#94a3b8', fontWeight:400, marginTop:2 }}>{hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Entry fee — always expenses fund (no toggle) */}
              {subForm.type === 'entry_fee' && (
                <div style={{ background:'#fffbeb', borderRadius:8, padding:'12px 14px', border:'1px solid #fde68a', marginBottom:16 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#92400e', marginBottom:4 }}>
                    🎫 Entry Fee — Expenses Fund
                  </div>
                  <div style={{ fontSize:12, color:'#78350f', lineHeight:1.5 }}>
                    Entry fees are <strong>non-refundable</strong> and always directed to the <strong>Expenses Fund</strong>.
                    They do not count as capital contributions and won't appear in members' capital balances.
                    Payments made via the installment page will automatically appear in
                    <a href="/admin/entry-fees" style={{ color:'#2563eb', marginLeft:4 }}>Entry Fees →</a>
                  </div>
                </div>
              )}

              {/* Re-registration fee — always expenses notice */}
              {subForm.type === 'reregistration_fee' && (
                <div style={{ background:'#fef3c7', borderRadius:8, padding:'12px 14px', border:'1px solid #fde68a', marginBottom:16 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#92400e', marginBottom:4 }}>Re-Registration Fee</div>
                  <div style={{ fontSize:12, color:'#92400e' }}>
                    Non-refundable and never counts as a capital contribution — always directed to the Expenses Fund.
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Title / Purpose *</label>
                <input value={subForm.title}
                  onChange={e => setSubForm(p=>({...p, title:e.target.value}))}
                  placeholder={
                    subForm.type === 'entry_fee'          ? 'e.g. New Member Entry Fee' :
                    subForm.type === 'reregistration_fee' ? 'e.g. Annual Re-Registration 2025' :
                    'e.g. Eid Celebration Fund'
                  } required />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea rows={2} value={subForm.description}
                  onChange={e => setSubForm(p=>({...p, description:e.target.value}))}
                  placeholder="Explain what this is for…" style={{ resize:'vertical' }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
                <div className="form-group">
                  <label className="form-label">Amount (৳) *</label>
                  <input type="number" min="1" value={subForm.amount}
                    onChange={e => setSubForm(p=>({...p, amount:e.target.value}))}
                    placeholder="0" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Deadline *</label>
                  <input type="date" value={subForm.deadline}
                    onChange={e => setSubForm(p=>({...p, deadline:e.target.value}))} required />
                </div>
              </div>

              {/* Target */}
              <div className="form-group">
                <label className="form-label">Target</label>
                <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                  {[['true','All Members'],['false','Specific Members']].map(([v,l])=>(
                    <button type="button" key={v}
                      onClick={()=>setSubForm(p=>({...p, targetAll:v==='true', targetMembers:[]}))}
                      style={{ padding:'7px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13,
                        fontWeight:String(subForm.targetAll)===v?700:400,
                        background:String(subForm.targetAll)===v?'#0f172a':'#f1f5f9',
                        color:String(subForm.targetAll)===v?'#fff':'#475569' }}>
                      {l}
                    </button>
                  ))}
                </div>
                {!subForm.targetAll && (
                  <div style={{ border:'1px solid #e2e8f0', borderRadius:8, maxHeight:200, overflowY:'auto', padding:8 }}>
                    {members.filter(m=>m.approved).length === 0
                      ? <div style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:12 }}>No approved members</div>
                      : members.filter(m=>m.approved).map(m=>(
                        <label key={m.id} style={{ display:'flex', alignItems:'center', gap:8,
                          padding:'6px 8px', borderRadius:6, cursor:'pointer',
                          background:(subForm.targetMembers||[]).includes(m.id)?'#eff6ff':'transparent' }}>
                          <input type="checkbox"
                            checked={(subForm.targetMembers||[]).includes(m.id)}
                            onChange={e=>setSubForm(p=>({...p,
                              targetMembers: e.target.checked
                                ? [...(p.targetMembers||[]),m.id]
                                : (p.targetMembers||[]).filter(id=>id!==m.id)
                            }))}/>
                          <span style={{ fontSize:13, color:'#0f172a' }}>
                            {m.nameEnglish||m.id.slice(0,12)}
                          </span>
                          {m.idNo && <span style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo}</span>}
                        </label>
                      ))}
                  </div>
                )}
              </div>

              <button type="submit" disabled={subSaving} className="btn-primary" style={{ padding:'10px 28px' }}>
                {subSaving ? 'Creating…' : 'Create & Notify Members'}
              </button>
            </form>
          </div>

          {/* List */}
          {specialSubs.length > 0 && (
            <div className="card">
              <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:12 }}>All Special Subscriptions</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {specialSubs.map(sub => {
                  const deadline = sub.deadline ? new Date(sub.deadline) : null;
                  const expired  = deadline && deadline < new Date();
                  const badge    = subTypeBadge(sub.type);
                  return (
                    <div key={sub.id} style={{ padding:'14px 16px', border:`1.5px solid ${sub.active?'#bfdbfe':'#e2e8f0'}`, borderRadius:10, background: sub.active?'#f8faff':'#fafafa' }}>
                      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:4, flexWrap:'wrap' }}>
                            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a' }}>{sub.title}</div>
                            <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:badge.bg, color:badge.color }}>
                              {badge.label}
                            </span>
                            {sub.type === 'entry_fee' && (
                              <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:'#92400e' }}>
                                → Expenses Fund
                              </span>
                            )}
                            {sub.type === 'reregistration_fee' && (
                              <span style={{ fontSize:10, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:'#92400e' }}>
                                → Expenses Fund
                              </span>
                            )}
                          </div>
                          {sub.description && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{sub.description}</div>}
                          <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                            <span className="badge badge-blue">৳{sub.amount?.toLocaleString()}</span>
                            <span className={`badge ${expired?'badge-red':'badge-yellow'}`}>Due: {sub.deadline}</span>
                            <span className={`badge ${sub.active?'badge-green':'badge-gray'}`}>{sub.active?'Active':'Inactive'}</span>
                            {!sub.targetAll && <span className="badge badge-gray">{(sub.targetMembers||[]).length} members</span>}
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                          {(sub.type === 'entry_fee' || sub.type === 'reregistration_fee') && (
                            <a href="/admin/entry-fees"
                              style={{ padding:'5px 12px', fontSize:12, fontWeight:600, borderRadius:6, cursor:'pointer',
                                background:'#eff6ff', color:'#1d4ed8', textDecoration:'none',
                                border:'none', display:'inline-block' }}>
                              View Fees →
                            </a>
                          )}
                          <button onClick={() => toggleSpecialSub(sub)}
                            style={{ padding:'5px 12px', fontSize:12, fontWeight:600, border:'none', borderRadius:6, cursor:'pointer', background: sub.active ? '#fffbeb' : '#dcfce7', color: sub.active ? '#b45309' : '#15803d' }}>
                            {sub.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={() => deleteSpecialSub(sub.id)}
                            style={{ padding:'5px 10px', fontSize:12, fontWeight:600, border:'none', borderRadius:6, cursor:'pointer', background:'#fee2e2', color:'#b91c1c' }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Invite Links ── */}
      {tab === 'invites' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div className="card">
            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:12 }}>Create Invite Link</div>
            <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <label className="form-label">Expires in</label>
                <select value={inviteDays} onChange={e => setInviteDays(e.target.value)}>
                  {[1,3,7,14,30].map(d => <option key={d} value={d}>{d} day{d>1?'s':''}</option>)}
                </select>
              </div>
              <button onClick={createInvite} className="btn-primary" style={{ padding:'10px 20px', whiteSpace:'nowrap' }}>Generate Link</button>
            </div>
          </div>
          {invites.length === 0 ? (
            <div style={{ textAlign:'center', color:'#94a3b8', padding:24, fontSize:13 }}>No invite links yet</div>
          ) : (
            <div className="card">
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {invites.map(inv => {
                  const exp  = inv.expiresAt?.seconds ? new Date(inv.expiresAt.seconds*1000) : null;
                  const dead = exp && exp < new Date();
                  return (
                    <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'#f8fafc', borderRadius:8, flexWrap:'wrap' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontFamily:'monospace', color:'#0f172a', wordBreak:'break-all' }}>
                          {typeof window!=='undefined' ? `${window.location.origin}/join/${inv.id}` : `/join/${inv.id}`}
                        </div>
                        <div style={{ fontSize:11, color: dead?'#dc2626':'#64748b', marginTop:2 }}>
                          {dead ? 'Expired' : `Expires ${exp?.toLocaleDateString('en-GB')}`} · Used {inv.useCount||0}×
                        </div>
                      </div>
                      <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/join/${inv.id}`)}
                        style={{ padding:'5px 12px', fontSize:12, fontWeight:600, border:'1px solid #e2e8f0', borderRadius:6, background:'#fff', cursor:'pointer', color:'#475569', whiteSpace:'nowrap' }}>
                        Copy
                      </button>
                      <button onClick={() => delInvite(inv.id)}
                        style={{ padding:'5px 10px', fontSize:12, fontWeight:600, border:'none', borderRadius:6, cursor:'pointer', background:'#fee2e2', color:'#b91c1c' }}>
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Fund Budgets ── */}
      {tab === 'budgets' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {saved && <div className="alert alert-success">Saved.</div>}
          <div className="card">
            <div style={{ fontWeight:700, fontSize:15, color:'#0f172a', marginBottom:4 }}>Fund Budget Allocations</div>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:20 }}>
              Set how much of the total capital is allocated to each fund. These are used to show progress bars on member dashboards.
            </p>
            {(() => {
              const fb    = settings.fundBudgets || {};
              const setFb = (key, field, val) => set('fundBudgets', { ...fb, [key]: { ...(fb[key]||{}), [field]: val } });
              const FUNDS = [
                { key:'investment', label:'Investment Fund', icon:'📈', color:'#2563eb', bg:'#eff6ff',
                  desc:'Capital deployed into investment projects.' },
                { key:'reserve',    label:'Reserve Fund',    icon:'🛡',  color:'#16a34a', bg:'#f0fdf4',
                  desc:'Emergency buffer. Can also be used to fund conservative investments.' },
                { key:'benevolent', label:'Benevolent Fund', icon:'🤝', color:'#7c3aed', bg:'#faf5ff',
                  desc:'Welfare, charity, and interest-free loan disbursements.' },
                { key:'expenses',   label:'Expenses Fund',   icon:'🧾', color:'#d97706', bg:'#fffbeb',
                  desc:'Operational expenses — admin, meetings, platform fees, etc.' },
              ];

              return (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {FUNDS.map(fund => {
                    const f = fb[fund.key] || { type:'pct', value:'' };
                    return (
                      <div key={fund.key} style={{ padding:'14px 16px', borderRadius:10,
                        border:`1.5px solid ${fund.color}33`, background:fund.bg }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                          <span style={{ fontSize:20 }}>{fund.icon}</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:13, color:'#0f172a' }}>{fund.label}</div>
                            <div style={{ fontSize:11, color:'#64748b' }}>{fund.desc}</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                          <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0', flexShrink:0 }}>
                            {[['pct','% of Capital'],['amount','Fixed ৳']].map(([type, tlabel]) => (
                              <button key={type} onClick={() => setFb(fund.key,'type',type)}
                                style={{ padding:'6px 12px', fontSize:12, fontWeight:f.type===type?700:400,
                                  border:'none', cursor:'pointer',
                                  background:f.type===type?fund.color:'#fff',
                                  color:f.type===type?'#fff':'#64748b', transition:'all 0.15s' }}>
                                {tlabel}
                              </button>
                            ))}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            {f.type === 'amount' && <span style={{ fontSize:13, color:'#64748b' }}>৳</span>}
                            <input type="number" min="0" max={f.type==='pct'?100:undefined}
                              value={f.value ?? ''}
                              onChange={e => setFb(fund.key,'value',e.target.value)}
                              placeholder={f.type==='pct'?'e.g. 30':'e.g. 50000'}
                              style={{ width:120 }} />
                            {f.type === 'pct' && <span style={{ fontSize:13, color:'#64748b' }}>%</span>}
                          </div>
                          {f.value && (
                            <span style={{ fontSize:12, color:fund.color, fontWeight:600 }}>
                              {f.type==='pct' ? `= ${f.value}% of total capital` : `Fixed ৳${Number(f.value).toLocaleString()}`}
                            </span>
                          )}
                        </div>
                        {f.type === 'pct' && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:4 }}>
                            <span style={{ fontSize:12, color:'#64748b', flexShrink:0 }}>Maximum cap (৳):</span>
                            <input type="number" min="0"
                              value={f.maxAmount ?? ''}
                              onChange={e => setFb(fund.key,'maxAmount',e.target.value)}
                              placeholder="Leave blank for no cap"
                              style={{ width:160, fontSize:12 }} />
                            {f.maxAmount && Number(f.maxAmount) > 0 && (
                              <span style={{ fontSize:11, color:'#64748b' }}>
                                → allocation = min({f.value||0}% × capital, ৳{Number(f.maxAmount).toLocaleString()})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <button onClick={saveRules} disabled={saving} className="btn-primary" style={{ marginTop:20, padding:'10px 28px' }}>
              {saving ? 'Saving…' : 'Save Fund Budgets'}
            </button>
          </div>
        </div>
      )}

      {/* ── Dashboard Display Settings ── */}
      {tab === 'dashboard' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {saved && <div className="alert alert-success">Saved.</div>}
          <div className="card">
            <div style={{ fontWeight:700, fontSize:15, color:'#0f172a', marginBottom:4 }}>Dashboard Cards</div>
            <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
              Choose which cards and information are shown to members on their dashboard.
            </div>
            <Toggle
              label="Show Total Fund Balance"
              sub="Members see the total capital collected by the organisation."
              value={settings.showFund !== false}
              onChange={() => set('showFund', settings.showFund === false ? true : false)}
            />
            <Toggle
              label="Show My Capital Card"
              sub="Members see their individual capital balance prominently on the dashboard."
              value={settings.showMyCapital !== false}
              onChange={() => set('showMyCapital', settings.showMyCapital === false ? true : false)}
            />
            <Toggle
              label="Show Fund Breakdown Bars"
              sub="Members see Investment/Reserve/Benevolent/Expenses fund progress bars (requires Fund Budgets to be configured)."
              value={!!settings.showFundBreakdown}
              onChange={() => set('showFundBreakdown', !settings.showFundBreakdown)}
            />
            <Toggle
              label="Show Latest Distribution Card"
              sub="Members see the most recent profit distribution results on their dashboard."
              value={settings.showLatestDistribution !== false}
              onChange={() => set('showLatestDistribution', settings.showLatestDistribution === false ? true : false)}
            />
            <Toggle
              label="Show Notifications Card"
              sub="A card showing the latest admin notifications appears on the dashboard."
              value={settings.showNotificationsCard !== false}
              onChange={() => set('showNotificationsCard', settings.showNotificationsCard === false ? true : false)}
            />
            <Toggle
              label="Show Recent Payments"
              sub="Members see their last 5 payment entries on the dashboard."
              value={settings.showRecentPayments !== false}
              onChange={() => set('showRecentPayments', settings.showRecentPayments === false ? true : false)}
            />
            <Toggle
              label="Show Pending Payments Warning"
              sub="Members see a warning card if they have unverified payment submissions."
              value={settings.showPendingWarning !== false}
              onChange={() => set('showPendingWarning', settings.showPendingWarning === false ? true : false)}
            />
          </div>

          <div className="card">
            <div style={{ fontWeight:700, fontSize:15, color:'#0f172a', marginBottom:4 }}>Org Info Card</div>
            <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
              Optional fields shown at the top of the member dashboard.
            </div>
            <Toggle
              label="Show Organisation Slogan"
              sub="Display the slogan line under the org name."
              value={!!settings.showSlogan}
              onChange={() => set('showSlogan', !settings.showSlogan)}
            />
            <div style={{ padding:'12px 0', borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ fontSize:14, color:'#0f172a', fontWeight:500, marginBottom:4 }}>Slogan / Tagline</div>
              <input value={settings.slogan || ''} onChange={e => set('slogan', e.target.value)} placeholder="e.g. Saving together, growing together" />
            </div>
            <div style={{ padding:'12px 0', borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ fontSize:14, color:'#0f172a', fontWeight:500, marginBottom:4 }}>Organisation Website</div>
              <input value={settings.website || ''} onChange={e => set('website', e.target.value)} placeholder="https://…" />
            </div>
            <div style={{ padding:'12px 0', borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ fontSize:14, color:'#0f172a', fontWeight:500, marginBottom:4 }}>Contact Phone</div>
              <input value={settings.contactPhone || ''} onChange={e => set('contactPhone', e.target.value)} placeholder="+880…" />
            </div>
            <div style={{ padding:'12px 0' }}>
              <div style={{ fontSize:14, color:'#0f172a', fontWeight:500, marginBottom:4 }}>Contact Email</div>
              <input value={settings.contactEmail || ''} onChange={e => set('contactEmail', e.target.value)} placeholder="info@…" />
            </div>
          </div>

          <button onClick={saveRules} disabled={saving} className="btn-primary" style={{ padding:'10px 28px', alignSelf:'flex-start' }}>
            {saving ? 'Saving…' : 'Save Dashboard Settings'}
          </button>
        </div>
      )}

      {/* ── Features ── */}
      {tab === 'features' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div className="card">
            <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Feature Management</div>
            <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
              Activate or deactivate features unlocked for your organisation.
              Deactivating hides the feature from members but does not delete any data.
            </p>

            {[
              { group:'Core', items:[
                { key:'cashierRole',        label:'Cashier Role',           icon:'💳', desc:'Cashiers can verify payments and transfer funds to admin.' },
                { key:'memberDirectory',    label:'Member Directory',       icon:'👥', desc:'Members can view the organisation directory.' },
                { key:'committeeRoles',     label:'Committee Roles',        icon:'🎖️',  desc:'Display committee roles on member profiles.' },
                { key:'fileLibrary',        label:'File Library',           icon:'📁', desc:'Upload and share files with members.' },
                { key:'advancedReports',    label:'Advanced Reports',       icon:'📈', desc:'Detailed financial reports with charts and breakdowns.' },
                { key:'charityTracking',    label:'Charity Tracking',       icon:'❤️',  desc:'Track donations to charity or external causes.' },
              ]},
              { group:'Member Management', items:[
                { key:'nomineeTracking',    label:'Nominee / Beneficiary',  icon:'👨‍👩‍👧', desc:'Members record a nominated heir for their capital balance.' },
                { key:'entryFeeTracking',   label:'Entry Fee Tracking',     icon:'🎫', desc:'Track entry and re-registration fees via Special Subscriptions.' },
              ]},
              { group:'Finance', items:[
                { key:'capitalLedger',      label:'Capital Ledger',         icon:'💰', desc:'Per-member capital balance from all verified payments.' },
                { key:'fundStructure',      label:'Fund Structure',         icon:'🏦', desc:'Split capital and profit across Investment, Reserve, Welfare, Operations.' },
                { key:'investmentPortfolio',label:'Investment Portfolio',   icon:'💹', desc:'Track investment projects with type, ROI, and status.' },
                { key:'profitDistribution', label:'Profit Distribution',    icon:'📊', desc:'Declare and distribute annual profit proportional to capital.' },
                { key:'qardHasana',         label:'Interest-Free Loans',    icon:'🤝', desc:'Loan applications, approvals, and repayment tracking.' },
                { key:'assetRegistry',      label:'Asset Registry',         icon:'🏗️',  desc:'Track org assets with valuations and insurance.' },
              ]},
              { group:'Reports', items:[
                { key:'quarterlyReports',   label:'Quarterly Reports',      icon:'📆', desc:'Quarterly financial summaries for all members.' },
              ]},
            ].map(({ group, items }) => {
              const available = items.filter(f => unlockedFeatures[f.key]);
              if (available.length === 0) return null;
              return (
                <div key={group} style={{ marginBottom:24 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>
                    {group}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
                    {available.map(({ key, label, icon, desc }) => {
                      const active = orgFeatures[key] || false;
                      return (
                        <div key={key} style={{ background: active ? '#f0fdf4' : '#fafafa',
                          border:`1.5px solid ${active ? '#86efac' : '#e2e8f0'}`,
                          borderRadius:12, padding:16, transition:'all 0.2s' }}>
                          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
                            <div style={{ display:'flex', gap:10, flex:1 }}>
                              <span style={{ fontSize:20, flexShrink:0, marginTop:1 }}>{icon}</span>
                              <div>
                                <div style={{ fontWeight:600, fontSize:13, color:'#0f172a', marginBottom:3 }}>{label}</div>
                                <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5 }}>{desc}</div>
                              </div>
                            </div>
                            <button type="button"
                              onClick={async () => {
                                try {
                                  await updateDoc(doc(db, 'organizations', orgId), { [`orgFeatures.${key}`]: !active });
                                } catch(e) { alert(e.message); }
                              }}
                              style={{ width:44, height:24, borderRadius:99, border:'none', flexShrink:0,
                                cursor:'pointer', background: active ? '#2563eb' : '#e2e8f0',
                                position:'relative', transition:'background 0.2s', marginTop:2 }}>
                              <span style={{ position:'absolute', top:2, left: active ? 20 : 2, width:20, height:20,
                                borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.15)', transition:'left 0.2s' }} />
                            </button>
                          </div>
                          <div style={{ marginTop:10, paddingTop:8, borderTop:'1px solid #e5e7eb', display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ width:6, height:6, borderRadius:'50%', display:'inline-block',
                              background: active ? '#16a34a' : '#cbd5e1' }} />
                            <span style={{ fontSize:11, fontWeight:600, color: active ? '#15803d' : '#94a3b8' }}>
                              {active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}