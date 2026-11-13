import { actorAccountId } from "@ed/core/context";
import type { PublicListing } from "@ed/core/directory";
import { listingTakesQuoteRequests } from "@ed/core/enquiries";
import { buttonClassName } from "@ed/ui";
import { IconEnvelope } from "@ed/ui/icons";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import styles from "./slots.module.css";

/**
 * "Trimite o cerere" (P8–P11) — the listing page's ONE primary action.
 *
 *  - rendered only for claimed listings (`listing.acceptsEnquiries`): an unclaimed listing
 *    never shows it (P29); the server refuses such an enquiry as well;
 *  - a signed-out visitor is sent to sign in first. Sign-in has no return path yet, so the
 *    note says plainly to come back to this page afterwards;
 *  - `occasionId` is set when the visitor arrived from an occasion ("Găsește firme") and is
 *    carried into the form, which pre-fills from that plan;
 *  - a florist or styling listing also offers the flower quote request (F5), as a secondary.
 */
export async function EnquiryCta({ listing, occasionId }: { listing: PublicListing; occasionId?: string | null }) {
  if (!listing.acceptsEnquiries) {
    // P29: no enquiry button on an unclaimed listing. What it gets instead is the way in for
    // the business itself: claim it (P30) or ask for removal / a correction (BD6).
    if (!listing.unclaimed) return null;
    const c = await getTranslations("claims");
    return (
      <div className={styles.cta}>
        <span className="ed-label">{c("cta.title")}</span>
        <Link href={`/claim/${listing.id}`} className={buttonClassName({ variant: "secondary", block: true })}>
          {c("cta.claim")}
        </Link>
        <p className="ed-small ed-muted">{c("cta.body")}</p>
        <Link href={`/claim/${listing.id}/remove`} className={styles.quietLink}>
          {c("cta.remove")}
        </Link>
      </div>
    );
  }
  const t = await getTranslations("enquiries");
  const ctx = await getCtx();
  const signedIn = ctx.actor.kind === "account" && !!actorAccountId(ctx.actor);
  if (!signedIn) {
    return (
      <div className={styles.cta}>
        <Link href="/sign-in" className={buttonClassName({ variant: "primary", block: true })}>
          {t("cta.signIn")}
        </Link>
        <p className="ed-small ed-muted">{t("cta.signInNote")}</p>
      </div>
    );
  }
  const quote = await listingTakesQuoteRequests(ctx, listing.id);
  const query = occasionId ? `occasion=${occasionId}` : "";
  const href = (extra?: string) => `/directory/listing/${listing.id}/enquire${query || extra ? `?${[query, extra].filter(Boolean).join("&")}` : ""}`;
  return (
    <div className={styles.cta}>
      <Link href={href()} className={buttonClassName({ variant: "primary", block: true })}>
        <IconEnvelope size={18} />
        {t("cta.send")}
      </Link>
      {quote ? (
        <Link href={href("kind=quote")} className={buttonClassName({ variant: "secondary", block: true })}>
          {t("cta.sendQuote")}
        </Link>
      ) : null}
      <p className="ed-small ed-muted">{t("cta.free")}</p>
    </div>
  );
}
