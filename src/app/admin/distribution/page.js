// src/app/admin/distribution/page.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, getDocs, doc, getDoc, addDoc, updateDoc,
  serverTimestamp, query, orderBy, writeBatch, where,
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n)  { return `৳${(Number(n)||0).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
function fmtSigned(n) {
  const v = Number(n)||0;
  const s = `৳${Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0})}`;
  return v < 0 ? `−${s}` : `+${s}`;
}
function pct(n)  { return `${(Number(n)||0).toFixed(2)}%`; }
function tsDate(ts) {
  if (!ts) return '—';
  const d = ts.seconds ? new Date(ts.seconds*1000) : new Date(ts);
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

const STATUS_CFG = {
  draft:       { label:'Draft',       bg:'#fef3c7', color:'#92400e', dot:'#f59e0b' },
  approved:    { label:'Approved',    bg:'#dcfce7', color:'#14532d', dot:'#16a34a' },
  distributed: { label:'Distributed', bg:'#dbeafe', color:'#1e3a8a', dot:'#2563eb' },
};

function StatusBadge({ status }) {
  const c = STATUS_CFG[status]||STATUS_CFG.draft;
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:5,
      padding:'3px 10px',borderRadius:99,fontSize:11,fontWeight:700,
      background:c.bg,color:c.color}}>
      <span style={{width:6,height:6,borderRadius:'50%',background:c.dot,display:'inline-block'}}/>
      {c.label}
    </span>
  );
}

function Stat({label,value,sub,color='#0f172a',bg='#f8fafc'}) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#64748b',fontWeight:600,textTransform:'uppercase',
        letterSpacing:'0.07em',marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:3}}>{sub}</div>}
    </div>
  );
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// For a periodic project, load all undistributed return entries and expense totals
async function fetchProjectContribution(orgId, project) {
  if (project.returnType !== 'periodic') {
    // Lump sum: contribution = profit stored on doc
    return {
      projectId:             project.id,
      title:                 project.title,
      type:                  project.type,
      returnType:            'lump_sum',
      investedAmount:        project.investedAmount||0,
      actualReturnAmount:    project.actualReturnAmount,
      profit:                project.profit||0,
      undistributedReturns:  project.profit||0,
      totalExpenses:         0,
      netContribution:       project.profit||0,
      returnEntryIds:        [],
      // Lock flag — set when this project is in a pending draft distribution
      pendingDistributionId: project.pendingDistributionId||null,
    };
  }

  // Periodic: sum undistributed returns, subtract proportional expenses
  const [retSnap, expSnap] = await Promise.all([
    getDocs(query(
      collection(db,'organizations',orgId,'investmentProjects',project.id,'returns'),
      where('distributedInDistributionId','==',null)
    )),
    getDocs(collection(db,'organizations',orgId,'investmentProjects',project.id,'projectExpenses')),
  ]);

  const returnEntries = retSnap.docs.map(d => ({id:d.id,...d.data()}));
  const undistributedReturns = returnEntries.reduce((s,r) => s+(r.amount||0), 0);

  // Total expenses ever recorded for this project
  const totalExpenses = expSnap.docs.reduce((s,d) => s+(d.data().amount||0), 0);

  // Total returns ever distributed (to calc proportional expense already accounted for)
  const allRetSnap = await getDocs(
    collection(db,'organizations',orgId,'investmentProjects',project.id,'returns')
  );
  const allReturns = allRetSnap.docs.reduce((s,d) => s+(d.data().amount||0), 0);

  // Expense allocation: expenses attributed proportionally to undistributed returns
  // Formula: expenseAlloc = totalExpenses * (undistributedReturns / allReturns)
  // If allReturns is 0 (no returns yet), we allocate all expenses to this distribution
  const expenseAlloc = allReturns > 0
    ? Math.round(totalExpenses * (undistributedReturns / allReturns))
    : totalExpenses;

  const netContribution = undistributedReturns - expenseAlloc;

  return {
    projectId:    project.id,
    title:        project.title,
    type:         project.type,
    sector:       project.sector||'',
    returnType:   'periodic',
    investedAmount: project.investedAmount||0,
    undistributedReturns,
    expenseAlloc,
    totalExpenses,
    netContribution,
    returnEntryIds: returnEntries.map(r => r.id), // will be marked after distribution
    returnEntryCount: returnEntries.length,
  };
}

// ── Project selector ──────────────────────────────────────────────────────────

function ProjectSelector({ eligibleProjects, selectedIds, contributions, loadingContribs, onToggle }) {
  if (eligibleProjects.length === 0) {
    return (
      <div style={{padding:24,textAlign:'center',background:'#fafafa',
        borderRadius:10,border:'1px dashed #e2e8f0'}}>
        <div style={{fontSize:32,marginBottom:8}}>💹</div>
        <div style={{fontWeight:600,fontSize:14,color:'#0f172a',marginBottom:4}}>
          No eligible projects
        </div>
        <div style={{fontSize:12,color:'#94a3b8'}}>
          For <strong>lump-sum</strong> projects: mark as completed with an actual return amount.<br/>
          For <strong>periodic</strong> projects: add at least one undistributed return entry.
        </div>
        <a href="/admin/projects" style={{display:'inline-block',marginTop:12,
          padding:'8px 16px',borderRadius:8,background:'#eff6ff',
          color:'#2563eb',fontSize:13,fontWeight:600,textDecoration:'none'}}>
          → Investment Portfolio
        </a>
      </div>
    );
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {eligibleProjects.map(p => {
        const sel        = selectedIds.includes(p.id);
        const c          = contributions[p.id];
        const isPeriodic = p.returnType === 'periodic';
        const isLocked   = !isPeriodic && c?.pendingDistributionId;

        return (
          <div key={p.id}
            onClick={() => !isLocked && onToggle(p.id)}
            style={{padding:'12px 14px',borderRadius:10,
              cursor:isLocked?'not-allowed':'pointer',
              border:`1.5px solid ${isLocked?'#fed7aa':sel?'#2563eb':'#e2e8f0'}`,
              background:isLocked?'#fff7ed':sel?'#eff6ff':'#fff',
              opacity:isLocked?0.75:1,
              transition:'all 0.15s'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              {/* Checkbox / lock icon */}
              <div style={{width:20,height:20,borderRadius:5,flexShrink:0,
                border:`2px solid ${isLocked?'#fdba74':sel?'#2563eb':'#cbd5e1'}`,
                background:isLocked?'#fed7aa':sel?'#2563eb':'#fff',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:11}}>
                {isLocked ? '🔒' : sel ? <span style={{color:'#fff',fontSize:12,lineHeight:1}}>✓</span> : null}
              </div>

              {/* Info */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <span style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{p.title}</span>
                  <span style={{padding:'2px 7px',borderRadius:5,fontSize:11,fontWeight:600,
                    background:isPeriodic?'#faf5ff':'#f0fdf4',
                    color:isPeriodic?'#7e22ce':'#14532d'}}>
                    {isPeriodic?'🔄 Periodic':'📦 Lump Sum'}
                  </span>
                  {isLocked && (
                    <span style={{padding:'2px 8px',borderRadius:5,fontSize:11,fontWeight:600,
                      background:'#fed7aa',color:'#92400e'}}>
                      🔒 In draft — delete that draft to unlock
                    </span>
                  )}
                </div>
                <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                  {p.type}{p.sector?` · ${p.sector}`:''}
                  {isPeriodic && c && ` · ${c.returnEntryCount} undistributed return entries`}
                </div>
              </div>

              {/* Contribution amount */}
              <div style={{textAlign:'right',flexShrink:0}}>
                {loadingContribs ? (
                  <div style={{fontSize:11,color:'#94a3b8'}}>Loading…</div>
                ) : c && !isLocked ? (
                  isPeriodic ? (
                    <>
                      <div style={{fontSize:11,color:'#94a3b8'}}>Undistributed Returns</div>
                      <div style={{fontWeight:700,fontSize:14,color:'#15803d'}}>{fmt(c.undistributedReturns)}</div>
                      {c.expenseAlloc > 0 && (
                        <div style={{fontSize:11,color:'#dc2626'}}>−{fmt(c.expenseAlloc)} expenses</div>
                      )}
                      <div style={{fontWeight:700,fontSize:13,
                        color:c.netContribution>=0?'#15803d':'#dc2626'}}>
                        Net: {fmtSigned(c.netContribution)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{fontSize:11,color:'#94a3b8'}}>
                        {fmt(p.investedAmount)} → {fmt(p.actualReturnAmount)}
                      </div>
                      <div style={{fontWeight:700,fontSize:14,
                        color:c.netContribution>=0?'#15803d':'#dc2626'}}>
                        {fmtSigned(c.netContribution)}
                      </div>
                    </>
                  )
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── New Distribution Modal (3-step wizard) ────────────────────────────────────

function NewDistributionModal({ onClose, onSave, members, payments, eligibleProjects, contributions, loadingContribs, orgData, saving }) {
  const settings  = orgData?.settings||{};
  const fs        = settings.fundStructure||{reservePct:10,welfarePct:5,operationsPct:5};
  const feeInAcct = !!settings.gatewayFeeInAccounting;

  const [step,        setStep]        = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [manualAdj,   setManualAdj]   = useState('');
  const [adjNote,     setAdjNote]     = useState('');
  const [year,        setYear]        = useState(String(new Date().getFullYear()));
  const [periodLabel, setPeriodLabel] = useState(`Year ${new Date().getFullYear()}`);

  const toggleProject = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);

  const selectedContribs = selectedIds.map(id => contributions[id]).filter(Boolean);

  // Gross profit = sum of net contributions + manual adjustment
  const projectsNet  = selectedContribs.reduce((s,c) => s+(c.netContribution||0), 0);
  const manualAdjNum = Number(manualAdj)||0;
  const grossProfit  = projectsNet + manualAdjNum;

  // Waterfall
  const reserveDed    = Math.round(grossProfit * (fs.reservePct   ||0) / 100);
  const welfareDed    = Math.round(grossProfit * (fs.welfarePct   ||0) / 100);
  const opsDed        = Math.round(grossProfit * (fs.operationsPct||0) / 100);
  const distributable = grossProfit - reserveDed - welfareDed - opsDed;

  // Capital per member
  // Phase 1: only count actual capital contributions (isContribution defaults true for old records)
  const capitalMap = {};
  payments.filter(p=>p.status==='verified' && p.isContribution !== false).forEach(p => {
    const net = (p.amount||0)-(feeInAcct?0:(p.gatewayFee||0));
    if (p.userId) capitalMap[p.userId] = (capitalMap[p.userId]||0)+net;
  });
  const totalCapital     = Object.values(capitalMap).reduce((s,v)=>s+v,0);
  const distributionRate = totalCapital > 0 ? distributable/totalCapital : 0;

  const memberShares = members
    .filter(m => m.approved && capitalMap[m.id]>0)
    .map(m => ({
      userId:              m.id,
      nameEnglish:         m.nameEnglish||m.name||'',
      idNo:                m.idNo||'',
      capitalContribution: Math.round(capitalMap[m.id]||0),
      shareAmount:         Math.round((capitalMap[m.id]||0)*distributionRate),
    }))
    .sort((a,b)=>b.capitalContribution-a.capitalContribution);

  const STEPS = [
    {n:1,label:'Select Projects'},
    {n:2,label:'Review & Adjust'},
    {n:3,label:'Preview Shares'},
  ];

  const handleSave = () => {
    if (!year)                   return alert('Year is required.');
    if (selectedIds.length===0)  return alert('Select at least one project.');
    if (memberShares.length===0) return alert('No members with verified capital found.');

    // Build project snapshot with contribution details
    const projectSnapshot = selectedContribs.map(c => ({
      projectId:          c.projectId,
      title:              c.title,
      type:               c.type,
      returnType:         c.returnType,
      investedAmount:     c.investedAmount,
      // Lump sum specific
      actualReturnAmount: c.actualReturnAmount??null,
      // Periodic specific
      undistributedReturns: c.undistributedReturns??null,
      expenseAlloc:       c.expenseAlloc??null,
      returnEntryIds:     c.returnEntryIds||[],
      // Common
      netContribution:    c.netContribution,
    }));

    onSave({
      year:                     Number(year),
      periodLabel,
      linkedProjectIds:         selectedIds,
      projectSnapshot,
      projectsNet,
      manualAdjustment:         manualAdjNum,
      manualAdjustmentNote:     adjNote,
      grossProfit,
      reserveDeduction:         reserveDed,
      welfareDeduction:         welfareDed,
      operationsDeduction:      opsDed,
      distributableProfit:      distributable,
      distributionRate,
      totalCapital,
      memberShares,
      snapshotDate:             new Date().toISOString().split('T')[0],
      snapshotReservePct:       fs.reservePct,
      snapshotWelfarePct:       fs.welfarePct,
      snapshotOperationsPct:    fs.operationsPct,
      status:                   'draft',
    });
  };

  return (
    <Modal title="New Profit Distribution" onClose={onClose}>
      {/* Step progress */}
      <div style={{display:'flex',alignItems:'center',marginBottom:24}}>
        {STEPS.map((s,i) => (
          <div key={s.n} style={{display:'flex',alignItems:'center',flex:i<STEPS.length-1?1:0}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',
                justifyContent:'center',fontSize:12,fontWeight:700,
                background:step>s.n?'#16a34a':step===s.n?'#2563eb':'#e2e8f0',
                color:step>=s.n?'#fff':'#94a3b8'}}>
                {step>s.n?'✓':s.n}
              </div>
              <div style={{fontSize:10,fontWeight:600,whiteSpace:'nowrap',
                color:step===s.n?'#2563eb':'#94a3b8'}}>{s.label}</div>
            </div>
            {i<STEPS.length-1 && (
              <div style={{flex:1,height:2,margin:'-16px 6px 0',transition:'background 0.3s',
                background:step>s.n?'#16a34a':'#e2e8f0'}}/>
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Select projects ── */}
      {step===1 && (
        <div>
          <div style={{marginBottom:14}}>
            <div style={{fontWeight:600,fontSize:14,color:'#0f172a',marginBottom:4}}>
              Select projects to include in this distribution
            </div>
            <div style={{fontSize:12,color:'#64748b'}}>
              Lump-sum: includes final profit/loss. Periodic: includes only undistributed return entries, net of proportional expenses.
            </div>
          </div>

          <ProjectSelector
            eligibleProjects={eligibleProjects}
            selectedIds={selectedIds}
            contributions={contributions}
            loadingContribs={loadingContribs}
            onToggle={toggleProject}
          />

          {selectedIds.length > 0 && (
            <div style={{marginTop:14,padding:'10px 14px',borderRadius:8,
              background:projectsNet>=0?'#f0fdf4':'#fef2f2',
              border:`1px solid ${projectsNet>=0?'#86efac':'#fca5a5'}`,
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:13,color:projectsNet>=0?'#14532d':'#b91c1c'}}>
                <strong>{selectedIds.length}</strong> project(s) selected
              </span>
              <span style={{fontWeight:700,fontSize:14,color:projectsNet>=0?'#15803d':'#dc2626'}}>
                Net: {fmtSigned(projectsNet)}
              </span>
            </div>
          )}

          <div style={{display:'flex',justifyContent:'flex-end',marginTop:20,
            paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={()=>setStep(2)} disabled={selectedIds.length===0||loadingContribs}
              className="btn-primary" style={{padding:'10px 24px'}}>
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Review & Adjust ── */}
      {step===2 && (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Period */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label className="form-label">Year *</label>
              <input type="number" value={year}
                onChange={e=>{setYear(e.target.value);setPeriodLabel(`Year ${e.target.value}`);}}
                placeholder="e.g. 2024"/>
            </div>
            <div>
              <label className="form-label">Period Label</label>
              <input type="text" value={periodLabel} onChange={e=>setPeriodLabel(e.target.value)}
                placeholder="e.g. FY 2023-24"/>
            </div>
          </div>

          {/* Selected projects breakdown */}
          <div style={{borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden'}}>
            <div style={{padding:'9px 14px',background:'#f8fafc',fontWeight:700,fontSize:12,
              color:'#475569',textTransform:'uppercase',letterSpacing:'0.07em',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Selected Projects ({selectedContribs.length})</span>
              <button onClick={()=>setStep(1)}
                style={{background:'none',border:'none',cursor:'pointer',
                  fontSize:11,color:'#2563eb',fontWeight:700}}>
                ← Change
              </button>
            </div>
            {selectedContribs.map((c,i) => (
              <div key={c.projectId}
                style={{padding:'10px 14px',borderTop:i>0?'1px solid #f1f5f9':'none',
                  display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{c.title}</div>
                  <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>
                    {c.type} · {c.returnType==='periodic'?'Periodic':'Lump Sum'}
                  </div>
                  {c.returnType==='periodic' && c.expenseAlloc>0 && (
                    <div style={{fontSize:11,color:'#dc2626',marginTop:1}}>
                      Expenses deducted: −{fmt(c.expenseAlloc)}
                    </div>
                  )}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  {c.returnType==='periodic' && (
                    <div style={{fontSize:11,color:'#94a3b8'}}>
                      {fmt(c.undistributedReturns)} returns
                    </div>
                  )}
                  {c.returnType==='lump_sum' && (
                    <div style={{fontSize:11,color:'#94a3b8'}}>
                      {fmt(c.investedAmount)} → {fmt(c.actualReturnAmount)}
                    </div>
                  )}
                  <div style={{fontWeight:700,fontSize:14,
                    color:c.netContribution>=0?'#15803d':'#dc2626'}}>
                    {fmtSigned(c.netContribution)}
                  </div>
                </div>
              </div>
            ))}
            <div style={{padding:'9px 14px',background:'#f8fafc',borderTop:'2px solid #e2e8f0',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>Projects Net</span>
              <span style={{fontSize:14,fontWeight:700,
                color:projectsNet>=0?'#15803d':'#dc2626'}}>{fmtSigned(projectsNet)}</span>
            </div>
          </div>

          {/* Manual adjustment */}
          <div>
            <label className="form-label">Manual Adjustment (৳) — optional</label>
            <input type="number" value={manualAdj} onChange={e=>setManualAdj(e.target.value)}
              placeholder="Positive to add (e.g. bank interest), negative to deduct (e.g. write-off)"/>
            {manualAdj && (
              <div style={{marginTop:6}}>
                <label className="form-label">Adjustment Note</label>
                <input type="text" value={adjNote} onChange={e=>setAdjNote(e.target.value)}
                  placeholder="Reason for adjustment"/>
              </div>
            )}
          </div>

          {/* Waterfall */}
          <div style={{borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden'}}>
            <div style={{padding:'9px 14px',background:'#f8fafc',fontWeight:700,fontSize:12,
              color:'#475569',textTransform:'uppercase',letterSpacing:'0.07em'}}>
              Distribution Waterfall
            </div>
            {[
              {label:'Projects Net',  value:projectsNet,  signed:true,
                color:projectsNet>=0?'#15803d':'#dc2626', bg:'#f8fafc'},
              ...(manualAdjNum!==0?[{
                label:`Manual Adjustment${adjNote?` (${adjNote})`:''}`,
                value:manualAdjNum, signed:true,
                color:manualAdjNum>=0?'#16a34a':'#b45309', bg:'#fff',
              }]:[]),
              {label:'Gross Profit', value:grossProfit, signed:true,
                color:'#0f172a', bg:'#f8fafc', bold:true},
              {label:`− Reserve (${fs.reservePct||0}%)`,
                value:reserveDed, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:`− Welfare (${fs.welfarePct||0}%)`,
                value:welfareDed, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:`− Operations (${fs.operationsPct||0}%)`,
                value:opsDed, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:'Distributable to Members', value:distributable, signed:false,
                color:distributable>=0?'#1d4ed8':'#dc2626', bg:'#eff6ff', bold:true},
            ].map((row,i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',
                padding:'9px 14px',borderTop:i>0?'1px solid #f1f5f9':'none',
                background:row.bg}}>
                <span style={{fontSize:13,fontWeight:row.bold?700:400,color:'#0f172a'}}>
                  {row.label}
                </span>
                <span style={{fontSize:13,fontWeight:row.bold?700:600,color:row.color}}>
                  {row.signed ? fmtSigned(row.value) : `${row.prefix||''}${fmt(Math.abs(row.value))}`}
                </span>
              </div>
            ))}
          </div>

          {/* Loss warning */}
          {distributable < 0 && (
            <div style={{padding:'10px 14px',borderRadius:8,background:'#fef2f2',
              border:'1px solid #fca5a5',fontSize:13,color:'#b91c1c'}}>
              📉 <strong>Net loss distribution.</strong> Members will absorb a proportional loss
              based on their capital share. This will be recorded as a negative share amount.
              You can still save, approve, and mark this as distributed as a loss record.
            </div>
          )}

          <div style={{display:'flex',justifyContent:'space-between',
            paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={()=>setStep(1)}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
              ← Back
            </button>
            <button onClick={()=>setStep(3)} className="btn-primary" style={{padding:'10px 24px'}}>
              Next: Preview →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Preview member shares ── */}
      {step===3 && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',
            gap:10,marginBottom:16}}>
            <Stat label="Gross Profit"  value={fmtSigned(grossProfit)}
              color={grossProfit>=0?'#15803d':'#dc2626'}
              bg={grossProfit>=0?'#f0fdf4':'#fef2f2'}/>
            <Stat label="Distributable" value={fmtSigned(distributable)}
              color={distributable>=0?'#1d4ed8':'#dc2626'} bg="#eff6ff"/>
            <Stat label="Total Capital" value={fmt(totalCapital)}  color="#15803d" bg="#f0fdf4"/>
            <Stat label="Members"       value={memberShares.length} bg="#faf5ff"/>
          </div>

          {/* Loss explanation */}
          {distributable < 0 && (
            <div style={{padding:'10px 14px',borderRadius:8,background:'#fef2f2',
              border:'1px solid #fca5a5',fontSize:12,color:'#b91c1c',marginBottom:12}}>
              Loss amounts shown in red. Each member absorbs a loss proportional to their capital share.
            </div>
          )}

          {memberShares.length === 0 ? (
            <div style={{textAlign:'center',padding:'32px 20px',background:'#fafafa',
              borderRadius:10,color:'#94a3b8',fontSize:13}}>
              No members with verified capital found.
            </div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'#f8fafc'}}>
                    {['Member','Capital','Cap %','Share Amount'].map(h => (
                      <th key={h} style={{padding:'9px 12px',
                        textAlign:h==='Member'?'left':'right',
                        fontSize:11,fontWeight:700,color:'#64748b',
                        textTransform:'uppercase',letterSpacing:'0.07em',
                        borderBottom:'1px solid #e2e8f0'}}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberShares.map((ms,i) => {
                    const capPct = totalCapital>0
                      ? ((ms.capitalContribution/totalCapital)*100).toFixed(2):'0.00';
                    return (
                      <tr key={ms.userId}
                        style={{borderBottom:'1px solid #f1f5f9',
                          background:i%2===0?'#fff':'#fafafa'}}>
                        <td style={{padding:'9px 12px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{width:28,height:28,borderRadius:'50%',background:'#dbeafe',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontSize:10,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                              {ms.photoURL?<img src={ms.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:initials(ms.nameEnglish)}
                            </div>
                            <div>
                              <div style={{fontWeight:600,color:'#0f172a'}}>{ms.nameEnglish||'—'}</div>
                              {ms.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{ms.idNo}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'9px 12px',textAlign:'right',
                          fontWeight:600,color:'#15803d'}}>{fmt(ms.capitalContribution)}</td>
                        <td style={{padding:'9px 12px',textAlign:'right',
                          color:'#64748b'}}>{capPct}%</td>
                        <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,
                          color:(ms.shareAmount||0)>=0?'#1d4ed8':'#dc2626'}}>
                          {fmtSigned(ms.shareAmount||0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:'#f0f9ff',borderTop:'2px solid #bae6fd'}}>
                    <td style={{padding:'9px 12px',fontWeight:700}}>Total</td>
                    <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'#15803d'}}>
                      {fmt(totalCapital)}
                    </td>
                    <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,color:'#64748b'}}>
                      100%
                    </td>
                    <td style={{padding:'9px 12px',textAlign:'right',fontWeight:700,
                      color:distributable>=0?'#1d4ed8':'#dc2626'}}>
                      {fmtSigned(memberShares.reduce((s,m)=>s+(m.shareAmount||0),0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div style={{display:'flex',justifyContent:'space-between',marginTop:20,
            paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
            <button onClick={()=>setStep(2)}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
              ← Back
            </button>
            <button onClick={handleSave}
              disabled={saving||memberShares.length===0}
              className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'Save as Draft'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Distribution Detail Modal ─────────────────────────────────────────────────

function DistributionDetailModal({ dist, onClose, onApprove, onMarkDistributed, onDeleteDraft, saving }) {
  const [tab, setTab] = useState('summary');
  const totalShares = (dist.memberShares||[]).reduce((s,m)=>s+(m.shareAmount||0),0);

  const TABS = [
    ['summary',  'Summary'],
    ['projects', `Projects (${(dist.projectSnapshot||[]).length})`],
    ['members',  `Shares (${(dist.memberShares||[]).length})`],
  ];

  return (
    <Modal title={`${dist.periodLabel||dist.year} — Distribution`} onClose={onClose}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:20}}>
        <StatusBadge status={dist.status}/>
        <span style={{fontSize:12,color:'#94a3b8'}}>Created {tsDate(dist.createdAt)}</span>
        {dist.approvedAt    && <span style={{fontSize:12,color:'#94a3b8'}}>· Approved {tsDate(dist.approvedAt)}</span>}
        {dist.distributedAt && <span style={{fontSize:12,color:'#94a3b8'}}>· Distributed {tsDate(dist.distributedAt)}</span>}
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:4,borderBottom:'2px solid #e2e8f0',marginBottom:20}}>
        {TABS.map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:'8px 14px',border:'none',background:'none',cursor:'pointer',
              fontSize:13,fontWeight:tab===id?700:400,
              color:tab===id?'#2563eb':'#64748b',
              borderBottom:tab===id?'2px solid #2563eb':'2px solid transparent',marginBottom:-2}}>
            {label}
          </button>
        ))}
      </div>

      {/* SUMMARY */}
      {tab==='summary' && (
        <div>
          <div style={{marginBottom:20}}>
            {[
              {label:'Projects Net',
                value:dist.projectsNet||0, signed:true,
                color:(dist.projectsNet||0)>=0?'#15803d':'#dc2626', bg:'#f8fafc'},
              ...(dist.manualAdjustment?[{
                label:`Manual Adjustment${dist.manualAdjustmentNote?` (${dist.manualAdjustmentNote})`:''}`,
                value:dist.manualAdjustment, signed:true, color:'#b45309', bg:'#fffbeb',
              }]:[]),
              {label:'Gross Profit',
                value:dist.grossProfit||0, signed:true,
                color:'#0f172a', bg:'#f8fafc', bold:true},
              {label:`Reserve (${dist.snapshotReservePct??'—'}%)`,
                value:dist.reserveDeduction||0, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:`Welfare (${dist.snapshotWelfarePct??'—'}%)`,
                value:dist.welfareDeduction||0, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:`Operations (${dist.snapshotOperationsPct??'—'}%)`,
                value:dist.operationsDeduction||0, prefix:'−', color:'#b45309', bg:'#fff'},
              {label:'Distributable to Members',
                value:dist.distributableProfit||0, signed:false,
                color:(dist.distributableProfit||0)>=0?'#1d4ed8':'#dc2626',
                bg:'#eff6ff', bold:true},
            ].map((row,i) => (
              <div key={i} style={{display:'flex',justifyContent:'space-between',
                padding:'9px 12px',borderRadius:8,marginBottom:4,background:row.bg,
                border:row.bold&&i>0?'1.5px solid #bfdbfe':'none'}}>
                <span style={{fontSize:13,fontWeight:row.bold?700:400,color:'#0f172a'}}>
                  {row.label}
                </span>
                <span style={{fontSize:13,fontWeight:row.bold?700:600,color:row.color}}>
                  {row.signed ? fmtSigned(row.value) : `${row.prefix||''}${fmt(Math.abs(row.value))}`}
                </span>
              </div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10}}>
            <Stat label="Total Capital"  value={fmt(dist.totalCapital)}     bg="#f0fdf4" color="#15803d"/>
            <Stat label="Rate / ৳100"
              value={dist.totalCapital>0
                ? pct((dist.distributableProfit/dist.totalCapital)*100):'—'}
              sub="per unit capital" bg="#eff6ff" color="#1d4ed8"/>
            <Stat label="Members"        value={(dist.memberShares||[]).length} bg="#faf5ff" color="#7e22ce"/>
            <Stat label="Total Shares"   value={fmtSigned(totalShares)}
              color={totalShares>=0?'#15803d':'#dc2626'} bg="#f8fafc"/>
          </div>
        </div>
      )}

      {/* PROJECTS */}
      {tab==='projects' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {(dist.projectSnapshot||[]).length===0 ? (
            <div style={{textAlign:'center',color:'#94a3b8',padding:32,fontSize:13}}>
              No project snapshot recorded.
            </div>
          ) : (
            <>
              {(dist.projectSnapshot||[]).map(p => (
                <div key={p.projectId}
                  style={{padding:'12px 14px',borderRadius:10,
                    border:'1px solid #e2e8f0',background:'#fafafa'}}>
                  <div style={{display:'flex',justifyContent:'space-between',
                    alignItems:'flex-start',gap:12}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:'#0f172a'}}>{p.title}</div>
                      <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>
                        {p.type} · {p.returnType==='periodic'?'Periodic':'Lump Sum'}
                      </div>
                      {p.returnType==='periodic' && p.undistributedReturns!=null && (
                        <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                          Returns: {fmt(p.undistributedReturns)}
                          {p.expenseAlloc>0 && ` − Expenses: ${fmt(p.expenseAlloc)}`}
                        </div>
                      )}
                      {p.returnType==='lump_sum' && p.actualReturnAmount!=null && (
                        <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                          {fmt(p.investedAmount)} → {fmt(p.actualReturnAmount)}
                        </div>
                      )}
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      <div style={{fontWeight:700,fontSize:14,
                        color:(p.netContribution||0)>=0?'#15803d':'#dc2626'}}>
                        {fmtSigned(p.netContribution||0)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {/* Projects net row */}
              <div style={{padding:'10px 14px',borderRadius:10,
                background:'#f0f9ff',border:'2px solid #bae6fd',
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:700,fontSize:13}}>Projects Net</span>
                <span style={{fontWeight:700,fontSize:14,
                  color:(dist.projectsNet||0)>=0?'#15803d':'#dc2626'}}>
                  {fmtSigned(dist.projectsNet||0)}
                </span>
              </div>
              {dist.manualAdjustment!=null && dist.manualAdjustment!==0 && (
                <div style={{padding:'10px 14px',borderRadius:10,
                  background:'#fffbeb',border:'1px solid #fde68a',
                  display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:13,color:'#78350f'}}>
                    Manual Adjustment{dist.manualAdjustmentNote?`: ${dist.manualAdjustmentNote}`:''}
                  </span>
                  <span style={{fontWeight:700,fontSize:13,color:'#92400e'}}>
                    {fmtSigned(dist.manualAdjustment)}
                  </span>
                </div>
              )}
              {/* Periodic entries note */}
              {dist.status==='distributed' &&
               (dist.projectSnapshot||[]).some(p=>p.returnType==='periodic') && (
                <div style={{padding:'10px 14px',borderRadius:8,
                  background:'#dbeafe',border:'1px solid #93c5fd',fontSize:12,color:'#1e40af'}}>
                  ✓ All periodic return entries included in this distribution have been
                  marked as distributed and will not appear in future distributions.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* MEMBER SHARES */}
      {tab==='members' && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'#f8fafc'}}>
                {['Member','Capital','Share %','Share Amount'].map(h => (
                  <th key={h} style={{padding:'10px 12px',
                    textAlign:h==='Member'?'left':'right',
                    fontSize:11,fontWeight:700,color:'#64748b',
                    textTransform:'uppercase',letterSpacing:'0.07em',
                    borderBottom:'1px solid #e2e8f0'}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(dist.memberShares||[])
                .sort((a,b)=>(b.capitalContribution||0)-(a.capitalContribution||0))
                .map((ms,i) => {
                  const capPct = dist.totalCapital>0
                    ? ((ms.capitalContribution/dist.totalCapital)*100).toFixed(2):'0.00';
                  return (
                    <tr key={ms.userId||i}
                      style={{borderBottom:'1px solid #f1f5f9',
                        background:i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{width:28,height:28,borderRadius:'50%',background:'#dbeafe',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:10,fontWeight:700,color:'#1d4ed8',flexShrink:0}}>
                            {ms.photoURL?<img src={ms.photoURL} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:initials(ms.nameEnglish||ms.name)}
                          </div>
                          <div>
                            <div style={{fontWeight:600,color:'#0f172a'}}>
                              {ms.nameEnglish||ms.name||'—'}
                            </div>
                            {ms.idNo && <div style={{fontSize:11,color:'#94a3b8'}}>#{ms.idNo}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'10px 12px',textAlign:'right',
                        fontWeight:600,color:'#15803d'}}>
                        {fmt(ms.capitalContribution)}
                      </td>
                      <td style={{padding:'10px 12px',textAlign:'right',color:'#64748b'}}>
                        {capPct}%
                      </td>
                      <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,
                        color:(ms.shareAmount||0)>=0?'#1d4ed8':'#dc2626'}}>
                        {fmtSigned(ms.shareAmount||0)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            <tfoot>
              <tr style={{background:'#f0f9ff',borderTop:'2px solid #bae6fd'}}>
                <td style={{padding:'10px 12px',fontWeight:700}}>Total</td>
                <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:'#15803d'}}>
                  {fmt(dist.totalCapital)}
                </td>
                <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:'#64748b'}}>
                  100%
                </td>
                <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,
                  color:totalShares>=0?'#1d4ed8':'#dc2626'}}>
                  {fmtSigned(totalShares)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Actions */}
      <div style={{display:'flex',gap:10,marginTop:24,paddingTop:20,borderTop:'1px solid #e2e8f0'}}>
        {dist.status==='draft' && (
          <>
            <button onClick={()=>onApprove(dist)} disabled={saving}
              className="btn-primary" style={{padding:'10px 24px'}}>
              {saving?'Saving…':'✅ Approve'}
            </button>
            <button onClick={()=>onDeleteDraft(dist)} disabled={saving}
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #fca5a5',
                background:'#fff',cursor:'pointer',fontSize:13,color:'#dc2626'}}>
              🗑 Delete Draft
            </button>
          </>
        )}
        {dist.status==='approved' && (
          <button onClick={()=>onMarkDistributed(dist)} disabled={saving}
            className="btn-primary" style={{padding:'10px 24px',background:'#16a34a'}}>
            {saving?'Saving…':'💸 Mark as Distributed'}
          </button>
        )}
        <button onClick={onClose}
          style={{padding:'10px 20px',borderRadius:8,border:'1px solid #e2e8f0',
            background:'#fff',cursor:'pointer',fontSize:13,color:'#64748b'}}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminDistribution() {
  const { user, userData, orgData, isOrgAdmin } = useAuth();
  const orgId = userData?.activeOrgId;

  const [loading,          setLoading]          = useState(true);
  const [distributions,    setDistributions]    = useState([]);
  const [members,          setMembers]          = useState([]);
  const [payments,         setPayments]         = useState([]);
  const [allProjects,      setAllProjects]      = useState([]);
  const [eligibleProjects, setEligibleProjects] = useState([]);
  const [contributions,    setContributions]    = useState({});
  const [loadingContribs,  setLoadingContribs]  = useState(false);
  const [selected,         setSelected]         = useState(null);
  const [showNew,          setShowNew]          = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [toast,            setToast]            = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(''),3500); };

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);
      const [distSnap, memSnap, paySnap, projSnap] = await Promise.all([
        getDocs(query(collection(db,'organizations',orgId,'profitDistributions'), orderBy('createdAt','desc'))),
        getDocs(collection(db,'organizations',orgId,'members')),
        getDocs(collection(db,'organizations',orgId,'investments')),
        getDocs(query(collection(db,'organizations',orgId,'investmentProjects'), orderBy('createdAt','desc'))),
      ]);

      // Enrich members with user profile data
      const rawMembers = memSnap.docs.map(d=>({id:d.id,...d.data()}));
      const enriched = await Promise.all(rawMembers.map(async m => {
        try {
          const u = await getDoc(doc(db,'users',m.id));
          return u.exists() ? {...u.data(),...m} : m;
        } catch { return m; }
      }));

      const projects = projSnap.docs.map(d=>({id:d.id,...d.data()}));

      // Eligible:
      // - Lump sum: status=completed, actualReturnAmount != null
      // - Periodic: status=active or completed (may have undistributed returns)
      const eligible = projects.filter(p => {
        if (p.returnType==='periodic') return p.status==='active'||p.status==='completed';
        return p.status==='completed' && p.actualReturnAmount!=null;
      });

      setDistributions(distSnap.docs.map(d=>({id:d.id,...d.data()})));
      setMembers(enriched);
      setPayments(paySnap.docs.map(d=>({id:d.id,...d.data()})));
      setAllProjects(projects);
      setEligibleProjects(eligible);
      setLoading(false);
    })();
  }, [orgId]);

  // Load contributions when modal opens
  useEffect(() => {
    if (!showNew || eligibleProjects.length===0) return;
    setLoadingContribs(true);
    Promise.all(eligibleProjects.map(p => fetchProjectContribution(orgId, p)))
      .then(results => {
        const map = {};
        results.forEach(c => { map[c.projectId] = c; });
        setContributions(map);
        setLoadingContribs(false);
      });
  }, [showNew, orgId]);

  const refreshDist = (id, updates) => {
    setDistributions(prev => prev.map(d => d.id===id ? {...d,...updates} : d));
    setSelected(prev => prev?.id===id ? {...prev,...updates} : prev);
  };

  const handleCreate = async (payload) => {
    setSaving(true);
    try {
      const batch = writeBatch(db);

      // Create the distribution doc
      const distRef = doc(collection(db,'organizations',orgId,'profitDistributions'));
      batch.set(distRef, {...payload, createdBy:user.uid, createdAt:serverTimestamp()});

      // Lock all lump-sum projects included in this draft so they can't be double-used
      for (const snap of (payload.projectSnapshot||[])) {
        if (snap.returnType === 'lump_sum') {
          batch.update(
            doc(db,'organizations',orgId,'investmentProjects',snap.projectId),
            { pendingDistributionId: distRef.id }
          );
        }
      }

      await batch.commit();

      // Update local state
      const newDist = {id:distRef.id, ...payload, createdAt:{seconds:Date.now()/1000}};
      setDistributions(prev => [newDist, ...prev]);
      // Reflect lock in local eligibleProjects so selector updates immediately
      setEligibleProjects(prev => prev.map(p => {
        if ((payload.linkedProjectIds||[]).includes(p.id) && p.returnType !== 'periodic') {
          return {...p, pendingDistributionId: distRef.id};
        }
        return p;
      }));
      setShowNew(false);
      showToast('✅ Draft distribution created!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const handleApprove = async (dist) => {
    if (!confirm(`Approve "${dist.periodLabel||dist.year}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db,'organizations',orgId,'profitDistributions',dist.id),
        {status:'approved', approvedBy:user.uid, approvedAt:serverTimestamp()}
      );
      refreshDist(dist.id, {status:'approved', approvedAt:{seconds:Date.now()/1000}});
      showToast('✅ Distribution approved!');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  // Delete a draft distribution and release the lump-sum project locks
  const handleDeleteDraft = async (dist) => {
    if (!confirm(`Delete draft "${dist.periodLabel||dist.year}"? The distribution will be permanently removed and locked projects will be available again.`)) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);

      // Delete the distribution doc
      batch.delete(doc(db,'organizations',orgId,'profitDistributions',dist.id));

      // Clear pendingDistributionId on all lump-sum projects in this draft
      for (const snap of (dist.projectSnapshot||[])) {
        if (snap.returnType === 'lump_sum') {
          batch.update(
            doc(db,'organizations',orgId,'investmentProjects',snap.projectId),
            { pendingDistributionId: null }
          );
        }
      }

      await batch.commit();

      // Update local state
      setDistributions(prev => prev.filter(d => d.id !== dist.id));
      setEligibleProjects(prev => prev.map(p => {
        if ((dist.linkedProjectIds||[]).includes(p.id) && p.returnType !== 'periodic') {
          return {...p, pendingDistributionId: null};
        }
        return p;
      }));
      setSelected(null);
      showToast('Draft deleted. Projects unlocked.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  // On mark distributed: also mark periodic return entries so they don't double-count
  const handleMarkDistributed = async (dist) => {
    if (!confirm(`Mark "${dist.periodLabel||dist.year}" as distributed? This will also lock all included periodic return entries.`)) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);

      // Mark distribution doc
      batch.update(
        doc(db,'organizations',orgId,'profitDistributions',dist.id),
        {status:'distributed', distributedAt:serverTimestamp()}
      );

      // Mark each periodic project's return entries
      for (const snap of (dist.projectSnapshot||[])) {
        if (snap.returnType==='periodic' && snap.returnEntryIds?.length>0) {
          for (const entryId of snap.returnEntryIds) {
            batch.update(
              doc(db,'organizations',orgId,'investmentProjects',snap.projectId,'returns',entryId),
              {distributedInDistributionId: dist.id}
            );
          }
        }
      }

      await batch.commit();
      refreshDist(dist.id, {status:'distributed', distributedAt:{seconds:Date.now()/1000}});
      showToast('✅ Marked as distributed! Return entries locked.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const router = useRouter();
  if (!isOrgAdmin) { router.replace('/dashboard'); return null; }

  const feeInAcct = !!orgData?.settings?.gatewayFeeInAccounting;
  const totalCapital = payments
    .filter(p=>p.status==='verified')
    .reduce((s,p) => s+(p.amount||0)-(feeInAcct?0:(p.gatewayFee||0)), 0);
  const totalDistributed = distributions
    .filter(d=>d.status==='distributed')
    .reduce((s,d) => s+(d.distributableProfit||0), 0);

  const hasDraft    = distributions.some(d=>d.status==='draft');
  const hasApproved = distributions.some(d=>d.status==='approved');

  // Filter eligible projects that have something to contribute this round
  const hasEligible = eligibleProjects.length > 0;

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
          <div>
            <div className="page-title">Profit Distribution</div>
            <div className="page-subtitle">
              Select investment projects, apply fund deductions, distribute profit or loss to members by capital share.
            </div>
          </div>
          <button onClick={()=>setShowNew(true)} className="btn-primary"
            style={{padding:'10px 20px',flexShrink:0,marginTop:4}}>
            + New Distribution
          </button>
        </div>
      </div>

      {toast && (
        <div style={{padding:'10px 16px',borderRadius:8,marginBottom:16,fontSize:13,fontWeight:600,
          background:toast.startsWith('Error')?'#fee2e2':'#dcfce7',
          color:toast.startsWith('Error')?'#b91c1c':'#15803d'}}>
          {toast}
        </div>
      )}

      {!loading && !hasEligible && (
        <div style={{padding:'12px 16px',borderRadius:10,marginBottom:16,
          background:'#fffbeb',border:'1px solid #fde68a',fontSize:13,color:'#92400e'}}>
          ⚠️ No eligible investment projects yet.{' '}
          <a href="/admin/projects" style={{color:'#2563eb',textDecoration:'underline'}}>
            Investment Portfolio
          </a>
          {' '}— complete lump-sum projects with actual returns, or add return entries to periodic projects.
        </div>
      )}

      {(hasDraft||hasApproved) && (
        <div style={{padding:'12px 16px',borderRadius:10,marginBottom:16,
          background:'#f0f9ff',border:'1px solid #bae6fd',fontSize:13,color:'#1e40af'}}>
          {hasDraft    && <span>A <strong>draft</strong> distribution is pending approval. </span>}
          {hasApproved && <span>An <strong>approved</strong> distribution is pending payout. </span>}
          Click a distribution below to take action.
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',
        gap:12,marginBottom:24}}>
        <Stat label="Total Member Capital"     value={fmt(totalCapital)}   color="#15803d" bg="#f0fdf4"/>
        <Stat label="Eligible Projects"         value={eligibleProjects.length} bg="#dbeafe" color="#1e40af"/>
        <Stat label="Distributions Made"
          value={distributions.filter(d=>d.status==='distributed').length} bg="#f8fafc"/>
        <Stat label="Total Profit Distributed"  value={fmt(totalDistributed)} color="#1d4ed8" bg="#eff6ff"/>
      </div>

      {/* List */}
      {loading ? (
        <div style={{textAlign:'center',padding:'60px 20px',color:'#94a3b8'}}>Loading…</div>
      ) : distributions.length===0 ? (
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:40,marginBottom:12}}>📊</div>
          <div style={{fontWeight:600,fontSize:16,color:'#0f172a',marginBottom:6}}>
            No distributions yet
          </div>
          <div style={{fontSize:13,color:'#94a3b8',marginBottom:20}}>
            Record investment returns first, then create a distribution.
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'center'}}>
            <a href="/admin/projects"
              style={{padding:'10px 20px',borderRadius:8,border:'1px solid #2563eb',
                color:'#2563eb',fontSize:13,fontWeight:600,textDecoration:'none'}}>
              Investment Portfolio →
            </a>
            {hasEligible && (
              <button onClick={()=>setShowNew(true)} className="btn-primary"
                style={{padding:'10px 24px'}}>
                + New Distribution
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {distributions.map(dist => {
            const sc = STATUS_CFG[dist.status]||STATUS_CFG.draft;
            const gp = dist.grossProfit||0;
            const dp = dist.distributableProfit||0;
            return (
              <div key={dist.id} onClick={()=>setSelected(dist)}
                style={{background:'#fff',borderRadius:12,padding:'16px 20px',
                  border:`1.5px solid ${dist.status==='draft'?'#fde68a':dist.status==='approved'?'#86efac':'#e2e8f0'}`,
                  cursor:'pointer',transition:'box-shadow 0.15s'}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                  gap:12,flexWrap:'wrap'}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div style={{width:44,height:44,borderRadius:10,background:sc.bg,
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:22,flexShrink:0}}>
                      {dp < 0 ? '📉' : '📊'}
                    </div>
                    <div>
                      <div style={{fontWeight:700,fontSize:15,color:'#0f172a',marginBottom:3}}>
                        {dist.periodLabel||dist.year}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <StatusBadge status={dist.status}/>
                        <span style={{fontSize:11,color:'#94a3b8'}}>
                          {(dist.projectSnapshot||[]).length} project(s) ·{' '}
                          {(dist.memberShares||[]).length} members ·{' '}
                          {tsDate(dist.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,color:'#94a3b8'}}>Gross Profit</div>
                      <div style={{fontWeight:700,fontSize:15,
                        color:gp>=0?'#15803d':'#dc2626'}}>
                        {fmtSigned(gp)}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,color:'#94a3b8'}}>Distributable</div>
                      <div style={{fontWeight:700,fontSize:15,
                        color:dp>=0?'#1d4ed8':'#dc2626'}}>
                        {fmtSigned(dp)}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,color:'#94a3b8'}}>Per ৳100</div>
                      <div style={{fontWeight:700,fontSize:15,color:'#7e22ce'}}>
                        {dist.totalCapital>0
                          ? fmt((dp/dist.totalCapital)*100) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewDistributionModal
          onClose={()=>setShowNew(false)}
          onSave={handleCreate}
          members={members}
          payments={payments}
          eligibleProjects={eligibleProjects}
          contributions={contributions}
          loadingContribs={loadingContribs}
          orgData={orgData}
          saving={saving}
        />
      )}

      {selected && (
        <DistributionDetailModal
          dist={selected}
          onClose={()=>setSelected(null)}
          onApprove={handleApprove}
          onMarkDistributed={handleMarkDistributed}
          onDeleteDraft={handleDeleteDraft}
          saving={saving}
        />
      )}
    </div>
  );
}