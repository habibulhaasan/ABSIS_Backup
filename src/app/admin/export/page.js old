// src/app/admin/export/page.js
// Full org data export to multi-sheet XLSX using SheetJS (cdn loaded in artifact)
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  if (isNaN(d)) return String(ts||'');
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function fmtTS(ts) {
  if (!ts) return '';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function n(v) { return Number(v)||0; }

// ── SheetJS loader ────────────────────────────────────────────────────────────
function loadXLSX() {
  return new Promise((resolve,reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Sheet builders ────────────────────────────────────────────────────────────
function buildMembersSheet(members) {
  const hdr = [
    'Member ID','Name (English)','Name (Bangla)',
    "Father's (En)","Father's (Bn)","Mother's (En)","Mother's (Bn)",
    'DOB','NID','Blood Group','Marital Status','Education','Occupation',
    'Phone','Email',
    'Present Address (En)','Present Address (Bn)',
    'Permanent Address (En)','Permanent Address (Bn)',
    'Heir Name (En)','Heir Name (Bn)','Heir Relation','Heir NID','Heir Phone',
    'Application No','Application Date','Agreement No','Agreement Date',
    'Joining Date','Role','Status','Profile Submitted','Last Updated',
  ];
  const rows = members.map(m => [
    m.idNo, m.nameEnglish, m.nameBangla,
    m.fatherNameEn||m.fatherName, m.fatherNameBn,
    m.motherNameEn||m.motherName, m.motherNameBn,
    m.dob, m.nid, m.bloodGroup, m.maritalStatus, m.education, m.occupation,
    m.phone, m.email,
    m.presentAddressEn||m.presentAddress, m.presentAddressBn,
    m.permanentAddressEn||m.permanentAddress, m.permanentAddressBn,
    m.heirNameEn||m.heirName, m.heirNameBn,
    m.heirRelation, m.heirNID||m.nomineeNID, m.heirPhone||m.nomineePhone,
    m.applicationNo, m.applicationDate, m.agreementNo, m.agreementDate,
    fmtDate(m.joiningDate||m.createdAt),
    m.role||'member',
    m.approved?'Active':'Pending',
    m.profileSubmitted?'Yes':'No',
    fmtTS(m.profileUpdatedAt),
  ]);
  return [hdr, ...rows];
}

function buildCapitalSheet(payments, members) {
  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Date','Amount (৳)','Gateway Fee (৳)',
    'Method','Account','Status','Transaction Ref'];
  const rows = payments.map(p => {
    const m = memberMap[p.userId]||{};
    return [
      m.idNo||p.userId, m.nameEnglish||'—',
      fmtDate(p.createdAt), n(p.amount), n(p.gatewayFee),
      p.method, p.accountId, p.status, p.transactionId||'',
    ];
  });
  return [hdr, ...rows];
}

function buildExpensesSheet(expenses) {
  const hdr = ['Date','Title','Category','Amount (৳)','Notes','Recorded By'];
  const rows = expenses.map(e => [
    e.date||fmtDate(e.createdAt), e.title, e.category,
    n(e.amount), e.notes||'', e.recordedBy||'',
  ]);
  return [hdr, ...rows];
}

function buildProjectsSheet(projects) {
  const hdr = ['Title','Type','Return Type','Fund Source','Sector',
    'Invested (৳)','Expected Return %','Actual Return (৳)','Profit (৳)',
    'Status','Start Date','Completed Date','Notes'];
  const rows = projects.map(p => [
    p.title, p.type, p.returnType, p.fundSource||'investment', p.sector||'',
    n(p.investedAmount), n(p.expectedReturnPct),
    p.actualReturnAmount!=null?n(p.actualReturnAmount):'',
    p.profit!=null?n(p.profit):'',
    p.status, p.startDate||'', p.completedDate||'', p.notes||'',
  ]);
  return [hdr, ...rows];
}

function buildLoansSheet(loans, members) {
  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Amount (৳)','Purpose','Status',
    'Repayment Months','Monthly Instalment (৳)','Total Repaid (৳)',
    'Outstanding (৳)','Forgiven','Issue Date'];
  const rows = loans.map(l => {
    const m = memberMap[l.userId]||{};
    return [
      m.idNo||l.userId, m.nameEnglish||'—', n(l.amount), l.purpose||'',
      l.status, n(l.repaymentMonths), n(l.monthlyInstallment),
      n(l.totalRepaid), n(l.outstandingBalance),
      l.forgiven?'Yes':'No', fmtDate(l.createdAt),
    ];
  });
  return [hdr, ...rows];
}

function buildDistributionsSheet(dists) {
  const hdr = ['Period','Gross Profit (৳)','Reserve Deduction (৳)',
    'Welfare Deduction (৳)','Operations Deduction (৳)',
    'Distributable Profit (৳)','Distribution Rate','Total Capital (৳)',
    'Status','Date'];
  const rows = dists.map(d => [
    d.periodLabel||d.year||'', n(d.grossProfit),
    n(d.reserveDeduction), n(d.welfareDeduction), n(d.operationsDeduction),
    n(d.distributableProfit), d.distributionRate||'',
    n(d.totalCapital), d.status, fmtDate(d.createdAt),
  ]);
  return [hdr, ...rows];
}

function buildMemberSharesSheet(dists, members) {
  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Period','Member ID','Member Name','Capital (৳)','Share Amount (৳)'];
  const rows = [];
  dists.filter(d=>d.status==='distributed').forEach(d => {
    (d.memberShares||[]).forEach(s => {
      const m = memberMap[s.userId]||{};
      rows.push([
        d.periodLabel||d.year||'',
        m.idNo||s.userId, m.nameEnglish||'—',
        n(s.capital), n(s.shareAmount),
      ]);
    });
  });
  return [hdr, ...rows];
}

function buildEntryFeesSheet(fees, members) {
  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Amount (৳)','Method','Paid At','Recorded By'];
  const rows = fees.map(f => {
    const m = memberMap[f.userId]||{};
    return [
      m.idNo||f.userId, m.nameEnglish||'—',
      n(f.amount), f.method||'', fmtDate(f.paidAt||f.createdAt), f.recordedBy||'',
    ];
  });
  return [hdr, ...rows];
}

function buildMemorandaSheet(memos) {
  const hdr = ['Memo No.','Category','Year','Date','Title','Sender','Recipient',
    'Prepared By','Approved By','Status','Visible to Members','Content','Notes'];
  const rows = memos.map(m => [
    m.memoNo, m.category, m.year, m.date, m.title,
    m.sender||'', m.recipient||'', m.preparedBy||'', m.approvedBy||'',
    m.status, m.visibleToMembers?'Yes':'No',
    m.content||'', m.notes||'',
  ]);
  return [hdr, ...rows];
}

function buildMemberLedgersSheet(payments, dists, loans, members) {
  const memberMap = Object.fromEntries(members.map(m=>[m.id,m]));
  const rows = [
    ['Member ID','Member Name','Date','Type','Description','Credit (৳)','Debit (৳)','Balance (৳)'],
  ];
  // Collect all events per member, sort by date, running balance
  const byMember = {};
  payments.filter(p=>p.status==='verified').forEach(p => {
    if (!byMember[p.userId]) byMember[p.userId]=[];
    byMember[p.userId].push({date:p.createdAt,type:'Capital',desc:`${p.method||''} payment`,credit:n(p.amount)-n(p.gatewayFee),debit:0});
  });
  dists.filter(d=>d.status==='distributed').forEach(d => {
    (d.memberShares||[]).forEach(s => {
      if (!byMember[s.userId]) byMember[s.userId]=[];
      byMember[s.userId].push({date:d.createdAt,type:'Profit',desc:`Distribution ${d.periodLabel||d.year||''}`,credit:n(s.shareAmount),debit:0});
    });
  });
  loans.filter(l=>l.status==='disbursed'||l.status==='repaid').forEach(l => {
    if (!byMember[l.userId]) byMember[l.userId]=[];
    byMember[l.userId].push({date:l.createdAt,type:'Loan',desc:`Loan disbursed`,credit:0,debit:n(l.amount)});
  });

  Object.entries(byMember).forEach(([uid,events]) => {
    const m = memberMap[uid]||{};
    events.sort((a,b)=>(a.date?.seconds||0)-(b.date?.seconds||0));
    let bal = 0;
    events.forEach(e => {
      bal += e.credit - e.debit;
      rows.push([m.idNo||uid,m.nameEnglish||'—',fmtDate(e.date),e.type,e.desc,e.credit||'',e.debit||'',bal]);
    });
  });
  return rows;
}

// ── XLSX write helper ─────────────────────────────────────────────────────────
function arrayToSheet(XLSX, data) {
  const ws = XLSX.utils.aoa_to_sheet(data);
  // Style header row (bold via col widths + auto-fit)
  const cols = data[0]?.map(h=>({wch:Math.max(12,String(h||'').length+2)}));
  if (cols) ws['!cols'] = cols;
  return ws;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminExport() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId   = userData?.activeOrgId;
  const orgName = orgData?.name || 'Organization';

  const [loading,    setLoading]    = useState(false);
  const [progress,   setProgress]   = useState('');
  const [done,       setDone]       = useState(false);
  const [stats,      setStats]      = useState(null);

  if (!isOrgAdmin) return null;

  const SHEETS = [
    { key:'members',       label:'Members',          desc:'Full member profiles with all bilingual fields' },
    { key:'capital',       label:'Capital Payments', desc:'All installment payment records' },
    { key:'ledger',        label:'Member Ledgers',   desc:'Running balance per member' },
    { key:'expenses',      label:'Expenses',         desc:'All expense records' },
    { key:'projects',      label:'Investments',      desc:'Investment project details' },
    { key:'loans',         label:'Loans (Qard)',     desc:'Loan disbursements and repayments' },
    { key:'distributions', label:'Distributions',    desc:'Annual profit distribution records' },
    { key:'shares',        label:'Member Shares',    desc:'Per-member share for each distribution' },
    { key:'entryFees',     label:'Entry Fees',       desc:'One-time entry fee payments' },
    { key:'memoranda',     label:'Memoranda',        desc:'Notice and memo register' },
  ];

  const [selected, setSelected] = useState(new Set(SHEETS.map(s=>s.key)));
  const toggle = key => setSelected(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const handleExport = async () => {
    if (!orgId) return;
    setLoading(true); setDone(false); setStats(null);
    try {
      const XLSX = await loadXLSX();
      setProgress('Loading data…');

      // ONE parallel fetch for everything
      const [
        memberSnap, paySnap, expSnap, projSnap,
        loanSnap, distSnap, feeSnap, memoSnap,
      ] = await Promise.all([
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(query(collection(db,'organizations',orgId,'investments'),orderBy('createdAt','desc'))),
        getDocs(query(collection(db,'organizations',orgId,'expenses'),orderBy('createdAt','desc'))),
        getDocs(collection(db,'organizations',orgId,'investmentProjects')),
        getDocs(collection(db,'organizations',orgId,'loans')),
        getDocs(query(collection(db,'organizations',orgId,'profitDistributions'),orderBy('createdAt','desc'))),
        getDocs(collection(db,'organizations',orgId,'entryFees')),
        getDocs(query(collection(db,'organizations',orgId,'memoranda'),orderBy('createdAt','desc'))),
      ]);

      // Merge member data with user profiles
      setProgress('Merging member profiles…');
      const memberDocs = memberSnap.docs.map(d=>({id:d.id,...d.data()}));
      const members = await Promise.all(memberDocs.map(async m => {
        try {
          const uSnap = await getDoc(doc(db,'users',m.id));
          return uSnap.exists() ? {...uSnap.data(),...m,id:m.id} : m;
        } catch { return m; }
      }));

      const payments      = paySnap.docs.map(d=>({id:d.id,...d.data()}));
      const expenses      = expSnap.docs.map(d=>({id:d.id,...d.data()}));
      const projects      = projSnap.docs.map(d=>({id:d.id,...d.data()}));
      const loans         = loanSnap.docs.map(d=>({id:d.id,...d.data()}));
      const distributions = distSnap.docs.map(d=>({id:d.id,...d.data()}));
      const entryFees     = feeSnap.docs.map(d=>({id:d.id,...d.data()}));
      const memoranda     = memoSnap.docs.map(d=>({id:d.id,...d.data()}));

      setProgress('Building spreadsheet…');
      const wb = XLSX.utils.book_new();

      // Summary sheet — always included
      const summaryDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
      const feeInAcct   = !!orgData?.settings?.gatewayFeeInAccounting;
      const totalCap    = payments.filter(p=>p.status==='verified')
        .reduce((s,p)=>s+n(p.amount)-(feeInAcct?0:n(p.gatewayFee)),0);

      XLSX.utils.book_append_sheet(wb, arrayToSheet(XLSX, [
        ['Organization Export Summary'],
        [''],
        ['Organization', orgName],
        ['Export Date',  summaryDate],
        [''],
        ['Data', 'Count / Value'],
        ['Total Members',      members.length],
        ['Active Members',     members.filter(m=>m.approved).length],
        ['Total Capital (৳)',  totalCap],
        ['Total Expenses (৳)', expenses.reduce((s,e)=>s+n(e.amount),0)],
        ['Active Projects',    projects.filter(p=>p.status==='active').length],
        ['Active Loans',       loans.filter(l=>l.status==='disbursed').length],
        ['Distributions',      distributions.filter(d=>d.status==='distributed').length],
        ['Memoranda',          memoranda.length],
      ]), 'Summary');

      const MAP = {
        members:       ()=>buildMembersSheet(members),
        capital:       ()=>buildCapitalSheet(payments,members),
        ledger:        ()=>buildMemberLedgersSheet(payments,distributions,loans,members),
        expenses:      ()=>buildExpensesSheet(expenses),
        projects:      ()=>buildProjectsSheet(projects),
        loans:         ()=>buildLoansSheet(loans,members),
        distributions: ()=>buildDistributionsSheet(distributions),
        shares:        ()=>buildMemberSharesSheet(distributions,members),
        entryFees:     ()=>buildEntryFeesSheet(entryFees,members),
        memoranda:     ()=>buildMemorandaSheet(memoranda),
      };

      SHEETS.filter(s=>selected.has(s.key)).forEach(s => {
        setProgress(`Building ${s.label}…`);
        try {
          XLSX.utils.book_append_sheet(wb, arrayToSheet(XLSX, MAP[s.key]()), s.label);
        } catch(e) { console.warn('Sheet error:',s.key,e); }
      });

      const filename = `${orgName.replace(/[^a-z0-9]/gi,'_')}_export_${new Date().toISOString().slice(0,10)}.xlsx`;
      XLSX.writeFile(wb, filename);

      setStats({
        members:members.length, payments:payments.length, expenses:expenses.length,
        projects:projects.length, loans:loans.length, distributions:distributions.length,
        memoranda:memoranda.length, sheets:selected.size+1,
      });
      setDone(true);
      setProgress('');
    } catch(e) {
      setProgress('Error: '+e.message);
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Export Data</div>
        <div className="page-subtitle">
          Download all organization data as a multi-sheet Excel file (.xlsx)
        </div>
      </div>

      {/* Sheet selector */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',
        padding:'20px',marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:4}}>
          Select Sheets to Include
        </div>
        <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>
          A Summary sheet is always included. Choose which data sheets to export.
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:10}}>
          {SHEETS.map(s=>(
            <label key={s.key}
              style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',
                borderRadius:8,border:`1.5px solid ${selected.has(s.key)?'#2563eb':'#e2e8f0'}`,
                background:selected.has(s.key)?'#eff6ff':'#fff',cursor:'pointer',
                transition:'all 0.15s'}}>
              <input type="checkbox" checked={selected.has(s.key)}
                onChange={()=>toggle(s.key)}
                style={{marginTop:2,flexShrink:0,width:15,height:15}}/>
              <div>
                <div style={{fontWeight:600,fontSize:13,
                  color:selected.has(s.key)?'#1d4ed8':'#0f172a'}}>
                  {s.label}
                </div>
                <div style={{fontSize:11,color:'#64748b',marginTop:1}}>{s.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{marginTop:14,display:'flex',gap:10}}>
          <button onClick={()=>setSelected(new Set(SHEETS.map(s=>s.key)))}
            style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:12,color:'#475569'}}>
            Select All
          </button>
          <button onClick={()=>setSelected(new Set())}
            style={{padding:'6px 14px',borderRadius:7,border:'1px solid #e2e8f0',
              background:'#fff',cursor:'pointer',fontSize:12,color:'#475569'}}>
            Clear All
          </button>
        </div>
      </div>

      {/* Export button */}
      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e2e8f0',padding:'20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <button onClick={handleExport}
            disabled={loading||selected.size===0}
            className="btn-primary"
            style={{padding:'12px 28px',fontSize:14,flexShrink:0}}>
            {loading ? '⏳ Exporting…' : `⬇ Export ${selected.size+1} Sheets`}
          </button>
          {progress && (
            <span style={{fontSize:13,color:'#64748b'}}>{progress}</span>
          )}
          {done && !loading && (
            <span style={{fontSize:13,color:'#15803d',fontWeight:600}}>
              ✅ Downloaded! Check your downloads folder.
            </span>
          )}
        </div>

        {stats && (
          <div style={{marginTop:16,display:'grid',
            gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10}}>
            {[
              ['Members',   stats.members],
              ['Payments',  stats.payments],
              ['Expenses',  stats.expenses],
              ['Projects',  stats.projects],
              ['Loans',     stats.loans],
              ['Distributions',stats.distributions],
              ['Memoranda', stats.memoranda],
              ['Sheets',    stats.sheets],
            ].map(([l,v])=>(
              <div key={l} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#94a3b8',
                  textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:2}}>{l}</div>
                <div style={{fontSize:18,fontWeight:700,color:'#0f172a'}}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{marginTop:14,padding:'10px 14px',borderRadius:8,
        background:'#fffbeb',border:'1px solid #fde68a',fontSize:12,color:'#92400e'}}>
        ⚠️ Export loads all data in one pass — on large organizations this may take 10–30 seconds.
        The file is generated in your browser and downloaded locally. No data leaves your Firestore.
      </div>
    </div>
  );
}