import { getJourney } from "@ed/core/guestevent";
import { dayOf, getPublicPageSettings, type PublicQuestion } from "@ed/core/publicpage";
import { listRegistrations, type RegistrationRow } from "@ed/core/registrations";
import { formatDate } from "@ed/i18n/format";
import { CopyButton, Figure, Figures, LinkButton, Notice, PageHeader, Section, Tag, ValueOrUnknown } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cancelRegistrationAction, promoteRegistrationAction, removePublicQuestionAction, savePublicQuestionAction } from "@/app/actions/publicpage";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { FormSheet, type FieldSpec } from "../guests/_components/form";
import styles from "../programme/_components/programme.module.css";
import { ResultForm } from "../programme/_components/ResultForm";
import { JourneyForm, PageSettingsForm } from "./_components/SettingsForms";

// The event page settings (C-06, C-07): what the public page /e/<slug> shows, its
// registration questions (one level of conditional logic), who registered and who waits,
// and the accessible guest journey that is published on the page and on every guest link.

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("publicpage"))("title") };
}

export default async function PublicPageSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("publicpage");
  const te = await getTranslations("guestevent");
  const tc = await getTranslations("common");
  const settings = await orNotFound(getPublicPageSettings(ctx, id));
  const { page, canManage, capacity, occasion } = settings;
  const [journey, regs] = await Promise.all([getJourney(ctx, id), canManage ? listRegistrations(ctx, id) : null]);
  const base = (settings.url ?? "").replace(/\/e\/.*$/, "") || (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const tz = occasion.timezone;

  const questions = page?.questions ?? [];
  const parentOptions = (current?: PublicQuestion) => {
    const upTo = current ? questions.findIndex((q) => q.id === current.id) : questions.length;
    return questions
      .slice(0, upTo < 0 ? questions.length : upTo)
      .filter((q) => q.kind === "choice" && !q.showIf)
      .flatMap((q) => q.options.map((o) => ({ value: `${q.id}:${o.id}`, label: t("questions.showIfOption", { question: q.ro, option: o.ro }) })));
  };
  const questionFields = (q?: PublicQuestion): FieldSpec[] => [
    { name: "kind", label: t("questions.kind"), type: "select", defaultValue: q?.kind ?? "choice", options: [{ value: "choice", label: t("questions.kindChoice") }, { value: "text", label: t("questions.kindText") }] },
    { name: "ro", label: t("questions.ro"), required: true, defaultValue: q?.ro ?? "", maxLength: 300 },
    { name: "en", label: t("questions.en"), defaultValue: q && q.en !== q.ro ? q.en : "", maxLength: 300 },
    { name: "options", label: t("questions.options"), hint: t("questions.optionsHint"), type: "textarea", rows: 4, defaultValue: (q?.options ?? []).map((o) => (o.en && o.en !== o.ro ? `${o.ro} | ${o.en}` : o.ro)).join("\n"), maxLength: 4000 },
    { name: "required", label: t("questions.required"), type: "checkbox", defaultValue: q?.required ? "on" : "" },
    { name: "showIf", label: t("questions.showIf"), type: "select", defaultValue: q?.showIf ? `${q.showIf.questionId}:${q.showIf.optionId}` : "", options: [{ value: "", label: t("questions.showAlways") }, ...parentOptions(q)] },
  ];
  const conditionText = (q: PublicQuestion) => {
    const parent = questions.find((p) => p.id === q.showIf?.questionId);
    const option = parent?.options.find((o) => o.id === q.showIf?.optionId);
    return parent && option ? t("questions.conditional", { question: parent.ro, option: option.ro }) : null;
  };

  const regRow = (r: RegistrationRow) => (
    <div className={styles.item} key={r.id}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>
          {r.position !== null ? `${t("registrations.position", { n: r.position })} · ` : ""}
          {r.name}
        </span>
        <span className="ed-small ed-muted">{t("registrations.party", { adults: r.adults, children: r.children })}</span>
      </div>
      <p className={`ed-small ed-muted ${styles.wrap}`}>
        {r.email} · {r.promotedAt ? t("registrations.promotedAt", { date: formatDate(r.promotedAt, ctx.locale, tz) }) : t("registrations.since", { date: formatDate(r.createdAt, ctx.locale, tz) })}
      </p>
      {r.answers.length > 0 ? <p className="ed-small">{r.answers.map((a) => `${a.question}: ${a.answer}`).join(" · ")}</p> : null}
      <div className={styles.inline}>
        {r.status === "waitlisted" ? (
          <ResultForm action={promoteRegistrationAction} hidden={{ occasionId: id, registrationId: r.id }} submitLabel={t("registrations.promote")} pendingLabel={t("registrations.promoting")} />
        ) : null}
        <FormSheet
          label={t("registrations.cancel")}
          title={t("registrations.cancelTitle", { name: r.name })}
          closeLabel={tc("actions.close")}
          variant="danger-quiet"
          intro={<p>{t("registrations.cancelBody")}</p>}
          form={{ id: `cancel-${r.id}`, action: cancelRegistrationAction, hidden: { occasionId: id, registrationId: r.id }, variant: "danger", submitLabel: t("registrations.cancelSubmit"), pendingLabel: tc("status.saving") }}
        />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={<Tag tone={page?.published ? "success" : "neutral"}>{page ? (page.published ? t("status.published") : t("status.draft")) : t("status.none")}</Tag>}
      />

      {page && settings.url ? (
        <Section>
          <div className={styles.urlLine}>
            <span className={`ed-num ${styles.wrap}`}>{settings.url}</span>
            <CopyButton text={settings.url} label={t("copy")} copiedLabel={t("copied")} />
            {page.published ? (
              <LinkButton href={`/e/${page.slug}`} target="_blank" rel="noopener">
                {t("open")}
              </LinkButton>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t("settings.title")}>
        {canManage ? (
          <PageSettingsForm
            occasionId={id}
            initial={{
              slug: page?.slug ?? settings.suggestedSlug,
              titleRo: page?.titleRo ?? occasion.title,
              titleEn: page?.titleEn ?? "",
              descriptionRo: page?.descriptionRo ?? "",
              descriptionEn: page?.descriptionEn ?? "",
              showDate: page?.showDate ?? true,
              showVenue: page?.showVenue ?? true,
              showProgramme: page?.showProgramme ?? false,
              showMenu: page?.showMenu ?? false,
              registrationEnabled: page?.registrationEnabled ?? false,
              opensOn: dayOf(page?.registrationOpensAt ?? null, tz),
              closesOn: dayOf(page?.registrationClosesAt ?? null, tz, 1000),
              sharesCapacity: page?.sharesCapacity ?? true,
              privacyUrl: page?.privacyUrl ?? "",
              published: page?.published ?? false,
            }}
            capacityNote={capacity.total === null ? t("settings.capacityUnlimited") : t("settings.capacity", { total: capacity.total, taken: capacity.taken, left: capacity.left ?? 0 })}
            labels={{
              optional: tc("optional"),
              slug: t("settings.slug"),
              slugHint: t("settings.slugHint", { base }),
              titleRo: t("settings.titleRo"),
              titleEn: t("settings.titleEn"),
              titleEnHint: t("settings.titleEnHint"),
              descriptionRo: t("settings.descriptionRo"),
              descriptionEn: t("settings.descriptionEn"),
              descriptionHint: t("settings.descriptionHint"),
              showLegend: t("settings.showLegend"),
              showDate: t("settings.showDate"),
              showVenue: t("settings.showVenue"),
              showProgramme: t("settings.showProgramme"),
              showMenu: t("settings.showMenu"),
              registrationLegend: t("settings.registrationLegend"),
              registrationEnabled: t("settings.registrationEnabled"),
              registrationHint: t("settings.registrationHint"),
              opensOn: t("settings.opensOn"),
              closesOn: t("settings.closesOn"),
              datesHint: t("settings.datesHint"),
              sharesCapacity: t("settings.sharesCapacity"),
              sharesCapacityHint: t("settings.sharesCapacityHint"),
              privacyUrl: t("settings.privacyUrl"),
              privacyUrlHint: t("settings.privacyUrlHint"),
              published: t("settings.published"),
              publishedHint: t("settings.publishedHint"),
              save: t("settings.save"),
              saving: t("settings.saving"),
              saved: t("settings.saved"),
            }}
          />
        ) : (
          <Notice>{t("readOnly")}</Notice>
        )}
      </Section>

      {page?.registrationEnabled ? (
        <Section
          title={t("questions.title")}
          actions={
            canManage ? (
              <FormSheet
                label={t("questions.add")}
                title={t("questions.addTitle")}
                closeLabel={tc("actions.close")}
                icon={<IconPlus size={16} />}
                form={{ id: "add-question", action: savePublicQuestionAction, hidden: { occasionId: id }, optionalLabel: tc("optional"), fields: questionFields(), submitLabel: t("questions.addSubmit"), pendingLabel: tc("status.saving") }}
              />
            ) : null
          }
        >
          <p className="ed-muted">{t("questions.intro")}</p>
          {questions.length === 0 ? (
            <p className="ed-muted">{t("questions.empty")}</p>
          ) : (
            <div>
              {questions.map((q) => (
                <div className={styles.item} key={q.id}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{q.ro}</span>
                    <span className={styles.inline}>{q.required ? <Tag plain>{t("questions.requiredTag")}</Tag> : null}</span>
                  </div>
                  <p className="ed-small ed-muted">{q.kind === "choice" ? q.options.map((o) => o.ro).join(" · ") : t("questions.kindText")}</p>
                  {q.showIf && conditionText(q) ? <p className="ed-small">{conditionText(q)}</p> : null}
                  {canManage ? (
                    <div className={styles.inline}>
                      <FormSheet
                        label={tc("actions.edit")}
                        title={t("questions.editTitle")}
                        closeLabel={tc("actions.close")}
                        variant="quiet"
                        form={{ id: `edit-q-${q.id}`, action: savePublicQuestionAction, hidden: { occasionId: id, questionId: q.id }, optionalLabel: tc("optional"), fields: questionFields(q), submitLabel: tc("actions.save"), pendingLabel: tc("status.saving") }}
                      />
                      <FormSheet
                        label={t("questions.remove")}
                        title={t("questions.removeTitle")}
                        closeLabel={tc("actions.close")}
                        variant="danger-quiet"
                        intro={<p>{t("questions.removeBody")}</p>}
                        form={{ id: `rm-q-${q.id}`, action: removePublicQuestionAction, hidden: { occasionId: id, questionId: q.id }, variant: "danger", submitLabel: t("questions.removeSubmit"), pendingLabel: tc("status.deleting") }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {regs?.hasPage && page?.registrationEnabled ? (
        <Section title={t("registrations.title")}>
          <Figure size="hero" label={t("registrations.heroLabel")} value={regs.places.adults + regs.places.children} note={t("registrations.heroNote", { adults: regs.places.adults, children: regs.places.children })} />
          <Figures>
            <Figure size="sm" label={t("registrations.waiting")} value={regs.waitlisted.length} />
            <Figure
              size="sm"
              label={t("registrations.left")}
              value={regs.sharesCapacity && regs.capacity.total !== null ? <ValueOrUnknown value={regs.capacity.left} unknownLabel={tc("unknown")} /> : <span className="ed-muted">{t("registrations.unlimited")}</span>}
            />
          </Figures>
          <p className="ed-small ed-muted">{t("registrations.managersOnly")}</p>
          {regs.registered.length === 0 && regs.waitlisted.length === 0 ? (
            <p className="ed-muted">{t("registrations.empty")}</p>
          ) : (
            <>
              {regs.registered.length > 0 ? (
                <div>
                  <h3 className={styles.courseTitle}>{t("registrations.registeredTitle")}</h3>
                  {regs.registered.map(regRow)}
                </div>
              ) : null}
              {regs.waitlisted.length > 0 ? (
                <div>
                  <h3 className={styles.courseTitle}>{t("registrations.waitlistTitle")}</h3>
                  <p className="ed-small ed-muted">{t("registrations.waitlistNote")}</p>
                  {regs.waitlisted.map(regRow)}
                </div>
              ) : null}
              <p className="ed-small">
                <a href={`/occasions/${id}/print/registrations-csv`}>{t("registrations.export")}</a>
                {regs.cancelledCount > 0 ? ` · ${t("registrations.cancelledCount", { count: regs.cancelledCount })}` : ""}
              </p>
            </>
          )}
        </Section>
      ) : null}

      <Section title={te("editor.title")} actions={<Tag tone={journey.published ? "success" : "neutral"}>{journey.published ? te("editor.statusPublished") : te("editor.statusDraft")}</Tag>}>
        <p className={`ed-muted ${styles.narrow}`}>{te("editor.intro")}</p>
        {canManage ? (
          <JourneyForm
            occasionId={id}
            facts={journey.facts.map((f) => ({ key: f.key, label: te(`journey.facts.${f.key}`), state: f.state, noteRo: f.note.ro ?? "", noteEn: f.note.en ?? "" }))}
            contactName={journey.contactName ?? ""}
            contactRoute={journey.contactRoute ?? ""}
            published={journey.published}
            labels={{
              optional: tc("optional"),
              stateYes: te("editor.stateYes"),
              stateNo: te("editor.stateNo"),
              stateUnknown: te("editor.stateUnknown"),
              noteRo: te("editor.noteRo"),
              noteEn: te("editor.noteEn"),
              noteHint: te("editor.noteHint"),
              contactName: te("editor.contactName"),
              contactRoute: te("editor.contactRoute"),
              published: te("editor.published"),
              publishedHint: te("editor.publishedHint"),
              save: te("editor.save"),
              saving: te("editor.saving"),
              saved: te("editor.saved"),
            }}
          />
        ) : (
          <Notice>{t("readOnly")}</Notice>
        )}
      </Section>
    </>
  );
}
