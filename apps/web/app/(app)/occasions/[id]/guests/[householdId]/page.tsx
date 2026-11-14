import { getHousehold } from "@ed/core/guests";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { DescriptionList, List, Notice, PageHeader, Row, Section, Tag, ValueOrUnknown } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addGuestAction,
  proposeRemoveHouseholdAction,
  recordRsvpAction,
  regenerateInvitationAction,
  removeGuestAction,
  revokeInvitationAction,
  sendInvitationEmailsAction,
  setInvitationExpiryAction,
  updateHouseholdAction,
} from "@/app/actions/guests";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { childrenForm } from "@/lib/guest";
import { FormSheet, PlannerForm } from "../_components/form";
import styles from "../_components/guests.module.css";

type Props = {
  params: Promise<{ id: string; householdId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("guests"))("detail.metaTitle") };
}

export default async function HouseholdPage({ params, searchParams }: Props) {
  const [{ id, householdId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("guests");
  const tc = await getTranslations("common");
  const childWarning = (await getTranslations("rsvp"))("errors.childDetails");
  const h = await getHousehold(ctx, householdId).catch(() => null);
  if (!h || h.occasionId !== id) notFound();
  const base = `/occasions/${id}/guests`;
  const previewId = typeof sp.preview === "string" ? sp.preview : null;
  const preview = previewId ? await getPreview(ctx, previewId).catch(() => null) : null;
  const hidden = { occasionId: id, householdId: h.id };
  const inv = h.invitation;
  const unknown = tc("unknown");
  const lang = (l: "ro" | "en") => tc(`languages.${l}`);
  const linkOnce = { title: t("link.onceTitle"), body: t("link.onceBody"), copy: t("link.copy"), copied: t("link.copied") };

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("detail.back")}
      </Link>
      <PageHeader
        level={2}
        title={h.name}
        description={
          <Tag tone={h.status === "yes" ? "success" : h.status === "maybe" ? "attention" : "neutral"}>{t(`status.${h.status}`)}</Tag>
        }
        actions={
          h.canManage ? (
            <FormSheet
              label={tc("actions.edit")}
              title={t("detail.editTitle")}
              closeLabel={tc("actions.close")}
              form={{
                id: "edit-household",
                action: updateHouseholdAction,
                hidden,
                optionalLabel: tc("optional"),
                childWarning,
                submitLabel: tc("actions.save"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
                fields: [
                  { name: "name", label: t("fields.name"), required: true, defaultValue: h.name, maxLength: 120 },
                  { name: "leadName", label: t("fields.leadName"), defaultValue: h.leadName ?? "", maxLength: 120 },
                  { name: "leadEmail", label: t("fields.email"), hint: t("fields.emailHint"), type: "email", defaultValue: h.leadEmail ?? "", maxLength: 254 },
                  { name: "expectedPartySize", label: t("fields.partySize"), type: "number", defaultValue: h.expectedPartySize?.toString() ?? "", maxLength: 3 },
                  {
                    name: "language",
                    label: t("fields.language"),
                    hint: t("fields.languageHint"),
                    type: "select",
                    defaultValue: h.language,
                    options: [
                      { value: "ro", label: lang("ro") },
                      { value: "en", label: lang("en") },
                    ],
                  },
                  { name: "notes", label: t("fields.notes"), hint: t("fields.notesHint"), type: "textarea", defaultValue: h.notes ?? "", maxLength: 1000 },
                ],
              }}
            />
          ) : null
        }
      />

      {preview ? (
        <PreviewPanel preview={toPreviewView(preview)} appliedHref={base} discardedHref={`${base}/${h.id}`} />
      ) : null}

      <Section title={t("detail.responseTitle")}>
        {h.status === "pending" ? (
          <p className="ed-muted">{t("detail.noResponse")}</p>
        ) : (
          <DescriptionList
            cols={3}
            items={[
              { term: t("detail.attending"), value: t(`status.${h.status}`) },
              { term: t("detail.adults"), value: <span className="ed-num">{h.adultsCount ?? 0}</span> },
              { term: t("detail.children"), value: <span className="ed-num">{t(`detail.children${childrenForm(h.childrenCount ?? 0)}`, { count: h.childrenCount ?? 0 })}</span> },
              ...(h.answeredAt ? [{ term: t("detail.answeredAt"), value: formatDateTime(h.answeredAt, ctx.locale) }] : []),
              ...h.answers.map((a) => ({
                term: a.question.text[ctx.locale],
                value: a.optionId ? (a.question.options.find((o) => o.id === a.optionId)?.[ctx.locale] ?? "") : (a.valueText ?? ""),
              })),
            ]}
          />
        )}
        {h.canManage ? (
          <div>
            <FormSheet
              label={t("detail.record")}
              title={t("detail.recordTitle")}
              closeLabel={tc("actions.close")}
              intro={<p className="ed-muted">{t("detail.recordIntro")}</p>}
              form={{
                id: "record-rsvp",
                action: recordRsvpAction,
                hidden,
                submitLabel: t("detail.recordSubmit"),
                pendingLabel: tc("status.saving"),
                success: tc("status.saved"),
                fields: [
                  {
                    name: "attending",
                    label: t("detail.attending"),
                    type: "select",
                    defaultValue: h.status === "pending" ? "yes" : h.status,
                    options: [
                      { value: "yes", label: t("status.yes") },
                      { value: "maybe", label: t("status.maybe") },
                      { value: "no", label: t("status.no") },
                    ],
                  },
                  { name: "adultsCount", label: t("detail.adults"), type: "number", required: true, defaultValue: String(h.adultsCount ?? Math.max(1, h.guests.length)), maxLength: 2 },
                  { name: "childrenCount", label: t("detail.children"), hint: t("detail.childrenHint"), type: "number", required: true, defaultValue: String(h.childrenCount ?? 0), maxLength: 2 },
                ],
              }}
            />
          </div>
        ) : null}
      </Section>

      <Section title={t("detail.adultsTitle")}>
        <p className="ed-small ed-muted">{t("detail.adultsNote")}</p>
        {h.guests.length === 0 ? (
          <p className="ed-muted">{t("list.noAdults")}</p>
        ) : (
          <List>
            {h.guests.map((g) => (
              <Row
                key={g.id}
                title={g.fullName}
                end={
                  h.canManage ? (
                    <PlannerForm
                      id={`rm-${g.id}`}
                      action={removeGuestAction}
                      hidden={{ occasionId: id, guestId: g.id }}
                      variant="danger-quiet"
                      submitLabel={t("detail.removeGuest")}
                      pendingLabel={tc("status.deleting")}
                    />
                  ) : null
                }
              />
            ))}
          </List>
        )}
        {h.canManage ? (
          <PlannerForm
            id="add-guest"
            action={addGuestAction}
            hidden={hidden}
            variant="secondary"
            fields={[{ name: "fullName", label: t("detail.addGuestLabel"), required: true, maxLength: 120 }]}
            submitLabel={t("detail.addGuest")}
            pendingLabel={tc("status.saving")}
          />
        ) : null}
      </Section>

      <Section title={t("link.title")}>
        {inv ? (
          <>
            <DescriptionList
              cols={3}
              items={[
                {
                  term: t("link.state"),
                  value: (
                    <Tag tone={inv.state === "active" ? "success" : "attention"}>{t(`link.states.${inv.state}`)}</Tag>
                  ),
                },
                { term: t("link.language"), value: lang(inv.language) },
                {
                  term: t("link.lastViewed"),
                  value: inv.lastViewedAt ? formatDateTime(inv.lastViewedAt, ctx.locale) : t("link.neverViewed"),
                },
                {
                  term: t("link.expiry"),
                  value:
                    inv.expiryMode === "never"
                      ? t("link.expiryModes.never")
                      : inv.expiryMode === "rsvp_deadline"
                        ? inv.expiresAt
                          ? t("link.expiresOn", { date: formatDate(inv.expiresAt, ctx.locale) })
                          : t("link.expiryNoDeadline")
                        : t("link.expiryModes.closeout"),
                },
                ...(inv.emailedAt ? [{ term: t("link.emailed"), value: formatDateTime(inv.emailedAt, ctx.locale) }] : []),
              ]}
            />
            <p className="ed-small ed-muted">{t("link.hashedNote")}</p>
            {h.canManage ? (
              <div className={styles.stackTight}>
                <PlannerForm
                  id="regen"
                  action={regenerateInvitationAction}
                  hidden={hidden}
                  variant="secondary"
                  submitLabel={t("link.regenerate")}
                  pendingLabel={t("link.regenerating")}
                  linkOnce={linkOnce}
                />
                <div className={styles.inline}>
                  {h.leadEmail && inv.state !== "revoked" ? (
                    <FormSheet
                      label={t("email.one")}
                      title={t("email.oneTitle")}
                      closeLabel={tc("actions.close")}
                      intro={<Notice tone="attention">{t("email.confirmBody")}</Notice>}
                      form={{
                        id: "email-one",
                        action: sendInvitationEmailsAction,
                        hidden,
                        submitLabel: t("email.oneSubmit"),
                        pendingLabel: tc("status.sending"),
                        success: t("email.done"),
                      }}
                    />
                  ) : null}
                  <FormSheet
                    label={t("link.expiryButton")}
                    title={t("link.expiryTitle")}
                    closeLabel={tc("actions.close")}
                    form={{
                      id: "expiry",
                      action: setInvitationExpiryAction,
                      hidden,
                      submitLabel: tc("actions.save"),
                      pendingLabel: tc("status.saving"),
                      success: tc("status.saved"),
                      fields: [
                        {
                          name: "mode",
                          label: t("link.expiry"),
                          hint: t("link.expiryHint"),
                          type: "select",
                          defaultValue: inv.expiryMode,
                          options: [
                            { value: "never", label: t("link.expiryModes.never") },
                            { value: "rsvp_deadline", label: t("link.expiryModes.rsvp_deadline") },
                            { value: "closeout", label: t("link.expiryModes.closeout") },
                          ],
                        },
                      ],
                    }}
                  />
                  {inv.state !== "revoked" ? (
                    <FormSheet
                      label={t("link.revoke")}
                      title={t("link.revokeTitle")}
                      closeLabel={tc("actions.close")}
                      variant="danger-quiet"
                      intro={<p>{t("link.revokeBody")}</p>}
                      form={{
                        id: "revoke",
                        action: revokeInvitationAction,
                        hidden,
                        variant: "danger",
                        submitLabel: t("link.revokeSubmit"),
                        pendingLabel: tc("status.saving"),
                        success: t("link.revoked"),
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Section>

      {h.canManage ? (
        <Section title={t("detail.contactTitle")}>
          <DescriptionList
            cols={3}
            items={[
              { term: t("fields.leadName"), value: <ValueOrUnknown value={h.leadName} unknownLabel={unknown} /> },
              { term: t("fields.email"), value: <ValueOrUnknown value={h.leadEmail} unknownLabel={unknown} /> },
              { term: t("fields.partySize"), value: <ValueOrUnknown value={h.expectedPartySize} unknownLabel={unknown} /> },
              ...(h.notes ? [{ term: t("fields.notes"), value: h.notes }] : []),
            ]}
          />
          <p className="ed-small ed-muted">{t("detail.contactNote")}</p>
        </Section>
      ) : (
        <p className="ed-small ed-muted">{t("contactsHidden")}</p>
      )}

      {h.canManage && !preview ? (
        <Section title={t("detail.removeTitle")}>
          <p className="ed-muted">{t("detail.removeBody")}</p>
          <PlannerForm
            id="remove-household"
            action={proposeRemoveHouseholdAction}
            hidden={hidden}
            variant="danger-quiet"
            submitLabel={t("detail.removeButton")}
            pendingLabel={tc("status.loading")}
            redirectTo={`${base}/${h.id}?preview={previewId}`}
          />
        </Section>
      ) : null}
    </>
  );
}
