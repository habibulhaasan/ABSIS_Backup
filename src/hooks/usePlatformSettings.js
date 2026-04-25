// src/hooks/usePlatformSettings.js
'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

const DEFAULTS = {
  requireOrgApproval:      true,
  maxOrgsPerUser:          5,
  maxMembersFreeTier:      20,
  platformName:            'Capital Sync',
  supportEmail:            '',
  maintenanceMode:         false,
  allowNewRegistrations:   true,
  allowOrgCreation:        true,
};

export function usePlatformSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'platform', 'settings'),
      snap => {
        setSettings(snap.exists() ? { ...DEFAULTS, ...snap.data() } : DEFAULTS);
        setLoading(false);
      },
      () => { setLoading(false); } // on error fall back to defaults
    );
    return unsub;
  }, []);

  return { settings, loading };
}