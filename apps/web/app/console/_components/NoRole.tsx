import type { StaffRole } from "@ed/core/staff";
import { Notice, Page, PageHeader } from "@ed/ui";
import { getTranslations } from "next-intl/server";

/** Shown when a staff member opens a section their roles do not cover. */
export async function NoRole({ title, roles }: { title: string; roles: StaffRole[] }) {
  const t = await getTranslations("console");
  return (
    <Page>
      <PageHeader title={title} />
      <Notice tone="attention" title={t("noRole.title")}>
        {t("noRole.body", { roles: roles.map((r) => t(`roles.${r}`)).join(", ") })}
      </Notice>
    </Page>
  );
}
