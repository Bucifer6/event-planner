import { getOwnChecklist } from "@ed/core/offline";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { offlineStatusLabels } from "../_components/labels";
import styles from "../_components/operate.module.css";
import { MyChecklist } from "./MyChecklist";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("checklist.title") };
}

/** E-03: the person's own checklist, usable without network once it was opened (shell only in the page). */
export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  await orNotFound(getOwnChecklist(ctx, id).then(() => true)); // membership check only
  const raw = (key: string) => t.raw(key as never) as string;
  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <Link href={`/occasions/${id}/operate`} className={styles.back}>
          <IconArrowLeft size={16} /> {t("backToHub")}
        </Link>
        <div className={styles.hero}>
          <span className="ed-label">{t("checklist.eyebrow")}</span>
          <h2 className={styles.blockTitle}>{t("checklist.title")}</h2>
          <span className={styles.heroNote}>{t("checklist.description")}</span>
        </div>
      </header>
      <MyChecklist
        occasionId={id}
        locale={ctx.locale}
        labels={{ empty: t("checklist.empty"), emptyBody: t("checklist.emptyBody"), stale: t("checklist.stale"), none: t("checklist.none"), waitingSync: t("checkin.waitingSync"), closed: t("closedNotice"), status: offlineStatusLabels(raw) }}
      />
    </div>
  );
}
