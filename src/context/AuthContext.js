// src/context/AuthContext.js
'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext({});

const PUBLIC = [
  '/', '/login', '/register', '/forgot-password', '/reset-password',
  '/select-org', '/create-org', '/join',
  '/pending-approval', '/org-pending',
  '/superadmin',
];

export const AuthProvider = ({ children }) => {
  const [user, setUser]               = useState(null);
  const [userData, setUserData]       = useState(null);
  const [orgData, setOrgData]         = useState(null);
  const [membership, setMembership]   = useState(null);
  const [loading, setLoading]         = useState(true);

  // ── Access mode ────────────────────────────────────────────────────────────
  // 'superadmin' → SA platform view
  // 'org'        → SA acting as org admin (or regular org admin/member)
  // 'member'     → SA impersonating a specific member
  const [accessMode, setAccessModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dt_access_mode') || 'superadmin';
    }
    return 'superadmin';
  });

  // ── Member impersonation ───────────────────────────────────────────────────
  // When accessMode === 'member', this holds the uid being impersonated
  const [impersonateMemberId,   setImpersonateMemberId]   = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dt_impersonate_uid') || null;
    return null;
  });
  const [impersonateMemberName, setImpersonateMemberName] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dt_impersonate_name') || null;
    return null;
  });

  const router   = useRouter();
  const pathname = usePathname();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const setAccessMode = (mode) => {
    setAccessModeState(mode);
    if (typeof window !== 'undefined') localStorage.setItem('dt_access_mode', mode);
  };

  // ── Switch to org-admin mode ───────────────────────────────────────────────
  const switchToOrgMode = async (orgId) => {
    if (orgId && user) {
      await setDoc(doc(db, 'users', user.uid), { activeOrgId: orgId }, { merge: true });
    }
    // Clear any member impersonation
    setImpersonateMemberId(null);
    setImpersonateMemberName(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dt_impersonate_uid');
      localStorage.removeItem('dt_impersonate_name');
    }
    setAccessMode('org');
    router.push('/dashboard');
  };

  // ── Switch back to SA platform mode ───────────────────────────────────────
  const switchToSuperAdminMode = () => {
    setImpersonateMemberId(null);
    setImpersonateMemberName(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dt_impersonate_uid');
      localStorage.removeItem('dt_impersonate_name');
    }
    setAccessMode('superadmin');
    router.push('/superadmin');
  };

  // ── Start impersonating a member ──────────────────────────────────────────
  // Call with: { uid, name, orgId }
  // orgId is optional — if SA is already in an org it uses the existing activeOrgId
  const startViewingAsMember = async ({ uid, name, orgId }) => {
    if (orgId && user) {
      await setDoc(doc(db, 'users', user.uid), { activeOrgId: orgId }, { merge: true });
    }
    setImpersonateMemberId(uid);
    setImpersonateMemberName(name || uid);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dt_impersonate_uid', uid);
      localStorage.setItem('dt_impersonate_name', name || uid);
    }
    setAccessMode('member');
    router.push('/dashboard');
  };

  // ── Stop impersonating — return to org-admin mode ─────────────────────────
  const stopViewingAsMember = () => {
    setImpersonateMemberId(null);
    setImpersonateMemberName(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dt_impersonate_uid');
      localStorage.removeItem('dt_impersonate_name');
    }
    setAccessMode('org');
    router.push('/dashboard');
  };

  // ── Firebase auth + Firestore listeners ───────────────────────────────────
  useEffect(() => {
    let unsubUser = null;
    let unsubOrg  = null;
    let unsubMem  = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (unsubUser) { unsubUser(); unsubUser = null; }
      if (unsubOrg)  { unsubOrg();  unsubOrg  = null; }
      if (unsubMem)  { unsubMem();  unsubMem  = null; }

      const isPublic = PUBLIC.some(r => pathname === r || pathname.startsWith(r + '/'));

      if (!firebaseUser) {
        setUser(null); setUserData(null); setOrgData(null); setMembership(null);
        if (!isPublic) router.push('/login');
        setLoading(false);
        return;
      }

      setUser(firebaseUser);

      unsubUser = onSnapshot(doc(db, 'users', firebaseUser.uid), (uSnap) => {
        if (!uSnap.exists()) { setLoading(false); return; }
        const uData = uSnap.data();
        setUserData(uData);

        const isSA = uData.role === 'superadmin';

        // SA in pure platform mode — no org data needed
        if (isSA && accessMode === 'superadmin') {
          setOrgData(null);
          setMembership(null);
          setLoading(false);
          return;
        }

        if (uData.activeOrgId) {
          if (unsubOrg) { unsubOrg(); unsubOrg = null; }
          if (unsubMem) { unsubMem(); unsubMem = null; }

          unsubOrg = onSnapshot(doc(db, 'organizations', uData.activeOrgId), (orgSnap) => {
            if (orgSnap.exists()) {
              const oData = { id: orgSnap.id, ...orgSnap.data() };
              setOrgData(oData);
              if (!isSA && oData.status === 'pending' && !isPublic && pathname !== '/org-pending') {
                router.push('/org-pending');
              }
            }
          });

          // For member mode: listen to the IMPERSONATED member's doc, not SA's
          const memberUid = (isSA && accessMode === 'member' && impersonateMemberId)
            ? impersonateMemberId
            : firebaseUser.uid;

          unsubMem = onSnapshot(
            doc(db, 'organizations', uData.activeOrgId, 'members', memberUid),
            (mSnap) => {
              if (mSnap.exists()) {
                const mData = { id: mSnap.id, ...mSnap.data() };
                setMembership(mData);
                // Only redirect real members, not SA impersonating
                if (!isSA && !mData.approved && !isPublic && pathname !== '/pending-approval') {
                  router.push('/pending-approval');
                }
              } else {
                setMembership(null);
              }
              setLoading(false);
            }
          );
        } else {
          setOrgData(null);
          setMembership(null);
          if (!isSA && !isPublic) router.push('/select-org');
          if (isSA && (accessMode === 'org' || accessMode === 'member')) router.push('/select-org');
          setLoading(false);
        }
      }, (err) => {
        console.error('AuthContext error:', err);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
      if (unsubOrg)  unsubOrg();
      if (unsubMem)  unsubMem();
    };
  }, [pathname, accessMode, impersonateMemberId]);

  // ── Derived role flags ─────────────────────────────────────────────────────
  const isSuperAdmin = userData?.role === 'superadmin';

  // SA in org mode OR real org admin
  const isOrgAdmin = membership?.role === 'admin' || (isSuperAdmin && accessMode === 'org');

  // SA in member mode — behaves exactly as a member
  const isViewingAsMember = isSuperAdmin && accessMode === 'member' && !!impersonateMemberId;

  // Cashier: real cashier, not admin, and not SA-in-member-mode
  const isCashier = !isOrgAdmin && !isViewingAsMember &&
    membership?.role === 'cashier' && !!membership?.approved;

  // The effective user ID for member-scoped queries
  // Use this instead of user.uid in all member-facing pages
  const viewUid = isViewingAsMember ? impersonateMemberId : (user?.uid || null);

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#f8fafc' }}>
      <div style={{ width:32, height:32, border:'3px solid #bfdbfe', borderTopColor:'#2563eb', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ marginTop:12, fontSize:13, color:'#94a3b8' }}>Loading…</p>
    </div>
  );

  return (
    <AuthContext.Provider value={{
      user, userData, orgData, membership, loading,
      isSuperAdmin, isOrgAdmin, isCashier,
      isViewingAsMember,
      impersonateMemberId,
      impersonateMemberName,
      viewUid,
      accessMode,
      switchToOrgMode,
      switchToSuperAdminMode,
      startViewingAsMember,
      stopViewingAsMember,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
