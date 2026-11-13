import { GiltRule, Lead, Notice, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AFTER_SIGN_IN_PATH, resolveActor } from "@/lib/session";
import { LegalLine } from "../_components/legal";
import { SignInFlow } from "../_components/sign-in-flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.signIn"))("title") };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await resolveActor()) redirect(AFTER_SIGN_IN_PATH);
  const t = await getTranslations("auth");
  const { e } = await searchParams;
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("signIn.title")}</h1>
        <Lead>{t("signIn.lead")}</Lead>
      </Stack>
      {e === "limited" ? <Notice tone="attention">{t("errors.tooManyTries")}</Notice> : null}
      <SignInFlow />
      <LegalLine />
      <GiltRule />
      <p>
        {t("signIn.noEmail")} <Link href="/sign-in/anonymous">{t("signIn.anonymousLink")}</Link>
      </p>
    </Stack>
  );
}
