import { ExternalLink, Stack } from "@ed/ui";
import { getLocale, getTranslations } from "next-intl/server";

/** Legal documents live on the public site (PUBLIC_URL), in both languages. */
export async function legalUrl(doc: "termeni" | "confidentialitate" | "cookies"): Promise<string> {
  const base = (process.env.PUBLIC_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  return `${base}/${await getLocale()}/${doc}`;
}

/** LAU1: the terms and the privacy policy are linked before any account can be created. */
export async function LegalLine() {
  const t = await getTranslations("auth.legal");
  const [terms, privacy, cookies] = await Promise.all([
    legalUrl("termeni"),
    legalUrl("confidentialitate"),
    legalUrl("cookies"),
  ]);
  return (
    <Stack gap={2}>
      <p className="ed-small ed-muted">
        {t.rich("agree", {
          terms: (chunks) => <ExternalLink href={terms}>{chunks}</ExternalLink>,
          privacy: (chunks) => <ExternalLink href={privacy}>{chunks}</ExternalLink>,
        })}
      </p>
      <p className="ed-small ed-muted">
        {t.rich("deviceCookie", {
          cookies: (chunks) => <ExternalLink href={cookies}>{chunks}</ExternalLink>,
        })}
      </p>
    </Stack>
  );
}
