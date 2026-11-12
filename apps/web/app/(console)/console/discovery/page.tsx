import { prisma } from '@eventdesk/db';
import { listDrafts, listSources } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import {
  approveDraftAction,
  handleObjectionAction,
  setSourceEnabledAction,
} from '../../../actions/pconsole';

// W4/W5/W7 + BD1-BD7: discovery drafts (approve -> live unclaimed listing, P29),
// per-source kill switch (BD7), objections/removals honoured within 30 days (BD6).
export default async function DiscoveryPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const drafts = await listDrafts('pending');
  const sources = await listSources();
  const objections = await prisma.objectionRecord.findMany({
    where: { handledAt: null },
    orderBy: { receivedAt: 'desc' },
  });

  return (
    <>
      <h1>{t('p.con.discovery.title')}</h1>

      <h2>{t('p.con.sources')}</h2>
      {sources.map((s) => (
        <Card key={s.id}>
          <strong>{s.name}</strong> · {s.kind} · {s.enabled ? 'ON' : 'OFF'} · {s.rateLimitPerHour}/h
          <div className="row">
            <form action={setSourceEnabledAction.bind(null, s.id, true)}>
              <button className="btn secondary" type="submit" disabled={s.enabled}>
                {t('p.con.source_enable')}
              </button>
            </form>
            <form action={setSourceEnabledAction.bind(null, s.id, false)}>
              <button className="btn attention" type="submit" disabled={!s.enabled}>
                {t('p.con.source_disable')}
              </button>
            </form>
          </div>
        </Card>
      ))}

      <h2>{t('p.con.drafts')}</h2>
      {drafts.length === 0 && <Notice>{t('p.con.moderation.empty')}</Notice>}
      {drafts.map((d) => (
        <Card key={d.id}>
          <strong>{d.name}</strong>
          <div className="muted mono">
            {d.sourceUrl} · {d.countyCode ?? '—'} · {d.collectedAt.toISOString().slice(0, 10)}
          </div>
          {d.publicContactRoute && <div className="mono">{d.publicContactRoute}</div>}
          <form action={approveDraftAction.bind(null, d.id)}>
            <button className="btn" type="submit">
              {t('p.con.draft_approve')}
            </button>
          </form>
        </Card>
      ))}

      <h2>{t('p.con.objections')}</h2>
      {objections.length === 0 && <Notice>—</Notice>}
      {objections.map((o) => (
        <Card key={o.id}>
          <div className="label-factual">
            {t(`p.con.objection_${o.kind}`)} · {o.receivedAt.toISOString().slice(0, 10)}
          </div>
          <p>{o.detail}</p>
          <form action={handleObjectionAction.bind(null, o.id)}>
            <button className="btn" type="submit">
              {t('p.con.objection_handle')}
            </button>
          </form>
        </Card>
      ))}
    </>
  );
}
