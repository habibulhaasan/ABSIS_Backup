// src/components/Shell.js
'use client';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const PUBLIC = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/create-org', '/select-org', '/join', '/pending-approval'];

export default function Shell({ children }) {
  const pathname = usePathname();
  const isPublic = PUBLIC.some(r => pathname === r || pathname.startsWith(r + '/'));
  const needsSidebarMargin = !isPublic;

  // Try to read member mode — useAuth may not be available in some edge cases
  let isViewingAsMember = false;
  try {
    const auth = useAuth();
    isViewingAsMember = auth.isViewingAsMember || false;
  } catch (_) {}

  // When SA is in member mode, a 32px purple banner is fixed at top
  // so all content needs to shift down an extra 32px
  const bannerOffset = isViewingAsMember ? 32 : 0;

  return (
    <>
      <style>{`
        /* Desktop: push content right of the 240px sidebar */
        @media (min-width: 769px) {
          .shell-main {
            margin-left: ${needsSidebarMargin ? '240px' : '0'};
            padding-top: ${bannerOffset}px;
          }
        }
        /* Mobile: push content below the 56px top bar (+ banner if active) */
        @media (max-width: 768px) {
          .shell-main {
            padding-top: ${needsSidebarMargin ? (56 + bannerOffset) + 'px' : '0'};
          }
        }
        /*
          IMPORTANT: Do NOT set transform, filter, or will-change on shell-main.
          Any of those would create a new stacking context and break
          position:fixed modals (they'd be fixed relative to shell-main
          instead of the viewport).
        */
      `}</style>
      <main className="shell-main" style={{ minHeight: '100vh' }}>
        {children}
      </main>
    </>
  );
}
