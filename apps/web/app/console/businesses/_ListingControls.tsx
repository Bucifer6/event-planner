import { getTranslations } from "next-intl/server";
import { restoreListingAction, suspendListingAction } from "@/app/actions/moderation";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { SpecForm } from "../_components/SpecForm";
import pageStyles from "../moderation/moderation.module.css";

/** W3 for one listing: suspend with a recorded reason, or restore. */
export async function ListingControls({ listingId, status, name }: { listingId: string; status: string; name: string }) {
  const t = await getTranslations("moderation");
  if (status === "retired") return null;
  if (status === "suspended") {
    return (
      <ActionForm
        action={restoreListingAction}
        hidden={{ listingId }}
        refreshOnSuccess
        variant="secondary"
        block={false}
        submitLabel={t("listing.restore")}
        pendingLabel={t("listing.restoring")}
      />
    );
  }
  return (
    <details className={pageStyles.details}>
      <summary>{t("listing.suspendOpen", { name })}</summary>
      <SpecForm
        action={suspendListingAction}
        hidden={{ listingId }}
        fields={[{ kind: "textarea", name: "reason", label: t("reasonLabel"), hint: t("reasonHint"), required: true, maxLength: 2000, rows: 3 }]}
        submitLabel={t("listing.suspend")}
        pendingLabel={t("listing.suspending")}
        variant="danger"
        refreshOnSuccess
      />
    </details>
  );
}
