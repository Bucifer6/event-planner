import { getBusinessView } from "@ed/core/business";
import { listBusinessListings, MAX_LISTINGS_PER_BUSINESS } from "@ed/core/listings";
import { Notice, PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import styles from "../../../business.module.css";
import { ListingEditor } from "../../_components/ListingEditor";
import { editorPicklists, editorValues } from "../../_components/load-editor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("listings"))("new.title") };
}

/** A new listing (P1). Nothing is public until a moderator approves it (P3). */
export default async function NewListingPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("listings");
  const [view, rows] = await Promise.all([orNotFound(getBusinessView(ctx, businessId)), orNotFound(listBusinessListings(ctx, businessId))]);
  const blocked = view.business.status !== "active" ? "restricted" : view.lapsed ? "lapsed" : rows.length >= MAX_LISTINGS_PER_BUSINESS ? "full" : null;
  return (
    <div className={styles.narrow}>
      <PageHeader level={2} eyebrow={<Link href={`/business/${businessId}`}>{t("back")}</Link>} title={t("new.title")} description={t("new.description")} />
      {blocked ? (
        <Notice tone="attention" title={t(`new.blocked.${blocked}`, { max: MAX_LISTINGS_PER_BUSINESS })} />
      ) : (
        <ListingEditor
          businessId={businessId}
          listingId={null}
          picklists={await editorPicklists(ctx)}
          initial={await editorValues(ctx, null)}
          canEdit
          submitLabel={t("editor.submit")}
        />
      )}
    </div>
  );
}
