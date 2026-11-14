import { getRemovalContext } from "@ed/core/discovery";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { ExternalLink, Lead, Notice, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import styles from "../../claim.module.css";
import { RemovalForm } from "./RemovalForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("claims"))("remove.title"), robots: { index: false } };
}

/**
 * BD6: anyone representing a business can ask for its unclaimed listing to be removed or
 * corrected, or object to it — without an account. Arriving through the link in the claim
 * invitation proves the published address, so a removal then takes effect at once.
 */
export default async function RemovePage({ params, searchParams }: { params: Promise<{ listingId: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ listingId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getCtx();
  const t = await getTranslations("claims");
  const token = typeof sp.t === "string" ? sp.t.slice(0, 200) : "";
  const context = await getRemovalContext(ctx, { listingId, token });
  if (!context) {
    return (
      <Stack gap={4}>
        <h1 className="ed-display">{t("remove.title")}</h1>
        <Notice
          title={t("remove.notAvailable.title")}
          actions={
            <Link href="/report" className="ed-btn">
              {t("report")}
            </Link>
          }
        >
          {t("remove.notAvailable.body")}
        </Notice>
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <header className={styles.head}>
        <span className="ed-label">{t("eyebrow")}</span>
        <h1 className={styles.name}>{context.listingName}</h1>
        <div className={styles.links}>
          <Link href={`/directory/listing/${context.listingId}`}>{t("viewListing")}</Link>
          {context.sourceUrl && /^https?:\/\//.test(context.sourceUrl) ? <ExternalLink href={context.sourceUrl}>{t("source")}</ExternalLink> : null}
        </div>
      </header>
      <h2>{t("remove.title")}</h2>
      <Lead>{t("remove.lead", { name: context.listingName })}</Lead>
      {context.viaInvitation ? <Notice tone="success" title={t("remove.viaInvitation")} /> : null}
      <RemovalForm listingId={context.listingId} token={context.viaInvitation ? token : ""} honeypot={{ name: HONEYPOT_FIELD, stampName: FORM_STAMP_FIELD, stamp: issueFormStamp() }} />
      <p className="ed-small ed-muted">
        {t("remove.claimInstead")} <Link href={`/claim/${context.listingId}`}>{t("title")}</Link>
      </p>
      <p className="ed-small ed-muted">{t("remove.privacy")}</p>
    </Stack>
  );
}
