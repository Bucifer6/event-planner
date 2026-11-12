import type { ReactNode } from 'react';
import './globals.css';
import { getLocale } from './lib/i18n';
import { LangProvider } from '../components/LangProvider';
import { CookieNotice } from '../components/CookieNotice';
import { COOKIE_SET_SIGNATURE } from './lib/cookie-set';

export const metadata = {
  title: 'EventDesk.ro',
  description: 'Un singur plan pentru orice ocazie. / One plan for any occasion.',
  manifest: '/manifest.webmanifest',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <LangProvider locale={locale}>
          {children}
          <CookieNotice signature={COOKIE_SET_SIGNATURE} />
        </LangProvider>
      </body>
    </html>
  );
}
