import { buttonClassName, Notice, PageHeader, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { consoleAccess } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.setup"))("title") };
}

/**
 * What a staff member sees while they cannot enter the console yet (S5): two-step sign-in is
 * off, or this sign-in cannot carry a console session. It explains what to do and shows
 * nothing of the console itself.
 */
export default async function ConsoleSetupPage() {
  const access = await consoleAccess();
  if (access.state === "not_staff") notFound();
  if (access.state === "ok") redirect("/console");
  const t = await getTranslations("console.setup");

  if (access.state === "two_step_required") {
    return (
      <Stack gap={4}>
        <PageHeader title={t("title")} description={t("twoStep.lead")} />
        <Notice tone="attention" title={t("twoStep.title")}>
          {t("twoStep.body")}
        </Notice>
        <ol className="ed-prose">
          <li>{t("twoStep.step1")}</li>
          <li>{t("twoStep.step2")}</li>
          <li>{t("twoStep.step3")}</li>
        </ol>
        <div>
          <Link href="/account/security" className={buttonClassName({ variant: "primary" })}>
            {t("twoStep.action")}
          </Link>
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <PageHeader title={t("title")} description={t(`again.${access.reason}.lead`)} />
      <Notice tone="attention" title={t(`again.${access.reason}.title`)}>
        {t(`again.${access.reason}.body`)}
      </Notice>
      <div>
        <Link href="/sign-out" className={buttonClassName({ variant: "primary" })}>
          {t("again.action")}
        </Link>
      </div>
      <p className="ed-small ed-muted">{t("again.note")}</p>
    </Stack>
  );
}
