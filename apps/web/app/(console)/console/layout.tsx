import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getLocale, tf } from '../../lib/i18n';
import { currentStaff } from '../../actions/console';
const STAFF_COOKIE = 'ed_staff_session';

// R0-13/S5: the console requires a staff account with confirmed TOTP and a console
// session (12h / 30min idle). Every console action is audit-logged (SEC10).
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect('/console/signin');
  const locale = await getLocale();
  const t = tf(locale);
  const store = await cookies();
  void store;
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/console">
          EventDesk — Consolă
        </Link>
        <nav>
          <Link href="/console">{t('console.dashboard')}</Link>
          <Link href="/console/approvals">{t('console.approvals')}</Link>
          <Link href="/console/audit">{t('console.audit')}</Link>
          <Link href="/console/monetization">{t('console.monetization')}</Link>
          <Link href="/dashboard">{t('nav.occasions')}</Link>
        </nav>
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
