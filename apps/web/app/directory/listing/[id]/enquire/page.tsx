import { getDirectoryPrefill, getPublicListing } from "@ed/core/directory";
import {
  BUDGET_BANDS,
  ENQUIRY_ATTACHMENT_PURPOSE,
  getEnquiryPrefill,
  listEnquiryOccasions,
  listingTakesQuoteRequests,
  MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY,
  MAX_ENQUIRIES_PER_OCCASION,
} from "@ed/core/enquiries";
import { getPicklists } from "@ed/core/geography";
import { OCCASION_KINDS } from "@ed/db";
import { isAppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { buttonClassName, EmptyState, Lead, Notice, Page, Stack } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/ctx";
import styles from "../../../_slots/slots.module.css";
import { EnquiryForm } from "./EnquiryForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("enquiries"))("form.title"), robots: { index: false } };
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ occasion?: string; kind?: string }> };

/**
 * The enquiry form of a listing (P8–P11, F5). Needs a signed-in planner (requireCtx sends
 * anyone else to sign in) and an occasion they manage: the one they came from, the only one
 * they have, or one they choose here. Everything is pre-filled from that plan and editable;
 * the limits are shown before the planner starts typing and enforced on the server.
 */
export default async function EnquirePage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("enquiries");
  const to = await getTranslations("occasions");
  const listing = await getPublicListing(ctx, id);
  if (!listing) notFound();
  const listingHref = `/directory/listing/${listing.id}`;
  const back = (
    <Link href={sp.occasion ? `${listingHref}?occasion=${sp.occasion}` : listingHref} className={styles.backLink}>
      <IconArrowLeft size={16} />
      {t("form.cancel")}
    </Link>
  );
  const wantsQuote = sp.kind === "quote" && (await listingTakesQuoteRequests(ctx, listing.id));
  const mode = wantsQuote ? "quote" : "enquiry";
  const head = (
    <header className={styles.formHead}>
      <span className="ed-label">{t("form.eyebrow")}</span>
      <h1 className={styles.formTitle}>{listing.name}</h1>
      <span className="ed-label">{listing.categories.map((c) => c.name).join(" · ")}</span>
    </header>
  );

  // P29: an unclaimed listing takes no enquiries — say so plainly (the server refuses too)
  if (!listing.acceptsEnquiries) {
    return (
      <Page narrow>
      <Stack gap={4}>
        {back}
        {head}
        <Notice tone="attention" title={t("errors.unclaimed")} />
        </Stack>
    </Page>
    );
  }

  const occasions = await listEnquiryOccasions(ctx);
  let occasionId = sp.occasion && occasions.some((o) => o.id === sp.occasion) ? sp.occasion : null;
  if (!occasionId && occasions.length === 1) occasionId = occasions[0]!.id;

  if (occasions.length === 0) {
    return (
      <Page narrow>
      <Stack gap={4}>
        {back}
        {head}
        <EmptyState
          title={t("form.noOccasionTitle")}
          action={
            <Link href="/occasions/new" className={buttonClassName({ variant: "primary" })}>
              {t("form.createOccasion")}
            </Link>
          }
        >
          {t("form.noOccasionBody")}
        </EmptyState>
        </Stack>
    </Page>
    );
  }

  if (!occasionId) {
    return (
      <Page narrow>
      <Stack gap={4}>
        {back}
        {head}
        <form method="get" className="ed-form">
          {wantsQuote ? <input type="hidden" name="kind" value="quote" /> : null}
          <div className="ed-field">
            <label className="ed-field__label" htmlFor="enq-occasion">
              {t("form.chooseOccasion")}
            </label>
            <span className="ed-field__hint" id="enq-occasion-hint">
              {t("form.chooseOccasionBody")}
            </span>
            <select className="ed-select" id="enq-occasion" name="occasion" aria-describedby="enq-occasion-hint" defaultValue={occasions[0]!.id}>
              {occasions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </div>
          <div className="ed-actionbar">
            <button type="submit" className="ed-btn ed-btn--primary">
              {t("form.chooseOccasionContinue")}
            </button>
          </div>
        </form>
        </Stack>
    </Page>
    );
  }

  const prefill = await getEnquiryPrefill(ctx, { occasionId, listingId: listing.id });
  let area: { countyCode: string | null; localityId: string | null } = { countyCode: null, localityId: null };
  try {
    area = await getDirectoryPrefill(ctx, occasionId);
  } catch (e) {
    if (!isAppError(e)) throw e;
  }
  const picklists = await getPicklists(ctx);
  const title = mode === "quote" ? t("form.titleQuote") : t("form.title");
  const blocked =
    prefill.leftForOccasion === 0 ? (
      <Notice tone="attention" title={t("form.limitOccasionTitle", { max: MAX_ENQUIRIES_PER_OCCASION })}>
        {t("form.limitOccasionBody")}
      </Notice>
    ) : prefill.leftToday === 0 ? (
      <Notice tone="attention" title={t("form.limitDayTitle", { max: MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY })}>
        {t("form.limitDayBody")}
      </Notice>
    ) : mode === "enquiry" && prefill.openEnquiryId ? (
      <Notice
        tone="attention"
        title={t("cta.openNote")}
        actions={
          <Link href={`/occasions/${occasionId}/suppliers/enquiries/${prefill.openEnquiryId}`} className="ed-btn">
            {t("cta.open")}
          </Link>
        }
      />
    ) : null;

  return (
    <Page narrow>
      <Stack gap={4}>
      {back}
      {head}
      <div className="ed-stack" data-gap="3">
        <h2>{title}</h2>
        <Lead>{mode === "quote" ? t("form.leadQuote") : t("form.lead")}</Lead>
        <p className="ed-small ed-muted">
          {t("form.occasion")}: <strong>{prefill.occasionTitle}</strong>
          {occasions.length > 1 ? (
            <>
              {" · "}
              <Link href={`${listingHref}/enquire${wantsQuote ? "?kind=quote" : ""}`}>{t("form.changeOccasion")}</Link>
            </>
          ) : null}
          <br />
          {t("form.occasionHint")}
        </p>
      </div>
      {blocked ?? (
        <>
          <EnquiryForm
            mode={mode}
            occasionId={occasionId}
            listingId={listing.id}
            idempotencyKey={`enq-${newId()}`}
            hasEmail={prefill.hasEmail}
            attachmentPurpose={ENQUIRY_ATTACHMENT_PURPOSE}
            kinds={OCCASION_KINDS.map((k) => ({ value: k, label: to(`kinds.${k}`) }))}
            counties={picklists.counties.map((c) => ({ code: c.code, name: c.name }))}
            localities={picklists.localities.map((l) => ({ id: l.id, countyCode: l.countyCode, name: l.name }))}
            budgets={BUDGET_BANDS.map((b) => ({ value: b, label: t(`budget.${b}`) }))}
            defaults={{
              occasionKind: prefill.occasionKind,
              date: prefill.date ?? "",
              guests: prefill.guests ? String(prefill.guests) : "",
              countyCode: area.countyCode ?? "",
              localityId: area.localityId ?? "",
            }}
          />
          <p className={styles.limits}>
            <span>{t("form.leftOccasion", { left: prefill.leftForOccasion, max: MAX_ENQUIRIES_PER_OCCASION })}</span>
            <span>{t("form.leftToday", { left: prefill.leftToday, max: MAX_ENQUIRIES_PER_ACCOUNT_PER_DAY })}</span>
          </p>
        </>
      )}
      </Stack>
    </Page>
  );
}
