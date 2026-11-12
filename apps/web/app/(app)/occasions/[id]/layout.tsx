import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '../../../lib/session';
import { getLocale, tf } from '../../../lib/i18n';
import { getOccasionForMember } from '@eventdesk/core';

export default async function OccasionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const { occasion } = await getOccasionForMember(id, user.accountId);
  const tabs = [
    ['occ.overview', `/occasions/${id}`],
    ['occ.tasks', `/occasions/${id}/tasks`],
    ['occ.guests', `/occasions/${id}/guests`],
    ['occ.polls', `/occasions/${id}/polls`],
    ['occ.contributions', `/occasions/${id}/contributions`],
    ['occ.settings', `/occasions/${id}/settings`],
  ] as const;
  return (
    <main className="wrap">
      <h1>{occasion.title}</h1>
      <div className="tabs">
        {tabs.map(([key, href]) => (
          <Link key={href} href={href}>
            {t(key)}
          </Link>
        ))}
        <Link href={`/occasions/${id}/export`}>{t('occ.export')}</Link>
      </div>
      {children}
    </main>
  );
}
