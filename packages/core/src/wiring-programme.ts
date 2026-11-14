import { listProgramme } from "./programme";
import { dayRange, registerTimelineSource } from "./rehearsal";

// Integration wiring: the programme (Release C) feeds the rehearsal timeline (Release E)
// without either module importing the other. Read-only; listProgramme does the access check.
registerTimelineSource({
  key: "programme",
  list: async (ctx, occasionId, day) => {
    const view = await listProgramme(ctx, occasionId);
    const range = dayRange(day, view.occasion.timezone);
    return view.items
      .filter((i) => i.startsAt !== null && i.startsAt >= range.from && i.startsAt < range.to)
      .map((i) => ({
        id: i.id,
        title: i.title,
        kind: "moment",
        startsAt: i.startsAt as Date,
        endsAt: i.endsAt,
        everyone: i.concernsAll,
        people: i.concernsAll ? undefined : i.concernsHouseholdIds.map((h) => ({ key: `h:${h}`, label: h })),
        supplier: i.supplierId ? { id: i.supplierId, label: i.performerName ?? i.supplierId } : null,
        place: i.place,
        slug: "programme",
      }));
  },
});
