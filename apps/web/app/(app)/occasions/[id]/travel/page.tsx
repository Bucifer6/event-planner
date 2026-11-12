import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { prisma } from '@eventdesk/db';
import { formatInZone, formatDateTime } from '@eventdesk/shared';
import { listItinerary, listRooms, settlementByCurrency } from '@eventdesk/core';
import {
  itineraryLegAction,
  packingAction,
  packingToggleAction,
  roomAction,
  roomAssignAction,
  subgroupAction,
  transportAction,
} from '../../../../actions/released';

// Release D: itinerary across time zones (UTC storage, Bucharest + trip zone display),
// subgroups, packing lists, transport legs, atomic room allocation, per-currency
// settlement from the one ledger.
export default async function TravelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const legs = await listItinerary(id, user.accountId);
  const households = await prisma.household.findMany({ where: { occasionId: id } });
  const subgroups = await prisma.subgroup.findMany({
    where: { occasionId: id },
    include: { members: true },
  });
  const packing = await prisma.packingItem.findMany({ where: { occasionId: id } });
  const transport = await prisma.transportLeg.findMany({ where: { occasionId: id } });
  const rooms = await listRooms(id, user.accountId);
  const settlement = await settlementByCurrency(id, user.accountId).catch(() => null);

  return (
    <>
      <h2>{t('d.title')}</h2>
      <p className="muted">{t('d.utc_hint')}</p>

      <h3>{t('d.itinerary')}</h3>
      <form action={itineraryLegAction.bind(null, id)}>
        <input name="title" type="text" placeholder={t('d.leg_title')} required />
        <select name="kind" defaultValue="flight">
          <option value="flight">flight</option>
          <option value="stay">stay</option>
          <option value="transport">transport</option>
          <option value="activity">activity</option>
          <option value="other">other</option>
        </select>
        <label>{t('d.starts_utc')}</label>
        <input name="startsAtUtc" type="datetime-local" required />
        <label>{t('d.zone')}</label>
        <input name="zone" type="text" defaultValue="Europe/Bucharest" />
        <button className="btn" type="submit">
          {t('d.add_leg')}
        </button>
      </form>
      <ul>
        {legs.map((l) => (
          <li key={l.id}>
            <strong>{l.title}</strong> ({l.kind}) — {formatDateTime(l.startsAtUtc, locale)} ·{' '}
            {formatInZone(l.startsAtUtc, l.zone, locale)}
          </li>
        ))}
      </ul>

      <h3>{t('d.subgroups')}</h3>
      <form action={subgroupAction.bind(null, id)}>
        <input name="name" type="text" placeholder={t('d.subgroup_name')} required />
        {households.map((h) => (
          <label key={h.id} style={{ display: 'block', minHeight: '44px' }}>
            <input type="checkbox" name="householdIds" value={h.id} /> {h.name}
          </label>
        ))}
        <button className="btn secondary" type="submit">
          {t('d.add_subgroup')}
        </button>
      </form>
      {subgroups.map((s) => (
        <div key={s.id} className="card">
          {s.name} ({s.members.length})
        </div>
      ))}

      <h3>{t('d.packing')}</h3>
      <form action={packingAction.bind(null, id)}>
        <input name="label" type="text" placeholder={t('d.pack_label')} required />
        <button className="btn secondary" type="submit">
          {t('d.add_pack')}
        </button>
      </form>
      {packing.map((p) => (
        <form key={p.id} action={packingToggleAction.bind(null, id, p.id, !p.packed)}>
          <label style={{ minHeight: '44px' }}>
            <input type="checkbox" checked={p.packed} readOnly /> {p.label}
          </label>
          <button className="btn secondary" type="submit">
            {p.packed ? t('d.unpack') : t('d.pack')}
          </button>
        </form>
      ))}

      <h3>{t('d.transport')}</h3>
      <form action={transportAction.bind(null, id)}>
        <input name="label" type="text" placeholder={t('d.transport_label')} required />
        <input name="fromPlace" type="text" placeholder={t('d.from')} required />
        <input name="toPlace" type="text" placeholder={t('d.to')} required />
        <input name="departsAtUtc" type="datetime-local" required />
        <input name="seats" type="number" min={0} defaultValue={0} />
        <button className="btn secondary" type="submit">
          {t('d.add_leg')}
        </button>
      </form>
      <ul>
        {transport.map((x) => (
          <li key={x.id}>
            {x.label}: {x.fromPlace} → {x.toPlace} · {formatInZone(x.departsAtUtc, x.zone, locale)}{' '}
            · {x.seats} locuri
          </li>
        ))}
      </ul>

      <h3>{t('d.rooms')}</h3>
      <form action={roomAction.bind(null, id)}>
        <input name="name" type="text" placeholder={t('d.room_name')} required />
        <input name="capacity" type="number" min={1} defaultValue={2} />
        <button className="btn secondary" type="submit">
          {t('d.add_room')}
        </button>
      </form>
      {rooms.map((r) => (
        <div key={r.id} className="card">
          <strong>{r.name}</strong> — {r.occupants}/{r.capacity}
          <ul>
            {r.assignments.map((a) => (
              <li key={a.id} className="mono">
                {households.find((h) => h.id === a.householdId)?.name ?? a.householdId}
              </li>
            ))}
          </ul>
          <form action={roomAssignAction.bind(null, id, r.id)}>
            <select name="householdId" defaultValue="">
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <button className="btn secondary" type="submit">
              {t('d.assign')}
            </button>
          </form>
        </div>
      ))}

      {settlement && (
        <>
          <h3>{t('d.settlement')}</h3>
          <ul>
            {settlement.byCurrency.map((c) => (
              <li key={c.currency} className="mono">
                {c.currency}: {c.count} intrări, {c.paidBani} bani
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
