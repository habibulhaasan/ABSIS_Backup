// src/app/admin/export/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(d)) return String(ts || '');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTS(ts) {
  if (!ts) return '';
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function n(v) { return Number(v) || 0; }

function buildCSV(rows) {
  return rows.map(row =>
    row.map(v => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');
}
function downloadCSV(rows, filename) {
  const bom  = '\uFEFF';
  const csv  = bom + buildCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function loadXLSX() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Sheet builders (unchanged from original) ──────────────────────────────────
function buildMembersSheet(members) {
  const hdr = [
    'Member ID','Name (English)','Name (বাংলা)',
    "Father's Name (En)","Father's Name (বাংলা)",
    "Mother's Name (En)","Mother's Name (বাংলা)",
    "Spouse Name (En)","Spouse Name (বাংলা)",
    'Date of Birth','NID','Blood Group','Marital Status',
    'Education','Occupation','Monthly Income',
    'Phone','Alternative Phone','Email',
    'Present Address (En)','Present Address (বাংলা)',
    'Permanent Address (En)','Permanent Address (বাংলা)',
    'Heir Name (En)','Heir Name (বাংলা)','Heir Relation',
    'Heir NID','Heir Phone','Nominee Photo URL',
    'Application No','Application Date',
    'Agreement No','Agreement Date',
    'Joining Date','Role','Status',
    'Entry Fee Paid','Is Late Payer','Re-reg Required','Re-reg Granted',
    'Committee Role','Member Status','Exit Date',
    'Profile Submitted','Last Updated',
    'Drive Folder ID','Photo URL','Drive Folder Link',
    'Legal Files Count',
  ];
  const rows = members.map(m => [
    m.idNo, m.nameEnglish, m.nameBengali,
    m.fatherNameEn||m.fatherName, m.fatherNameBn,
    m.motherNameEn||m.motherName, m.motherNameBn,
    m.spouseNameEn, m.spouseNameBn,
    m.dob, m.nid, m.bloodGroup, m.maritalStatus,
    m.education, m.occupation, m.monthlyIncome||'',
    m.phone, m.alternativePhone||'', m.email,
    m.presentAddressEn||m.presentAddress, m.presentAddressBn,
    m.permanentAddressEn||m.permanentAddress, m.permanentAddressBn,
    m.heirNameEn||m.heirName, m.heirNameBn, m.heirRelation,
    m.heirNID||m.nomineeNID, m.heirPhone||m.nomineePhone,
    m.nomineePhotoURL||'',
    m.applicationNo, m.applicationDate,
    m.agreementNo, m.agreementDate,
    fmtDate(m.joiningDate||m.createdAt), m.role||'member',
    m.approved?'Active':'Pending',
    m.entryFeePaid?'Yes':'No',
    m.isLatePayer?'Yes':'No',
    m.reregRequired?'Yes':'No',
    m.reregGranted?'Yes (Waived)':'No',
    m.committeeRole||'', m.memberStatus||'active', m.exitDate||'',
    m.profileSubmitted?'Yes':'No', fmtTS(m.profileUpdatedAt),
    m.memberDriveFolderId||'', m.photoURL||'',
    m.memberDriveFolderId ? `https://drive.google.com/drive/folders/${m.memberDriveFolderId}` : '',
    (m.legalFiles||[]).length,
  ]);
  return [hdr, ...rows];
}
function buildMemberFilesSheet(members) {
  const hdr = ['Member ID','Member Name','File Title','Category','Description','Uploaded By','Uploaded At','Drive URL','Drive File ID','MIME Type','File Name on Drive'];
  const rows = [];
  members.forEach(m => {
    const files = m.legalFiles || [];
    if (!files.length) {
      rows.push([m.idNo||m.id, m.nameEnglish||'—','(no files)','','','','','','','','']);
    } else {
      files.forEach(f => rows.push([
        m.idNo||m.id, m.nameEnglish||'—',
        f.title||f.name||'—', f.category||'—', f.description||'',
        f.uploadedBy||'—',
        f.uploadedAt ? fmtTS({ seconds: Math.floor(new Date(f.uploadedAt).getTime()/1000) }) : '',
        f.url||f.viewUrl||'', f.fileId||'', f.mimeType||'', f.driveFileName||f.name||'',
      ]));
    }
  });
  return [hdr, ...rows];
}
function buildMemberPhotosSheet(members) {
  const hdr = ['Member ID','Member Name','Profile Photo URL','Nominee Photo URL','Drive Folder ID','Drive Folder Link'];
  const rows = members.map(m => [
    m.idNo||m.id, m.nameEnglish||'—',
    m.photoURL||'', m.nomineePhotoURL||'',
    m.memberDriveFolderId||'',
    m.memberDriveFolderId ? `https://drive.google.com/drive/folders/${m.memberDriveFolderId}` : '',
  ]);
  return [hdr, ...rows];
}
function buildCapitalSheet(payments, members) {
  const mm = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Date','Amount (৳)','Gateway Fee (৳)','Method','Account','Status','Transaction Ref'];
  return [hdr, ...payments.map(p => {
    const m = mm[p.userId]||{};
    return [m.idNo||p.userId, m.nameEnglish||'—', fmtDate(p.createdAt), n(p.amount), n(p.gatewayFee), p.method, p.accountId, p.status, p.transactionId||''];
  })];
}
function buildExpensesSheet(expenses) {
  const hdr = ['Date','Title','Category','Amount (৳)','Notes','Recorded By'];
  return [hdr, ...expenses.map(e => [e.date||fmtDate(e.createdAt), e.title, e.category, n(e.amount), e.notes||'', e.recordedBy||''])];
}
function buildProjectsSheet(projects) {
  const hdr = ['Title','Type','Return Type','Fund Source','Sector','Invested (৳)','Expected Return %','Actual Return (৳)','Profit (৳)','Status','Start Date','Completed Date','Notes'];
  return [hdr, ...projects.map(p => [p.title, p.type, p.returnType, p.fundSource||'investment', p.sector||'', n(p.investedAmount), n(p.expectedReturnPct), p.actualReturnAmount!=null?n(p.actualReturnAmount):'', p.profit!=null?n(p.profit):'', p.status, p.startDate||'', p.completedDate||'', p.notes||''])];
}
function buildLoansSheet(loans, members) {
  const mm = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Amount (৳)','Purpose','Status','Repayment Months','Monthly Instalment (৳)','Total Repaid (৳)','Outstanding (৳)','Forgiven','Issue Date'];
  return [hdr, ...loans.map(l => {
    const m = mm[l.userId]||{};
    return [m.idNo||l.userId, m.nameEnglish||'—', n(l.amount), l.purpose||'', l.status, n(l.repaymentMonths), n(l.monthlyInstallment), n(l.totalRepaid), n(l.outstandingBalance), l.forgiven?'Yes':'No', fmtDate(l.createdAt)];
  })];
}
function buildDistributionsSheet(dists) {
  const hdr = ['Period','Gross Profit (৳)','Reserve Deduction (৳)','Welfare Deduction (৳)','Operations Deduction (৳)','Distributable Profit (৳)','Distribution Rate','Total Capital (৳)','Status','Date'];
  return [hdr, ...dists.map(d => [d.periodLabel||d.year||'', n(d.grossProfit), n(d.reserveDeduction), n(d.welfareDeduction), n(d.operationsDeduction), n(d.distributableProfit), d.distributionRate||'', n(d.totalCapital), d.status, fmtDate(d.createdAt)])];
}
function buildMemberSharesSheet(dists, members) {
  const mm = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Period','Member ID','Member Name','Capital (৳)','Share Amount (৳)'];
  const rows = [];
  dists.filter(d=>d.status==='distributed').forEach(d => {
    (d.memberShares||[]).forEach(s => {
      const m = mm[s.userId]||{};
      rows.push([d.periodLabel||d.year||'', m.idNo||s.userId, m.nameEnglish||'—', n(s.capital), n(s.shareAmount)]);
    });
  });
  return [hdr, ...rows];
}
function buildEntryFeesSheet(fees, members) {
  const mm = Object.fromEntries(members.map(m=>[m.id,m]));
  const hdr = ['Member ID','Member Name','Amount (৳)','Method','Paid At','Recorded By'];
  return [hdr, ...fees.map(f => {
    const m = mm[f.userId]||{};
    return [m.idNo||f.userId, m.nameEnglish||'—', n(f.amount), f.method||'', fmtDate(f.paidAt||f.createdAt), f.recordedBy||''];
  })];
}
function buildMemorandaSheet(memos) {
  const hdr = ['Memo No.','Category','Year','Date','Title','Sender','Recipient','Prepared By','Approved By','Status','Visible to Members','Content (first 500 chars)','Full Content Length','Notes','Attachment File ID','Attachment URL'];
  return [hdr, ...memos.map(m => [
    m.memoNo, m.category, m.year, m.date, m.title,
    m.sender||'', m.recipient||'', m.preparedBy||'', m.approvedBy||'',
    m.status, m.visibleToMembers?'Yes':'No',
    (m.content||'').slice(0,500)+((m.content||'').length>500?'…':''),
    (m.content||'').length,
    (m.notes||'').slice(0,500)+((m.notes||'').length>500?'…':''),
    m.fileId||'',
    m.fileId ? `https://drive.google.com/file/d/${m.fileId}/view` : (m.fileUrl||''),
  ])];
}
function buildMemberLedgersSheet(payments, dists, loans, members) {
  const mm = Object.fromEntries(members.map(m=>[m.id,m]));
  const rows = [['Member ID','Member Name','Date','Type','Description','Credit (৳)','Debit (৳)','Balance (৳)']];
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
    byMember[l.userId].push({date:l.createdAt,type:'Loan',desc:'Loan disbursed',credit:0,debit:n(l.amount)});
  });
  Object.entries(byMember).forEach(([uid,events]) => {
    const m = mm[uid]||{};
    events.sort((a,b)=>(a.date?.seconds||0)-(b.date?.seconds||0));
    let bal = 0;
    events.forEach(e => {
      bal += e.credit - e.debit;
      rows.push([m.idNo||uid, m.nameEnglish||'—', fmtDate(e.date), e.type, e.desc, e.credit||'', e.debit||'', bal]);
    });
  });
  return rows;
}

const CELL_LIMIT = 32700;
function safeCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT) + '…' : s;
}
function sanitizeData(data) {
  return data.map(row =>
    Array.isArray(row) ? row.map(cell => {
      if (cell === null || cell === undefined || typeof cell === 'number' || typeof cell === 'boolean') return cell;
      return safeCell(cell);
    }) : row
  );
}
function arrayToSheet(XLSX, data) {
  const safe = sanitizeData(data);
  const ws   = XLSX.utils.aoa_to_sheet(safe);
  const cols  = safe[0]?.map(h => ({ wch: Math.max(14, String(h||'').length + 2) }));
  if (cols) ws['!cols'] = cols;
  if (data.length > 1) {
    const urlColIdxs = data[0]
      .map((h,i) => ({ h: String(h||''), i }))
      .filter(({ h }) => h.toLowerCase().includes('url') || h.toLowerCase().includes('link') || h.toLowerCase().includes('drive'))
      .map(({ i }) => i);
    urlColIdxs.forEach(ci => {
      for (let ri = 1; ri < data.length; ri++) {
        const val = data[ri][ci];
        if (val && String(val).startsWith('http')) {
          const cellRef = XLSX.utils.encode_cell({ r: ri, c: ci });
          if (ws[cellRef]) ws[cellRef].l = { Target: String(val), Tooltip: String(val) };
        }
      }
    });
  }
  return ws;
}

