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
    ['occ.budget', `/occasions/${id}/budget`],
    ['occ.ledger', `/occasions/${id}/ledger`],
    ['occ.suppliers', `/occasions/${id}/suppliers`],
    ['occ.deliveries', `/occasions/${id}/deliveries`],
    ['occ.eventday', `/occasions/${id}/eventday`],
    ['occ.readiness', `/occasions/${id}/readiness`],
    ['occ.closeout', `/occasions/${id}/closeout`],
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
        <Link href={`/occasions/${id}/briefing`}>{t('occ.briefing')}</Link>
        <Link href={`/occasions/${id}/space`}>{t('p.space.title')}</Link>
        <Link href={`/occasions/${id}/seating`}>{t('c.seat.tab')}</Link>
        <Link href={`/occasions/${id}/programme`}>{t('c.prog.tab')}</Link>
        <Link href={`/occasions/${id}/menus`}>{t('c.menu.tab')}</Link>
        <Link href={`/occasions/${id}/public`}>{t('c.pub.tab')}</Link>
        <Link href={`/occasions/${id}/invitations`}>{t('c.inv.tab')}</Link>
        <Link href={`/occasions/${id}/arrangements`}>{t('c.arr.tab')}</Link>
        <Link href={`/occasions/${id}/gift`}>{t('c.gift.tab')}</Link>
        <Link href={`/occasions/${id}/promotion`}>{t('c.promo.tab')}</Link>
        <Link href={`/occasions/${id}/travel`}>{t('d.tab')}</Link>
        <Link href={`/occasions/${id}/operate`}>{t('e.tab')}</Link>
      </div>
      {children}
    </main>
  );
}
