import { getFreshAuthMethod } from "@ed/auth";
import { isManager } from "@ed/core/access";
import { isFreshAuth } from "@ed/core/accounts";
import { DELETION_UNDO_DAYS, RETAINED_AFTER_DELETION } from "@ed/core/deletion";
import { getOccasionView } from "@ed/core/occasions";
import { instantToDay } from "@ed/core/templates";
import { formatDateTime } from "@ed/i18n/format";
import { Card, Notice, PageHeader, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FreshGate } from "@/app/(app)/account/_components/fresh-gate";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { LifecycleSections } from "./lifecycle/Lifecycle";
import { DeleteOccasion, DetailsForm, MoveDateForm } from "./SettingsForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("occasions"))("settings.title") };
}

/** Details and brief, moving the date (as a preview), and deletion with its seven-day undo. */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("occasions");
  const [{ occasion, member, deletion }, fresh, method] = await Promise.all([
    orNotFound(getOccasionView(ctx, id)),
    isFreshAuth(ctx),
    getFreshAuthMethod(ctx),
  ]);
  const tz = occasion.timezone;

  if (!isManager(member)) {
    return (
      <>
        <PageHeader level={2} title={t("settings.title")} />
        <Notice title={t("settings.readOnlyTitle")}>{t("settings.readOnlyBody")}</Notice>
      </>
    );
  }

  return (
    <div style={{ maxWidth: "var(--page-narrow)" }}>
      <PageHeader level={2} title={t("settings.title")} description={t("settings.description")} />

      <Section title={t("settings.detailsTitle")} level={3}>
        <DetailsForm
          occasionId={id}
          initial={{
            title: occasion.title,
            venueName: occasion.venueName ?? "",
            venueAddress: occasion.venueAddress ?? "",
            purpose: occasion.purpose ?? "",
            priorities: occasion.priorities,
          }}
        />
      </Section>

      <Section title={t("move.title")} level={3} id="date">
        <p style={{ maxWidth: "var(--measure)" }}>{t("move.intro")}</p>
        <MoveDateForm
          occasionId={id}
          mode={occasion.dateMode}
          startsOn={occasion.startsAt ? instantToDay(occasion.startsAt, tz) : ""}
          endsOn={occasion.endsAt ? instantToDay(occasion.endsAt, tz) : ""}
        />
      </Section>

      <LifecycleSections occasion={occasion} locale={ctx.locale} now={ctx.now} fresh={fresh} freshGate={<FreshGate method={method} />} />

      {member.role === "owner" ? (
        <Section title={t("deletion.title")} level={3} id="delete">
          {deletion ? (
            <Notice tone="attention" title={t("deletion.bannerTitle")}>
              {t("deletion.pendingHere", { date: formatDateTime(deletion.undoUntil, ctx.locale) })}
            </Notice>
          ) : (
            <Stack gap={4}>
              <p style={{ maxWidth: "var(--measure)" }}>{t("deletion.intro", { days: DELETION_UNDO_DAYS })}</p>
              <Card>
                <Stack gap={2}>
                  <p>{t("deletion.retainedIntro")}</p>
                  <ul className="ed-prose">
                    <li>{t("deletion.retainedReceipts", { years: RETAINED_AFTER_DELETION.receiptsYears })}</li>
                    <li>{t("deletion.retainedObjections", { years: RETAINED_AFTER_DELETION.objectionRecordsYears })}</li>
                    <li>{t("deletion.retainedAudit", { years: RETAINED_AFTER_DELETION.auditYears })}</li>
                  </ul>
                </Stack>
              </Card>
              {fresh ? (
                <div>
                  <DeleteOccasion occasionId={id} title={occasion.title} days={DELETION_UNDO_DAYS} />
                </div>
              ) : (
                <Stack gap={4}>
                  <Notice title={t("deletion.freshTitle")}>
                    {t("deletion.freshBody")} <Link href="/account#fresh">{t("deletion.freshLink")}</Link>
                  </Notice>
                  <FreshGate method={method} />
                </Stack>
              )}
            </Stack>
          )}
        </Section>
      ) : null}
    </div>
  );
}
