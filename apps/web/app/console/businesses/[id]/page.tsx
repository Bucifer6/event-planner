import { getBusinessForConsole } from "@ed/core/business";
import { getListingForConsole } from "@ed/core/listings";
import { listContentReportsForTarget } from "@ed/core/reports";
import { isAppError } from "@ed/shared/errors";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { DescriptionList, Fact, List, Notice, Page, PageHeader, Section, Table, Tag } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordFactCheckAction, setBusinessStatusAction, withdrawFactCheckAction } from "@/app/actions/moderation";
import { NoRole } from "../../_components/NoRole";
import { SpecForm } from "../../_components/SpecForm";
import { requireConsole } from "../../_lib";
import pageStyles from "../../moderation/moderation.module.css";
import { ListingControls } from "../_ListingControls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("moderation"))("businesses.detailTitle") };
}

const orNotFound = async <T,>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });

/**
 * W3 + P4 for one business: its status with the recorded reason (restrict / suspend /
 * restore), the two factual badges with the record of each check, and its listings.
 * `/console/businesses/listing-<id>` shows a single unclaimed listing (it has no business).
 */
export default async function ConsoleBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("moderation");
  const b = await getTranslations("business");
  const d = await getTranslations("directory");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("businesses.title")} roles={["listing_moderator", "platform_admin"]} />;
  const { id } = await params;

  if (id.startsWith("listing-")) {
    const { listing } = await orNotFound(getListingForConsole(ctx, id.slice("listing-".length)));
    if (listing.businessId) notFound();
    return (
      <Page>
        <PageHeader
          eyebrow={<Link href="/console/businesses">{t("businesses.back")}</Link>}
          title={listing.name}
          actions={<Tag tone={listing.status === "live" ? "success" : listing.status === "suspended" ? "danger" : "attention"}>{t(`listingStatus.${listing.status}`)}</Tag>}
        />
        <Section title={d("unclaimed.label")}>
          <DescriptionList
            cols={2}
            items={[
              { term: t("unclaimedDetail.contact"), value: listing.publicContactRoute ?? "—" },
              { term: t("unclaimedDetail.source"), value: listing.sourceUrl ?? "—" },
              { term: t("unclaimedDetail.collected"), value: listing.collectedAt ? formatDate(listing.collectedAt, ctx.locale) : "—" },
            ]}
          />
          {listing.suspensionReason ? <Notice tone="danger" title={t("listing.suspendedReason")}>{listing.suspensionReason}</Notice> : null}
          <ListingControls listingId={listing.id} status={listing.status} name={listing.name} />
        </Section>
      </Page>
    );
  }

  const data = await orNotFound(getBusinessForConsole(ctx, id));
  const { business } = data;
  const reports = await listContentReportsForTarget(ctx, { targetType: "business", targetId: business.id });
  const canCheck = has("listing_moderator");
  const hasOnrc = data.badges.some((x) => x.kind === "onrc");
  const insurance = data.badges.find((x) => x.kind === "insurance");

  return (
    <Page>
      <PageHeader
        eyebrow={<Link href="/console/businesses">{t("businesses.back")}</Link>}
        title={business.name}
        actions={<Tag tone={business.status === "active" ? "success" : "danger"}>{b(`status.${business.status}`)}</Tag>}
      />

      <Section title={t("businesses.about")}>
        <DescriptionList
          cols={2}
          items={[
            { term: t("businesses.owner"), value: data.ownerEmail ?? "—" },
            { term: t("businesses.members"), value: <span className="ed-num">{data.members}</span> },
            { term: t("businesses.onrcNumber"), value: business.onrcRegistration ?? <span className="ed-unknown">{t("businesses.notGiven")}</span> },
            { term: t("businesses.since"), value: formatDate(business.createdAt, ctx.locale) },
            ...(reports.length > 0 ? [{ term: t("businesses.reports"), value: <Link href="/console/reports?state=actioned">{reports.length}</Link> }] : []),
          ]}
        />
      </Section>

      <div className={pageStyles.grid}>
        <Section title={t("status.title")}>
          <p className="ed-muted">{t("status.body")}</p>
          {business.status !== "active" ? (
            <Notice tone="danger" title={t("status.currentReason", { date: business.restrictedAt ? formatDateTime(business.restrictedAt, ctx.locale) : "" })}>
              <span className={pageStyles.reason}>{business.restrictionReason}</span>
            </Notice>
          ) : null}
          <SpecForm
            key={business.status}
            action={setBusinessStatusAction}
            hidden={{ businessId: business.id }}
            fields={[
              {
                kind: "chips",
                name: "status",
                label: t("status.choose"),
                required: true,
                stack: true,
                defaultValue: business.status,
                options: [
                  { value: "active", label: t("status.options.active") },
                  { value: "restricted", label: t("status.options.restricted") },
                  { value: "suspended", label: t("status.options.suspended") },
                ],
              },
              { kind: "textarea", name: "reason", label: t("reasonLabel"), hint: t("reasonHint"), maxLength: 2000, rows: 4 },
            ]}
            submitLabel={t("status.save")}
            pendingLabel={t("status.saving")}
            variant="secondary"
            success={t("status.saved")}
            refreshOnSuccess
          />
        </Section>

        <Section title={t("badges.title")}>
          <p className="ed-muted">{t("badges.body")}</p>
          <List>
            <li className="ed-row">
              <div className="ed-row__main">
                {hasOnrc ? <Fact icon={<IconCheck size={14} />}>{d("badges.onrc")}</Fact> : <span className="ed-row__title">{t("badges.onrcOff")}</span>}
              </div>
            </li>
            <li className="ed-row">
              <div className="ed-row__main">
                {insurance && insurance.kind === "insurance" ? (
                  <Fact icon={<IconCheck size={14} />}>{d("badges.insurance", { date: formatDate(new Date(`${insurance.validUntil}T12:00:00Z`), ctx.locale) })}</Fact>
                ) : (
                  <span className="ed-row__title">{t("badges.insuranceOff")}</span>
                )}
              </div>
            </li>
          </List>
          {canCheck ? (
            <>
              <details className={pageStyles.details}>
                <summary>{hasOnrc ? t("badges.onrcWithdrawOpen") : t("badges.onrcOpen")}</summary>
                {hasOnrc ? (
                  <SpecForm
                    action={withdrawFactCheckAction}
                    hidden={{ businessId: business.id, kind: "onrc" }}
                    fields={[{ kind: "textarea", name: "seen", label: t("badges.withdrawReason"), required: true, maxLength: 1000, rows: 3 }]}
                    submitLabel={t("badges.withdraw")}
                    pendingLabel={t("badges.saving")}
                    variant="danger"
                    refreshOnSuccess
                  />
                ) : (
                  <SpecForm
                    action={recordFactCheckAction}
                    hidden={{ businessId: business.id, kind: "onrc" }}
                    fields={[{ kind: "textarea", name: "seen", label: t("badges.seen"), hint: t("badges.seenOnrcHint"), required: true, maxLength: 1000, rows: 3 }]}
                    submitLabel={t("badges.recordOnrc")}
                    pendingLabel={t("badges.saving")}
                    variant="secondary"
                    refreshOnSuccess
                  />
                )}
              </details>
              <details className={pageStyles.details}>
                <summary>{t("badges.insuranceOpen")}</summary>
                <SpecForm
                  action={recordFactCheckAction}
                  hidden={{ businessId: business.id, kind: "insurance" }}
                  fields={[
                    { kind: "textarea", name: "seen", label: t("badges.seen"), hint: t("badges.seenInsuranceHint"), required: true, maxLength: 1000, rows: 3 },
                    { kind: "date", name: "validUntil", label: t("badges.validUntil"), required: true },
                  ]}
                  submitLabel={t("badges.recordInsurance")}
                  pendingLabel={t("badges.saving")}
                  variant="secondary"
                  refreshOnSuccess
                />
                {insurance ? (
                  <SpecForm
                    action={withdrawFactCheckAction}
                    hidden={{ businessId: business.id, kind: "insurance" }}
                    fields={[{ kind: "textarea", name: "seen", label: t("badges.withdrawReason"), required: true, maxLength: 1000, rows: 3 }]}
                    submitLabel={t("badges.withdrawInsurance")}
                    pendingLabel={t("badges.saving")}
                    variant="danger"
                    refreshOnSuccess
                  />
                ) : null}
              </details>
            </>
          ) : (
            <p className="ed-small ed-muted">{t("badges.moderatorOnly")}</p>
          )}
        </Section>
      </div>

      <Section title={t("businesses.listingsTitle")}>
        {data.listings.length === 0 ? (
          <p className="ed-muted">{t("businesses.noListings")}</p>
        ) : (
          data.listings.map((l) => (
            <div key={l.id} className={pageStyles.block}>
              <div className={pageStyles.forms}>
                <strong>{l.name}</strong>
                <Tag tone={l.status === "live" ? "success" : l.status === "suspended" ? "danger" : "neutral"}>{t(`listingStatus.${l.status}`)}</Tag>
                {l.status === "live" ? <Link href={`/directory/listing/${l.id}`}>{t("listing.viewPublic")}</Link> : null}
              </div>
              {l.suspensionReason ? (
                <p className={pageStyles.reason}>
                  <span className="ed-label">{t("listing.suspendedReason")}</span> {l.suspensionReason}
                </p>
              ) : null}
              <ListingControls listingId={l.id} status={l.status} name={l.name} />
            </div>
          ))
        )}
      </Section>

      <Section title={t("badges.history")}>
        {data.factChecks.length === 0 ? (
          <p className="ed-muted">{t("badges.noHistory")}</p>
        ) : (
          <Table caption={t("badges.history")}>
            <thead>
              <tr>
                <th scope="col">{t("badges.when")}</th>
                <th scope="col">{t("badges.what")}</th>
                <th scope="col">{t("badges.seen")}</th>
                <th scope="col">{t("badges.validUntil")}</th>
              </tr>
            </thead>
            <tbody>
              {data.factChecks.map((f) => (
                <tr key={f.id}>
                  <td className="ed-num">{formatDateTime(f.checkedAt, ctx.locale)}</td>
                  <td>{t(`badges.kinds.${f.kind}_${f.outcome}`)}</td>
                  <td>{f.seen}</td>
                  <td className="ed-num">{f.validUntil ? formatDate(new Date(`${f.validUntil}T12:00:00Z`), ctx.locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  );
}
