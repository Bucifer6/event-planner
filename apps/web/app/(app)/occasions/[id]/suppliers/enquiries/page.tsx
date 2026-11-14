import { listOccasionEnquiries } from "@ed/core/enquiries";
import { buttonClassName, EmptyState, List, PageHeader } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import styles from "./_components/enquiries.module.css";
import { StateTag, statusLine } from "./_components/Thread";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("enquiries"))("planner.listTitle") };
}

/**
 * P33: every enquiry the occasion has sent, with its state in words. An unanswered one says
 * when it left — a silent business is visible, never a blank.
 */
export default async function OccasionEnquiriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("enquiries");
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const threads = await orNotFound(listOccasionEnquiries(ctx, id));
  const base = `/occasions/${id}/suppliers`;

  return (
    <>
      <Link href={base} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("planner.back")}
      </Link>
      <PageHeader level={2} title={t("planner.listTitle")} description={t("planner.listDescription")} />
      {threads.length === 0 ? (
        <EmptyState
          title={t("planner.emptyTitle")}
          action={
            <Link href={`/directory?occasion=${id}`} className={buttonClassName({ variant: "primary" })}>
              {t("planner.emptyAction")}
            </Link>
          }
        >
          {t("planner.emptyBody")}
        </EmptyState>
      ) : (
        <List>
          {threads.map((th) => (
            <li key={th.id} className="ed-row">
              <Link href={`${base}/enquiries/${th.id}`} className={styles.rowLink} aria-label={t("planner.openNamed", { name: th.listingName })}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{th.listingName}</span>
                  <span className={styles.rowMeta}>
                    {t(`kinds.${th.kind}`)} · {statusLine(tt, th, ctx.locale, "planner")}
                  </span>
                </span>
                <span className={styles.rowEnd}>
                  <StateTag t={tt} state={th.state} viewer="planner" />
                </span>
              </Link>
            </li>
          ))}
        </List>
      )}
    </>
  );
}
