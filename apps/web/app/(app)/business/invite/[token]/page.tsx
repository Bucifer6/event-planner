import { getBusinessInvite } from "@ed/core/business";
import { Notice, Page, PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { acceptBusinessInviteAction } from "@/app/actions/business";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { requireCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("business"))("invite.title"), robots: { index: false } };
}

/** Accepting an invitation to a business team (P18). Works once, for the invited email address only. */
export default async function BusinessInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const invite = await getBusinessInvite(ctx, token);
  return (
    <Page narrow>
      <PageHeader eyebrow={t("eyebrow")} title={t("invite.title")} />
      {!invite ? (
        <Notice tone="attention" title={t("invite.goneTitle")}>
          {t("invite.goneBody")} <Link href="/business">{t("invite.toBusiness")}</Link>
        </Notice>
      ) : invite.state === "expired" ? (
        <Notice tone="attention" title={t("invite.expiredTitle")}>
          {t("invite.expiredBody", { business: invite.businessName })}
        </Notice>
      ) : (
        <>
          <p>{t("invite.body", { business: invite.businessName, role: t(`roles.${invite.role}`) })}</p>
          <ActionForm action={acceptBusinessInviteAction} hidden={{ token }} block={false} submitLabel={t("invite.accept", { business: invite.businessName })} pendingLabel={t("invite.accepting")} />
        </>
      )}
    </Page>
  );
}
