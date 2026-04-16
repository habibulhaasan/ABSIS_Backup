'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';

export default function AdminNotifications() {
  const { user, userData } = useAuth();
  const [members, setMembers] = useState([]);   // merged with user profiles
  const [target, setTarget]   = useState('all');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const orgId = userData?.activeOrgId;

  useEffect(() => {
    if (!orgId) return;
    getDocs(collection(db, 'organizations', orgId, 'members')).then(async snap => {
      const memberDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const withNames = await Promise.all(memberDocs.map(async m => {
        try {
          const uSnap = await getDoc(doc(db, 'users', m.id));
          return uSnap.exists() ? { ...uSnap.data(), ...m } : m;
        } catch { return m; }
      }));
      setMembers(withNames.filter(m => m.approved));
    });
  }, [orgId]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      const recipients = target === 'all' ? members : members.filter(m => m.id === target);
      await Promise.all(recipients.map(m =>
        addDoc(collection(db, 'organizations', orgId, 'notifications'), {
          userId: m.id, message, read: false, sentBy: user.uid, createdAt: serverTimestamp(),
        })
      ));
      setMessage('');
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch (err) { alert(err.message); }
    setSending(false);
  };

  return (
    <div className="page-wrap animate-fade">
      <div className="page-header">
        <div className="page-title">Send Notification</div>
        <div className="page-subtitle">Send messages to members</div>
      </div>

      <div className="card">
        {sent && <div className="alert alert-success">Notification sent successfully!</div>}
        <form onSubmit={handleSend}>
          <div className="form-group">
            <label className="form-label">Recipient</label>
            <select value={target} onChange={e => setTarget(e.target.value)}>
              <option value="all">All Approved Members ({members.length})</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.nameEnglish || '(no name)'}{m.idNo ? ` — ${m.idNo}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Message *</label>
            <textarea rows={5} required value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your message here…" style={{ resize:'vertical' }} />
          </div>
          <button type="submit" disabled={sending} className="btn-primary" style={{ width:'100%', justifyContent:'center' }}>
            {sending ? 'Sending…' : `Send to ${target === 'all' ? `all ${members.length} members` : members.find(m=>m.id===target)?.nameEnglish || 'member'}`}
          </button>
        </form>
      </div>
    </div>
  );
}
