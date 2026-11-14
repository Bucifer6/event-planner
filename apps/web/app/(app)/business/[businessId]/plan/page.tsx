import { getPlanView } from "@ed/core/billing";
import { formatDate } from "@ed/i18n/format";
import { Notice, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import biz from "../occasions/biz.module.css";
import { PaidPlan } from "./_paid";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("plan.tab") };
}

/**
 * The business's plan page.
 *
 * MON1: while the monetization switch is OFF (the launch state) this page states facts and
 * nothing else — everything is free, what stays free for good, and the promise of notice.
 * No price, no plan to pick, no button to buy: `view.paid` is null and the paid component (the only
 * component that can render a price or start a checkout) is not rendered.
 */
export default async function BusinessPlanPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ checkout?: string }> }) {
  const [{ businessId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("billing");
  const view = await orNotFound(getPlanView(ctx, businessId));
  const { phase, effectiveAt } = view.monetization;

  return (
    <div className={biz.narrow}>
      <Section title={t("plan.title")} level={2}>
        {phase === "on" ? (
          <p className={biz.lead}>{view.hasBusinessPlan ? t("plan.leadOn") : t("plan.leadFreeTier")}</p>
        ) : (
          <p className={biz.lead}>{t("plan.leadFree")}</p>
        )}
        {phase === "off" ? <p>{t("plan.freeBody")}</p> : null}
        {phase === "notice" && effectiveAt ? (
          <Notice tone="accent" title={t("plan.noticeTitle", { date: formatDate(effectiveAt, ctx.locale) })}>
            {t("plan.noticeBody")}
          </Notice>
        ) : null}
      </Section>

      <Section title={t("plan.freeTierTitle")} level={2}>
        <p className="ed-muted">{t("plan.freeTierBody")}</p>
        <ol className={biz.facts}>
          {view.freeTier.map((key, i) => (
            <li key={key}>
              <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span>{t(`plan.freeTier.${key}` as never)}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t("plan.promiseTitle")} level={2}>
        <ul className="ed-prose">
          <li>{t("plan.promise1")}</li>
          <li>{t("plan.promise2")}</li>
          <li>{t("plan.promise3")}</li>
        </ul>
        {phase !== "on" ? <p className={biz.note}>{t("plan.laterBody")}</p> : null}
      </Section>

      {/* MON1 gate: `paid` exists only when isMonetizationOn (see getPlanView) */}
      {view.paid ? <PaidPlan businessId={businessId} paid={view.paid} lapsed={view.lapsed} returned={sp.checkout === "returned"} /> : null}
    </div>
  );
}
