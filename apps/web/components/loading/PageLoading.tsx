import { Page, Skeleton, Stack, VisuallyHidden } from "@ed/ui";
import { getTranslations } from "next-intl/server";

// Reserves the shape of a page (header, lead, three rows) so nothing jumps when it arrives.
//
// Used as loading.tsx BELOW the layouts that check access (occasions/[id], business/[businessId]),
// never at the root: a loading boundary starts streaming, and a page that has started streaming
// can no longer answer 404 — a stranger opening someone's occasion would get "page not found"
// with status 200. apps/web/test/loading.test.ts keeps it that way.
export async function PageLoading() {
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
