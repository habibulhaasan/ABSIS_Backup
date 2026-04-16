// src/app/admin/subscriptions/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, doc, getDoc, getDocs } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const fmt = n => `৳${(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const initials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

export default function AdminSubscriptions() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [subs,    setSubs]    = useState([]);   // special subscriptions list
  const [selSub,  setSelSub]  = useState(null); // selected subscription id ('all' or specific id)
  const [payments, setPayments] = useState([]); // all investments tagged with subId
  const [members,  setMembers]  = useState({}); // uid → profile
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');

  // Load special subscriptions
  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'specialSubscriptions'), snap => {
      const list = snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      setSubs(list);
      // Auto-select first active if none selected
      if (!selSub && list.length > 0) setSelSub(list[0].id);
    });
    return unsub;
  }, [orgId]);

  // Load payments that have a specialSubId field
  useEffect(() => {
    if (!orgId) return;
    const unsub = onSnapshot(collection(db,'organizations',orgId,'investments'), snap => {
      const all = snap.docs.map(d=>({id:d.id,...d.data()}))
        .filter(p => p.specialSubId); // only special subscription payments
      setPayments(all);
    });
    return unsub;
  }, [orgId]);

  // Load member profiles once
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const snap = await getDocs(collection(db,'organizations',orgId,'members'));
      const map = {};
      await Promise.all(snap.docs.map(async d => {
        try {
          const u = await getDoc(doc(db,'users',d.id));
          map[d.id] = u.exists() ? { ...u.data(), ...d.data(), id:d.id } : { ...d.data(), id:d.id };
        } catch { map[d.id] = { ...d.data(), id:d.id }; }
      }));
      setMembers(map);
      setLoading(false);
    })();
  }, [orgId]);

  const activeSub   = subs.find(s => s.id === selSub);
  const visiblePay  = payments.filter(p =>
    (selSub === 'all' || p.specialSubId === selSub) &&
    (!search ||
      (members[p.userId]?.nameEnglish||'').toLowerCase().includes(search.toLowerCase()) ||
      (members[p.userId]?.idNo||'').toLowerCase().includes(search.toLowerCase()))
  );

  // Stats for selected sub
  const totalCollected = visiblePay.filter(p=>p.status==='verified').reduce((s,p)=>s+(p.amount||0),0);
  const totalPending   = visiblePay.filter(p=>p.status==='pending').reduce((s,p)=>s+(p.amount||0),0);
  const paidCount      = new Set(visiblePay.filter(p=>p.status==='verified').map(p=>p.userId)).size;
  const targetAmount   = activeSub?.amount || 0;
  const memberCount    = Object.keys(members).filter(id => members[id]?.approved).length;
  const pct            = memberCount > 0 ? Math.round((paidCount / memberCount) * 100) : 0;

  if (!isOrgAdmin) return <div className="page-wrap"><div style={{textAlign:'center',padding:80,color:'#94a3b8'}}>Admin only.</div></div>;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div style={{ flex:1 }}>
          <div className="page-title">Special Subscriptions</div>
          <div className="page-subtitle">Track who paid for each subscription</div>
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="card" style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:700, fontSize:15, color:'#0f172a', marginBottom:6 }}>No Special Subscriptions Yet</div>
          <div style={{ fontSize:13, color:'#64748b' }}>Create one from <strong>Settings → Special Subs</strong></div>
        </div>
      ) : (
        <>
          {/* Subscription filter tabs */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20 }}>
            {subs.map(s => (
              <button key={s.id} onClick={() => setSelSub(s.id)}
                style={{ padding:'9px 16px', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer', border:'1.5px solid', transition:'all .15s',
                  borderColor: selSub===s.id ? '#2563eb' : '#e2e8f0',
                  background:  selSub===s.id ? '#eff6ff' : '#fff',
                  color:       selSub===s.id ? '#1d4ed8' : '#475569' }}>
                {s.title}
                <span style={{ marginLeft:6, fontSize:11, opacity:0.7 }}>
                  {s.active ? '🟢' : '🔴'}
                </span>
              </button>
            ))}
          </div>

          {/* Active sub info card */}
          {activeSub && (
            <div style={{ background:'linear-gradient(135deg,#1e3a5f,#2563eb)', borderRadius:14, padding:'18px 22px', marginBottom:20, color:'#fff' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800 }}>{activeSub.title}</div>
                  {activeSub.description && <div style={{ fontSize:13, opacity:0.8, marginTop:4 }}>{activeSub.description}</div>}
                  <div style={{ fontSize:12, opacity:0.7, marginTop:6 }}>
                    Amount: {fmt(activeSub.amount)} · Deadline: {activeSub.deadline}
                    {!activeSub.active && <span style={{ marginLeft:8, background:'#fecaca', color:'#b91c1c', padding:'1px 8px', borderRadius:99, fontSize:11, fontWeight:700 }}>Inactive</span>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:24, flexShrink:0 }}>
                  {[
                    [paidCount + '/' + memberCount, 'Members Paid'],
                    [pct + '%', 'Completion'],
                    [fmt(totalCollected), 'Collected'],
                  ].map(([v,l]) => (
                    <div key={l} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22, fontWeight:800 }}>{v}</div>
                      <div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase', letterSpacing:'.06em' }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ marginTop:14, height:6, background:'rgba(255,255,255,0.2)', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`, background:'#fff', borderRadius:99, transition:'width 0.5s' }} />
              </div>
            </div>
          )}

          {/* Stats row */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:20 }}>
            {[
              ['Paid',     visiblePay.filter(p=>p.status==='verified').length, '#16a34a'],
              ['Pending',  visiblePay.filter(p=>p.status==='pending').length,  '#d97706'],
              ['Collected',fmt(totalCollected),                                '#2563eb'],
              ['Pending ৳',fmt(totalPending),                                  '#d97706'],
            ].map(([l,v,c]) => (
              <div key={l} style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search member name or ID…" style={{ marginBottom:14 }} />

          {/* Payments table */}
          {loading ? (
            <div style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>Loading…</div>
          ) : visiblePay.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>
              No payments found for this subscription.
            </div>
          ) : (
            <div className="card" style={{ padding:0, overflow:'hidden' }}>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      {selSub === 'all' && <th>Subscription</th>}
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePay.map(p => {
                      const m = members[p.userId] || {};
                      const sub = subs.find(s=>s.id===p.specialSubId);
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <div style={{ width:32, height:32, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:11, color:'#1d4ed8', flexShrink:0, overflow:'hidden' }}>
                                {m.photoURL ? <img src={m.photoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : initials(m.nameEnglish)}
                              </div>
                              <div>
                                <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish||'Unknown'}</div>
                                <div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo||'—'}</div>
                              </div>
                            </div>
                          </td>
                          {selSub === 'all' && <td style={{ fontSize:12 }}>{sub?.title||'—'}</td>}
                          <td>
                            <span className={`badge ${p.status==='verified'?'badge-green':p.status==='pending'?'badge-yellow':'badge-red'}`}>
                              {p.status}
                            </span>
                          </td>
                          <td style={{ fontWeight:600, color:'#0f172a' }}>{fmt(p.amount)}</td>
                          <td><span className="badge badge-gray" style={{ fontSize:10 }}>{p.method||'—'}</span></td>
                          <td style={{ fontSize:12, color:'#94a3b8', whiteSpace:'nowrap' }}>
                            {p.createdAt?.seconds ? new Date(p.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Who hasn't paid yet */}
          {activeSub && (() => {
            const paidUids = new Set(visiblePay.filter(p=>p.status==='verified').map(p=>p.userId));
            const unpaid = Object.values(members).filter(m => m.approved && !paidUids.has(m.id));
            if (unpaid.length === 0) return null;
            return (
              <div className="card" style={{ marginTop:16 }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#dc2626', marginBottom:12 }}>
                  ⚠️ Not Paid Yet ({unpaid.length})
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {unpaid.map(m => (
                    <div key={m.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:8, background:'#fef2f2', border:'1px solid #fecaca' }}>
                      <div style={{ width:26, height:26, borderRadius:'50%', background:'#fee2e2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#dc2626', flexShrink:0 }}>
                        {initials(m.nameEnglish)}
                      </div>
                      <span style={{ fontSize:12, fontWeight:600, color:'#0f172a' }}>{m.nameEnglish||'Unknown'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
