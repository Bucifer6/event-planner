import { getBusinessProfile } from "@ed/core/bizoccasions";
import { getBusinessView } from "@ed/core/business";
import { Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import biz from "../occasions/biz.module.css";
import { BrandingForm } from "./BrandingForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bizoccasions"))("tabs.branding") };
}

/**
 * P20: the name, the logo and ONE accent colour guests see on the pages of the occasions this
 * business runs — until each occasion is handed over. The business chooses freely; the page
 * only shows what the choice looks like. A lapsed plan keeps what is set and stops changes (P23).
 */
export default async function BusinessBrandingPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("bizoccasions");
  const [view, profile] = await Promise.all([orNotFound(getBusinessView(ctx, businessId)), orNotFound(getBusinessProfile(ctx, businessId))]);
  return (
    <Section title={t("branding.title")} level={2}>
      <div className={biz.narrow}>
        <p className="ed-muted">{t("branding.body")}</p>
        {!profile.canEdit ? <p className="ed-muted">{view.role === "staff" ? t("branding.staffOnly") : profile.lapsed ? t("branding.lapsed") : t("create.notActive")}</p> : null}
        <BrandingForm
          businessId={businessId}
          businessName={view.business.name}
          canEdit={profile.canEdit}
          initial={{ displayName: profile.displayName ?? "", accentColor: profile.accentColor, logoUrl: profile.logoUrl }}
        />
      </div>
    </Section>
  );
}
