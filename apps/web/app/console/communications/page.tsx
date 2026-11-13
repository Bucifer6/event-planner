import { listPlatformNotices, previewAudience } from "@ed/core/comms";
import { listCategories, listCounties } from "@ed/core/geography";
import { formatDateTime, formatInteger } from "@ed/i18n/format";
import { EmptyState, Figure, Figures, Page, PageHeader, Section, Table } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { sendNoticeAction } from "@/app/actions/comms";
import { NoRole } from "../_components/NoRole";
import { requireConsole } from "../_lib";
import styles from "../commercial/commercial.module.css";
import { NoticeForm } from "./NoticeForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("comms"))("title") };
}

const ROLES = ["commercial_manager", "content_editor"] as const;

/**
 * W7 — Communications: notices to BUSINESSES. A notice appears in each business's area and
 * is emailed to its owner and admins, at their own login address. There is no way to address
 * anyone a planner entered (guests, households, suppliers): no such field exists.
 */
export default async function ConsoleCommunicationsPage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("comms");
  if (!has(...ROLES)) return <NoRole title={t("title")} roles={[...ROLES]} />;
  const [notices, cats, cos, all] = await Promise.all([listPlatformNotices(ctx), listCategories(ctx), listCounties(ctx), previewAudience(ctx, { audience: "all" })]);
  const n = (v: number) => formatInteger(v, ctx.locale);
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";
  const coName = (code: string | null) => cos.find((c) => c.code === code)?.name ?? "—";

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className={styles.body}>
      <Section title={t("reach.title")} level={2}>
        <Figures>
          <Figure label={t("reach.businesses")} value={n(all.businesses)} note={t("reach.now")} />
          <Figure label={t("reach.emails")} value={n(all.emails)} note={t("reach.emailsNote")} />
        </Figures>
      </Section>

      <Section title={t("compose.title")} level={2}>
        <div className={styles.narrow}>
          <p className="ed-muted">{t("compose.body")}</p>
          <NoticeForm
            action={sendNoticeAction}
            categories={cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
            counties={cos.filter((c) => c.active).map((c) => ({ value: c.code, label: c.name }))}
          />
        </div>
      </Section>

      <Section title={t("log.title")} level={2}>
        {notices.length === 0 ? (
          <EmptyState title={t("log.emptyTitle")}>{t("log.emptyBody")}</EmptyState>
        ) : (
          <div className={styles.rel}>
            <Table caption={t("log.title")}>
              <thead>
                <tr>
                  <th scope="col">{t("log.when")}</th>
                  <th scope="col">{t("log.subject")}</th>
                  <th scope="col">{t("log.audience")}</th>
                  <th scope="col" data-num>
                    {t("log.businesses")}
                  </th>
                  <th scope="col" data-num>
                    {t("log.emails")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {notices.map((x) => (
                  <tr key={x.id}>
                    <td>{formatDateTime(x.sentAt, ctx.locale)}</td>
                    <td className={styles.cell}>
                      <details>
                        <summary>{x.subject}</summary>
                        <p className={styles.pre}>{x.body}</p>
                      </details>
                    </td>
                    <td>{x.audience === "all" ? t("audience.all") : x.audience === "category" ? t("log.inCategory", { name: catName(x.categoryId) }) : t("log.inCounty", { name: coName(x.countyCode) })}</td>
                    <td data-num className="ed-num">
                      {n(x.businessCount)}
                    </td>
                    <td data-num className="ed-num">
                      {n(x.emailCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Section>
      </div>
    </Page>
  );
}
