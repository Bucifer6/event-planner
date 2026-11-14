"use client";

import { buttonClassName, Notice, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { deleteAccount, undoDeleteAccount } from "@/app/actions/account";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { FreshGate } from "./fresh-gate";

type Props = {
  fresh: boolean;
  method: "email_code" | "recovery_code";
  /** Formatted end of the undo window when a deletion is pending. */
  undoUntil: string | null;
};

/** D6: delete the account with seven days to undo. */
export function DeleteSettings({ fresh, method, undoUntil }: Props) {
  const t = useTranslations("account.delete");
  if (undoUntil) {
    return (
      <Stack gap={4}>
        <Notice tone="attention" title={t("pendingTitle")}>
          {t("pendingBody", { date: undoUntil })}
        </Notice>
        <ActionForm
          action={undoDeleteAccount}
          refreshOnSuccess
          submitLabel={t("undo")}
          pendingLabel={t("undoing")}
        />
      </Stack>
    );
  }
  if (!fresh) return <FreshGate method={method} />;
  return (
    <Stack gap={3}>
      <ActionForm
        action={deleteAccount}
        refreshOnSuccess
        variant="danger"
        submitLabel={t("submit")}
        pendingLabel={t("submitting")}
      />
      <Link href="/account" className={buttonClassName({ block: true })}>
        {t("keep")}
      </Link>
    </Stack>
  );
}
