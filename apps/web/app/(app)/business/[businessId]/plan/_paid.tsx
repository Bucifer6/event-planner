import { isFreshAuth } from "@ed/core/accounts";
import type { PlanView, PriceBreakdown } from "@ed/core/billing";
import { getFeaturedPreview } from "@ed/core/featured";
import { listBusinessListings } from "@ed/core/listings";
import { formatDate, formatInteger, formatMoney } from "@ed/i18n/format";
import { List, Notice, Section, Table, Tag } from "@ed/ui";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { cancelSubscriptionAction, startCheckoutAction } from "@/app/actions/billing";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { requireCtx } from "@/lib/ctx";
import biz from "../occasions/biz.module.css";

/**
 * MONETIZATION ON ONLY. The one component in the business area that shows a price or starts
 * a purchase. It is rendered by plan/page.tsx solely when `view.paid` is set, which
 * @ed/core/billing getPlanView does only while isMonetizationOn() — and the actions it posts
 * to refuse on their own while the switch is off (MON1).
 *
 * PAY4: every price is stated EXCLUDING TVA, with the TVA and the total beside it.
 * P24: coming back from the processor changes nothing; the plan switches when the
 * processor's signed confirmation arrives, which this page then simply shows.
 */
export async function PaidPlan({ businessId, paid, lapsed, returned }: { businessId: string; paid: NonNullable<PlanView["paid"]>; lapsed: boolean; returned: boolean }) {
  const t = await getTranslations("billing");
  const locale = (await getLocale()) as "ro" | "en";
  const money = (minor: number) => formatMoney(minor, "RON", locale);
  const rows: Array<{ key: "businessMonthly" | "businessYearly" | "featuredMonthly"; price: PriceBreakdown }> = [
    { key: "businessMonthly", price: paid.prices.businessMonthly },
    { key: "businessYearly", price: paid.prices.businessYearly },
    { key: "featuredMonthly", price: paid.prices.featuredMonthly },
  ];
  const live = paid.subscriptions.filter((s) => s.status !== "canceled");
  const hasPlan = live.some((s) => s.plan !== "featured_monthly");
  // P15: what a business sees BEFORE buying Featured — numbers, no promise
  const ctx = await requireCtx();
  // S4: a purchase needs a fresh confirmation — enforced in @ed/core/billing, said here first
  const fresh = await isFreshAuth(ctx);
  const listings = (await listBusinessListings(ctx, businessId)).filter((l) => l.listing.status === "live");
  const previews = await Promise.all(listings.map(async (l) => ({ listing: l.listing, rows: await getFeaturedPreview(ctx, { listingId: l.listing.id }) })));

  return (
    <>
      {returned ? (
        <Notice title={t("paid.returnedTitle")} role="status">
          {t("paid.returnedBody")}
        </Notice>
      ) : null}

      {paid.canBuy && paid.checkoutConfigured && !fresh ? (
        <Notice title={t("paid.freshTitle")}>
          {t("paid.freshBody")} <Link href="/account#fresh">{t("paid.freshLink")}</Link>
        </Notice>
      ) : null}

      <Section title={t("paid.pricesTitle")} level={2}>
        <p className="ed-muted">{paid.prices.tvaRegistered ? t("paid.exclTva") : t("paid.noTva")}</p>
        <div className={biz.prices}>
          <Table caption={t("paid.pricesTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("paid.col.what")}</th>
                <th scope="col" data-num>
                  {t("paid.col.net")}
                </th>
                <th scope="col" data-num>
                  {t("paid.col.tva", { rate: paid.prices.businessMonthly.tvaRateBp / 100 })}
                </th>
                <th scope="col" data-num>
                  {t("paid.col.gross")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, price }) => (
                <tr key={key}>
                  <td>{t(`paid.plans.${key}`)}</td>
                  <td data-num>{money(price.netMinor)}</td>
                  <td data-num>{money(price.tvaMinor)}</td>
                  <td data-num>{money(price.grossMinor)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className={biz.note}>{t("paid.stops")}</p>
      </Section>

      {live.length > 0 ? (
        <Section title={t("paid.yoursTitle")} level={2}>
          <List>
            {live.map((s) => (
              <li key={s.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">{t(`paid.planNames.${s.plan}`)}</span>
                  <span className="ed-row__meta">
                    {s.status === "grace" && s.graceUntil
                      ? t("paid.graceUntil", { date: formatDate(s.graceUntil, locale) })
                      : s.cancelAtPeriodEnd && s.currentPeriodEnd
                        ? t("paid.endsOn", { date: formatDate(s.currentPeriodEnd, locale) })
                        : s.currentPeriodEnd
                          ? t("paid.renewsOn", { date: formatDate(s.currentPeriodEnd, locale) })
                          : t("paid.waiting")}
                  </span>
                </div>
                <div className="ed-row__end">
                  <Tag tone={s.status === "active" ? "success" : "attention"}>{t(`paid.status.${s.status}`)}</Tag>
                  {paid.canBuy && !s.cancelAtPeriodEnd && s.status === "active" ? (
                    <ActionForm action={cancelSubscriptionAction} hidden={{ businessId, subscriptionId: s.id }} refreshOnSuccess variant="quiet" block={false} submitLabel={t("paid.cancel")} pendingLabel={t("paid.cancelling")} success={t("paid.cancelRequested")} />
                  ) : null}
                </div>
              </li>
            ))}
          </List>
        </Section>
      ) : null}

      {paid.canBuy && !hasPlan ? (
        <Section title={lapsed ? t("paid.buyTitleLapsed") : t("paid.buyTitle")} level={2}>
          {paid.checkoutConfigured ? (
            <>
              <p className={biz.note}>{t("paid.buyBody")}</p>
              <ActionForm
                action={startCheckoutAction}
                hidden={{ businessId, plan: "business_monthly" }}
                block={false}
                submitLabel={t("paid.buyMonthly", { total: money(paid.prices.businessMonthly.grossMinor) })}
                pendingLabel={t("paid.opening")}
              />
              <ActionForm
                action={startCheckoutAction}
                hidden={{ businessId, plan: "business_yearly" }}
                variant="secondary"
                block={false}
                submitLabel={t("paid.buyYearly", { total: money(paid.prices.businessYearly.grossMinor) })}
                pendingLabel={t("paid.opening")}
              />
            </>
          ) : (
            <p className="ed-muted">{t("paid.notConfigured")}</p>
          )}
        </Section>
      ) : null}

      <Section title={t("paid.featuredTitle")} level={2}>
        <p className={biz.note}>{t("paid.featuredBody")}</p>
        {previews.length === 0 ? <p className="ed-muted">{t("paid.featuredNoListing")}</p> : null}
        {previews.map(({ listing, rows: pr }) => (
          <div key={listing.id} className={biz.stack}>
            <h3>{listing.name}</h3>
            <div className={biz.prices}>
              <Table caption={t("paid.featuredCaption", { name: listing.name })}>
                <thead>
                  <tr>
                    <th scope="col">{t("paid.fcol.where")}</th>
                    <th scope="col" data-num>
                      {t("paid.fcol.now")}
                    </th>
                    <th scope="col" data-num>
                      {t("paid.fcol.share")}
                    </th>
                    <th scope="col" data-num>
                      {t("paid.fcol.searches")}
                    </th>
                    <th scope="col" aria-label={t("paid.fcol.buy")} />
                  </tr>
                </thead>
                <tbody>
                  {pr.map((r) => (
                    <tr key={`${r.categoryId}:${r.countyCode}`}>
                      <td>
                        {r.categoryName} · {r.countyName}
                      </td>
                      <td data-num>{formatInteger(r.current, locale)}</td>
                      <td data-num>{Math.round(r.share * 100)}%</td>
                      <td data-num>{formatInteger(r.searches30, locale)}</td>
                      <td>
                        {paid.canBuy && paid.checkoutConfigured ? (
                          <ActionForm
                            action={startCheckoutAction}
                            hidden={{ businessId, plan: "featured_monthly", listingId: listing.id, categoryId: r.categoryId, countyCode: r.countyCode }}
                            variant="secondary"
                            block={false}
                            submitLabel={t("paid.buyFeatured", { total: money(paid.prices.featuredMonthly.grossMinor) })}
                            pendingLabel={t("paid.opening")}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        ))}
        <p className={biz.note}>{t("paid.featuredNoGuarantee")}</p>
      </Section>
    </>
  );
}
