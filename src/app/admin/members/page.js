// src/app/admin/members/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, updateDoc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

const getInitials = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const COMMITTEE_PRESETS = ['President','Vice President','Secretary','Joint Secretary','Treasurer','Assistant Treasurer','Organizer','Advisor','Member'];

function Avatar({ m, size = 36 }) {
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:size*0.35, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
      {m.photoURL ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : getInitials(m.nameEnglish)}
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, fontSize:13, padding:'8px 0', borderBottom:'1px solid #f1f5f9' }}>
      <span style={{ color:'#64748b', flexShrink:0 }}>{label}</span>
      <span style={{ fontWeight:500, color:'#0f172a', textAlign:'right', wordBreak:'break-word' }}>{value}</span>
    </div>
  );
}

function MemberModal({ member, onClose, onToggleApproval, onSaveId, onSaveCashier, onSaveCommittee, onSaveRole, settings, nextId, saving, orgData, members }) {
  const [idEdit,          setIdEdit]          = useState(member.idNo || '');
  const [committeeEdit,   setCommitteeEdit]   = useState(member.committeeRole || '');
  // cashierAccountIds: array of specific account IDs (e.g. ["bkash_uuid1", "nagad_uuid2"])
  const [cashierAccountIds, setCashierAccountIds] = useState(member.cashierAccountIds || []);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    setIdEdit(member.idNo || '');
    setCommitteeEdit(member.committeeRole || '');
    setCashierAccountIds(member.cashierAccountIds || []);
  }, [member.idNo, member.committeeRole, JSON.stringify(member.cashierAccountIds)]);

  const features        = orgData?.features || {};
  const limits          = orgData?.limits   || {};
  const enabledMethods  = settings.paymentMethods  || ['bKash','Nagad','Rocket','Bank Transfer','Cash'];
  const paymentAccounts = settings.paymentAccounts || {};

  // Build a flat list of every individual account across all enabled methods
  const allAccounts = [];
  enabledMethods.forEach(method => {
    const accs = paymentAccounts[method] || [];
    if (method === 'Cash') {
      allAccounts.push({ id: 'cash-default', method: 'Cash', label: 'Cash (physical)', number: '' });
    } else if (accs.length === 0) {
      allAccounts.push({ id: `${method}-default`, method, label: 'Default', number: '(no account configured)' });
    } else {
      accs.forEach(a => allAccounts.push({ id: a.id, method, label: a.label, number: a.number }));
    }
  });

  const currentCashierCount = members.filter(m => m.role === 'cashier' && m.id !== member.id).length;
  const maxCashiers = limits.maxCashiers;
  const roleBadge = r =>
    r === 'admin'              ? 'badge-blue'   :
    r === 'cashier'            ? 'badge-yellow' :
    r === 'office_secretary'   ? 'badge-blue'   :
    r === 'joint_secretary'    ? 'badge-blue'   : 'badge-gray';
  const roleLabel = r =>
    r === 'office_secretary' ? 'Office Secretary' :
    r === 'joint_secretary'  ? 'Joint Secretary'  :
    r ? r.charAt(0).toUpperCase()+r.slice(1) : 'Member';

  const tabs = [
    { id:'profile',    label:'Profile'    },
    ...(features.cashierRole    ? [{ id:'cashier',    label:'Cashier'    }] : []),
    ...(features.committeeRoles ? [{ id:'committee',  label:'Committee'  }] : []),
    { id:'secretary', label:'Secretary' },
  ];

  const toggleAccId = id => setCashierAccountIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  // Group accounts by method for display
  const accountsByMethod = enabledMethods.reduce((acc, m) => {
    acc[m] = allAccounts.filter(a => a.method === m);
    return acc;
  }, {});

  return (
    <Modal title="Member Profile" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', marginBottom:16 }}>
        <Avatar m={member} size={64} />
        <div style={{ marginTop:10, fontWeight:700, fontSize:17, color:'#0f172a' }}>{member.nameEnglish || '(no name)'}</div>
        {member.nameBengali && <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{member.nameBengali}</div>}
        <div style={{ display:'flex', gap:6, justifyContent:'center', marginTop:10, flexWrap:'wrap' }}>
          <span className={`badge ${member.approved ? 'badge-green' : 'badge-yellow'}`}>{member.approved ? 'Approved' : 'Pending'}</span>
          <span className={`badge ${roleBadge(member.role)}`}>{roleLabel(member.role)}</span>
          {member.committeeRole && features.committeeRoles && (
            <span className="badge badge-blue" style={{ fontSize:10 }}>🎖️ {member.committeeRole}</span>
          )}
        </div>
      </div>

      {tabs.length > 1 && (
        <div style={{ display:'flex', gap:4, borderBottom:'2px solid #e2e8f0', marginBottom:16 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ padding:'8px 14px', background:'none', border:'none', cursor:'pointer', fontSize:13,
                fontWeight: activeTab===t.id ? 600 : 400, color: activeTab===t.id ? '#2563eb' : '#64748b',
                borderBottom: activeTab===t.id ? '2px solid #2563eb' : '2px solid transparent', marginBottom:-2 }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Profile tab ── */}
      {activeTab === 'profile' && (
        <>
          <div style={{ marginBottom:16 }}>
            <label className="form-label">
              Member ID
              {settings.autoMemberId && <span style={{ fontWeight:400, textTransform:'none', marginLeft:4, color:'#94a3b8' }}>(auto on approve)</span>}
            </label>
            <div style={{ display:'flex', gap:8 }}>
              <input value={idEdit} onChange={e => setIdEdit(e.target.value)}
                placeholder={settings.autoMemberId ? `Next: ${nextId}` : 'e.g. M-001'} style={{ flex:1 }} />
              <button onClick={() => onSaveId(member.id, idEdit)} disabled={saving === member.id+'_id'}
                className="btn-primary" style={{ padding:'10px 14px' }}>
                {saving === member.id+'_id' ? '…' : 'Save'}
              </button>
            </div>
          </div>
          <InfoRow label="Email"       value={member.email} />
          <InfoRow label="Phone"       value={member.phone} />
          <InfoRow label="Blood Group" value={member.bloodGroup} />
          <InfoRow label="NID"         value={member.nid} />
          <InfoRow label="Occupation"  value={member.occupation} />
          <InfoRow label="DOB"         value={member.dob} />
          <InfoRow label="Father"      value={member.fatherName} />
          <InfoRow label="Address"     value={member.address} />
          <button onClick={() => onToggleApproval(member)} disabled={saving === member.id}
            style={{ width:'100%', marginTop:18, padding:'12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:600, fontSize:14,
              background: member.approved ? '#fee2e2' : '#dcfce7',
              color:      member.approved ? '#b91c1c' : '#15803d',
              opacity: saving === member.id ? .6 : 1 }}>
            {saving === member.id ? '…' : member.approved ? 'Suspend Member' : 'Approve Member'}
          </button>
        </>
      )}

      {/* ── Secretary tab ── */}
      {activeTab === 'secretary' && (
        <div>
          <div className="alert alert-info" style={{ marginBottom:16, fontSize:13 }}>
            Secretary roles give limited access to specific admin pages without full admin privileges.
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {/* Office Secretary */}
            {[
              {
                role: 'office_secretary',
                label: 'Office Secretary',
                icon: '📋',
                desc: 'Can view and edit member profiles, and manage memoranda (notices & circulars).',
                access: ['Member Profiles', 'Memoranda'],
              },
              {
                role: 'joint_secretary',
                label: 'Joint Secretary',
                icon: '📝',
                desc: 'Can manage memoranda (notices & circulars) only. No access to member data.',
                access: ['Memoranda'],
              },
            ].map(({ role, label, icon, desc, access }) => {
              const isActive = member.role === role;
              return (
                <div key={role} style={{
                  padding:'14px 16px', borderRadius:10,
                  border:`2px solid ${isActive ? '#2563eb' : '#e2e8f0'}`,
                  background: isActive ? '#eff6ff' : '#fff',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color: isActive ? '#1d4ed8' : '#0f172a' }}>
                        {icon} {label}
                        {isActive && <span style={{ marginLeft:8, fontSize:11, fontWeight:600, padding:'1px 8px', borderRadius:99, background:'#bfdbfe', color:'#1d4ed8' }}>Active</span>}
                      </div>
                      <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>{desc}</div>
                      <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
                        {access.map(a => (
                          <span key={a} style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:'#f0fdf4', color:'#15803d' }}>
                            ✓ {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const newRole = isActive ? 'member' : role;
                        onSaveRole(member.id, newRole);
                      }}
                      disabled={saving === member.id+'_role'}
                      style={{
                        padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer',
                        fontWeight:600, fontSize:13, flexShrink:0,
                        background: isActive ? '#fee2e2' : '#dcfce7',
                        color:      isActive ? '#b91c1c' : '#15803d',
                        opacity: saving === member.id+'_role' ? 0.6 : 1,
                      }}>
                      {saving === member.id+'_role' ? '…' : isActive ? 'Remove Role' : 'Assign Role'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {(member.role === 'office_secretary' || member.role === 'joint_secretary') && (
            <div style={{ marginTop:14, padding:'10px 14px', borderRadius:8, background:'#fffbeb', border:'1px solid #fde68a', fontSize:12, color:'#92400e' }}>
              ⚠️ Secretary roles cannot access financial data, verify payments, or approve members.
              Only admins can do that. Secretary roles are for administrative office tasks only.
            </div>
          )}
        </div>
      )}

      {/* ── Cashier tab ── */}
      {activeTab === 'cashier' && features.cashierRole && (
        <div>
          <div className="alert alert-info" style={{ marginBottom:16, fontSize:13 }}>
            Cashiers can only see and verify payments sent to their specifically assigned account numbers.
          </div>

          {/* Role toggle */}
          <div className="card" style={{ marginBottom:16, padding:'14px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:14, color:'#0f172a' }}>Cashier Role</div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                  {member.role === 'cashier' ? 'This member is currently a cashier.' : 'Assign cashier role to this member.'}
                </div>
                {maxCashiers > 0 && (
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>
                    Org limit: {currentCashierCount}/{maxCashiers} cashiers used
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  if (member.role !== 'cashier' && maxCashiers > 0 && currentCashierCount >= maxCashiers) {
                    alert(`Cashier limit reached (${maxCashiers}). Remove a cashier first.`);
                    return;
                  }
                  onSaveCashier(member.id, member.role === 'cashier' ? 'member' : 'cashier', cashierAccountIds);
                }}
                disabled={saving === member.id+'_role'}
                style={{ padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:600, fontSize:13, flexShrink:0,
                  background: member.role === 'cashier' ? '#fee2e2' : '#dcfce7',
                  color:      member.role === 'cashier' ? '#b91c1c' : '#15803d',
                  opacity: saving === member.id+'_role' ? .6 : 1 }}>
                {saving === member.id+'_role' ? '…' : member.role === 'cashier' ? 'Remove Cashier' : 'Make Cashier'}
              </button>
            </div>
          </div>

          {/* Assign specific accounts — shown when cashier or just toggled */}
          {(member.role === 'cashier') && (
            <div className="card" style={{ padding:'14px 16px' }}>
              <div style={{ fontWeight:600, fontSize:14, color:'#0f172a', marginBottom:4 }}>Assigned Accounts</div>
              <p style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>
                Select the exact account numbers this cashier handles. They will <strong>only</strong> see payments sent to these accounts.
              </p>

              {allAccounts.length === 0 ? (
                <div style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:'16px 0' }}>
                  No payment accounts configured. Add them in Settings → Payment Accounts.
                </div>
              ) : (
                enabledMethods.map(method => {
                  const methodAccounts = accountsByMethod[method] || [];
                  if (methodAccounts.length === 0) return null;
                  return (
                    <div key={method} style={{ marginBottom:14 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>
                        {method}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {methodAccounts.map(acc => {
                          const checked = cashierAccountIds.includes(acc.id);
                          return (
                            <label key={acc.id}
                              style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
                                border:`1.5px solid ${checked ? '#bfdbfe' : '#e2e8f0'}`,
                                borderRadius:8, background: checked ? '#f0f7ff' : '#fafafa', cursor:'pointer' }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleAccId(acc.id)}
                                style={{ flexShrink:0, accentColor:'#2563eb', width:15, height:15 }} />
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:600, fontSize:13, color: checked ? '#1d4ed8' : '#0f172a' }}>
                                  {acc.label}
                                </div>
                                {acc.number && (
                                  <div style={{ fontFamily:'monospace', fontSize:12, color:'#475569', marginTop:1 }}>
                                    {acc.number}
                                  </div>
                                )}
                              </div>
                              {checked && <span style={{ fontSize:12, color:'#2563eb', fontWeight:700 }}>✓</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12, paddingTop:12, borderTop:'1px solid #f1f5f9' }}>
                <span style={{ fontSize:12, color:'#64748b' }}>
                  {cashierAccountIds.length} account{cashierAccountIds.length !== 1 ? 's' : ''} selected
                </span>
                <button onClick={() => onSaveCashier(member.id, 'cashier', cashierAccountIds)}
                  disabled={saving === member.id+'_role'}
                  className="btn-primary" style={{ padding:'9px 20px' }}>
                  {saving === member.id+'_role' ? 'Saving…' : 'Save Accounts'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Committee tab ── */}
      {activeTab === 'committee' && features.committeeRoles && (
        <div>
          <div className="alert alert-info" style={{ marginBottom:16, fontSize:13 }}>
            Committee roles are for display only. They do not affect any access or permissions.
          </div>
          <div className="form-group">
            <label className="form-label">Committee Role</label>
            <input value={committeeEdit} onChange={e => setCommitteeEdit(e.target.value)}
              placeholder="e.g. President, Secretary…" list="committee-presets" />
            <datalist id="committee-presets">
              {COMMITTEE_PRESETS.map(p => <option key={p} value={p} />)}
            </datalist>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10 }}>
              {COMMITTEE_PRESETS.map(p => (
                <button key={p} type="button" onClick={() => setCommitteeEdit(p)}
                  style={{ padding:'4px 10px', fontSize:11, borderRadius:99,
                    border:`1px solid ${committeeEdit===p?'#2563eb':'#e2e8f0'}`,
                    background: committeeEdit===p?'#eff6ff':'#fff',
                    color: committeeEdit===p?'#2563eb':'#475569', cursor:'pointer',
                    fontWeight: committeeEdit===p ? 600 : 400 }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            {committeeEdit && (
              <button onClick={() => { setCommitteeEdit(''); onSaveCommittee(member.id, ''); }}
                className="btn-ghost" style={{ padding:'10px 14px', fontSize:13 }}>
                Clear Role
              </button>
            )}
            <button onClick={() => onSaveCommittee(member.id, committeeEdit)}
              disabled={saving === member.id+'_committee'}
              className="btn-primary" style={{ flex:1, justifyContent:'center' }}>
              {saving === member.id+'_committee' ? 'Saving…' : 'Save Committee Role'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}


// ── CSV helpers ───────────────────────────────────────────────────────────────
function memberCSVRow(m) {
  const e = v => `"${(v||'').toString().replace(/"/g,'""')}"`;
  return [
    m.idNo, m.nameEnglish, m.nameBengali, m.fatherNameEn||m.fatherName,
    m.motherNameEn||m.motherName, m.dob, m.nid, m.bloodGroup,
    m.maritalStatus, m.education, m.occupation, m.phone, m.email,
    m.presentAddressEn||m.presentAddress, m.permanentAddressEn||m.permanentAddress,
    m.heirNameEn||m.heirName, m.heirRelation, m.heirNID,
    m.applicationNo, m.agreementNo,
    m.approved?'Active':'Pending',
  ].map(e).join(',');
}
const CSV_HDR = [
  'ID','Name (En)','Name (Bn)',"Father's"+"(En)","Mother's (En)",
  'DOB','NID','BG','Marital','Education','Occupation','Phone','Email',
  'Present Address','Permanent Address','Heir Name','Heir Relation','Heir NID',
  'Application No','Agreement No','Status',
].map(h=>`"${h}"`).join(',');

function downloadMembersCSV(members, filename='members.csv') {
  const rows = [CSV_HDR, ...members.map(memberCSVRow)].join('\n');
  const blob = new Blob([rows],{type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'),{href:url,download:filename});
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},100);
}

export default function AdminMembers() {
  const { userData, orgData, isOrgAdmin} = useAuth();
  const router = useRouter();
  if (!isOrgAdmin) { typeof window !== 'undefined' && router.replace('/dashboard'); return null; }

  const [members,  setMembers]  = useState([]);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortBy,   setSortBy]   = useState('idNo');   // default: sort by Member ID
  const [saving,   setSaving]   = useState(null);

  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};
  const features = orgData?.features || {};
  const limits   = orgData?.limits   || {};

  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db, 'organizations', orgId, 'members'), async snap => {
      const docs   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const merged = await Promise.all(docs.map(async m => {
        try {
          const u = await getDoc(doc(db, 'users', m.id));
          return u.exists() ? { ...u.data(), ...m } : m;
        } catch { return m; }
      }));
      setMembers(merged);
      setSelected(s => s ? (merged.find(m => m.id === s.id) || null) : null);
    });
    return unsub;
  }, [orgId]);

  const nextMemberId = () => {
    const prefix = settings.memberIdPrefix || 'M';
    const nums   = members.map(m => m.idNo||'').filter(id => id.startsWith(prefix+'-')).map(id => parseInt(id.split('-')[1])||0);
    return `${prefix}-${String((nums.length ? Math.max(...nums) : 0)+1).padStart(3,'0')}`;
  };

  const toggleApproval = async m => {
    if (!m.approved && limits.maxMembers) {
      const approvedCount = members.filter(x => x.approved && x.id !== m.id).length;
      if (approvedCount >= limits.maxMembers) {
        alert(`Member limit reached (${limits.maxMembers}). Contact superadmin to increase the limit.`);
        return;
      }
    }
    setSaving(m.id);
    try {
      const nowApproved = !m.approved;
      const update = { approved: nowApproved };
      if (nowApproved && settings.autoMemberId && !m.idNo) update.idNo = nextMemberId();
      await updateDoc(doc(db, 'organizations', orgId, 'members', m.id), update);
      const msg = nowApproved
        ? `✅ Your membership has been approved! Welcome to ${orgData?.name || 'the organization'}.`
        : `⚠️ Your membership has been suspended. Please contact admin for more details.`;
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId: m.id, message: msg, read: false, createdAt: serverTimestamp(),
      });
    } catch (e) { alert(e.message); }
    setSaving(null);
  };

  const saveId = async (uid, val) => {
    setSaving(uid+'_id');
    try { await updateDoc(doc(db, 'organizations', orgId, 'members', uid), { idNo: val }); }
    catch (e) { alert(e.message); }
    setSaving(null);
  };

  // Save cashierAccountIds (per-account) + derive cashierMethods for display/compat
  const saveCashier = async (uid, newRole, accountIds) => {
    setSaving(uid+'_role');
    try {
      const paymentAccounts = settings.paymentAccounts || {};
      const enabledMethods  = settings.paymentMethods  || ['bKash','Nagad','Rocket','Bank Transfer','Cash'];

      // Build flat account list to look up details
      const allAccounts = [];
      enabledMethods.forEach(method => {
        const accs = paymentAccounts[method] || [];
        if (method === 'Cash') { allAccounts.push({ id:'cash-default', method:'Cash', label:'Cash' }); }
        else if (accs.length === 0) { allAccounts.push({ id:`${method}-default`, method, label:'Default' }); }
        else { accs.forEach(a => allAccounts.push({ id: a.id, method, label: a.label, number: a.number })); }
      });

      const assigned = allAccounts.filter(a => accountIds.includes(a.id));
      const methods  = [...new Set(assigned.map(a => a.method))]; // for backward-compat display

      await updateDoc(doc(db, 'organizations', orgId, 'members', uid), {
        role:              newRole,
        cashierAccountIds: accountIds,   // NEW: specific account IDs
        cashierMethods:    methods,       // keep for display in table
      });

      const msg = newRole === 'cashier'
        ? `💳 You have been assigned as a cashier. Your accounts: ${assigned.map(a => `${a.method} – ${a.label}${a.number ? ' ('+a.number+')' : ''}`).join(', ') || 'none'}.`
        : `ℹ️ Your cashier role has been removed. You are now a regular member.`;
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId: uid, message: msg, read: false, createdAt: serverTimestamp(),
      });
    } catch (e) { alert(e.message); }
    setSaving(null);
  };

  const saveCommittee = async (uid, role) => {
    setSaving(uid+'_committee');
    try { await updateDoc(doc(db, 'organizations', orgId, 'members', uid), { committeeRole: role }); }
    catch (e) { alert(e.message); }
    setSaving(null);
  };

  const saveRole = async (uid, newRole) => {
    setSaving(uid+'_role');
    try {
      await updateDoc(doc(db, 'organizations', orgId, 'members', uid), { role: newRole });
      // Notification
      const roleLabels = { office_secretary:'Office Secretary', joint_secretary:'Joint Secretary', member:'Regular Member' };
      const msg = newRole === 'member'
        ? 'Your secretary role has been removed. You are now a regular member.'
        : `You have been assigned as ${roleLabels[newRole]||newRole}. You now have limited admin access.`;
      await addDoc(collection(db, 'organizations', orgId, 'notifications'), {
        userId: uid, message: msg, read: false, createdAt: serverTimestamp(),
      });
    } catch (e) { alert(e.message); }
    setSaving(null);
  };

  const filtered = members.filter(m => {
    const q  = search.toLowerCase();
    const sf = !search
      || (m.nameEnglish||'').toLowerCase().includes(q)
      || (m.phone||'').includes(search)
      || (m.email||'').toLowerCase().includes(q)
      || (m.idNo||'').includes(search);
    const ff = filter === 'all'
      || filter === m.role
      || (filter === 'approved' ? m.approved : filter === 'pending' ? !m.approved : false);
    return sf && ff;
  });

  // Parse idNo for numeric sort: "M-007" → 7, "M-012" → 12
  const idNum = idNo => {
    if (!idNo) return Infinity; // no ID → goes to bottom
    const m = idNo.match(/(\d+)$/);
    return m ? parseInt(m[1]) : idNo; // numeric if possible, else string
  };

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'idNo':
        // Numeric ID sort: unassigned last
        if (!a.idNo && !b.idNo) return (a.nameEnglish||'').localeCompare(b.nameEnglish||'');
        if (!a.idNo) return 1;
        if (!b.idNo) return -1;
        const na = idNum(a.idNo), nb = idNum(b.idNo);
        return typeof na === 'number' && typeof nb === 'number' ? na - nb : String(na).localeCompare(String(nb));
      case 'name':
        return (a.nameEnglish||'').localeCompare(b.nameEnglish||'');
      case 'joinDate':
        return (b.joiningDate||b.createdAt?.seconds||0) > (a.joiningDate||a.createdAt?.seconds||0) ? 1 : -1;
      case 'status':
        // Approved first, then pending
        if (a.approved === b.approved) return (a.nameEnglish||'').localeCompare(b.nameEnglish||'');
        return a.approved ? -1 : 1;
      case 'role':
        const roleOrder = { admin:0, cashier:1, office_secretary:2, joint_secretary:3, member:4 };
        const ra = roleOrder[a.role||'member'] ?? 2;
        const rb = roleOrder[b.role||'member'] ?? 2;
        return ra !== rb ? ra - rb : (a.nameEnglish||'').localeCompare(b.nameEnglish||'');
      default:
        return 0;
    }
  });

  const roleBadge    = r => r === 'admin' ? 'badge-blue' : r === 'cashier' ? 'badge-yellow' :
    r === 'office_secretary' || r === 'joint_secretary' ? 'badge-blue' : 'badge-gray';
  const roleLabel    = r => r === 'office_secretary' ? 'Office Sec.' : r === 'joint_secretary' ? 'Joint Sec.' :
    r ? r.charAt(0).toUpperCase()+r.slice(1) : 'Member';
  const cashierCount = members.filter(m => m.role === 'cashier').length;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:40, height:40, borderRadius:10, overflow:'hidden', flexShrink:0 }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div style={{ flex:1 }}>
          <div className="page-title">Members</div>
          <div className="page-subtitle" style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <span>{members.length} total · {members.filter(m => !m.approved).length} pending</span>
            {features.cashierRole && cashierCount > 0 && (
              <span className="badge badge-yellow" style={{ fontSize:10 }}>💳 {cashierCount} cashier{cashierCount>1?'s':''}</span>
            )}
            {members.filter(m => m.role === 'office_secretary' || m.role === 'joint_secretary').length > 0 && (
              <span className="badge badge-blue" style={{ fontSize:10 }}>
                📋 {members.filter(m => m.role === 'office_secretary' || m.role === 'joint_secretary').length} secretary
              </span>
            )}
            {settings.autoMemberId && (
              <span style={{ fontSize:11, background:'#eff6ff', color:'#2563eb', padding:'2px 8px', borderRadius:4, fontWeight:600 }}>Auto-ID</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <button onClick={() => downloadMembersCSV(members, 'all-members.csv')}
          style={{ padding:'8px 16px', borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600, color:'#475569' }}>
          ⬇ Export All CSV
        </button>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, ID…" style={{ flex:1, minWidth:160 }} />
        <div style={{ display:'flex', gap:6, flexShrink:0, flexWrap:'wrap' }}>
          {['all','approved','pending','cashier'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={filter === f ? 'btn-primary' : 'btn-ghost'}
              style={{ padding:'9px 14px', fontSize:12, textTransform:'capitalize' }}>
              {f}
            </button>
          ))}
        </div>
        {/* Sort control */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding:'9px 12px', borderRadius:8, border:'1px solid #e2e8f0',
            fontSize:12, color:'#475569', background:'#fff', cursor:'pointer' }}>
          <option value="idNo">Sort: Member ID</option>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="joinDate">Sort: Newest First</option>
          <option value="status">Sort: Status</option>
          <option value="role">Sort: Role</option>
        </select>
      </div>

      {/* Member list — responsive cards, no horizontal scroll */}
      {sorted.length === 0 ? (
        <div style={{ textAlign:'center', color:'#94a3b8', padding:'48px 20px', fontSize:14,
          background:'#fff', borderRadius:12, border:'1px solid #e2e8f0' }}>
          No members found
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {sorted.map(m => (
            <div key={m.id}
              style={{
                background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
                padding: '12px 14px', display: 'flex', alignItems: 'center',
                gap: 12, flexWrap: 'wrap',
              }}>

              {/* Avatar + name block */}
              <div onClick={() => setSelected(m)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  flex: '1 1 0', minWidth: 0, cursor: 'pointer', alignSelf: 'flex-start',
                }}>
                <Avatar m={m} size={38} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.nameEnglish || '(no name)'}
                  </div>
                  {(m.nameBengali || m.email) && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.nameBengali || m.email}
                    </div>
                  )}
                  {/* Mobile-only: ID below Bengali name */}
                  {m.idNo && (
                    <span className="mobile-id-chip"
                      style={{ display: 'none', marginTop: 4, fontSize: 11, fontFamily: 'monospace', color: '#475569', background: '#f1f5f9', padding: '2px 7px', borderRadius: 5 }}>
                      {m.idNo}
                    </span>
                  )}
                </div>
              </div>

              {/* Mobile-only: role + status badges (top-right) */}
                <div className="mobile-meta"
                  style={{
                    display: 'none', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end',
                    flex: '0 0 auto', maxWidth: '45%', alignSelf: 'flex-start',
                    marginLeft: 'auto',
                  }}>
                  <span className={`badge ${m.approved ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: 10 }}>
                    {m.approved ? 'Approved' : 'Pending'}
                  </span>
                  <span className={`badge ${roleBadge(m.role)}`} style={{ fontSize: 10 }}>
                    {roleLabel(m.role)}
                  </span>
                  {features.committeeRoles && m.committeeRole && (
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>🎖️ {m.committeeRole}</span>
                  )}
                </div>

              {/* Desktop-only: ID column */}
              <div className="desktop-id"
                style={{ flex: '0 0 90px', display: 'flex', alignItems: 'center' }}>
                {m.idNo
                  ? <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', background: '#f1f5f9', padding: '2px 7px', borderRadius: 5 }}>{m.idNo}</span>
                  : <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>
                }
              </div>

              {/* Desktop-only: meta chips (no phone) */}
              <div className="desktop-meta"
                onClick={() => setSelected(m)}
                style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1, cursor: 'pointer' }}>
                <span className={`badge ${m.approved ? 'badge-green' : 'badge-yellow'}`} style={{ fontSize: 10 }}>
                  {m.approved ? 'Approved' : 'Pending'}
                </span>
                <span className={`badge ${roleBadge(m.role)}`} style={{ fontSize: 10, textTransform: 'capitalize' }}>
                  {m.role || 'member'}
                </span>
                {features.committeeRoles && m.committeeRole && (
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>🎖️ {m.committeeRole}</span>
                )}
                {m.role === 'cashier' && m.cashierAccountIds?.length > 0 && (
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>{m.cashierAccountIds.length} acct{m.cashierAccountIds.length > 1 ? 's' : ''}</span>
                )}
              </div>

              {/* Actions — unchanged positioning */}
              <div className="member-card-actions"
                style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                <a href={`/admin/members/${m.id}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 7, background: '#eff6ff', color: '#1d4ed8', textDecoration: 'none', whiteSpace: 'nowrap', border: '1px solid #bfdbfe' }}>
                  👤 Profile
                </a>
                <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />
                <button onClick={() => toggleApproval(m)} disabled={saving === m.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: m.approved ? '1px solid #fecaca' : '1px solid #bbf7d0', cursor: 'pointer', whiteSpace: 'nowrap', background: m.approved ? '#fff1f2' : '#f0fdf4', color: m.approved ? '#dc2626' : '#16a34a', opacity: saving === m.id ? .6 : 1 }}>
                  {saving === m.id ? '…' : m.approved ? '⏸ Suspend' : '✓ Approve'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}


      {selected && (
        <MemberModal
          member={selected} onClose={() => setSelected(null)}
          onToggleApproval={toggleApproval} onSaveId={saveId}
          onSaveCashier={saveCashier} onSaveCommittee={saveCommittee} onSaveRole={saveRole}
          settings={settings} nextId={nextMemberId()}
          saving={saving} orgData={orgData} members={members}
        />
      )}
    </div>
  );
}