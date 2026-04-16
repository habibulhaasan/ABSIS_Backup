// src/context/AuthContext.js
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext({});

const PUBLIC = [
  '/', '/login', '/register', '/forgot-password',
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
  const [accessMode, setAccessModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dt_access_mode') || 'superadmin';
    }
    return 'superadmin';
  });
  // Superadmin impersonation: view the app as a specific member
  const [impersonateMemberId, setImpersonateMemberId] = useState(null);

  const router   = useRouter();
  const pathname = usePathname();

  const setAccessMode = (mode) => {
    setAccessModeState(mode);
    if (typeof window !== 'undefined') localStorage.setItem('dt_access_mode', mode);
  };

  const switchToOrgMode = async (orgId) => {
    if (orgId && user) {
      await setDoc(doc(db, 'users', user.uid), { activeOrgId: orgId }, { merge: true });
    }
    setAccessMode('org');
    router.push('/dashboard');
  };

  const switchToSuperAdminMode = () => {
    setAccessMode('superadmin');
    setImpersonateMemberId(null);
    router.push('/superadmin');
  };

  const startImpersonation = (memberId) => {
    setImpersonateMemberId(memberId);
    router.push('/dashboard');
  };

  const stopImpersonation = () => {
    setImpersonateMemberId(null);
    router.push('/admin/members');
  };

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

          unsubMem = onSnapshot(
            doc(db, 'organizations', uData.activeOrgId, 'members', firebaseUser.uid),
            (mSnap) => {
              if (mSnap.exists()) {
                const mData = { id: mSnap.id, ...mSnap.data() };
                setMembership(mData);

                if (!isSA && !mData.approved && !isPublic && pathname !== '/pending-approval') {
                  router.push('/pending-approval');
                  setLoading(false);
                  return;
                }

                // ── Admin-path protection ────────────────────────────────────
                // /admin/* and /superadmin/* are restricted.
                // A regular member (not admin, not cashier) hitting /admin/* → /dashboard
                const isAdminPath        = pathname.startsWith('/admin');
                const isSuperAdminPath   = pathname.startsWith('/superadmin');
                const memberIsAdmin      = mData.role === 'admin';
                const memberIsCashier    = mData.role === 'cashier' && !!mData.approved;
                const memberIsOfficeSec  = mData.role === 'office_secretary' && !!mData.approved;
                const memberIsJointSec   = mData.role === 'joint_secretary'  && !!mData.approved;

                // Pages each secretary role may access
                const OFFICE_SEC_PATHS  = ['/admin/members', '/admin/memoranda'];
                const JOINT_SEC_PATHS   = ['/admin/memoranda'];

                const secAllowed = (memberIsOfficeSec && OFFICE_SEC_PATHS.some(p => pathname === p || pathname.startsWith(p+'/')))
                                || (memberIsJointSec  && JOINT_SEC_PATHS.some(p  => pathname === p || pathname.startsWith(p+'/')));

                if (!isSA && isAdminPath && !memberIsAdmin && !memberIsCashier && !secAllowed) {
                  router.replace('/dashboard');
                  setLoading(false);
                  return;
                }
                if (!isSA && isSuperAdminPath) {
                  router.replace('/dashboard');
                  setLoading(false);
                  return;
                }
              } else {
                setMembership(null);
                // No membership doc at all → not a member of this org
                // If they're trying to access /admin, redirect to dashboard
                if (!isSA && pathname.startsWith('/admin')) {
                  router.replace('/dashboard');
                }
              }
              setLoading(false);
            }
          );
        } else {
          setOrgData(null);
          setMembership(null);
          if (!isSA && !isPublic) router.push('/select-org');
          if (isSA && accessMode === 'org') router.push('/select-org');
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
  }, [pathname, accessMode]);

  const isSuperAdmin      = userData?.role === 'superadmin';
  const isOrgAdmin        = membership?.role === 'admin' || (isSuperAdmin && accessMode === 'org');
  const isCashier         = !isOrgAdmin && membership?.role === 'cashier'         && !!membership?.approved;
  const isOfficeSecretary = !isOrgAdmin && membership?.role === 'office_secretary' && !!membership?.approved;
  const isJointSecretary  = !isOrgAdmin && membership?.role === 'joint_secretary'  && !!membership?.approved;
  // Any secretary role
  const isSecretary       = isOfficeSecretary || isJointSecretary;

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
      isOfficeSecretary, isJointSecretary, isSecretary,
      accessMode,
      impersonateMemberId,
      startImpersonation,
      stopImpersonation,
      switchToOrgMode,
      switchToSuperAdminMode,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);