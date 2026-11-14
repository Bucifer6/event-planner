import { getOwnAccount } from "@ed/core/accounts";
import { listMyBusinesses } from "@ed/core/business";
import { buttonClassName, List, Notice, Page, PageHeader, Row, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createBusinessAction } from "@/app/actions/business";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import { HelpLink } from "@/components/help/HelpLink";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("business"))("title") };
}

/**
 * "Afacerea mea" (P1). Someone without a business sees what listing means and the one form
 * that creates it; a member of one business goes straight to it. Everything is free: there
 * is no plan, price or card anywhere (MON1).
 */
export default async function BusinessHomePage() {
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const c = await getTranslations("common");
  const mine = await listMyBusinesses(ctx);
  if (mine.length === 1) redirect(`/business/${mine[0]!.business.id}`);

  if (mine.length > 1) {
    return (
      <Page narrow>
        <PageHeader eyebrow={t("eyebrow")} title={t("choose.title")} description={t("choose.description")} />
        <List>
          {mine.map(({ business, role }) => (
            <Row
              key={business.id}
              title={business.name}
              meta={t(`roles.${role}`)}
              end={
                <>
                  {business.status !== "active" ? <Tag tone="danger">{t(`status.${business.status}`)}</Tag> : null}
                  <Link href={`/business/${business.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("choose.openNamed", { name: business.name })}>
                    {t("choose.open")}
                  </Link>
                </>
              }
            />
          ))}
        </List>
      </Page>
    );
  }

  const account = await getOwnAccount(ctx);
  return (
    <Page narrow>
      <PageHeader eyebrow={t("eyebrow")} title={t("start.title")} description={t("start.description")} />
      <HelpLink topic="business" />
      <Section title={t("start.howTitle")}>
        <ol className="ed-prose">
          <li>{t("start.step1")}</li>
          <li>{t("start.step2")}</li>
          <li>{t("start.step3")}</li>
        </ol>
      </Section>
      <Section title={t("start.formTitle")}>
        {account.kind === "email" ? (
          <SpecForm
            action={createBusinessAction}
            fields={[
              { kind: "text", name: "name", label: t("fields.name"), hint: t("fields.nameHint"), required: true, maxLength: 120 },
              { kind: "text", name: "onrcRegistration", label: t("fields.onrc"), hint: t("fields.onrcHint"), maxLength: 40, optionalLabel: c("optional"), placeholder: "J12/345/2020" },
            ]}
            submitLabel={t("start.submit")}
            pendingLabel={t("start.submitting")}
          />
        ) : (
          <Notice tone="attention" title={t("start.emailRequiredTitle")}>
            {t("start.emailRequiredBody")} <Link href="/account/email">{t("start.emailRequiredLink")}</Link>
          </Notice>
        )}
      </Section>
    </Page>
  );
}
