import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireUser } from '../lib/session';
import { getLocale, tf } from '../lib/i18n';
import { LangToggle } from '../../components/LangToggle';
import { signOutAction } from '../actions/auth';
import { getPlannerAppearance } from '../lib/planner-appearance';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser().catch(() => redirect('/signin'));
  const locale = await getLocale();
  const t = tf(locale);
  const appearance = await getPlannerAppearance();
  return (
    <div
      className={appearance === 'garden' ? undefined : 'planner-skin planner-shell'}
      data-appearance={appearance}
    >
      <header className="topbar planner-topbar">
        <Link className="brand" href="/dashboard">
          {t('app.name')}
        </Link>
        <nav>
          <Link href="/dashboard">{t('nav.occasions')}</Link>
          <Link href="/directory">{t('nav.directory')}</Link>
          <Link href="/business">{t('nav.business')}</Link>
          <Link href="/account">{t('nav.account')}</Link>
          <LangToggle />
          <form action={signOutAction}>
            <button className="btn secondary" type="submit">
              {t('nav.signout')}
            </button>
          </form>
        </nav>
      </header>
      <div className="planner-content">
        {children}
        <footer>EventDesk.ro — {user.email ?? user.username}</footer>
      </div>
    </div>
  );
}
