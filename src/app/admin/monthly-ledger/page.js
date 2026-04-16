// src/app/admin/monthly-ledger/page.js
'use client';
import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n)  { return `৳${(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function pad(n)  { return String(n).padStart(2,'0'); }
function ymLabel(ym) { if (!ym) return ''; const [y,m] = ym.split('-'); return `${MONTHS[+m-1]} ${y}`; }
function ymShort(ym) { if (!ym) return ''; const [y,m] = ym.split('-'); return `${SHORT[+m-1]} ${y}`; }

function getMonthRange(startDate) {
  if (!startDate) return [];
  const out = [];
  const d = new Date(startDate);
  d.setDate(1);
  const now = new Date();
  while (d <= now) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}`);
    d.setMonth(d.getMonth()+1);
  }
  return out.reverse(); // newest first
}

const initials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

// ── Accordion section ──────────────────────────────────────────────────────────
function Section({ title, icon, count, total, color, children, defaultOpen=false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border:`1px solid ${open ? color+'44' : '#e2e8f0'}`, borderRadius:12, overflow:'hidden', transition:'border-color .2s' }}>
      <button onClick={() => setOpen(v=>!v)} style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 16px', background: open?color+'08':'#fff', border:'none', cursor:'pointer', textAlign:'left' }}>
        <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
        <span style={{ flex:1, fontWeight:700, fontSize:14, color:'#0f172a' }}>{title}</span>
        {count != null && <span style={{ fontSize:12, color:'#94a3b8' }}>{count} entries</span>}
        {total != null && <span style={{ fontWeight:700, fontSize:14, color }}>{fmt(total)}</span>}
        <span style={{ fontSize:16, color:'#94a3b8', transition:'transform .2s', transform: open?'rotate(90deg)':'rotate(0deg)', flexShrink:0 }}>›</span>
      </button>
      {open && <div style={{ borderTop:`1px solid ${color+'22'}` }}>{children}</div>}
    </div>
  );
}

