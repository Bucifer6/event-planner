import { GiltRule, Lead, Notice, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSignupOpen, safeNextPath, withNext } from "@ed/auth";
import { getCtx } from "@/lib/ctx";
import { afterSignInPath, resolveActor } from "@/lib/session";
import { LegalLine } from "../_components/legal";
import { SignInFlow } from "../_components/sign-in-flow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.signIn"))("title") };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next: rawNext } = await searchParams;
  // the return path (an invitation, a claim, an enquiry button): safe same-origin paths only
  const next = safeNextPath(rawNext);
  if (await resolveActor()) redirect(afterSignInPath(next));
  const t = await getTranslations("auth");
  // LAU1: before the legal documents are published only existing accounts can sign in
  const signupOpen = await isSignupOpen(await getCtx());
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("signIn.title")}</h1>
        <Lead>{signupOpen ? t("signIn.lead") : t("signIn.leadExisting")}</Lead>
      </Stack>
      {e === "limited" ? <Notice tone="attention">{t("errors.tooManyTries")}</Notice> : null}
      {e === "closed" ? <Notice tone="attention">{t("errors.signupsClosed")}</Notice> : null}
      {!signupOpen && e !== "closed" ? <Notice title={t("signIn.closedTitle")}>{t("signIn.closedBody")}</Notice> : null}
      {next ? <p className="ed-small ed-muted">{t("signIn.returnNote")}</p> : null}
      <SignInFlow next={next ?? undefined} />
      <LegalLine />
      <GiltRule />
      <p>
        {t("signIn.noEmail")} <Link href={withNext("/sign-in/anonymous", next)}>{t("signIn.anonymousLink")}</Link>
      </p>
    </Stack>
  );
}
