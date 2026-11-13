import { getFreshAuthMethod, isFreshAuth } from "@ed/auth";
import { getOwnAccount } from "@ed/core/accounts";
import { DELETION_UNDO_DAYS, RETAINED_AFTER_DELETION } from "@ed/core/deletion";
import { formatDateTime } from "@ed/i18n/format";
import { Card, Page, PageHeader, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { DeleteSettings } from "../_components/delete-settings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.delete"))("title") };
}

/** D6: what deletion does, the seven-day undo, and what is kept and why — before the button. */
export default async function AccountDeletePage() {
  const ctx = await requireCtx();
  const t = await getTranslations("account");
  const [account, fresh, method] = await Promise.all([getOwnAccount(ctx), isFreshAuth(ctx), getFreshAuthMethod(ctx)]);
  return (
    <Page narrow>
      <PageHeader
        eyebrow={<Link href="/account">{t("back")}</Link>}
        title={t("delete.title")}
        description={t("delete.description", { days: DELETION_UNDO_DAYS })}
      />
      <Section title={t("delete.whatHappensTitle")}>
        <ul className="ed-prose">
          <li>{t("delete.happensUndo", { days: DELETION_UNDO_DAYS })}</li>
          <li>{t("delete.happensGone")}</li>
          <li>{t("delete.happensTokens")}</li>
        </ul>
      </Section>
      <Section title={t("delete.retainedTitle")}>
        <Card>
          <Stack gap={2}>
            <p>{t("delete.retainedIntro")}</p>
            <ul className="ed-prose">
              <li>{t("delete.retainedReceipts", { years: RETAINED_AFTER_DELETION.receiptsYears })}</li>
              <li>{t("delete.retainedObjections", { years: RETAINED_AFTER_DELETION.objectionRecordsYears })}</li>
              <li>{t("delete.retainedAudit", { years: RETAINED_AFTER_DELETION.auditYears })}</li>
            </ul>
          </Stack>
        </Card>
      </Section>
      <DeleteSettings
        fresh={fresh}
        method={method}
        undoUntil={account.deletion ? formatDateTime(account.deletion.undoUntil, ctx.locale) : null}
      />
    </Page>
  );
}
