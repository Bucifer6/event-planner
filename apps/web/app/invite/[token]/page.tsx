import { signInPathFor } from "@ed/auth";
import { actorAccountId } from "@ed/core/context";
import { getInvite } from "@ed/core/members";
import { buttonClassName, Card, Eyebrow, Notice, Stack, Wordmark } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/members";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { LanguageSwitch } from "@/components/shell/LanguageSwitch";
import { getCtx } from "@/lib/ctx";
import { SIGN_IN_PATH } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("accept.metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * A5: the emailed team invitation. Shows what the person is invited to, then binds their
 * signed-in account on "accept". An unknown, used, cancelled or expired link says so plainly
 * and reveals nothing else.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getCtx();
  const t = await getTranslations("team");
  const nav = await getTranslations("nav");
  const invite = await getInvite(ctx, token);
  const signedIn = actorAccountId(ctx.actor) !== null && ctx.actor.kind === "account";
  // sign-in brings the person straight back to this invitation
  const signInHref = signInPathFor(`/invite/${token}`, SIGN_IN_PATH);

  return (
    <div className="ed-solo">
      <header className="ed-solo__head">
        <Wordmark href="/" label={nav("home")} />
        <LanguageSwitch />
      </header>
      <main className="ed-solo__main" id="main">
        {!invite ? (
          <Stack gap={4}>
            <h1 className="ed-display">{t("accept.goneTitle")}</h1>
            <p>{t("accept.goneBody")}</p>
            <Link href={signedIn ? "/occasions" : SIGN_IN_PATH} className={buttonClassName({ block: true })}>
              {signedIn ? t("accept.toOccasions") : t("accept.signIn")}
            </Link>
          </Stack>
        ) : (
          <Stack gap={4}>
            <Card framed>
              <Stack gap={2}>
                <Eyebrow>{t("accept.eyebrow")}</Eyebrow>
                <h1 className="ed-display">{invite.occasionTitle}</h1>
                <p>
                  {t("accept.body", { role: t(`roles.${invite.role}`) })}
                  {invite.customLabel ? ` ${t("accept.label", { label: invite.customLabel })}` : ""}
                </p>
              </Stack>
            </Card>
            {invite.state === "expired" ? (
              <Notice tone="attention" title={t("accept.expiredTitle")}>
                {t("accept.expiredBody")}
              </Notice>
            ) : signedIn ? (
              <ActionForm action={acceptInviteAction} hidden={{ token }} submitLabel={t("accept.submit")} pendingLabel={t("accept.submitting")} />
            ) : (
              <>
                <Notice title={t("accept.signInTitle")}>{t("accept.signInBody")}</Notice>
                <Link href={signInHref} className={buttonClassName({ variant: "primary", block: true })}>
                  {t("accept.signIn")}
                </Link>
              </>
            )}
          </Stack>
        )}
      </main>
    </div>
  );
}
