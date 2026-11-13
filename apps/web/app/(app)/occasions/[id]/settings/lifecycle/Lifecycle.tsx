import type { Occasion } from "@ed/core/occasions";
import { instantToDay, shiftDay } from "@ed/core/templates";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, Notice, Section, Stack } from "@ed/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { CancelForm, PostponeForm } from "./LifecycleForms";

/**
 * Lifecycle sections of the settings page (B9, B10): postpone and cancel — two clearly
 * separate actions, each opening a What-if preview — and the way into closeout.
 * Rendered for owners and project managers only (the settings page checks).
 * `freshGate` is shown instead of the forms until the person has confirmed recently (S4).
 */
export async function LifecycleSections({ occasion, locale, now, fresh, freshGate }: { occasion: Occasion; locale: "ro" | "en"; now: Date; fresh: boolean; freshGate: ReactNode }) {
  const t = await getTranslations("lifecycle.settings");
  const tz = occasion.timezone;
  const live = occasion.status === "planning" || occasion.status === "postponed";
  const tomorrow = shiftDay(instantToDay(now, tz), { days: 1 });
  const gate = (
    <Stack gap={4}>
      <Notice title={t("freshTitle")}>
        {t("freshBody")} <Link href="/account#fresh">{t("freshLink")}</Link>
      </Notice>
      {freshGate}
    </Stack>
  );

  return (
    <>
      {live ? (
        <>
          <Section title={t("postponeTitle")} level={3} id="postpone">
            <Stack gap={4}>
              <p style={{ maxWidth: "var(--measure)" }}>{t("postponeIntro")}</p>
              <p className="ed-muted">{occasion.startsAt ? t("currentDate", { date: formatDate(occasion.startsAt, locale, tz) }) : t("noDate")}</p>
              {fresh ? <PostponeForm occasionId={occasion.id} min={tomorrow} /> : gate}
            </Stack>
          </Section>
          <Section title={t("cancelTitle")} level={3} id="cancel">
            <Stack gap={4}>
              <p style={{ maxWidth: "var(--measure)" }}>{t("cancelIntro")}</p>
              {/* one confirmation gate is enough on the page: it sits in the section above */}
              {fresh ? <CancelForm occasionId={occasion.id} /> : null}
            </Stack>
          </Section>
        </>
      ) : (
        <Section title={t("postponeTitle")} level={3} id="postpone">
          <Notice>{occasion.status === "closed" ? t("alreadyClosed") : t("alreadyCancelled")}</Notice>
        </Section>
      )}
      <Section title={t("closeoutTitle")} level={3} id="closeout">
        <Stack gap={3}>
          <p style={{ maxWidth: "var(--measure)" }}>{t("closeoutIntro")}</p>
          <div>
            <Link href={`/occasions/${occasion.id}/settings/closeout`} className={buttonClassName()}>
              {t("closeoutLink")}
            </Link>
          </div>
        </Stack>
      </Section>
    </>
  );
}
