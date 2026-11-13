import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { CONTENT_REPORT_REASONS } from "@ed/core/reports";
import { ExternalLink, Lead, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReportForm } from "./ReportForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("report"))("title") };
}

function publicUrl(path: string): string {
  return `${(process.env.PUBLIC_URL ?? "http://localhost:3001").replace(/\/+$/, "")}${path}`;
}

/**
 * LAU8 (Digital Services Act notice-and-action): anyone can report illegal content or an
 * unlawful listing, without an account. In-app "report" links may pre-fill the form:
 * /report?ref=<url or name>&type=listing&id=<listing id>.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ ref?: string; type?: string; id?: string }> }) {
  const t = await getTranslations("report");
  const sp = await searchParams;
  const clean = (v: string | undefined, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const type = /^[a-z][a-z_]{0,59}$/.test(sp.type ?? "") ? sp.type! : "";
  return (
    <Stack gap={5}>
      <Stack gap={3}>
        <h1 className="ed-display">{t("title")}</h1>
        <Lead>{t("lead")}</Lead>
        <p>
          {t.rich("rules", {
            link: (chunks) => <ExternalLink href={publicUrl("/ro/reguli-moderare")}>{chunks}</ExternalLink>,
          })}
        </p>
      </Stack>
      <Section title={t("next.title")} level={2}>
        <ol className="ed-prose">
          <li>{t("next.step1")}</li>
          <li>{t("next.step2")}</li>
          <li>{t("next.step3")}</li>
        </ol>
      </Section>
      <Section title={t("form.title")} level={2}>
        <ReportForm
          categories={[...CONTENT_REPORT_REASONS]}
          prefill={{ targetRef: clean(sp.ref, 500), targetType: type, targetId: type ? clean(sp.id, 64) : "" }}
          honeypot={{ name: HONEYPOT_FIELD, stampName: FORM_STAMP_FIELD, stamp: issueFormStamp() }}
        />
        <p className="ed-small ed-muted">{t("privacy")}</p>
      </Section>
    </Stack>
  );
}
