import "@ed/core/catalogues"; // registers the "catalogue" moderation kind
import { getBusinessView } from "@ed/core/business";
import { listBusinessCatalogues, listFloralListings, MAX_CATALOGUES_PER_BUSINESS } from "@ed/core/catalogues";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, List, Notice, Section, SheetTrigger, Tag, type Tone } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createCatalogueAction } from "@/app/actions/catalogues";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "./catalogues.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("catalogues"))("title") };
}

const STATE_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success", retired: "neutral" };

/**
 * F1/F2: the business's flower catalogues. Each one shows what is public and what waits for
 * a moderator — the live version stays up while an edit is being checked.
 */
export default async function CataloguesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ retired?: string }> }) {
  const [{ businessId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("catalogues");
  const [view, rows, floral] = await Promise.all([
    orNotFound(getBusinessView(ctx, businessId)),
    orNotFound(listBusinessCatalogues(ctx, businessId)),
    orNotFound(listFloralListings(ctx, businessId)),
  ]);
  const base = `/business/${businessId}`;
  const canAdd = view.business.status === "active" && !view.lapsed && floral.length > 0 && rows.length < MAX_CATALOGUES_PER_BUSINESS;
  const addForm = (
    <SpecForm
      action={createCatalogueAction}
      hidden={{ businessId }}
      fields={[
        { kind: "text", name: "name", label: t("list.name"), hint: t("list.nameHint"), required: true, maxLength: 120 },
        { kind: "select", name: "listingId", label: t("list.listingField"), required: true, defaultValue: floral[0]?.id, options: floral.map((l) => ({ value: l.id, label: l.name })) },
      ]}
      submitLabel={t("list.create")}
      pendingLabel={t("list.creating")}
      block
    />
  );

  return (
    <Section
      title={t("title")}
      level={2}
      actions={
        canAdd && rows.length > 0 ? (
          <SheetTrigger label={t("list.add")} title={t("list.newTitle")} closeLabel={t("list.close")} variant="primary" icon={<IconPlus size={18} />}>
            {addForm}
          </SheetTrigger>
        ) : undefined
      }
    >
      <p className="ed-muted">{t("description")}</p>
      {sp.retired ? <Notice tone="success" title={t("editor.retired")} /> : null}

      {floral.length === 0 && rows.length === 0 ? (
        <EmptyState
          title={t("list.noFloralTitle")}
          action={
            <Link href={base} className={buttonClassName({ variant: "secondary" })}>
              {t("list.noFloralAction")}
            </Link>
          }
        >
          {t("list.noFloralBody")}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          action={
            canAdd ? (
              <SheetTrigger label={t("list.addFirst")} title={t("list.newTitle")} closeLabel={t("list.close")} variant="primary">
                {addForm}
              </SheetTrigger>
            ) : undefined
          }
        >
          {t("list.emptyBody")}
        </EmptyState>
      ) : (
        <List>
          {rows.map(({ catalogue, listingName, liveItems, pendingSince, hasDraft, lastRejectionReason }) => (
            <li key={catalogue.id} className="ed-row">
              <div className="ed-row__main">
                <Link href={`${base}/catalogues/${catalogue.id}`} className={`${styles.name} ${styles.rowLink}`} aria-label={t("list.openNamed", { name: catalogue.name })}>
                  {catalogue.name}
                </Link>
                <span className="ed-row__meta">
                  {t("list.listing", { name: listingName })} · {t("list.items", { count: liveItems })}
                  {pendingSince ? ` · ${t("list.pendingSince", { date: formatDate(pendingSince, ctx.locale) })}` : ""}
                </span>
              </div>
              <div className={`ed-row__end ${styles.tags}`}>
                <Tag tone={STATE_TONE[catalogue.state]}>{t(`states.${catalogue.state}`)}</Tag>
                {catalogue.state === "live" && pendingSince ? <Tag tone="attention">{t("states.editPending")}</Tag> : null}
                {hasDraft && catalogue.state !== "draft" ? <Tag>{t("states.unsent")}</Tag> : null}
                {lastRejectionReason ? <Tag tone="danger">{t("states.rejected")}</Tag> : null}
              </div>
            </li>
          ))}
        </List>
      )}
    </Section>
  );
}
