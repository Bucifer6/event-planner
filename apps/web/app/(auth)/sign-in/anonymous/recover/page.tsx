import { safeNextPath, withNext } from "@ed/auth";
import { Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { anonymousRecover } from "@/app/actions/auth";
import { ActionForm } from "../../../_components/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.anonymous"))("recoverTitle") };
}

/** S8: lost password — username + one recovery code + a new password. */
export default async function AnonymousRecoverPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  const t = await getTranslations("auth.anonymous");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("recoverTitle")}</h1>
        <Lead>{t("recoverLead")}</Lead>
      </Stack>
      <ActionForm
        action={anonymousRecover}
        hidden={next ? { next } : undefined}
        fields={[
          { name: "username", label: t("usernameLabel"), hint: t("usernameHint"), autoComplete: "username", maxLength: 100 },
          { name: "recoveryCode", label: t("recoveryCodeLabel"), hint: t("recoveryCodeHint"), autoComplete: "off", maxLength: 40 },
          { name: "newPassword", label: t("newPasswordLabel"), hint: t("passwordHint"), type: "password", autoComplete: "new-password", maxLength: 200 },
        ]}
        submitLabel={t("recover")}
        pendingLabel={t("recovering")}
      />
      <p>
        <Link href={withNext("/sign-in/anonymous", next)}>{t("backToAnonymous")}</Link>
      </p>
    </Stack>
  );
}
