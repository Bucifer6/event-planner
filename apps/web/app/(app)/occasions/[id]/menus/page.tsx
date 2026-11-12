import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { listMenus, menuQuantities } from '@eventdesk/core';
import { mealChoiceAction, menuAction, menuItemAction } from '../../../../actions/releasec';

// C-05: menus, per-guest meal choices (diet tags), quantities into order snapshots.
export default async function MenusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const menus = await listMenus(id, user.accountId);
  const households = await prisma.household.findMany({ where: { occasionId: id } });
  const q = await menuQuantities(id, user.accountId);

  return (
    <>
      <h2>{t('c.menu.title')}</h2>
      <form action={menuAction.bind(null, id)}>
        <input name="name" type="text" placeholder={t('c.menu.name')} required />
        <button className="btn" type="submit">
          {t('c.menu.add')}
        </button>
      </form>
      {menus.map((m) => (
        <div key={m.id} className="card">
          <h3>{m.name}</h3>
          <ul>
            {m.items.map((it) => (
              <li key={it.id}>
                {it.name} {it.dietTags.length ? `(${it.dietTags.join(', ')})` : ''} —{' '}
                {it.choices.length}{' '}
                {households.map((h) => (
                  <form
                    key={h.id}
                    action={mealChoiceAction.bind(null, id, h.id, it.id)}
                    style={{ display: 'inline' }}
                  >
                    <button className="btn secondary" type="submit" title={h.name}>
                      {h.name.split(' ')[0]}
                    </button>
                  </form>
                ))}
              </li>
            ))}
          </ul>
          <form action={menuItemAction.bind(null, id, m.id)}>
            <input name="name" type="text" placeholder={t('c.menu.item')} required />
            <input name="dietTags" type="text" placeholder="vegetarian, vegan…" />
            <button className="btn secondary" type="submit">
              {t('c.menu.add_item')}
            </button>
          </form>
        </div>
      ))}
      <h3>{t('c.menu.quantities')}</h3>
      <ul>
        {q.map((x) => (
          <li key={x.itemId} className="mono">
            {x.name}: {x.count}
          </li>
        ))}
      </ul>
    </>
  );
}
