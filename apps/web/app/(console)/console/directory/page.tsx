import { prisma } from '@eventdesk/db';
import { directoryDailyStats, listDirectoryCategories, listCounties } from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import {
  createDirectoryCategoryAction,
  retireDirectoryCategoryAction,
  setDirectoryCategoryPublishedAction,
} from '../../../actions/pconsole';

// W4: directory management — categories create/retire/publish, per-category x county
// daily stats (aggregates only, no visitor identifiers, D4).
export default async function DirectoryManagePage() {
  const locale = await getLocale();
  const t = tf(locale);
  const categories = await listDirectoryCategories();
  const counties = await listCounties();
  const stats = await directoryDailyStats(30);

  return (
    <>
      <h1>{t('p.con.dir.title')}</h1>
      <Card>
        <h2>{t('p.con.dir.new_cat')}</h2>
        <form action={createDirectoryCategoryAction}>
          <input name="slug" type="text" placeholder="slug" required />
          <input name="nameRo" type="text" placeholder="nume RO" required />
          <input name="nameEn" type="text" placeholder="name EN" required />
          <button className="btn" type="submit">
            {t('p.con.dir.create')}
          </button>
        </form>
      </Card>
      {categories.map((c) => (
        <Card key={c.id}>
          <strong>{c.slug}</strong> · {c.nameRo} / {c.nameEn} ·{' '}
          {c.published ? 'published' : 'unpublished'} {c.retiredAt ? '· retired' : ''}
          <div className="row">
            <form action={setDirectoryCategoryPublishedAction.bind(null, c.id, !c.published)}>
              <button className="btn secondary" type="submit">
                {c.published ? t('p.con.dir.unpublish') : t('p.con.dir.publish')}
              </button>
            </form>
            <form action={retireDirectoryCategoryAction.bind(null, c.id, !c.retiredAt)}>
              <button className="btn attention" type="submit">
                {c.retiredAt ? t('p.con.dir.unretire') : t('p.con.dir.retire')}
              </button>
            </form>
          </div>
        </Card>
      ))}
      <h2>{t('p.con.dir.stats')}</h2>
      <Notice>{t('p.con.dir.stats_hint')}</Notice>
      <table>
        <thead>
          <tr>
            <th>{t('p.dir.category')}</th>
            <th>{t('p.dir.county')}</th>
            <th>{t('p.con.dir.searches30d')}</th>
            <th>{t('p.con.dir.enq_sent')}</th>
            <th>{t('p.con.dir.enq_answered')}</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={`${s.categoryId}|${s.countyId}`}>
              <td>{s.category}</td>
              <td>{s.county}</td>
              <td>{s.searches30d}</td>
              <td>{s.enquiriesSent}</td>
              <td>{s.enquiriesAnswered}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('p.con.dir.counties')}</h2>
      <p className="muted">{counties.map((c) => c.code).join(' · ')}</p>
      <p className="muted mono">{prisma ? '' : ''}</p>
    </>
  );
}
