// src/app/admin/reports/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n) { return `৳${(n||0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }
function monthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return `${MONTHS[+m-1]} ${y}`;
}

export default function AdminReports() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId   = userData?.activeOrgId;
  const currency = orgData?.currency || '৳';
  const settings = orgData?.settings || {};

  const [loading, setLoading] = useState(true);
  const [members,   setMembers]   = useState([]);
  const [payments,  setPayments]  = useState([]);
  const [expenses,  setExpenses]  = useState([]);
  const [incomes,   setIncomes]   = useState([]);
  const [deployments, setDeployments] = useState([]);

  // month filter  (YYYY-MM)
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [selMonth, setSelMonth] = useState('all');

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [memSnap, paySnap, expSnap, incSnap, depSnap] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(collection(db,'organizations',orgId,'expenses')),
        getDocs(collection(db,'organizations',orgId,'income')),
        getDocs(collection(db,'organizations',orgId,'deployments')),
      ]);

      // Merge member profiles
      const rawMembers = memSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      const merged = await Promise.all(rawMembers.map(async m => {
        try { const u = await getDoc(doc(db,'users',m.id)); return u.exists() ? { ...u.data(), ...m } : m; }
        catch { return m; }
      }));
      setMembers(merged);
      setPayments(paySnap.docs.map(d => ({ id:d.id, ...d.data() })));
      setExpenses(expSnap.docs.map(d => ({ id:d.id, ...d.data() })));
      setIncomes(incSnap.docs.map(d => ({ id:d.id, ...d.data() })));
      setDeployments(depSnap.docs.map(d => ({ id:d.id, ...d.data() })));
      setLoading(false);
    })();
  }, [orgId]);

  // Build available months from payments
  const allMonths = [...new Set(
    payments.flatMap(p => p.paidMonths || [])
  )].sort().reverse();

  // Filter payments by month
  const filteredPay = selMonth === 'all'
    ? payments.filter(p => p.status === 'verified')
    : payments.filter(p => p.status === 'verified' && (p.paidMonths||[]).includes(selMonth));

  const filteredExp = selMonth === 'all'
    ? expenses
    : expenses.filter(e => {
        if (!e.date) return false;
        return e.date.startsWith(selMonth);
      });

  const filteredInc = selMonth === 'all'
    ? incomes
    : incomes.filter(i => {
        if (!i.date) return false;
        return i.date.startsWith(selMonth);
      });

  // When gatewayFeeInAccounting is ON, include gateway fees in the donation total
  const feeInAccounting = !!settings.gatewayFeeInAccounting;
  const donationNet = (p) => (p.amount||0) - (p.penaltyPaid||0) - (feeInAccounting ? 0 : (p.gatewayFee||0));

  // Summary numbers
  const totalDonations = filteredPay.reduce((s,p) => s + donationNet(p), 0);
  const totalPenalties  = filteredPay.reduce((s,p) => s + (p.penaltyPaid||0), 0);
  const totalExpenses   = filteredExp.reduce((s,e) => s + (e.amount||0), 0);
  const totalManual     = filteredInc.reduce((s,i) => s + (i.amount||0), 0);
  const totalIncome     = totalDonations + totalPenalties + totalManual;
  const netBalance      = totalIncome - totalExpenses;

  // Member-wise summary
  const memberSummary = members.map(m => {
    const myPay = filteredPay.filter(p => p.userId === m.id);
    return {
      ...m,
      paid:   myPay.length,
      total:  myPay.reduce((s,p) => s + donationNet(p), 0),
      penalty:myPay.reduce((s,p) => s + (p.penaltyPaid||0), 0),
    };
  }).sort((a,b) => b.total - a.total);

  // Download CSV
  const downloadCSV = () => {
    const rows = [
      ['Organization Report', orgData?.name || ''],
      ['Period', selMonth === 'all' ? 'All Time' : monthLabel(selMonth)],
      [],
      ['=== INCOME SUMMARY ==='],
      ['Category', 'Amount'],
      ['Monthly Donations', totalDonations],
      ['Late Fees', totalPenalties],
      ['Manual Income', totalManual],
      ['TOTAL INCOME', totalIncome],
      [],
      ['=== EXPENSES ==='],
      ['Category', 'Amount'],
      ['Total Expenses', totalExpenses],
      [],
      ['NET BALANCE', netBalance],
      [],
      ['=== MEMBER PAYMENTS ==='],
      ['Name','ID','Months Paid','Amount','Penalties'],
      ...memberSummary.map(m => [m.nameEnglish||'', m.idNo||'', m.paid, m.total, m.penalty]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `report_${orgData?.name||'org'}_${selMonth}.csv`;
    a.click();
  };

  if (!isOrgAdmin) return <div className="page-wrap"><div style={{textAlign:'center',padding:80,color:'#94a3b8'}}>Admin only.</div></div>;

  if (!orgData?.features?.advancedReports) return (
    <div className="page-wrap">
      <div style={{ textAlign:'center', padding:80 }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Feature Not Enabled</div>
        <div style={{ fontSize:13, color:'#64748b' }}>Advanced Reports is not enabled for this organization.<br />Contact your platform superadmin.</div>
      </div>
    </div>
  );

  return (
    <div className="page-wrap animate-fade">
      {/* Org header */}
      <div className="page-header" style={{ display:'flex', alignItems:'center', gap:14 }}>
        {orgData?.logoURL && (
          <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0, border:'1px solid #e2e8f0' }}>
            <img src={orgData.logoURL} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
          </div>
        )}
        <div style={{ flex:1 }}>
          <div className="page-title">Advanced Reports</div>
          <div className="page-subtitle">{orgData?.name} · {orgData?.currency || 'BDT'}</div>
        </div>
        <button onClick={downloadCSV} className="btn-primary" style={{ padding:'9px 18px', fontSize:13, flexShrink:0 }}>
          ⬇ Download CSV
        </button>
      </div>

      {/* Month filter */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20 }}>
        <button onClick={() => setSelMonth('all')}
          className={selMonth==='all' ? 'btn-primary' : 'btn-ghost'} style={{ padding:'8px 14px', fontSize:12 }}>
          All Time
        </button>
        {allMonths.map(m => (
          <button key={m} onClick={() => setSelMonth(m)}
            className={selMonth===m ? 'btn-primary' : 'btn-ghost'} style={{ padding:'8px 14px', fontSize:12 }}>
            {monthLabel(m)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Loading report…</div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:12, marginBottom:20 }}>
            {[
              ['Total Income',   fmt(totalIncome),   '#16a34a'],
              ['Donations',      fmt(totalDonations), '#2563eb'],
              ['Late Fees',      fmt(totalPenalties), '#d97706'],
              ['Manual Income',  fmt(totalManual),    '#7c3aed'],
              ['Expenses',       fmt(totalExpenses),  '#dc2626'],
              ['Net Balance',    fmt(netBalance),     netBalance>=0?'#16a34a':'#dc2626'],
            ].map(([l,v,c]) => (
              <div key={l} className="stat-card">
                <div className="stat-label">{l}</div>
                <div className="stat-value" style={{ color:c, fontSize:18 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Member-wise table */}
          <div className="card">
            <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:14 }}>Member Payment Breakdown</div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Member</th><th>ID</th><th>Months Paid</th><th>Contributions</th><th>Late Fees</th></tr>
                </thead>
                <tbody>
                  {memberSummary.map(m => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ fontWeight:600, fontSize:13 }}>{m.nameEnglish||'(no name)'}</div>
                        <div style={{ fontSize:11, color:'#94a3b8' }}>{m.email||''}</div>
                      </td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{m.idNo||'—'}</td>
                      <td><span className="badge badge-blue">{m.paid}</span></td>
                      <td style={{ fontWeight:600, color:'#16a34a' }}>{fmt(m.total)}</td>
                      <td style={{ color: m.penalty>0?'#d97706':'#94a3b8', fontWeight: m.penalty>0?600:400 }}>{fmt(m.penalty)}</td>
                    </tr>
                  ))}
                  {memberSummary.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign:'center', color:'#94a3b8', padding:32 }}>No payment data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Expense breakdown */}
          {filteredExp.length > 0 && (
            <div className="card" style={{ marginTop:16 }}>
              <div style={{ fontWeight:700, fontSize:14, color:'#dc2626', marginBottom:14 }}>Expenses</div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Title</th><th>Category</th><th>Date</th><th>Amount</th></tr></thead>
                  <tbody>
                    {filteredExp.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontWeight:500 }}>{e.title||'—'}</td>
                        <td><span className="badge badge-gray">{e.category||'—'}</span></td>
                        <td style={{ fontSize:12, color:'#94a3b8' }}>{e.date||'—'}</td>
                        <td style={{ fontWeight:600, color:'#dc2626' }}>{fmt(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
