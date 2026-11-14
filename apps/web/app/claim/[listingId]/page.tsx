import { signInPathFor } from "@ed/auth";
import { getClaimView } from "@ed/core/claims";
import { buttonClassName, ExternalLink, Lead, Notice, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelClaimAction, resendClaimCodeAction, startClaimAction, verifyClaimCodeAction } from "@/app/actions/claims";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { getCtx } from "@/lib/ctx";
import styles from "../claim.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("claims"))("title"), robots: { index: false } };
}

/**
 * P30: claiming an unclaimed listing. The page says how it works before asking for anything:
 * a code goes to the address the business itself publishes (or, when it publishes none, a
 * moderator checks against the public source), and a second person approves. Until then the
 * listing stays exactly as it is.
 */
export default async function ClaimPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("claims");
  const view = await getClaimView(ctx, listingId);
  if (!view) notFound();
  const claim = view.claim;
  const open = claim && ["code_sent", "verified", "needs_check", "in_approval"].includes(claim.state);
  const listingHref = `/directory/listing/${view.listingId}`;

  const head = (
    <header className={styles.head}>
      <span className="ed-label">{t("eyebrow")}</span>
      <h1 className={styles.name}>{view.listingName}</h1>
      <div className={styles.links}>
        <Link href={listingHref}>{t("viewListing")}</Link>
        {view.sourceUrl && /^https?:\/\//.test(view.sourceUrl) ? <ExternalLink href={view.sourceUrl}>{t("source")}</ExternalLink> : null}
      </div>
    </header>
  );

  if (!view.unclaimed) {
    return (
      <Stack gap={4}>
        {head}
        {claim?.state === "approved" ? (
          <Notice
            tone="success"
            title={t("status.approvedTitle")}
            actions={
              <Link href={claim.businessId ? `/business/${claim.businessId}` : "/business"} className={buttonClassName({ variant: "primary" })}>
                {t("status.approvedAction")}
              </Link>
            }
          >
            {t("status.approvedBody")}
          </Notice>
        ) : (
          <Notice
            title={t("alreadyClaimed.title")}
            actions={
              <Link href={`/report?ref=${encodeURIComponent(view.listingName)}&type=listing&id=${view.listingId}`} className="ed-btn">
                {t("report")}
              </Link>
            }
          >
            {t("alreadyClaimed.body")}
          </Notice>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      {head}
      <Lead>{t("lead", { name: view.listingName })}</Lead>

      <Section title={t("steps.title")}>
        <ol className={styles.steps}>
          <li>{t("steps.one")}</li>
          <li>{view.maskedEmail ? t("steps.twoCode", { email: view.maskedEmail }) : t("steps.twoModerator")}</li>
          <li>{t("steps.three")}</li>
        </ol>
      </Section>

      {!view.signedIn ? (
        <Notice
          title={t("signIn.title")}
          actions={
            <Link href={signInPathFor(`/claim/${listingId}`)} className={buttonClassName({ variant: "primary" })}>
              {t("signIn.action")}
            </Link>
          }
        >
          {t("signIn.body")}
        </Notice>
      ) : !view.hasEmail ? (
        <Notice
          tone="attention"
          title={t("noEmail.title")}
          actions={
            <Link href="/account" className="ed-btn">
              {t("noEmail.action")}
            </Link>
          }
        >
          {t("noEmail.body")}
        </Notice>
      ) : claim?.state === "code_sent" ? (
        <Section title={t("code.title")}>
          <p>{t("code.body", { email: view.maskedEmail ?? "" })}</p>
          <SpecForm
            action={verifyClaimCodeAction}
            hidden={{ listingId: view.listingId, claimId: claim.id }}
            fields={[{ kind: "text", name: "code", label: t("code.label"), required: true, maxLength: 8 }]}
            submitLabel={t("code.submit")}
            pendingLabel={t("code.submitting")}
            refreshOnSuccess
          />
          <div className={styles.tools}>
            <SpecForm action={resendClaimCodeAction} hidden={{ listingId: view.listingId }} fields={[]} submitLabel={t("code.resend")} pendingLabel={t("code.resending")} variant="quiet" success={t("code.resent")} />
            <SpecForm action={cancelClaimAction} hidden={{ listingId: view.listingId, claimId: claim.id }} fields={[]} submitLabel={t("code.cancel")} pendingLabel={t("code.cancelling")} variant="quiet" refreshOnSuccess />
          </div>
        </Section>
      ) : open && claim ? (
        <Notice tone={claim.state === "in_approval" ? "success" : "attention"} title={t(claim.state === "verified" ? "status.verifiedTitle" : claim.state === "needs_check" ? "status.needsCheckTitle" : "status.inApprovalTitle")}>
          {t(claim.state === "verified" ? "status.verifiedBody" : claim.state === "needs_check" ? "status.needsCheckBody" : "status.inApprovalBody")}
        </Notice>
      ) : (
        <Section title={t("form.title")}>
          {claim?.state === "rejected" ? (
            <Notice tone="danger" title={t("status.rejectedTitle")} role="status">
              {claim.decisionReason ? <p className={styles.reason}>{t("status.rejectedReason", { reason: claim.decisionReason })}</p> : null}
              <p>{t("status.again")}</p>
            </Notice>
          ) : claim?.state === "cancelled" ? (
            <Notice title={t("status.cancelledTitle")}>{t("status.again")}</Notice>
          ) : null}
          <SpecForm
            action={startClaimAction}
            hidden={{ listingId: view.listingId }}
            fields={[
              ...(view.ownBusiness ? [] : [{ kind: "text" as const, name: "businessName", label: t("form.businessName"), hint: t("form.businessNameHint"), required: true, maxLength: 120, defaultValue: view.listingName }]),
              { kind: "text" as const, name: "statement", label: t("form.statement"), hint: t("form.statementHint"), maxLength: 200, optionalLabel: t("form.optional") },
            ]}
            submitLabel={t("form.submit")}
            pendingLabel={t("form.submitting")}
            refreshOnSuccess
          >
            {view.ownBusiness ? <p>{t("form.ownBusiness", { name: view.ownBusiness.name })}</p> : null}
            {view.maskedEmail ? <p className="ed-small ed-muted">{t("form.codeNote")}</p> : null}
          </SpecForm>
        </Section>
      )}

      <p className="ed-small ed-muted">
        <Link href={`/claim/${view.listingId}/remove`}>{t("remove.title")}</Link>
      </p>
    </Stack>
  );
}
