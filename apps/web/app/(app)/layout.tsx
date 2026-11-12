import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireUser } from '../lib/session';
import { getLocale, tf } from '../lib/i18n';
import { LangToggle } from '../../components/LangToggle';
import { signOutAction } from '../actions/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser().catch(() => redirect('/signin'));
  const locale = await getLocale();
  const t = tf(locale);
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/dashboard">
          {t('app.name')}
        </Link>
        <nav>
          <Link href="/dashboard">{t('nav.occasions')}</Link>
          <Link href="/account">{t('nav.account')}</Link>
          <LangToggle />
          <form action={signOutAction}>
            <button className="btn secondary" type="submit">
              {t('nav.signout')}
            </button>
          </form>
        </nav>
      </header>
      {children}
      <footer>EventDesk.ro — {user.email ?? user.username}</footer>
    </>
  );
}
