import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'EventDesk.ro',
  description: 'Un singur plan pentru orice ocazie. / One plan for any occasion.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  // No cookies are set anywhere on the public site (D1); locale is a query param.
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
