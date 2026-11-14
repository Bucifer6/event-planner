import { getMagicLinkStatus, safeNextPath, withNext } from "@ed/auth";
import { buttonClassName, Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { SIGN_IN_PATH } from "@/lib/session";
import { LinkUsed } from "../../../_components/link-used";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.link"))("title"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * The one-tap link from the sign-in email (S1). A live link goes on to the route that uses
 * it up and signs in; a used or expired one shows the SEC14 page: type the code from the same
 * email, or ask for one new code.
 */
export default async function MagicLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ next?: string }> }) {
  const { token } = await params;
  const next = safeNextPath((await searchParams).next);
  const t = await getTranslations("auth.link");
  const wellFormed = /^[A-Za-z0-9_-]{20,200}$/.test(token);
  const status = wellFormed ? await getMagicLinkStatus(await getCtx(), { token }) : "unknown";
  if (status === "valid") redirect(withNext(`/api/auth/link/${token}`, next));

  if (status === "unknown") {
    return (
      <Stack gap={4}>
        <Stack gap={2}>
          <h1 className="ed-display">{t("unknownTitle")}</h1>
          <Lead>{t("unknownBody")}</Lead>
        </Stack>
        <Link href={withNext(SIGN_IN_PATH, next)} className={buttonClassName({ variant: "primary", block: true })}>
          {t("backToSignIn")}
        </Link>
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{status === "used" ? t("usedTitle") : t("expiredTitle")}</h1>
        <Lead>{status === "used" ? t("usedBody") : t("expiredBody")}</Lead>
      </Stack>
      <LinkUsed token={token} next={next ?? undefined} />
      <p>
        <Link href={withNext(SIGN_IN_PATH, next)}>{t("backToSignIn")}</Link>
      </p>
    </Stack>
  );
}
