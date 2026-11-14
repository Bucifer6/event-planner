import { getBusinessView } from "@ed/core/business";
import { formatDate } from "@ed/i18n/format";
import { DescriptionList, Fact, Section } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { saveBusinessSettings } from "@/app/actions/business";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "../../business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("business"))("tabs.settings") };
}

/** Business details, the two switches a business controls (P31 hide, P32 nudge) and its factual badges (P4). */
export default async function BusinessSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const d = await getTranslations("directory.badges");
  const c = await getTranslations("common");
  const { business, role, badges } = await orNotFound(getBusinessView(ctx, businessId));
  const manage = role !== "staff";

  return (
    <div className={styles.narrow}>
      <Section title={t("settings.detailsTitle")} level={2}>
        {manage ? (
          <SpecForm
            action={saveBusinessSettings}
            hidden={{ businessId }}
            fields={[
              { kind: "text", name: "name", label: t("fields.name"), hint: t("fields.nameHint"), required: true, maxLength: 120, defaultValue: business.name },
              {
                kind: "text",
                name: "onrcRegistration",
                label: t("fields.onrc"),
                hint: t("fields.onrcChangeHint"),
                maxLength: 40,
                optionalLabel: c("optional"),
                defaultValue: business.onrcRegistration ?? "",
                placeholder: "J12/345/2020",
              },
              { kind: "check", name: "nudge48h", label: t("settings.nudge"), hint: t("settings.nudgeHint"), defaultChecked: business.nudge48h },
              { kind: "check", name: "hideStats", label: t("settings.hideStats"), hint: t("settings.hideStatsHint"), defaultChecked: business.hideStats },
            ]}
            submitLabel={t("settings.save")}
            pendingLabel={t("settings.saving")}
            success={t("settings.saved")}
            refreshOnSuccess
          />
        ) : (
          <DescriptionList
            items={[
              { term: t("fields.name"), value: business.name },
              { term: t("fields.onrc"), value: business.onrcRegistration ?? <span className="ed-unknown">{c("unknown")}</span> },
            ]}
          />
        )}
      </Section>

      <Section title={t("badges.title")} level={2}>
        <p className="ed-muted">{t("badges.body")}</p>
        {badges.length > 0 ? (
          <ul className={styles.plainList}>
            {badges.map((b) => (
              <li key={b.kind}>
                <Fact icon={<IconCheck size={14} />}>
                  {b.kind === "onrc" ? d("onrc") : d("insurance", { date: formatDate(new Date(`${b.validUntil}T12:00:00Z`), ctx.locale) })}
                </Fact>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ed-small">{t("badges.none")}</p>
        )}
        <p className="ed-small ed-muted">{t("badges.how")}</p>
      </Section>
    </div>
  );
}
