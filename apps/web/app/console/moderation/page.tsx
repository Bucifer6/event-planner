import "@ed/core/listings"; // registers the "listing" moderation kind
import { listModerationQueue } from "@ed/core/moderation";
import { formatDateTime, formatInteger } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Figure, Figures, Notice, Page, PageHeader, Section, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { saveModerationTarget } from "@/app/actions/moderation";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import pageStyles from "./moderation.module.css";
import { waitText } from "./_wait";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("moderation"))("title") };
}

const TABS = ["pending", "decided"] as const;

/**
 * W2: the moderation queue — every new listing and every edit (later also drawings and
 * catalogue items) waits here, oldest first, with its waiting time against the operator's
 * service target. The live version of anything being edited stays up meanwhile (P3).
 */
export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ state?: string; decided?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("moderation");
  const all = await getTranslations();
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const sp = await searchParams;
  const state = (TABS as readonly string[]).includes(sp.state ?? "") ? (sp.state as (typeof TABS)[number]) : "pending";
  const queue = await listModerationQueue(ctx, { state });
  const overdue = state === "pending" ? queue.items.filter((i) => i.overdue).length : 0;
  const oldest = state === "pending" ? queue.items[0] : undefined;
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      {sp.decided ? <Notice tone="success" title={t(sp.decided === "approve" ? "decided.approved" : "decided.rejected")} /> : null}

      <Figures>
        <Figure label={t("figures.waiting")} value={formatInteger(queue.pending, ctx.locale)} note={t("figures.now")} />
        <Figure label={t("figures.target")} value={formatInteger(queue.targetHours, ctx.locale)} unit={t("figures.hours")} note={t("figures.targetNote")} />
        <Figure
          label={t("figures.overdue")}
          value={formatInteger(overdue, ctx.locale)}
          note={oldest ? t("figures.oldest", { wait: waitText(tt, oldest.waitingMinutes) }) : t("figures.none")}
          noteTone={overdue > 0 ? "danger" : undefined}
        />
      </Figures>

      <nav aria-label={t("tabsLabel")}>
        <ul className="ed-tabs">
          {TABS.map((tab) => (
            <li key={tab}>
              <Link className="ed-tab" href={tab === "pending" ? "/console/moderation" : `/console/moderation?state=${tab}`} aria-current={tab === state ? "page" : undefined}>
                {t(`tabs.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {queue.items.length === 0 ? (
        <EmptyState title={t(`empty.${state}`)}>{state === "pending" ? t("empty.pendingBody") : null}</EmptyState>
      ) : (
        <section className={`ed-section ${pageStyles.rel}`}>
        <Table caption={t("title")}>
          <thead>
            <tr>
              <th scope="col">{t("cols.subject")}</th>
              <th scope="col">{t("cols.kind")}</th>
              <th scope="col">{t("cols.business")}</th>
              <th scope="col">{t("cols.submitted")}</th>
              <th scope="col">{state === "pending" ? t("cols.waiting") : t("cols.outcome")}</th>
              <th scope="col" aria-label={t("open")} />
            </tr>
          </thead>
          <tbody>
            {queue.items.map((i) => (
              <tr key={i.id}>
                <td className={pageStyles.subject}>
                  <strong>{i.title}</strong>
                </td>
                <td>
                  {all(i.kindLabelKey as never)} · {i.isEdit ? t("change.edit") : t("change.new")}
                </td>
                <td className={pageStyles.subject}>{i.businessName ?? <span className="ed-unknown">{t("unclaimed")}</span>}</td>
                <td className="ed-num">{formatDateTime(i.submittedAt, ctx.locale)}</td>
                <td>
                  {state === "pending" ? (
                    <Tag tone={i.overdue ? "danger" : "neutral"}>
                      {waitText(tt, i.waitingMinutes)} · {i.overdue ? t("overdue") : t("onTime")}
                    </Tag>
                  ) : (
                    <Tag tone={i.state === "approved" ? "success" : "danger"}>{t(`states.${i.state}`)}</Tag>
                  )}
                </td>
                <td>
                  <Link href={`/console/moderation/${i.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("openNamed", { title: i.title })}>
                    {t("open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        </section>
      )}

      {has("platform_admin") ? (
        <Section title={t("target.title")}>
          <p className="ed-muted">{t("target.body")}</p>
          <SpecForm
            action={saveModerationTarget}
            fields={[{ kind: "number", name: "hours", label: t("target.label"), hint: t("target.hint"), required: true, defaultValue: String(queue.targetHours), min: 1, max: 720 }]}
            submitLabel={t("target.save")}
            pendingLabel={t("target.saving")}
            variant="secondary"
            success={t("target.saved")}
            refreshOnSuccess
          />
        </Section>
      ) : null}
    </Page>
  );
}