// ── Print / PDF helper ─────────────────────────────────────────────────────────
function buildPrintHTML(orgData, selMonth, sections) {
  const title = `${orgData?.name || 'Organization'} — Ledger Report`;
  const period = ymLabel(selMonth);
  const now = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  const tableRows = (rows) => rows.map(r =>
    `<tr>${r.map(c=>`<td>${c??'—'}</td>`).join('')}</tr>`
  ).join('');

  const sectionsHTML = sections.map(s => {
    if (!s.rows || s.rows.length === 0) return '';
    return `
      <div class="section">
        <h3 style="color:${s.color}">${s.icon} ${s.title} — ${fmt(s.total)}</h3>
        <table>
          <thead><tr>${s.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${tableRows(s.rows)}</tbody>
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #2563eb}
    .org-name{font-size:20px;font-weight:700;color:#0f172a;margin-bottom:4px}
    .meta{font-size:11px;color:#64748b}
    .period{text-align:right}
    .period-label{font-size:14px;font-weight:700;color:#2563eb}
    .section{margin-bottom:20px}
    h3{font-size:13px;font-weight:700;margin-bottom:8px;padding:6px 0}
    table{width:100%;border-collapse:collapse;margin-bottom:4px}
    th{background:#f1f5f9;padding:6px 8px;text-align:left;font-size:11px;color:#475569;font-weight:600}
    td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:11px}
    tr:last-child td{border-bottom:none}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center}
  </style></head><body>
  <div class="header">
    <div>
      <div class="org-name">${orgData?.name || 'Organization'}</div>
      <div class="meta">${orgData?.type || ''} · ${orgData?.currency || 'BDT'}</div>
      <div class="meta">Generated: ${now}</div>
    </div>
    <div class="period">
      <div class="period-label">Ledger Report</div>
      <div class="meta">${period}</div>
    </div>
  </div>
  ${sectionsHTML}
  <div class="footer">Capital Sync — ${orgData?.name} — ${period}</div>
  </body></html>`;
}

export default function AdminLedger() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId    = userData?.activeOrgId;
  const settings = orgData?.settings || {};
  const router   = useRouter();

  if (!isOrgAdmin) { router.replace('/dashboard'); return null; }

  const [loading,    setLoading]    = useState(true);
  const [payments,   setPayments]   = useState([]);
  const [expenses,   setExpenses]   = useState([]);
  const [incomes,    setIncomes]    = useState([]);
  const [penalties,  setPenalties]  = useState([]);
  const [members,    setMembers]    = useState({}); // uid → profile
  const [selMonth,   setSelMonth]   = useState('');
  const [allMonths,  setAllMonths]  = useState([]);
  const [downloading, setDownloading] = useState(false);
  const printRef = useRef(null);

  // Set default month to current
  useEffect(() => {
    const now = new Date();
    setSelMonth(`${now.getFullYear()}-${pad(now.getMonth()+1)}`);
  }, []);

  // Build month list from org start date
  useEffect(() => {
    if (settings.startDate) {
      setAllMonths(getMonthRange(settings.startDate));
    } else {
      // Fallback: last 24 months
      const months = [];
      const d = new Date();
      for (let i = 0; i < 24; i++) {
        months.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}`);
        d.setMonth(d.getMonth()-1);
      }
      setAllMonths(months);
    }
  }, [settings.startDate]);

  // Load all data once
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);
      const [paySnap, expSnap, incSnap, memSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'income')),
        getDocs(collection(db,'organizations',orgId,'members')),
      ]);

      // Build member map with profiles
      const rawMem = memSnap.docs.map(d=>({id:d.id,...d.data()}));
      const map = {};
      await Promise.all(rawMem.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); map[m.id] = u.exists() ? { ...u.data(), ...m } : m; }
        catch { map[m.id] = m; }
      }));
      setMembers(map);

      const rawPay = paySnap.docs.map(d=>({id:d.id,...d.data()}));
      setPayments(rawPay);

      // Build penalty entries from verified payments
      const pen = rawPay.filter(p => p.status==='verified' && p.penaltyPaid > 0).map(p => ({
        id: p.id+'_pen',
        userId: p.userId,
        amount: p.penaltyPaid,
        month: (p.paidMonths||[])[0] || '',
        date: p.verifiedAt || p.createdAt,
        reason: 'Late payment penalty',
      }));
      setPenalties(pen);

      setExpenses(expSnap.docs.map(d=>({id:d.id,...d.data()})));
      setIncomes(incSnap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    })();
  }, [orgId]);

  // ── Filter to selected month ─────────────────────────────────────────────────
  const inMonth = (dateStr) => {
    if (!dateStr || !selMonth) return true;
    return String(dateStr).startsWith(selMonth);
  };

  const verifiedThisMonth = payments.filter(p =>
    p.status === 'verified' && p.isContribution !== false
    && (p.paidMonths||[]).some(m => m === selMonth)
  );
  const pendingThisMonth = payments.filter(p =>
    p.status === 'pending' && (p.paidMonths||[]).some(m => m === selMonth)
  );
  const expensesThisMonth  = expenses.filter(e => inMonth(e.date));
  const incomesThisMonth   = incomes.filter(i => inMonth(i.date));
  const penaltiesThisMonth = penalties.filter(p => p.month === selMonth);

  // ── Totals ───────────────────────────────────────────────────────────────────
  // When gatewayFeeInAccounting is ON, gateway fees count toward income (not deducted)
  const feeInAccounting = !!settings.gatewayFeeInAccounting;
  const donationNet = (p) => (p.amount||0) - (p.penaltyPaid||0) - (feeInAccounting ? 0 : (p.gatewayFee||0));
  const totalDonations = verifiedThisMonth.reduce((s,p) => s + donationNet(p), 0);
  const totalPending   = pendingThisMonth.reduce((s,p) => s+(p.amount||0),0);
  const totalPenalties = penaltiesThisMonth.reduce((s,p) => s+(p.amount||0),0);
  const totalExpenses  = expensesThisMonth.reduce((s,e) => s+(e.amount||0),0);
  const totalIncome    = incomesThisMonth.reduce((s,i) => s+(i.amount||0),0);
  const netBalance     = totalDonations + totalPenalties + totalIncome - totalExpenses;

  // ── Download PDF via print window ────────────────────────────────────────────
  const downloadReport = () => {
    setDownloading(true);
    const sections = [
      {
        title:'Installments Paid', icon:'💰', color:'#16a34a', total:totalDonations,
        headers:['Member','ID','Month(s)','Base Amount','Late Fee','Gateway Fee','Date'],
        rows: verifiedThisMonth.map(p => {
          const m = members[p.userId] || {};
          return [
            m.nameEnglish||p.userId, m.idNo||'—',
            (p.paidMonths||[]).join(', '),
            fmt(donationNet(p)),
            p.penaltyPaid ? fmt(p.penaltyPaid) : '—',
            p.gatewayFee  ? fmt(p.gatewayFee)  : '—',
            p.verifiedAt ? new Date(p.verifiedAt.seconds*1000).toLocaleDateString('en-GB') : '—',
          ];
        }),
      },
      {
        title:'Pending Payments', icon:'⏳', color:'#d97706', total:totalPending,
        headers:['Member','ID','Month(s)','Amount','Submitted'],
        rows: pendingThisMonth.map(p => {
          const m = members[p.userId] || {};
          return [
            m.nameEnglish||p.userId, m.idNo||'—',
            (p.paidMonths||[]).join(', '),
            fmt(p.amount),
            p.createdAt ? new Date(p.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—',
          ];
        }),
      },
      {
        title:'Expenses', icon:'📤', color:'#dc2626', total:totalExpenses,
        headers:['Title','Category','Date','Amount'],
        rows: expensesThisMonth.map(e => [e.title||'—', e.category||'—', e.date||'—', fmt(e.amount)]),
      },
      {
        title:'Other Income', icon:'📥', color:'#2563eb', total:totalIncome,
        headers:['Description','Category','Date','Amount'],
        rows: incomesThisMonth.map(i => [i.description||i.title||'—', i.category||'—', i.date||'—', fmt(i.amount)]),
      },
      {
        title:'Late Fees Collected', icon:'⚠️', color:'#d97706', total:totalPenalties,
        headers:['Member','Month','Amount','Reason'],
        rows: penaltiesThisMonth.map(p => {
          const m = members[p.userId] || {};
          return [m.nameEnglish||'—', p.month, fmt(p.amount), p.reason||'Late payment'];
        }),
      },
    ];

    const html = buildPrintHTML(orgData, selMonth, sections);
    const win = window.open('','_blank','width=900,height=700');
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); setDownloading(false); };
  };

  if (!isOrgAdmin) return <div className="page-wrap"><div style={{textAlign:'center',padding:80,color:'#94a3b8'}}>Admin only.</div></div>;

  return (
    <div className="page-wrap animate-fade">

      {/* ── Org Header ─────────────────────────────────────────────────────── */}
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#2563eb)', borderRadius:14, padding:'20px 22px', marginBottom:20, color:'#fff' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12, flexWrap:'wrap' }}>
          {orgData?.logoURL ? (
            <div style={{ width:52, height:52, borderRadius:12, overflow:'hidden', flexShrink:0, border:'2px solid rgba(255,255,255,0.3)' }}>
              <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
            </div>
          ) : (
            <div style={{ width:52, height:52, borderRadius:12, background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>🏢</div>
          )}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:20, fontWeight:800, letterSpacing:'-0.01em' }}>{orgData?.name || 'Organization'}</div>
            <div style={{ fontSize:12, opacity:0.75, marginTop:2 }}>{orgData?.type} · {orgData?.currency || 'BDT'} · Due: {settings.dueDate ? `${settings.dueDate}th` : '—'} each month</div>
          </div>
          <button onClick={downloadReport} disabled={downloading}
            style={{ padding:'10px 18px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:13,
              background:'rgba(255,255,255,0.15)', color:'#fff', backdropFilter:'blur(4px)',
              opacity: downloading ? 0.6 : 1, flexShrink:0 }}>
            {downloading ? '…' : '⬇ Download PDF'}
          </button>
        </div>

        {/* Month selector */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4, scrollbarWidth:'none' }}>
          {allMonths.map(m => (
            <button key={m} onClick={() => setSelMonth(m)}
              style={{ padding:'7px 14px', borderRadius:99, border:'none', cursor:'pointer', whiteSpace:'nowrap', fontSize:12, fontWeight:600, flexShrink:0, transition:'all .15s',
                background: selMonth===m ? '#fff' : 'rgba(255,255,255,0.12)',
                color:      selMonth===m ? '#1d4ed8' : 'rgba(255,255,255,0.85)' }}>
              {ymShort(m)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Period label + summary ──────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:18, color:'#0f172a' }}>{ymLabel(selMonth)}</div>
          <div style={{ fontSize:12, color:'#64748b' }}>Showing all transactions for this month</div>
        </div>
        <div style={{ display:'flex', gap:16 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em' }}>Net This Month</div>
            <div style={{ fontSize:20, fontWeight:800, color: netBalance>=0?'#16a34a':'#dc2626' }}>{fmt(netBalance)}</div>
          </div>
        </div>
      </div>

      {/* ── Quick stat row ──────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:10, marginBottom:20 }}>
        {[
          ['Installments',  fmt(totalDonations),  verifiedThisMonth.length+' paid',  '#16a34a'],
          ['Pending',       fmt(totalPending),     pendingThisMonth.length+' pending','#d97706'],
          ['Late Fees',     fmt(totalPenalties),   penaltiesThisMonth.length+' fees', '#f59e0b'],
          ['Other Income',  fmt(totalIncome),      incomesThisMonth.length+' entries','#2563eb'],
          ['Expenses',      fmt(totalExpenses),    expensesThisMonth.length+' items', '#dc2626'],
        ].map(([l,v,sub,c]) => (
          <div key={l} style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 14px' }}>
            <div style={{ fontSize:10, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{l}</div>
            <div style={{ fontSize:17, fontWeight:800, color:c }}>{v}</div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Loading ledger…</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

          {/* ── 1. Installments Paid ──────────────────────────────────────── */}
          <Section title="Installments Paid" icon="💰" count={verifiedThisMonth.length} total={totalDonations} color="#16a34a" defaultOpen={true}>
            {verifiedThisMonth.length === 0 ? (
              <div style={{ padding:'20px 16px', color:'#94a3b8', fontSize:13, textAlign:'center' }}>No payments verified this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Member</th><th>Month(s)</th><th>Base</th><th>Late Fee</th><th>Gateway</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {verifiedThisMonth.map(p => {
                      const m = members[p.userId] || {};
                      const base = donationNet(p);
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish||'Unknown'}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo||p.userId?.slice(0,8)}</div>
                          </td>
                          <td style={{ fontSize:12 }}>{(p.paidMonths||[]).map(ymShort).join(', ')}</td>
                          <td style={{ fontWeight:600, color:'#16a34a' }}>{fmt(base)}</td>
                          <td>{p.penaltyPaid>0 ? <span style={{ color:'#d97706', fontWeight:600 }}>{fmt(p.penaltyPaid)}</span> : <span style={{ color:'#94a3b8' }}>—</span>}</td>
                          <td>{p.gatewayFee>0  ? <span style={{ color:'#64748b' }}>{fmt(p.gatewayFee)}</span>  : <span style={{ color:'#94a3b8' }}>—</span>}</td>
                          <td style={{ fontSize:11, color:'#94a3b8', whiteSpace:'nowrap' }}>
                            {p.verifiedAt?.seconds ? new Date(p.verifiedAt.seconds*1000).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 2. Pending Payments ───────────────────────────────────────── */}
          <Section title="Pending Payments" icon="⏳" count={pendingThisMonth.length} total={totalPending} color="#d97706">
            {pendingThisMonth.length === 0 ? (
              <div style={{ padding:'20px 16px', color:'#94a3b8', fontSize:13, textAlign:'center' }}>No pending payments this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Member</th><th>Month(s)</th><th>Amount</th><th>Method</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {pendingThisMonth.map(p => {
                      const m = members[p.userId] || {};
                      return (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish||'Unknown'}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo||'—'}</div>
                          </td>
                          <td style={{ fontSize:12 }}>{(p.paidMonths||[]).map(ymShort).join(', ')}</td>
                          <td style={{ fontWeight:600, color:'#d97706' }}>{fmt(p.amount)}</td>
                          <td><span className="badge badge-gray" style={{ fontSize:10 }}>{p.method||'—'}</span></td>
                          <td style={{ fontSize:11, color:'#94a3b8' }}>
                            {p.createdAt?.seconds ? new Date(p.createdAt.seconds*1000).toLocaleDateString('en-GB') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 3. Late Fees ──────────────────────────────────────────────── */}
          <Section title="Late Fees Collected" icon="⚠️" count={penaltiesThisMonth.length} total={totalPenalties} color="#f59e0b">
            {penaltiesThisMonth.length === 0 ? (
              <div style={{ padding:'20px 16px', color:'#94a3b8', fontSize:13, textAlign:'center' }}>No late fees this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Member</th><th>Month</th><th>Amount</th></tr></thead>
                  <tbody>
                    {penaltiesThisMonth.map(p => {
                      const m = members[p.userId] || {};
                      return (
                        <tr key={p.id}>
                          <td><div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish||'Unknown'}</div><div style={{ fontSize:11, color:'#94a3b8' }}>{m.idNo||'—'}</div></td>
                          <td style={{ fontSize:12 }}>{ymShort(p.month)}</td>
                          <td style={{ fontWeight:600, color:'#f59e0b' }}>{fmt(p.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 4. Expenses ───────────────────────────────────────────────── */}
          <Section title="Expenses" icon="📤" count={expensesThisMonth.length} total={totalExpenses} color="#dc2626">
            {expensesThisMonth.length === 0 ? (
              <div style={{ padding:'20px 16px', color:'#94a3b8', fontSize:13, textAlign:'center' }}>No expenses recorded this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Title</th><th>Category</th><th>Date</th><th>Amount</th><th>Notes</th></tr></thead>
                  <tbody>
                    {expensesThisMonth.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontWeight:600, fontSize:13 }}>{e.title||'—'}</td>
                        <td><span className="badge badge-gray" style={{ fontSize:10 }}>{e.category||'—'}</span></td>
                        <td style={{ fontSize:12, color:'#94a3b8' }}>{e.date||'—'}</td>
                        <td style={{ fontWeight:700, color:'#dc2626' }}>{fmt(e.amount)}</td>
                        <td style={{ fontSize:11, color:'#64748b', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.notes||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 5. Other Income ───────────────────────────────────────────── */}
          <Section title="Other Income" icon="📥" count={incomesThisMonth.length} total={totalIncome} color="#2563eb">
            {incomesThisMonth.length === 0 ? (
              <div style={{ padding:'20px 16px', color:'#94a3b8', fontSize:13, textAlign:'center' }}>No other income this month.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead>
                  <tbody>
                    {incomesThisMonth.map(i => (
                      <tr key={i.id}>
                        <td style={{ fontWeight:600, fontSize:13 }}>{i.description||i.title||'—'}</td>
                        <td><span className="badge badge-blue" style={{ fontSize:10 }}>{i.category||'—'}</span></td>
                        <td style={{ fontSize:12, color:'#94a3b8' }}>{i.date||'—'}</td>
                        <td style={{ fontWeight:700, color:'#2563eb' }}>{fmt(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

        </div>
      )}

      {/* ── Monthly balance footer ─────────────────────────────────────────── */}
      {!loading && (
        <div style={{ marginTop:20, padding:'18px 22px', borderRadius:12, border:`2px solid ${netBalance>=0?'#bbf7d0':'#fecaca'}`, background:netBalance>=0?'#f0fdf4':'#fef2f2', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.07em' }}>Net Balance — {ymLabel(selMonth)}</div>
            <div style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>Income − Expenses</div>
          </div>
          <div style={{ fontSize:32, fontWeight:900, color:netBalance>=0?'#16a34a':'#dc2626', letterSpacing:'-0.02em' }}>
            {netBalance>=0?'+':''}{fmt(netBalance)}
          </div>
        </div>
      )}
    </div>
  );
}