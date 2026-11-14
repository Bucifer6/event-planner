import { listOfflineConflicts } from "@ed/core/offline";
import { formatDateTime } from "@ed/i18n/format";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { resolveConflictAction } from "@/app/actions/operate";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { QuickAction } from "../../travel/_components/forms";
import { offlineStatusLabels } from "../_components/labels";
import styles from "../_components/operate.module.css";
import { QueuePanel } from "./QueuePanel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("offline.title") };
}

/**
 * E-03: what waits on this device, and the conflicts the server found. A conflict is never
 * merged on its own: the person reads what changed and chooses.
 */
export default async function OfflinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  const tc = await getTranslations("common");
  const conflicts = await orNotFound(listOfflineConflicts(ctx, id));
  const raw = (key: string) => t.raw(key as never) as string;
  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <Link href={`/occasions/${id}/operate`} className={styles.back}>
          <IconArrowLeft size={16} /> {t("backToHub")}
        </Link>
        <div className={styles.hero}>
          <span className="ed-label">{t("offline.eyebrow")}</span>
          <h2 className={styles.blockTitle}>{t("offline.title")}</h2>
          <span className={styles.heroNote}>{t("offline.description")}</span>
        </div>
      </header>
      <section className={styles.block}>
        <QueuePanel occasionId={id} locale={ctx.locale} labels={{ empty: t("offline.empty"), arrival: raw("offline.item.arrival"), tick: raw("offline.item.tick"), untick: raw("offline.item.untick"), listTitle: t("offline.listTitle"), status: offlineStatusLabels(raw) }} />
      </section>
      <section className={styles.block} id="conflicts">
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>{t("offline.conflictsTitle")}</h3>
        </div>
        {conflicts.length === 0 ? (
          <p className={styles.small}>{t("offline.noConflicts")}</p>
        ) : (
          <ul className={styles.rows}>
            {conflicts.map((c) => {
              const d = c.detail ?? {};
              const wanted = d.wanted === true ? t("offline.done") : t("offline.notDone");
              return (
                <li key={c.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowName}>{c.code === "changed_since_capture" ? String(d.label ?? "") : t("offline.removedItem")}</span>
                    <span className={styles.small}>
                      {c.code === "changed_since_capture"
                        ? t("offline.changedBody", { task: String(d.taskTitle ?? ""), server: d.serverDone === true ? t("offline.done") : t("offline.notDone"), wanted })
                        : t("offline.removedBody", { wanted })}
                    </span>
                    <span className={styles.small}>{t("offline.capturedAt", { time: formatDateTime(c.capturedAt, ctx.locale) })}</span>
                  </div>
                  <div className={styles.rowEnd}>
                    {c.code === "changed_since_capture" ? (
                      <QuickAction action={resolveConflictAction} hidden={{ occasionId: id, offlineItemId: c.id, decision: "apply" }} label={t("offline.apply", { wanted })} pendingLabel={tc("status.saving")} variant="secondary" block />
                    ) : null}
                    <QuickAction action={resolveConflictAction} hidden={{ occasionId: id, offlineItemId: c.id, decision: "drop" }} label={c.code === "changed_since_capture" ? t("offline.keepServer") : t("offline.dismiss")} pendingLabel={tc("status.saving")} variant="quiet" block />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
