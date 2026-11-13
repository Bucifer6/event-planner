import { Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AFTER_SIGN_IN_PATH, getCurrentSession, SIGN_IN_PATH } from "@/lib/session";
import { TwoStepForm } from "../../_components/two-step-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.twoStep"))("title") };
}

/** S2: shown only to an account that turned two-step on, after its first step. */
export default async function TwoStepPage() {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  if (!session.secondFactorPending) redirect(AFTER_SIGN_IN_PATH);
  const t = await getTranslations("auth.twoStep");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("title")}</h1>
        <Lead>{t("lead")}</Lead>
      </Stack>
      <TwoStepForm />
      <p>
        <Link href={SIGN_IN_PATH}>{t("startOver")}</Link>
      </p>
    </Stack>
  );
}
