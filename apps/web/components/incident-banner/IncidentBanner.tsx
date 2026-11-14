import { getActiveIncident } from "@ed/core/incidents";
import { ExternalLink, Notice } from "@ed/ui";
import { getLocale, getTranslations } from "next-intl/server";
import { getCtx } from "@/lib/ctx";
import { publicUrl } from "./public-url";

/**
 * Plain-language status message for guest-facing pages while an incident is open (LAU5):
 * "Ceva nu funcționează…" with a link to the public status page. Never technical detail.
 * Renders nothing when there is no open incident — and nothing if the check itself fails
 * (a banner must not be what breaks the page).
 *
 *   <IncidentBanner />      // top of g/[token], e/[slug] and sign-in layouts
 */
export async function IncidentBanner() {
  const incident = await getCtx()
    .then((ctx) => getActiveIncident(ctx))
    .catch(() => null);
  if (!incident) return null;
  const [t, locale] = await Promise.all([getTranslations("platform.incident"), getLocale()]);
  return (
    <Notice tone="attention" role="status" title={t("title")}>
      <p>{incident.message ?? t("default")}</p>
      <p>
        <ExternalLink href={publicUrl(locale, "/stare/")}>{t("statusLink")}</ExternalLink>
      </p>
    </Notice>
  );
}
