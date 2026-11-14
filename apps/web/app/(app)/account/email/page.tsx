import { getFreshAuthMethod, isFreshAuth } from "@ed/auth";
import { getOwnAccount } from "@ed/core/accounts";
import { Page, PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { EmailSettings } from "../_components/email-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.email"))("title") };
}

export default async function AccountEmailPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("account");
  const [account, fresh, method] = await Promise.all([getOwnAccount(ctx), isFreshAuth(ctx), getFreshAuthMethod(ctx)]);
  return (
    <Page narrow>
      <PageHeader
        eyebrow={<Link href="/account">{t("back")}</Link>}
        title={t("email.title")}
        description={account.kind === "email" ? t("email.current", { email: account.email ?? "" }) : t("email.currentNone")}
      />
      <EmailSettings fresh={fresh} method={method} kind={account.kind} />
    </Page>
  );
}