// ── Shared data loader ────────────────────────────────────────────────────────
async function loadAllData(db, orgId) {
  const [memberSnap, paySnap, expSnap, projSnap, loanSnap, distSnap, feeSnap, memoSnap] =
    await Promise.all([
      getDocs(collection(db, 'organizations', orgId, 'members')),
      getDocs(query(collection(db, 'organizations', orgId, 'investments'), orderBy('createdAt', 'desc'))),
      getDocs(query(collection(db, 'organizations', orgId, 'expenses'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'organizations', orgId, 'investmentProjects')),
      getDocs(collection(db, 'organizations', orgId, 'loans')),
      getDocs(query(collection(db, 'organizations', orgId, 'profitDistributions'), orderBy('createdAt', 'desc'))),
      getDocs(collection(db, 'organizations', orgId, 'entryFees')),
      getDocs(query(collection(db, 'organizations', orgId, 'memoranda'), orderBy('createdAt', 'desc'))),
    ]);
  const memberDocs = memberSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const members = await Promise.all(memberDocs.map(async m => {
    try {
      const uSnap = await getDoc(doc(db, 'users', m.id));
      return uSnap.exists() ? { ...uSnap.data(), ...m, id: m.id } : m;
    } catch { return m; }
  }));
  return {
    members,
    payments:      paySnap.docs.map(d => ({ id: d.id, ...d.data() })),
    expenses:      expSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    projects:      projSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    loans:         loanSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    distributions: distSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    entryFees:     feeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    memoranda:     memoSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// ── Backups Tab ───────────────────────────────────────────────────────────────
function BackupsTab({ orgId }) {
  const [backups,   setBackups]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [running,   setRunning]   = useState(false);
  const [runStatus, setRunStatus] = useState('');

  useEffect(() => {
    if (!orgId) return;
    const q = query(
      collection(db, 'organizations', orgId, 'backups'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setBackups(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [orgId]);

  const handleManualBackup = async () => {
    setRunning(true);
    setRunStatus('⏳ Triggering backup…');
    try {
      const secret = process.env.NEXT_PUBLIC_BACKUP_SECRET;
      const res    = await fetch(`/api/backup?secret=${encodeURIComponent(secret)}&manual=1`);
      const data   = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'API error');
      setRunStatus('✅ Backup triggered! Apps Script will upload to Drive shortly.');
    } catch (e) {
      setRunStatus('❌ Error: ' + e.message);
    }
    setRunning(false);
  };

  const fmtSize = bytes => {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>🛡 Auto Backup Log</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Daily backups at 11:59 PM · Stored in Google Drive · Last 14 kept
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {runStatus && (
            <span style={{ fontSize: 12, color: runStatus.startsWith('✅') ? '#15803d' : runStatus.startsWith('❌') ? '#dc2626' : '#64748b' }}>
              {runStatus}
            </span>
          )}
          <button onClick={handleManualBackup} disabled={running}
            style={{ padding: '9px 20px', borderRadius: 8, background: '#0f172a', color: '#fff',
              border: 'none', cursor: running ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 700, opacity: running ? 0.7 : 1, whiteSpace: 'nowrap' }}>
            {running ? '⏳ Running…' : '▶ Run Backup Now'}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div style={{ padding: '10px 14px', borderRadius: 8, background: '#eff6ff',
        border: '1px solid #bfdbfe', fontSize: 12, color: '#1e40af', marginBottom: 16 }}>
        <strong>How it works:</strong> Google Apps Script calls this app's backup API at 11:59 PM daily,
        fetches all Firestore data, uploads a JSON file to Google Drive, then logs it here.
        Click any Drive link to download the backup file directly.
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
          Loading backup history…
        </div>
      ) : backups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13,
          border: '1px dashed #e2e8f0', borderRadius: 10 }}>
          No backups yet. The first backup will run tonight at 11:59 PM,
          or click "Run Backup Now" to trigger one immediately.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Date & Time', 'File Name', 'Size', 'Triggered By', 'Status', 'Drive Link'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700,
                    fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {backups.map((b, i) => (
                <tr key={b.id}
                  style={{ background: i % 2 === 0 ? '#fff' : '#fafafa',
                    borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'}>
                  <td style={{ padding: '10px 12px', color: '#0f172a', whiteSpace: 'nowrap' }}>
                    {fmtTS(b.createdAt)}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#475569', fontFamily: 'monospace',
                    fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.fileName || '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {fmtSize(b.sizeBytes)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                      fontSize: 11, fontWeight: 600,
                      background: b.triggeredBy === 'manual' ? '#fef9c3' : '#f0fdf4',
                      color:      b.triggeredBy === 'manual' ? '#854d0e'  : '#15803d',
                    }}>
                      {b.triggeredBy === 'manual' ? '🖱 Manual' : '🤖 Auto'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                      fontSize: 11, fontWeight: 600,
                      background: b.status === 'success' ? '#f0fdf4' : '#fef2f2',
                      color:      b.status === 'success' ? '#15803d'  : '#dc2626',
                    }}>
                      {b.status === 'success' ? '✅ Success' : '❌ Failed'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {b.driveUrl ? (
                      <a href={b.driveUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                          color: '#2563eb', fontWeight: 600, fontSize: 12,
                          textDecoration: 'none', padding: '4px 10px',
                          borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#dbeafe'}
                        onMouseLeave={e => e.currentTarget.style.background = '#eff6ff'}>
                        📂 Open in Drive
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>
                        {b.status === 'success' ? '⏳ Uploading…' : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 12, color: '#94a3b8' }}>
        Showing {backups.length} backup{backups.length !== 1 ? 's' : ''} · Drive folder:{' '}
        <a href="https://drive.google.com/drive/folders/1TU2tYkPRvkj8apac4kydPUZEztALFr6v"
          target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
          Open backup folder ↗
        </a>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const SHEETS = [
  { key: 'members',       label: 'Members',          desc: 'Full member profiles with all bilingual fields' },
  { key: 'memberFiles',   label: 'Member Files',     desc: 'All uploaded documents per member with Drive links', badge: 'new' },
  { key: 'memberPhotos',  label: 'Photos & Folders', desc: 'Profile/nominee photos and Drive folder links', badge: 'new' },
  { key: 'capital',       label: 'Capital Payments', desc: 'All installment payment records' },
  { key: 'ledger',        label: 'Member Ledgers',   desc: 'Running balance per member' },
  { key: 'expenses',      label: 'Expenses',         desc: 'All expense records' },
  { key: 'projects',      label: 'Investments',      desc: 'Investment project details' },
  { key: 'loans',         label: 'Loans (Qard)',     desc: 'Loan disbursements and repayments' },
  { key: 'distributions', label: 'Distributions',    desc: 'Annual profit distribution records' },
  { key: 'shares',        label: 'Member Shares',    desc: 'Per-member share for each distribution' },
  { key: 'entryFees',     label: 'Entry Fees',       desc: 'One-time entry fee payments' },
  { key: 'memoranda',     label: 'Memoranda',        desc: 'Notice and memo register with attachment links', badge: 'updated' },
];

const BADGE_CFG = {
  new:     { bg: '#dcfce7', color: '#15803d', label: 'NEW' },
  updated: { bg: '#eff6ff', color: '#1d4ed8', label: 'UPDATED' },
};

export default function AdminExport() {
  const { userData, orgData, isOrgAdmin } = useAuth();
  const orgId   = userData?.activeOrgId;
  const orgName = orgData?.name || 'Organization';

  const [activeTab, setActiveTab] = useState('export'); // 'export' | 'backups'

  const [loading,       setLoading]       = useState(false);
  const [progress,      setProgress]      = useState('');
  const [done,          setDone]          = useState(false);
  const [stats,         setStats]         = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupDone,    setBackupDone]    = useState(false);
  const [csvLoading,    setCsvLoading]    = useState(false);
  const [selected,      setSelected]      = useState(new Set(SHEETS.map(s => s.key)));

  if (!isOrgAdmin) return null;

  const toggle = key => setSelected(prev => {
    const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s;
  });

  // ── XLSX export ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!orgId) return;
    setLoading(true); setDone(false); setStats(null);
    try {
      const XLSX = await loadXLSX();
      setProgress('Loading data…');
      const { members, payments, expenses, projects, loans, distributions, entryFees, memoranda } =
        await loadAllData(db, orgId);

      const totalFiles = members.reduce((s, m) => s + (m.legalFiles?.length || 0), 0);
      setProgress('Building spreadsheet…');
      const wb = XLSX.utils.book_new();
      const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
      const totalCap  = payments.filter(p => p.status === 'verified')
        .reduce((s, p) => s + n(p.amount) - (feeInAcct ? 0 : n(p.gatewayFee)), 0);

      XLSX.utils.book_append_sheet(wb, arrayToSheet(XLSX, [
        ['Organization Export Summary'], [''],
        ['Organization', orgName],
        ['Export Date',  new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
        [''],
        ['Data', 'Count / Value'],
        ['Total Members',           members.length],
        ['Active Members',          members.filter(m => m.approved).length],
        ['Total Capital (৳)',        totalCap],
        ['Total Expenses (৳)',       expenses.reduce((s, e) => s + n(e.amount), 0)],
        ['Active Projects',         projects.filter(p => p.status === 'active').length],
        ['Active Loans',            loans.filter(l => l.status === 'disbursed').length],
        ['Distributions',           distributions.filter(d => d.status === 'distributed').length],
        ['Memoranda',               memoranda.length],
        ['Member Documents (total)', totalFiles],
      ]), 'Summary');

      const MAP = {
        members:       () => buildMembersSheet(members),
        memberFiles:   () => buildMemberFilesSheet(members),
        memberPhotos:  () => buildMemberPhotosSheet(members),
        capital:       () => buildCapitalSheet(payments, members),
        ledger:        () => buildMemberLedgersSheet(payments, distributions, loans, members),
        expenses:      () => buildExpensesSheet(expenses),
        projects:      () => buildProjectsSheet(projects),
        loans:         () => buildLoansSheet(loans, members),
        distributions: () => buildDistributionsSheet(distributions),
        shares:        () => buildMemberSharesSheet(distributions, members),
        entryFees:     () => buildEntryFeesSheet(entryFees, members),
        memoranda:     () => buildMemorandaSheet(memoranda),
      };

      SHEETS.filter(s => selected.has(s.key)).forEach(s => {
        setProgress(`Building ${s.label}…`);
        try {
          XLSX.utils.book_append_sheet(wb, arrayToSheet(XLSX, MAP[s.key]()), s.label);
        } catch (e) { console.warn('Sheet error:', s.key, e); }
      });

      const filename = `${orgName.replace(/[^a-z0-9]/gi, '_')}_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      setStats({ members: members.length, payments: payments.length, expenses: expenses.length, projects: projects.length, loans: loans.length, distributions: distributions.length, memoranda: memoranda.length, totalFiles, sheets: selected.size + 1 });
      setDone(true); setProgress('');
    } catch (e) { setProgress('Error: ' + e.message); console.error(e); }
    setLoading(false);
  };

  // ── CSV export ─────────────────────────────────────────────────────────────
  const handleCsvExport = async () => {
    if (!orgId) return;
    setCsvLoading(true);
    try {
      setProgress('Loading data for CSV…');
      const { members, payments, expenses, entryFees, loans, distributions, memoranda } =
        await loadAllData(db, orgId);
      const slug = orgName.replace(/[^a-z0-9]/gi, '_');
      const date = new Date().toISOString().slice(0, 10);
      setProgress('Writing CSVs…');
      downloadCSV(buildMembersSheet(members),                   `${slug}_members_${date}.csv`);
      downloadCSV(buildCapitalSheet(payments, members),         `${slug}_payments_${date}.csv`);
      downloadCSV(buildExpensesSheet(expenses),                 `${slug}_expenses_${date}.csv`);
      downloadCSV(buildEntryFeesSheet(entryFees, members),      `${slug}_entry_fees_${date}.csv`);
      downloadCSV(buildLoansSheet(loans, members),              `${slug}_loans_${date}.csv`);
      downloadCSV(buildDistributionsSheet(distributions),       `${slug}_distributions_${date}.csv`);
      downloadCSV(buildMemberSharesSheet(distributions, members), `${slug}_member_shares_${date}.csv`);
      const memoHdr = ['Memo No.','Category','Year','Date','Title','Sender','Recipient','Prepared By','Approved By','Status','Visible to Members','Full Content','Notes','Attachment File ID','Attachment URL'];
      const memoRows = memoranda.map(m => [m.memoNo||'', m.category||'', m.year||'', m.date||'', m.title||'', m.sender||'', m.recipient||'', m.preparedBy||'', m.approvedBy||'', m.status||'', m.visibleToMembers?'Yes':'No', m.content||'', m.notes||'', m.fileId||'', m.fileId ? `https://drive.google.com/file/d/${m.fileId}/view` : (m.fileUrl||'')]);
      downloadCSV([memoHdr, ...memoRows],                       `${slug}_memoranda_${date}.csv`);
      downloadCSV(buildMemberFilesSheet(members),               `${slug}_member_files_${date}.csv`);
      setProgress('');
    } catch (e) { setProgress('CSV Error: ' + e.message); console.error(e); }
    setCsvLoading(false);
  };

  // ── JSON backup (browser download, unchanged) ──────────────────────────────
  const handleBackup = async () => {
    if (!orgId) return;
    setBackupLoading(true); setBackupDone(false);
    try {
      setProgress('Loading all collections…');
      const COLLECTIONS = ['members','investments','entryFees','expenses','investmentProjects','profitDistributions','loans','memoranda','specialSubscriptions','notifications','files','income','assets','penalties'];
      const backup = {
        _meta: { orgId, orgName, exportedAt: new Date().toISOString(), exportedBy: userData?.nameEnglish || userData?.email || 'admin', version: '1.0', collections: COLLECTIONS },
        org: orgData, collections: {},
      };
      for (const col of COLLECTIONS) {
        setProgress(`Backing up ${col}…`);
        try {
          const snap = await getDocs(collection(db, 'organizations', orgId, col));
          backup.collections[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
          if (col === 'investmentProjects') {
            for (const projDoc of snap.docs) {
              for (const sub of ['returns','projectExpenses']) {
                const subSnap = await getDocs(collection(db,'organizations',orgId,col,projDoc.id,sub));
                if (!subSnap.empty) backup.collections[`investmentProjects/${projDoc.id}/${sub}`] = subSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
              }
            }
          }
        } catch { backup.collections[col] = []; }
      }
      setProgress('Backing up member profiles…');
      const memberDocs = backup.collections['members'] || [];
      const userProfiles = {};
      await Promise.all(memberDocs.map(async m => {
        try { const uSnap = await getDoc(doc(db,'users',m._id)); if (uSnap.exists()) userProfiles[m._id] = uSnap.data(); } catch {}
      }));
      backup.userProfiles = userProfiles;
      const json     = JSON.stringify(backup, null, 2);
      const blob     = new Blob([json], { type: 'application/json' });
      const url      = URL.createObjectURL(blob);
      const filename = `${orgName.replace(/[^a-z0-9]/gi, '_')}_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;
      const a        = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setBackupDone(true); setProgress('');
    } catch (e) { setProgress('Backup error: ' + e.message); console.error(e); }
    setBackupLoading(false);
  };

  // ── Tab styles ─────────────────────────────────────────────────────────────
  const tabStyle = active => ({
    padding: '9px 22px', borderRadius: '8px 8px 0 0',
    borderTop: '1px solid #e2e8f0',
    borderLeft: '1px solid #e2e8f0',
    borderRight: '1px solid #e2e8f0',
    borderBottom: active ? '1px solid #fff' : '1px solid #e2e8f0',
    background: active ? '#fff' : '#f8fafc',
    color: active ? '#1d4ed8' : '#64748b',
    fontWeight: active ? 700 : 500, fontSize: 13,
    cursor: 'pointer', position: 'relative', bottom: -1,
    transition: 'all 0.15s',
  });

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Export Data</div>
        <div className="page-subtitle">Download organization data or manage automated backups</div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid #e2e8f0' }}>
        <button style={tabStyle(activeTab === 'export')}  onClick={() => setActiveTab('export')}>
          ⬇ Export
        </button>
        <button style={tabStyle(activeTab === 'backups')} onClick={() => setActiveTab('backups')}>
          🛡 Auto Backups
        </button>
      </div>

      {/* ── Export Tab ── */}
      {activeTab === 'export' && (
        <div style={{ background: '#fff', borderRadius: '0 8px 8px 8px', border: '1px solid #e2e8f0',
          borderTop: 'none', padding: 20 }}>

          {/* Sheet selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 4 }}>Select Sheets to Include</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              A Summary sheet is always included. "Member Files" and "Photos & Folders" sheets include direct Google Drive links.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
              {SHEETS.map(s => {
                const badge = s.badge ? BADGE_CFG[s.badge] : null;
                return (
                  <label key={s.key}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                      borderRadius: 8, border: `1.5px solid ${selected.has(s.key) ? '#2563eb' : '#e2e8f0'}`,
                      background: selected.has(s.key) ? '#eff6ff' : '#fff', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)}
                      style={{ marginTop: 2, flexShrink: 0, width: 15, height: 15 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: selected.has(s.key) ? '#1d4ed8' : '#0f172a' }}>{s.label}</span>
                        {badge && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: badge.bg, color: badge.color }}>{badge.label}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{s.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button onClick={() => setSelected(new Set(SHEETS.map(s => s.key)))}
                style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                Select All
              </button>
              <button onClick={() => setSelected(new Set())}
                style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#475569' }}>
                Clear All
              </button>
            </div>
          </div>

          {/* XLSX export button */}
          <div style={{ padding: '16px 0', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={handleExport} disabled={loading || selected.size === 0} className="btn-primary"
                style={{ padding: '12px 28px', fontSize: 14, flexShrink: 0 }}>
                {loading ? '⏳ Exporting…' : `⬇ Export ${selected.size + 1} Sheets`}
              </button>
              {progress && <span style={{ fontSize: 13, color: '#64748b' }}>{progress}</span>}
              {done && !loading && <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✅ Downloaded!</span>}
            </div>
            {stats && (
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
                {[['Members',stats.members],['Payments',stats.payments],['Expenses',stats.expenses],['Projects',stats.projects],['Loans',stats.loans],['Distributions',stats.distributions],['Memoranda',stats.memoranda],['Member Files',stats.totalFiles],['Sheets',stats.sheets]].map(([l,v]) => (
                  <div key={l} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
            ⚠️ Export loads all data in one pass — may take 10–30 seconds on large organizations.
          </div>

          {/* CSV export */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>📄 Full CSV Export</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
              Downloads <strong>9 separate CSV files</strong> with <strong>no character limits</strong>. UTF-8 encoded with BOM for Bengali text.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={handleCsvExport} disabled={csvLoading}
                style={{ padding: '12px 28px', borderRadius: 8, background: '#059669', color: '#fff', border: 'none', cursor: csvLoading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: csvLoading ? 0.7 : 1 }}>
                {csvLoading ? '⏳ Generating CSVs…' : '📄 Download All as CSV'}
              </button>
              {csvLoading && progress && <span style={{ fontSize: 13, color: '#64748b' }}>{progress}</span>}
            </div>
          </div>

          {/* JSON backup */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>🗄 Manual JSON Backup</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
              Downloads a complete Firestore snapshot to your device. For automated daily backups, see the <button onClick={() => setActiveTab('backups')} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, padding: 0, fontSize: 13 }}>Auto Backups tab</button>.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={handleBackup} disabled={backupLoading}
                style={{ padding: '12px 28px', borderRadius: 8, background: '#0f172a', color: '#fff', border: 'none', cursor: backupLoading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: backupLoading ? 0.7 : 1 }}>
                {backupLoading ? '⏳ Generating…' : '🗄 Download JSON Backup'}
              </button>
              {backupDone && !backupLoading && <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✅ Downloaded!</span>}
              {progress && backupLoading && <span style={{ fontSize: 13, color: '#64748b' }}>{progress}</span>}
            </div>
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5', fontSize: 12, color: '#b91c1c' }}>
              ⚠️ <strong>Keep backup files private.</strong> They contain all member data.
            </div>
          </div>
        </div>
      )}

      {/* ── Backups Tab ── */}
      {activeTab === 'backups' && (
        <div style={{ background: '#fff', borderRadius: '0 8px 8px 8px', border: '1px solid #e2e8f0',
          borderTop: 'none', padding: 20 }}>
          <BackupsTab orgId={orgId} />
        </div>
      )}
    </div>
  );
}