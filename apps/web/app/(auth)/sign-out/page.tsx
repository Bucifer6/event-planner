import { Lead, Stack, SubmitButton } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { AFTER_SIGN_IN_PATH, resolveActor, SIGN_IN_PATH } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.signOut"))("title") };
}

/** Signing out is a button (POST), never a link: a stray GET must not end a session. */
export default async function SignOutPage() {
  if (!(await resolveActor())) redirect(SIGN_IN_PATH);
  const t = await getTranslations("auth.signOut");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("title")}</h1>
        <Lead>{t("lead")}</Lead>
      </Stack>
      <form action={signOutAction} className="ed-form">
        <SubmitButton pendingLabel={t("pending")} block>
          {t("submit")}
        </SubmitButton>
      </form>
      <p>
        <Link href={AFTER_SIGN_IN_PATH}>{t("stay")}</Link>
      </p>
    </Stack>
  );
}
