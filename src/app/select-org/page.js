'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import Link from 'next/link';
import { db } from '@/lib/firebase';

export default function SelectOrg() {
  const { user, userData, orgData } = useAuth();
  const [orgs, setOrgs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [switching, setSwitching] = useState(null);

  useEffect(() => {
    if (!user || !userData) return;

    (async () => {
      try {
        const orgIds = userData.orgIds || (userData.activeOrgId ? [userData.activeOrgId] : []);
        const list = [];

        for (const orgId of orgIds) {
          try {
            const [orgSnap, memberSnap] = await Promise.all([
              getDoc(doc(db, 'organizations', orgId)),
              getDoc(doc(db, 'organizations', orgId, 'members', user.uid)),
            ]);
            if (orgSnap.exists() && memberSnap.exists()) {
              const data = orgSnap.data();
              list.push({ id: orgId, ...data, membership: memberSnap.data() });
            }
          } catch (e) {
            console.error('org fetch error:', e);
          }
        }

        setOrgs(list);
      } catch (e) {
        console.error('select-org:', e);
      }
      setLoading(false);
    })();
  }, [user, userData]);

  const switchOrg = async (orgId) => {
    setSwitching(orgId);
    const existing = userData?.orgIds || [];
    const orgIds   = existing.includes(orgId) ? existing : [...existing, orgId];
    await updateDoc(doc(db, 'users', user.uid), { activeOrgId: orgId, orgIds });
    window.location.href = '/dashboard';
  };

  const getLogo = (org) => {
    if (userData?.activeOrgId === org.id && orgData) {
      return orgData.logoUrl || orgData.logoURL || null;
    }
    return org.logoUrl || org.logoURL || null;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: 24 }}>
      <div style={{ maxWidth: 560, margin: '40px auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Your Organizations</h1>
          <p style={{ fontSize: 14, color: '#64748b' }}>Select an organization to continue</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
        ) : orgs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: '#64748b', marginBottom: 20 }}>You're not part of any organization yet.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Link href="/create-org" className="btn-primary">Create Organization</Link>
              <Link href="/join" className="btn-ghost">Join via Invite</Link>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {orgs.map(org => {
              const isActive = userData?.activeOrgId === org.id;
              const logo = getLogo(org);
              return (
                <div
                  key={org.id}
                  className="card"
                  onClick={() => !isActive && switchOrg(org.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: isActive ? 'default' : 'pointer', border: isActive ? '1.5px solid #2563eb' : '1px solid #e2e8f0', background: isActive ? '#eff6ff' : '#fff' }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: isActive ? '#2563eb' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: isActive ? '#fff' : '#475569', flexShrink: 0, overflow: 'hidden' }}>
                    {logo
                      ? <img
                          src={logo}
                          alt={org.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; e.target.parentNode.innerText = org.name?.[0]?.toUpperCase(); }}
                        />
                      : org.name?.[0]?.toUpperCase()
                    }
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 15 }}>{org.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {org.type} · <span style={{ textTransform: 'capitalize' }}>{org.membership?.role}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {isActive && <span className="badge badge-blue">Active</span>}
                    {!org.membership?.approved && <span className="badge badge-yellow">Pending</span>}
                    {switching === org.id && <span style={{ fontSize: 12, color: '#94a3b8' }}>Switching…</span>}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <Link href="/create-org" className="btn-ghost" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                + New Organization
              </Link>
              <Link href="/join" className="btn-ghost" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Join via Invite
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
