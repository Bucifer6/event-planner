import { listThreadsForBooking } from "@ed/core/enquiries";
import { Section } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import styles from "./enquiries.module.css";
import { Letters, StateTag, statusLine } from "./Thread";

/**
 * P10: the enquiry threads that sit in a supplier record, shown on the supplier's page — the
 * state in words and the latest letters, with a link to the whole thread. Renders nothing
 * for a supplier the planner added by hand (no thread).
 */
export async function SupplierEnquiries({ occasionId, bookingId }: { occasionId: string; bookingId: string }) {
  const ctx = await requireCtx();
  const threads = await listThreadsForBooking(ctx, bookingId).catch(() => []);
  if (threads.length === 0) return null;
  const t = await getTranslations("enquiries");
  const tt = (k: string, p?: Record<string, string | number>) => t(k as never, p as never);
  const base = `/occasions/${occasionId}/suppliers/enquiries`;
  return (
    <Section title={t("planner.sectionTitle")}>
      <div>
        {threads.map((th) => (
          <div key={th.id} className={styles.compact}>
            <div className={styles.inline}>
              <StateTag t={tt} state={th.state} viewer="planner" />
              <span className={styles.status}>
                {t(`kinds.${th.kind}`)} · {statusLine(tt, th, ctx.locale, "planner")}
              </span>
            </div>
            <Letters t={tt} messages={th.messages} viewer="planner" locale={ctx.locale} limit={3} />
            <Link href={`${base}/${th.id}`} className={styles.back}>
              {t("planner.sectionAll")}
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}
