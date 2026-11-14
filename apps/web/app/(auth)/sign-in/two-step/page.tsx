import { Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath, withNext } from "@ed/auth";
import { afterSignInPath, getCurrentSession, SIGN_IN_PATH } from "@/lib/session";
import { TwoStepForm } from "../../_components/two-step-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.twoStep"))("title") };
}

/** S2: shown only to an account that turned two-step on, after its first step. */
export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  const session = await getCurrentSession();
  if (!session) redirect(withNext(SIGN_IN_PATH, next));
  if (!session.secondFactorPending) redirect(afterSignInPath(next));
  const t = await getTranslations("auth.twoStep");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("title")}</h1>
        <Lead>{t("lead")}</Lead>
      </Stack>
      <TwoStepForm next={next ?? undefined} />
      <p>
        <Link href={withNext(SIGN_IN_PATH, next)}>{t("startOver")}</Link>
      </p>
    </Stack>
  );
}
