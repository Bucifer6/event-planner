import { getPlanSummary, listExports } from "@ed/core/exports";
import { toListView } from "@ed/core/tasks";
import { DescriptionList, LinkButton, List, PageHeader, Row, Section, Table } from "@ed/ui";
import { IconDownload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireCtx } from "@/lib/ctx";
import styles from "../../_components/planning.module.css";
import { orNotFound } from "../../_lib/load";
import { PrintButton } from "./PrintButton";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("print.title") };
}

/**
 * A12: downloads (CSV) and the plan on one printable page. Everything here is the occasion's
 * own data — no directory content and nothing promoted ever appears in an export (P16).
 *
 * MORE EXPORTS — later releases add theirs with registerExport() in @ed/core/exports and they
 * show up in the list below by themselves:
 *   - guest list (CSV) ............ guests release
 *   - supplier briefing (PDF) ..... release B
 *   - budget (CSV, finance grant) . release B
 *   - print pack: place cards, table plan, menus ... release C
 */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("overview");
  const tt = await getTranslations("tasks");
  const all = await getTranslations();
  const [exportsList, plan] = await Promise.all([orNotFound(listExports(ctx, id)), orNotFound(getPlanSummary(ctx, id))]);
  const label = (key: string | undefined) => (key && all.has(key as never) ? all(key as never) : "");
  const groups = toListView(plan.tasks);

  return (
    <>
      <div className="ed-noprint">
        <PageHeader level={2} title={t("print.title")} description={t("print.description")} actions={<PrintButton label={t("print.printPlan")} />} />
        <Section title={t("print.downloads")} level={3}>
          <List>
            {exportsList.map((e) => (
              <Row
                key={e.key}
                title={label(e.titleKey)}
                meta={label(e.descriptionKey)}
                end={
                  <LinkButton size="sm" href={`/occasions/${id}/print/${e.key}`} download>
                    <IconDownload size={18} />
                    {t("print.download")}
                  </LinkButton>
                }
              />
            ))}
          </List>
          <p className="ed-small ed-muted">{t("print.ownDataNote")}</p>
        </Section>
        <div style={{ marginTop: "var(--s-5)" }}>
          <Section title={t("print.previewTitle")} level={3}>
            <p className="ed-muted">{t("print.previewBody")}</p>
          </Section>
        </div>
      </div>

      <article className={styles.sheet} style={{ marginTop: "var(--s-4)" }}>
        <header>
          <p className="ed-label">{t("print.planEyebrow")}</p>
          <h2 className={styles.sheetTitle}>{plan.title}</h2>
        </header>
        <DescriptionList
          cols={3}
          items={[
            { term: t("print.date"), value: plan.date ? (plan.endDate ? `${plan.date} – ${plan.endDate}` : plan.date) : <em>{t("print.byPoll")}</em> },
            { term: t("print.venue"), value: plan.venueName ? [plan.venueName, plan.venueAddress].filter(Boolean).join(", ") : <em>{t("print.notSet")}</em> },
            { term: t("print.progress"), value: t("print.progressValue", { done: plan.counts.done, total: plan.counts.total }) },
          ]}
        />
        {plan.purpose ? <p style={{ maxWidth: "var(--measure)" }}>{plan.purpose}</p> : null}
        {plan.priorities.length > 0 ? (
          <ol className="ed-prose">
            {plan.priorities.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        ) : null}
        {groups.length === 0 ? <p className="ed-muted">{t("print.noTasks")}</p> : null}
        {groups.map((group) => (
          <section key={group.key} className="ed-stack" data-gap="2">
            <h3 className="ed-label">{tt(`groups.${group.key}`)}</h3>
            <Table caption={tt(`groups.${group.key}`)}>
              <thead>
                <tr>
                  <th scope="col">{t("print.col.task")}</th>
                  <th scope="col">{t("print.col.due")}</th>
                  <th scope="col">{t("print.col.owner")}</th>
                  <th scope="col">{t("print.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {group.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td className="ed-num">{task.dueDay ? task.dueDay.split("-").reverse().join(".") : "—"}</td>
                    <td>{task.ownerName ?? "—"}</td>
                    <td>{tt(`status.${task.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        ))}
      </article>
    </>
  );
}
