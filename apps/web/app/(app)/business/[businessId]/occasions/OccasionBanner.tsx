import { getBusinessOccasionContext } from "@ed/core/bizoccasions";
import type { Ctx } from "@ed/core/context";
import { listOccasionLibraryFiles } from "@ed/core/library";
import { buttonClassName, ExternalLink, Notice, Stack } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { takeBusinessSeatAction } from "@/app/actions/bizoccasions";
import { ActionForm } from "@/app/(auth)/_components/forms";
import biz from "./biz.module.css";

/**
 * RELEASE P (P17, P19, P22): what the occasion frame shows about a business.
 *  - On an occasion a business runs: who runs it; for a team member, the way to take a seat
 *    (so tasks can be assigned to them) and, for the owner/admin, the entry to the handover.
 *  - Files the business shared into the occasion — shown to every member for as long as the
 *    occasion exists, also after a plan lapse and after the handover (invariant 8).
 * Returns null when there is nothing to show (every ordinary occasion).
 */
export async function businessOccasionBanner(ctx: Ctx, occasionId: string): Promise<ReactNode | null> {
  const [info, files] = await Promise.all([getBusinessOccasionContext(ctx, occasionId), listOccasionLibraryFiles(ctx, occasionId)]);
  if (!info && files.length === 0) return null;
  const t = await getTranslations("bizoccasions");
  return (
    <>
      {info ? (
        <Notice title={t("banner.title", { business: info.businessName })} role="status">
          <Stack gap={3}>
            <span>{info.viaTeam ? t("banner.team") : t("banner.client")}</span>
            {info.viaTeam && !info.hasSeat ? (
              <ActionForm action={takeBusinessSeatAction} hidden={{ occasionId }} refreshOnSuccess variant="secondary" block={false} submitLabel={t("banner.join")} pendingLabel={t("banner.joining")}>
                <span className="ed-small ed-muted">{t("banner.joinHint")}</span>
              </ActionForm>
            ) : null}
            {info.canHandOver ? (
              <span>
                <Link href={`/business/${info.businessId}/occasions/${occasionId}#handover`} className={buttonClassName({ variant: "quiet" })}>
                  {t("banner.handover")}
                </Link>
              </span>
            ) : null}
          </Stack>
        </Notice>
      ) : null}
      {files.length > 0 ? (
        <details>
          <summary className={biz.summary}>{t("banner.files", { count: files.length })}</summary>
          <ul>
            {files.map((f) => (
              <li key={f.id}>{f.url ? <ExternalLink href={f.url}>{f.title}</ExternalLink> : f.title}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
