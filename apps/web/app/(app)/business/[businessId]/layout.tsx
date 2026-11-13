import { getBusinessView } from "@ed/core/business";
import { Notice, Page, PageHeader, Tag } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SectionTabs } from "@/components/shell/NavLinks";
import { requireCtx } from "@/lib/ctx";
import styles from "../business.module.css";

/**
 * Frame of one business's area. The W3 status is read from the database on every request:
 * a restriction or suspension is shown here with the recorded reason for as long as it lasts.
 */
export default async function BusinessLayout({ children, params }: { children: ReactNode; params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const { business, lapsed } = await orNotFound(getBusinessView(ctx, businessId));
  const base = `/business/${business.id}`;
  return (
    <Page>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={business.name}
        actions={business.status !== "active" ? <Tag tone="danger">{t(`status.${business.status}`)}</Tag> : undefined}
      />
      {business.status !== "active" ? (
        <Notice tone="danger" title={t(`restriction.${business.status}Title`)} role="status">
          <p>{t(`restriction.${business.status}Body`)}</p>
          {business.restrictionReason ? (
            <p className={styles.reason}>
              <strong>{t("restriction.reason")}</strong> {business.restrictionReason}
            </p>
          ) : null}
          <p className="ed-small">{t("restriction.contact")}</p>
        </Notice>
      ) : null}
      {lapsed && business.status === "active" ? (
        <Notice tone="attention" title={t("lapsed.title")}>
          {t("lapsed.body")}
        </Notice>
      ) : null}
      <div className={styles.tabs}>
        <SectionTabs
          label={t("tabs.label")}
          groups={[
            {
              key: "business",
              label: t("tabs.label"),
              items: [
                { href: base, label: t("tabs.listings"), exact: true },
                { href: `${base}/team`, label: t("tabs.team") },
                { href: `${base}/settings`, label: t("tabs.settings") },
              ],
            },
          ]}
        />
      </div>
      {children}
    </Page>
  );
}
