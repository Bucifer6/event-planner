import { EmptyState, LinkButton, Page } from "@ed/ui";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("platform.notFound");
  return (
    <Page narrow>
      <EmptyState title={t("title")} action={<LinkButton variant="primary" href="/">{t("home")}</LinkButton>}>
        {t("body")}
      </EmptyState>
    </Page>
  );
}
