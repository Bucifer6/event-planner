import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { formatDateTime } from '@eventdesk/shared';
import { listProgramme } from '@eventdesk/core';
import {
  cueAction,
  notifyProgrammeAction,
  programmeItemAction,
  programmeUpdateAction,
} from '../../../../actions/releasec';

// C-03/C-10: entertainment programme + versioned cue list; guests are notified once
// per programme change (INF5), never as a stream.
export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const items = await listProgramme(id, user.accountId);
  const occ = await prismaOcc(id);

  return (
    <>
      <h2>{t('c.prog.title')}</h2>
      <p className="muted">
        {t('c.prog.revision')}: {occ.programmeRevision}
      </p>
      <form action={programmeItemAction.bind(null, id)}>
        <input name="title" type="text" placeholder={t('c.prog.title_ph')} required />
        <input name="durationMin" type="number" min={1} placeholder="min" />
        <button className="btn" type="submit">
          {t('c.prog.add')}
        </button>
      </form>
      {items.map((it) => (
        <div key={it.id} className="card">
          <strong>{it.title}</strong> · v{it.version}
          {it.startsAt && (
            <span className="muted mono"> {formatDateTime(it.startsAt, locale)}</span>
          )}
          <form action={programmeUpdateAction.bind(null, id, it.id)}>
            <input name="title" type="text" defaultValue={it.title} />
            <button className="btn secondary" type="submit">
              {t('common.save')}
            </button>
          </form>
          <ul>
            {it.cues.map((c) => (
              <li key={c.id} className="mono">
                {c.atLabel}: {c.action}
              </li>
            ))}
          </ul>
          <form action={cueAction.bind(null, id, it.id)}>
            <input name="atLabel" type="text" placeholder="T-10min" required />
            <input name="action" type="text" placeholder={t('c.prog.cue_action')} required />
            <button className="btn secondary" type="submit">
              {t('c.prog.add_cue')}
            </button>
          </form>
        </div>
      ))}
      <form action={notifyProgrammeAction.bind(null, id)}>
        <button className="btn attention" type="submit">
          {t('c.prog.notify')}
        </button>
      </form>
    </>
  );
}

import { prisma } from '@eventdesk/db';
async function prismaOcc(id: string) {
  return prisma.occasion.findUniqueOrThrow({ where: { id } });
}
