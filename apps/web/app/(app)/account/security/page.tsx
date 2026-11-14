import { getFreshAuthMethod, getTwoStepStatus, isFreshAuth } from "@ed/auth";
import { getOwnAccount } from "@ed/core/accounts";
import { Page, PageHeader, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { TwoStepSettings } from "../_components/two-step-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.twoStep"))("title") };
}

export default async function AccountSecurityPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("account");
  const [account, status, fresh, method] = await Promise.all([
    getOwnAccount(ctx),
    getTwoStepStatus(ctx),
    isFreshAuth(ctx),
    getFreshAuthMethod(ctx),
  ]);
  return (
    <Page narrow>
      <PageHeader
        eyebrow={<Link href="/account">{t("back")}</Link>}
        title={t("twoStep.title")}
        description={t("twoStep.description")}
        actions={<Tag tone={status.totpEnabled ? "success" : "neutral"}>{status.totpEnabled ? t("twoStep.stateOn") : t("twoStep.stateOff")}</Tag>}
      />
      <TwoStepSettings
        fresh={fresh}
        method={method}
        enabled={status.totpEnabled}
        anonymous={account.kind === "anonymous"}
        codesLeft={status.recoveryCodesLeft}
        codeEndings={status.recoveryCodeEndings}
      />
    </Page>
  );
}
