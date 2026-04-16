'use client';
import { useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

const ORG_TYPES = ['Donation Group','Savings Club','Investment Group','Welfare Fund','Community Fund','Other'];

export default function CreateOrg() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    name:'', type:'', description:'', currency:'BDT',
    baseAmount:'', dueDate:'10', penalty:'50', startDate:'',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [logoPreview, setLogoPreview] = useState(null);

  const handleLogo = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    const canvas = document.createElement('canvas');
    const img    = new Image();
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


  const set = (k, v) => setForm(p => ({...p, [k]: v}));

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.type) { setError('Name and type are required.'); return; }
    setLoading(true); setError('');
    try {
      const orgId = `org_${Date.now()}`;

      // Always pending — superadmin must verify before org becomes active
      await setDoc(doc(db, 'organizations', orgId), {
        name: form.name, type: form.type, description: form.description,
        currency: form.currency,
        status: 'pending',
        logoURL: logoPreview || null,
        settings: {
          baseAmount:     Number(form.baseAmount) || 0,
          dueDate:        Number(form.dueDate) || 10,
          penalty:        Number(form.penalty) || 0,
          startDate:      form.startDate,
          uniformAmount:  true,
          lateFeeEnabled: true,
        },
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // Add creator as admin member (approved so they can manage org once superadmin approves it)
      await setDoc(doc(db, 'organizations', orgId, 'members', user.uid), {
        role: 'admin', approved: true, idNo: 'A-001', joinedAt: serverTimestamp(),
      });

      // Track org in user doc
      const userSnap    = await getDoc(doc(db, 'users', user.uid));
      const existingIds = userSnap.exists() ? (userSnap.data().orgIds || []) : [];
      await setDoc(doc(db, 'users', user.uid), {
        activeOrgId: orgId,
        orgIds: existingIds.includes(orgId) ? existingIds : [...existingIds, orgId],
      }, { merge: true });

      // Always redirect to pending — superadmin must approve
      window.location.href = '/org-pending';
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', padding:24 }}>
      <div style={{ maxWidth:600, margin:'40px auto' }}>
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#0f172a', marginBottom:4 }}>Create Organization</h1>
          <p style={{ fontSize:14, color:'#64748b' }}>Set up your donation group or fund — a superadmin will activate it shortly.</p>
        </div>

        <div className="card">
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleCreate}>
            <h3 style={{ fontSize:14, fontWeight:600, color:'#0f172a', marginBottom:16, paddingBottom:10, borderBottom:'1px solid #e2e8f0' }}>Basic Information</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
              <div className="form-group" style={{ gridColumn:'1/-1' }}>
                <label className="form-label">Organization Logo</label>
                <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                  <div style={{ width:64, height:64, borderRadius:12, background:'#eff6ff', border:'2px dashed #bfdbfe', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0 }}>
                    {logoPreview
                      ? <img src={logoPreview} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
                      : <span style={{ fontSize:24, color:'#93c5fd' }}>🏢</span>}
                  </div>
                  <div>
                    <label className="btn-ghost" style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6, padding:'8px 16px', fontSize:13 }}>
                      {logoPreview ? 'Change Logo' : 'Upload Logo'}
                      <input type="file" accept="image/*" onChange={handleLogo} style={{ display:'none' }} />
                    </label>
                    <p style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>Square image recommended, max ~2MB</p>
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ gridColumn:'1/-1' }}>
                <label className="form-label">Organization Name <span style={{color:'#dc2626'}}>*</span></label>
                <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Our Donation Fund" required />
              </div>
              <div className="form-group">
                <label className="form-label">Type <span style={{color:'#dc2626'}}>*</span></label>
                <select value={form.type} onChange={e => set('type', e.target.value)} required>
                  <option value="">Select type…</option>
                  {ORG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {['BDT','USD','EUR','INR'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn:'1/-1' }}>
                <label className="form-label">Description</label>
                <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description (optional)" style={{ resize:'vertical' }} />
              </div>
            </div>

            <h3 style={{ fontSize:14, fontWeight:600, color:'#0f172a', margin:'8px 0 16px', paddingBottom:10, borderBottom:'1px solid #e2e8f0' }}>Payment Settings</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
              <div className="form-group">
                <label className="form-label">Monthly Amount</label>
                <input type="number" min="0" value={form.baseAmount} onChange={e => set('baseAmount', e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Late Fee Amount</label>
                <input type="number" min="0" value={form.penalty} onChange={e => set('penalty', e.target.value)} placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Due Day (of month)</label>
                <input type="number" min="1" max="28" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginTop:8 }}>
              <button type="button" onClick={() => window.history.back()} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={loading} className="btn-primary" style={{ flex:1, justifyContent:'center' }}>
                {loading ? 'Creating…' : 'Create Organization'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
