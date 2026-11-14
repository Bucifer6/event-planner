import { isFreshAuth } from "@ed/core/accounts";
import { getBusinessProfile, listBusinessOccasions } from "@ed/core/bizoccasions";
import { getBusinessView } from "@ed/core/business";
import { OCCASION_KINDS } from "@ed/db";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, List, Notice, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { saveTeamGrantsAction, createBusinessOccasionAction } from "@/app/actions/bizoccasions";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { plural } from "@/app/(app)/occasions/_lib/plural";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "../../business.module.css";
import biz from "./biz.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bizoccasions"))("tabs.occasions") };
}

/**
 * P17: the occasions this business runs for its clients. Any member creates one and the whole
 * team works in it; the client is invited like any other member and takes it over at
 * handover (P22). A lapsed plan stops NEW occasions only (P23) — the list stays fully usable.
 */
export default async function BusinessOccasionsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("bizoccasions");
  const o = await getTranslations("occasions");
  const [view, list, profile, fresh] = await Promise.all([
    orNotFound(getBusinessView(ctx, businessId)),
    orNotFound(listBusinessOccasions(ctx, businessId)),
    orNotFound(getBusinessProfile(ctx, businessId)),
    isFreshAuth(ctx),
  ]);
  const canCreate = view.business.status === "active" && !view.lapsed;
  const base = `/business/${businessId}/occasions`;

  return (
    <>
      <Section title={t("list.title")} level={2}>
        {list.running.length === 0 ? (
          <EmptyState title={t("list.emptyTitle")}>{canCreate ? t("list.emptyBody") : t("list.emptyBodyNoCreate")}</EmptyState>
        ) : (
          <List>
            {list.running.map((r) => (
              <li key={r.id} className="ed-row">
                <div className="ed-row__main">
                  <Link href={`/occasions/${r.id}`} className={`${styles.listingName} ${styles.rowLink}`}>
                    {r.title}
                  </Link>
                  <span className="ed-row__meta">
                    {o(`kinds.${r.kind}`)} · {r.startsAt ? formatDate(r.startsAt, ctx.locale, r.timezone) : t("list.noDate")} ·{" "}
                    {t(`list.openTasks.${plural(r.openTasks, ctx.locale, { zero: true })}`, { count: r.openTasks })}
                  </span>
                </div>
                <div className={`ed-row__end ${styles.tags}`}>
                  {r.status !== "planning" ? <Tag tone={r.status === "cancelled" ? "danger" : "attention"}>{t(`status.${r.status}`)}</Tag> : null}
                  <Link href={`${base}/${r.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("list.manageNamed", { title: r.title })}>
                    {t("list.manage")}
                  </Link>
                </div>
              </li>
            ))}
          </List>
        )}
      </Section>

      <Section title={t("create.title")} level={2}>
        {canCreate ? (
          <div className={biz.narrow}>
            <SpecForm
              action={createBusinessOccasionAction}
              hidden={{ businessId }}
              fields={[
                { kind: "text", name: "title", label: t("create.name"), hint: t("create.nameHint"), required: true, maxLength: 120 },
                { kind: "select", name: "kind", label: t("create.kind"), required: true, defaultValue: "nunta", options: OCCASION_KINDS.map((k) => ({ value: k, label: o(`kinds.${k}`) })) },
                { kind: "date", name: "startsOn", label: t("create.date"), hint: t("create.dateHint"), optionalLabel: t("optional") },
              ]}
              submitLabel={t("create.submit")}
              pendingLabel={t("create.pending")}
            />
          </div>
        ) : (
          <p className="ed-muted">{view.lapsed ? t("create.lapsed") : t("create.notActive")}</p>
        )}
      </Section>

      {list.handedOver.length > 0 ? (
        <Section title={t("handedOver.title")} level={2}>
          <p className="ed-muted">{t("handedOver.body")}</p>
          <List>
            {list.handedOver.map((h) => (
              <li key={h.occasionId} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">{h.title}</span>
                  <span className="ed-row__meta">{t("handedOver.on", { date: formatDate(h.at, ctx.locale) })}</span>
                </div>
              </li>
            ))}
          </List>
        </Section>
      ) : null}

      {view.role === "owner" ? (
        <Section title={t("grants.title")} level={2}>
          <div className={biz.narrow}>
            <p className="ed-muted">{t("grants.body")}</p>
            {/* S4: a capability grant needs a fresh confirmation — enforced in @ed/core, said here first */}
            {!fresh ? (
              <Notice title={t("grants.freshTitle")}>
                {t("grants.freshBody")} <Link href="/account#fresh">{t("grants.freshLink")}</Link>
              </Notice>
            ) : null}
            <SpecForm
              action={saveTeamGrantsAction}
              hidden={{ businessId }}
              fields={[
                {
                  kind: "checks",
                  name: "grants",
                  label: t("grants.legend"),
                  options: [
                    { name: "finance", label: t("grants.finance"), hint: t("grants.financeHint"), defaultChecked: profile.teamGrantFinance },
                    { name: "privateRequests", label: t("grants.privateRequests"), hint: t("grants.privateRequestsHint"), defaultChecked: profile.teamGrantPrivateRequests },
                  ],
                },
              ]}
              submitLabel={t("grants.save")}
              pendingLabel={t("saving")}
              variant="secondary"
              success={t("saved")}
              refreshOnSuccess
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}
