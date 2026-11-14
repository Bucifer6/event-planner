import { listHouseholds, type HouseholdStatus } from "@ed/core/guests";
import { getRsvpSummary } from "@ed/core/rsvp";
import { formatDate, formatInteger } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Figure, Figures, List, Notice, PageHeader, Section, Tag, type Tone } from "@ed/ui";
import { IconDownload, IconPlus, IconSearch, IconSettings, IconUpload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createHouseholdAction, sendInvitationEmailsAction } from "@/app/actions/guests";
import { requireCtx } from "@/lib/ctx";
import { FormSheet, type FieldSpec } from "./_components/form";
import styles from "./_components/guests.module.css";
import { HelpLink } from "@/components/help/HelpLink";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTERS = ["all", "yes", "maybe", "no", "pending"] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_TONE: Record<HouseholdStatus, Tone> = { yes: "success", maybe: "attention", no: "neutral", pending: "neutral" };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("guests"))("title") };
}

export default async function GuestsPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("guests");
  const tc = await getTranslations("common");
  const childWarning = (await getTranslations("rsvp"))("errors.childDetails");
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const status: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : "all";

  const [summary, list] = await Promise.all([
    getRsvpSummary(ctx, id),
    listHouseholds(ctx, { occasionId: id, q, status }),
  ]);
  const base = `/occasions/${id}/guests`;
  const n = (v: number) => formatInteger(v, ctx.locale);
  const href = (f: Filter) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (f !== "all") p.set("status", f);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const counts: Record<Filter, number> = {
    all: summary.households.total,
    yes: summary.households.yes,
    maybe: summary.households.maybe,
    no: summary.households.no,
    pending: summary.households.pending,
  };
  const withEmailWaiting = list.canManage
    ? (await listHouseholds(ctx, { occasionId: id, status: "pending" })).items.filter(
        (h) => h.leadEmail && h.invitation && !h.invitation.emailedAt && h.invitation.state === "active",
      ).length
    : 0;

  const householdFields: FieldSpec[] = [
    { name: "name", label: t("fields.name"), hint: t("fields.nameHint"), required: true, maxLength: 120 },
    { name: "guestNames", label: t("fields.adults"), hint: t("fields.adultsHint"), type: "textarea", rows: 3, maxLength: 2000 },
    { name: "expectedPartySize", label: t("fields.partySize"), hint: t("fields.partySizeHint"), type: "number", maxLength: 3 },
    { name: "leadEmail", label: t("fields.email"), hint: t("fields.emailHint"), type: "email", maxLength: 254 },
    {
      name: "language",
      label: t("fields.language"),
      type: "select",
      defaultValue: "ro",
      options: [
        { value: "ro", label: tc("languages.ro") },
        { value: "en", label: tc("languages.en") },
      ],
    },
    { name: "notes", label: t("fields.notes"), hint: t("fields.notesHint"), type: "textarea", rows: 2, maxLength: 1000 },
  ];

  const capacity = summary.capacity;
  const heroUnit =
    capacity.total !== null
      ? t("hero.ofCapacity", { total: n(capacity.total) })
      : summary.invited !== null
        ? t("hero.ofInvited", { total: n(summary.invited) })
        : undefined;
  const heroNote = [
    t("hero.breakdown", { adults: n(summary.attending.adults), children: n(summary.attending.children) }),
    capacity.left !== null ? t("hero.placesLeft", { count: capacity.left }) : null,
    summary.rsvpDeadline ? t("hero.deadline", { date: formatDate(summary.rsvpDeadline, ctx.locale) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={
          list.canManage ? (
            <FormSheet
              label={t("add.button")}
              title={t("add.title")}
              closeLabel={tc("actions.close")}
              variant="primary"
              icon={<IconPlus size={16} />}
              intro={<p className="ed-muted">{t("add.intro")}</p>}
              form={{
                id: "add-household",
                action: createHouseholdAction,
                hidden: { occasionId: id },
                fields: householdFields,
                submitLabel: t("add.submit"),
                pendingLabel: tc("status.saving"),
                optionalLabel: tc("optional"),
                childWarning,
                linkOnce: { title: t("link.onceTitle"), body: t("link.onceBody"), copy: t("link.copy"), copied: t("link.copied") },
              }}
            />
          ) : null
        }
      />
      <HelpLink topic="guests" />

      <Section>
        <div className={styles.hero}>
          <Figure
            size="hero"
            label={t("hero.label")}
            value={n(summary.attending.total)}
            unit={heroUnit}
            note={heroNote}
          />
          <Figures>
            <Figure size="sm" label={t("counts.yes")} value={n(summary.households.yes)} note={t("counts.people", { count: summary.attending.total })} />
            <Figure size="sm" label={t("counts.maybe")} value={n(summary.households.maybe)} note={t("counts.people", { count: summary.maybe.total })} />
            <Figure size="sm" label={t("counts.no")} value={n(summary.households.no)} note={t("counts.households")} />
            <Figure size="sm" label={t("counts.pending")} value={n(summary.households.pending)} note={t("counts.households")} />
          </Figures>
        </div>
      </Section>

      <Section
        title={t("list.title")}
        actions={
          list.canManage ? (
            <>
              <Link href={`${base}/settings`} className={buttonClassName({ size: "sm" })}>
                <IconSettings size={16} />
                {t("settings.link")}
              </Link>
              <Link href={`${base}/import`} className={buttonClassName({ size: "sm" })}>
                <IconUpload size={16} />
                {t("import.link")}
              </Link>
              <a href={`${base}/export`} className={buttonClassName({ size: "sm" })}>
                <IconDownload size={16} />
                {t("export.link")}
              </a>
            </>
          ) : null
        }
      >
        {summary.households.total === 0 ? (
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
        ) : (
          <>
            <div className={styles.toolbar}>
              <form method="get" action={base} className={styles.search} role="search">
                <div className="ed-field">
                  <label className="ed-field__label" htmlFor="guest-search">
                    {t("list.search")}
                  </label>
                  <input id="guest-search" className="ed-input" type="search" name="q" defaultValue={q} maxLength={120} autoComplete="off" />
                </div>
                {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
                <button type="submit" className="ed-btn">
                  <IconSearch size={16} />
                  {t("list.searchButton")}
                </button>
              </form>
              <nav className={`ed-chips ${styles.filters}`} aria-label={t("list.filter")}>
                {FILTERS.map((f) => (
                  <Link key={f} href={href(f)} className={`ed-chip ${styles.filterChip}`} aria-current={status === f ? "true" : undefined}>
                    {t(`filters.${f}`)} · {n(counts[f])}
                  </Link>
                ))}
              </nav>
            </div>

            {list.items.length === 0 ? (
              <EmptyState title={t("list.noMatchTitle")}>{t("list.noMatchBody")}</EmptyState>
            ) : (
              <List>
                {list.items.map((h) => (
                  <li className="ed-row" key={h.id}>
                    <Link href={`${base}/${h.id}`} className={styles.rowLink}>
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle}>{h.name}</span>
                        <span className="ed-row__meta">
                          {h.adults.length > 0 ? h.adults.join(", ") : t("list.noAdults")}
                        </span>
                      </span>
                      <span className={styles.rowEnd}>
                        <Tag tone={STATUS_TONE[h.status]}>{t(`status.${h.status}`)}</Tag>
                        {h.status === "yes" || h.status === "maybe" ? (
                          <span className="ed-small ed-muted ed-num">
                            {t("list.party", { adults: h.adultsCount ?? 0, children: h.childrenCount ?? 0 })}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </List>
            )}
          </>
        )}
      </Section>

      {list.canManage && withEmailWaiting > 0 ? (
        <Section title={t("email.title")}>
          <p className="ed-muted">{t("email.body", { count: withEmailWaiting })}</p>
          <div>
            <FormSheet
              label={t("email.button")}
              title={t("email.title")}
              closeLabel={tc("actions.close")}
              intro={
                <Notice tone="attention" title={t("email.confirmTitle", { count: withEmailWaiting })}>
                  {t("email.confirmBody")}
                </Notice>
              }
              form={{
                id: "send-invitations",
                action: sendInvitationEmailsAction,
                hidden: { occasionId: id },
                submitLabel: t("email.submit", { count: withEmailWaiting }),
                pendingLabel: tc("status.sending"),
                success: t("email.done"),
              }}
            />
          </div>
        </Section>
      ) : null}

      {!list.canManage ? <p className="ed-small ed-muted">{t("contactsHidden")}</p> : null}
    </>
  );
}
