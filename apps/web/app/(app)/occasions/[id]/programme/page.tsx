import { listHouseholds } from "@ed/core/guests";
import { listAllCueVersions, listProgramme, PROGRAMME_KINDS, type ProgrammeCue, type ProgrammeItemView } from "@ed/core/programme";
import { listSuppliers } from "@ed/core/suppliers";
import { formatDateTime, formatWeekdayDate } from "@ed/i18n/format";
import { EmptyState, Notice, PageHeader, Section, Tag } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { includeProgrammeInBriefingAction, setProgrammeVisibilityAction } from "@/app/actions/programme";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { CueSheet, type CueLabels, type CueVersion } from "./_components/CueSheet";
import { ItemSheet, type ItemLabels, type ItemValues } from "./_components/ItemSheet";
import styles from "./_components/programme.module.css";
import { ResultForm } from "./_components/ResultForm";

// Programme of the day (C-03): the moments in time order, each with its performer, its
// versioned cue list and the "vizibil invitaților" switch; performer briefings go through
// the supplier briefing (B4). Guests are told once per change (C-10) — see @ed/core/programme.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("programme"))("title") };
}

export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("programme");
  const tc = await getTranslations("common");
  const view = await orNotFound(listProgramme(ctx, id));
  const [cueVersions, suppliers, households] = await Promise.all([
    listAllCueVersions(ctx, id),
    listSuppliers(ctx, id).catch(() => null),
    view.canManage ? listHouseholds(ctx, { occasionId: id }).catch(() => null) : null,
  ]);
  const supplierOptions = (suppliers?.items ?? []).map((s) => ({ id: s.id, name: s.name }));
  const householdOptions = (households?.items ?? []).map((h) => ({ id: h.id, name: h.name }));
  const kinds = PROGRAMME_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }));

  const itemLabels: ItemLabels = {
    close: tc("actions.close"),
    optional: tc("optional"),
    title: t("fields.title"),
    titleHint: t("fields.titleHint"),
    kind: t("fields.kind"),
    time: t("fields.time"),
    timeHint: t("fields.timeHint"),
    nextDay: t("fields.nextDay"),
    nextDayHint: t("fields.nextDayHint"),
    duration: t("fields.duration"),
    durationHint: t("fields.durationHint"),
    place: t("fields.place"),
    placeHint: t("fields.placeHint"),
    performer: t("fields.performer"),
    performerNone: t("fields.performerNone"),
    performerHint: t("fields.performerHint"),
    visible: t("fields.visible"),
    visibleHint: t("fields.visibleHint"),
    concerns: t("fields.concerns"),
    concernsAll: t("fields.concernsAll"),
    concernsSome: t("fields.concernsSome"),
    households: t("fields.households"),
    householdsEmpty: t("fields.householdsEmpty"),
    notes: t("fields.notes"),
    notesHint: t("fields.notesHint"),
    submit: t("edit.submit"),
    saving: tc("status.saving"),
    remove: t("remove.button"),
    removeBody: t("remove.body"),
    removeSubmit: t("remove.submit"),
    removeKeep: t("remove.keep"),
    removing: tc("status.deleting"),
  };
  const cueLabels: CueLabels = {
    close: tc("actions.close"),
    intro: t("cues.intro"),
    offset: t("cues.offset"),
    offsetHint: t("cues.offsetHint"),
    instruction: t("cues.instruction"),
    who: t("cues.who"),
    row: t.raw("cues.row") as string,
    addRow: t("cues.addRow"),
    removeRow: t.raw("cues.removeRow") as string,
    save: t("cues.save"),
    saving: t("cues.saving"),
    saved: t.raw("cues.saved") as string,
    unchanged: t.raw("cues.unchanged") as string,
    empty: t("cues.empty"),
    history: t("cues.history"),
    version: t.raw("cues.version") as string,
    current: t("cues.current"),
    versionEmpty: t("cues.versionEmpty"),
    readOnly: !view.canManage,
  };

  const cueAt = (c: ProgrammeCue) => (c.offsetMin === 0 ? t("cues.atStart") : c.offsetMin > 0 ? t("cues.after", { n: c.offsetMin }) : t("cues.before", { n: -c.offsetMin }));
  const versionsOf = (itemId: string): CueVersion[] =>
    (cueVersions[itemId] ?? []).map((v) => ({
      version: v.version,
      savedAt: t("cues.versionAt", { date: formatDateTime(v.createdAt, ctx.locale) }),
      cues: v.cues.map((c) => ({ at: cueAt(c), instruction: c.instruction, who: c.who })),
    }));
  const toValues = (i: ProgrammeItemView): ItemValues => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    time: i.time,
    nextDay: i.dayOffset > 0,
    durationMin: i.durationMin,
    place: i.place,
    visibleToGuests: i.visibleToGuests,
    concernsAll: i.concernsAll,
    concernsHouseholdIds: i.concernsHouseholdIds,
    supplierId: i.supplierId,
    notes: i.notes,
  });

  const addButton = view.canManage ? (
    <ItemSheet
      occasionId={id}
      trigger={t("add.button")}
      sheetTitle={t("add.title")}
      variant="primary"
      icon={<IconPlus size={16} />}
      kinds={kinds}
      suppliers={supplierOptions}
      households={householdOptions}
      labels={{ ...itemLabels, submit: t("add.submit") }}
    />
  ) : null;

  // performers: suppliers that have at least one moment
  const performers = (suppliers?.items ?? [])
    .map((s) => ({ supplier: s, moments: view.items.filter((i) => i.supplierId === s.id).length }))
    .filter((p) => p.moments > 0);

  const rows: ReactNode[] = [];
  let lastDay = 0;
  for (const i of view.items) {
    if (i.dayOffset > lastDay) {
      rows.push(
        <li className={styles.dayMark} key={`day-${i.dayOffset}`}>
          {t("nextDayHeading")}
        </li>,
      );
      lastDay = i.dayOffset;
    }
    const meta = [t(`kinds.${i.kind}`), i.place, i.performerName, i.durationMin !== null ? t("row.minutes", { n: i.durationMin }) : t("row.durationUnknown")].filter(Boolean).join(" · ");
    rows.push(
      <li className={styles.moment} key={i.id}>
        <span className={styles.time}>{i.time}</span>
        <div className={styles.body}>
          <span className={styles.title}>{i.title}</span>
          <span className={styles.meta}>{meta}</span>
          {i.notes ? <span className={styles.notes}>{i.notes}</span> : null}
          <div className={styles.tags}>
            {i.visibleToGuests ? <Tag tone="accent">{t("row.visible")}</Tag> : <Tag plain>{t("row.hidden")}</Tag>}
            {i.visibleToGuests && !i.concernsAll ? <Tag plain>{t("row.some", { count: i.concernsHouseholdIds.length })}</Tag> : null}
            <Tag plain>{i.cues.length > 0 ? t("row.cues", { count: i.cues.length }) : t("row.noCues")}</Tag>
          </div>
        </div>
        <div className={styles.rowActions}>
          <CueSheet
            occasionId={id}
            itemId={i.id}
            trigger={t("cues.button")}
            sheetTitle={t("cues.title", { title: i.title })}
            initial={i.cues.map((c) => ({ offsetMin: String(c.offsetMin), instruction: c.instruction, who: c.who ?? "" }))}
            versions={versionsOf(i.id)}
            labels={cueLabels}
          />
          {view.canManage ? (
            <>
              <ItemSheet occasionId={id} item={toValues(i)} trigger={t("edit.button")} sheetTitle={t("edit.title")} kinds={kinds} suppliers={supplierOptions} households={householdOptions} labels={itemLabels} />
              <ResultForm
                action={setProgrammeVisibilityAction}
                hidden={{ occasionId: id, itemId: i.id, visible: i.visibleToGuests ? "false" : "true" }}
                submitLabel={i.visibleToGuests ? t("row.hide") : t("row.show")}
                pendingLabel={t("row.changing")}
                variant="quiet"
              />
            </>
          ) : null}
        </div>
      </li>,
    );
  }

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} actions={view.items.length > 0 ? addButton : null} />

      {view.items.length === 0 ? (
        <Section>
          <EmptyState title={t("empty.title")} action={addButton}>
            {view.canManage ? t("empty.body") : t("empty.bodyReadOnly")}
          </EmptyState>
        </Section>
      ) : (
        <>
          <Section>
            {view.occasion.startsAt ? (
              <p className="ed-muted">
                {formatWeekdayDate(view.occasion.startsAt, ctx.locale, view.occasion.timezone)} ·{" "}
                <Link href={`/occasions/${id}/day`}>{t("dayLink")}</Link>
              </p>
            ) : (
              <Notice>{t("undated")}</Notice>
            )}
            <ol className={styles.timeline}>{rows}</ol>
            <p className="ed-small ed-muted">
              {t("notifyNote")} {view.revision > 0 ? t("revision", { count: view.revision }) : ""}
            </p>
          </Section>

          {performers.length > 0 ? (
            <Section title={t("briefing.sectionTitle")}>
              <p className="ed-muted">{t("briefing.sectionIntro")}</p>
              <div>
                {performers.map(({ supplier, moments }) => {
                  const b = supplier.briefing;
                  return (
                    <div className={styles.item} key={supplier.id}>
                      <div className={styles.itemHead}>
                        <span className={styles.itemTitle}>
                          <Link href={`/occasions/${id}/suppliers/${supplier.id}`}>{supplier.name}</Link>
                        </span>
                        <span className="ed-small ed-muted">{t("briefing.moments", { count: moments })}</span>
                      </div>
                      <p className="ed-small">
                        {b.latestVersion === null
                          ? t("briefing.noVersion")
                          : `${t("briefing.version", { version: b.latestVersion })} · ${b.acknowledgedVersion === null ? t("briefing.notAcked") : t("briefing.acked", { version: b.acknowledgedVersion })}`}
                      </p>
                      {view.canManage ? (
                        <ResultForm
                          action={includeProgrammeInBriefingAction}
                          hidden={{ occasionId: id, supplierId: supplier.id }}
                          submitLabel={t("briefing.include")}
                          pendingLabel={t("briefing.including")}
                          successTemplate={t.raw("briefing.included") as string}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : null}

          <Section>
            <p className="ed-small">
              <a href={`/occasions/${id}/print/programme-csv`}>{t("export.title")}</a>
            </p>
          </Section>
        </>
      )}
    </>
  );
}
