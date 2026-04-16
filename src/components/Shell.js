'use client';
import { usePathname } from 'next/navigation';

const PUBLIC = ['/', '/login', '/register', '/forgot-password', '/create-org', '/select-org', '/join', '/pending-approval'];

export default function Shell({ children }) {
  const pathname = usePathname();
  const isPublic = PUBLIC.some(r => pathname === r || pathname.startsWith(r + '/'));
  const needsSidebarMargin = !isPublic;

  return (
    <>
      <style>{`
        /* Desktop: push content right of the 240px sidebar */
        @media (min-width: 769px) {
          .shell-main {
            margin-left: ${needsSidebarMargin ? '240px' : '0'};
          }
        }
        /* Mobile: push content below the 56px top bar */
        @media (max-width: 768px) {
          .shell-main {
            padding-top: ${needsSidebarMargin ? '56px' : '0'};
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
