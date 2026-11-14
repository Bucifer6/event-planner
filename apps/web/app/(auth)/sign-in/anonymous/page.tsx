import { GiltRule, Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { anonymousSignIn } from "@/app/actions/auth";
import { safeNextPath, withNext } from "@ed/auth";
import { afterSignInPath, resolveActor, SIGN_IN_PATH } from "@/lib/session";
import { ActionForm } from "../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.anonymous"))("signInTitle") };
}

/** S8: sign in to an anonymous account with its username and password. */
export default async function AnonymousSignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await resolveActor()) redirect(afterSignInPath(next));
  const t = await getTranslations("auth.anonymous");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("signInTitle")}</h1>
        <Lead>{t("signInLead")}</Lead>
      </Stack>
      <ActionForm
        action={anonymousSignIn}
        hidden={next ? { next } : undefined}
        fields={[
          { name: "username", label: t("usernameLabel"), hint: t("usernameHint"), autoComplete: "username", maxLength: 100 },
          { name: "password", label: t("passwordFieldLabel"), type: "password", autoComplete: "current-password", maxLength: 200 },
        ]}
        submitLabel={t("signIn")}
        pendingLabel={t("signingIn")}
      />
      <GiltRule />
      <Stack gap={2}>
        <p>
          {t("noAccountYet")} <Link href={withNext("/sign-in/anonymous/new", next)}>{t("createLink")}</Link>
        </p>
        <p>
          {t("lostPassword")} <Link href={withNext("/sign-in/anonymous/recover", next)}>{t("recoverLink")}</Link>
        </p>
        <p>
          <Link href={withNext(SIGN_IN_PATH, next)}>{t("backToEmail")}</Link>
        </p>
      </Stack>
    </Stack>
  );
}
