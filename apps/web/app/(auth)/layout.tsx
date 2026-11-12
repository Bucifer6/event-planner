import Link from 'next/link';
import type { ReactNode } from 'react';

// Auth pages get a minimal brand bar so they don't render bare.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          EventDesk.ro
        </Link>
      </header>
      {children}
    </>
  );
}
