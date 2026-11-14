import { Page, Skeleton, Stack, VisuallyHidden } from "@ed/ui";
import { getTranslations } from "next-intl/server";

// Reserves the shape of a page (header, lead, three rows) so nothing jumps when it arrives.
export default async function Loading() {
  const t = await getTranslations("platform.loading");
  return (
    <Page>
      <div role="status" aria-busy="true">
        <VisuallyHidden>{t("label")}</VisuallyHidden>
        <Stack gap={4}>
          <Stack gap={2}>
            <Skeleton width={120} height={12} />
            <Skeleton width="60%" height={36} />
            <Skeleton width="80%" />
          </Stack>
          <Stack gap={3}>
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </Stack>
        </Stack>
      </div>
    </Page>
  );
}
