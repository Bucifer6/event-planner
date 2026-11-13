import { getBusinessView } from "@ed/core/business";
import { listBusinessListings, MAX_LISTINGS_PER_BUSINESS } from "@ed/core/listings";
import { formatDate } from "@ed/i18n/format";
import { buttonClassName, EmptyState, List, Notice, Section, Tag, type Tone } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { dismissBusinessNotices } from "@/app/actions/business";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { requireCtx } from "@/lib/ctx";
import styles from "../business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("business"))("tabs.listings") };
}

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", pending: "attention", live: "success", suspended: "danger", retired: "neutral" };

/** The business's listings (P1: at most five), each with what is public and what waits for a moderator (P3). */
export default async function BusinessListingsPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ retired?: string }> }) {
  const [{ businessId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const l = await getTranslations("listings");
  const [view, rows] = await Promise.all([orNotFound(getBusinessView(ctx, businessId)), orNotFound(listBusinessListings(ctx, businessId))]);
  const unread = view.notices.filter((n) => !n.readAt);
  const full = rows.length >= MAX_LISTINGS_PER_BUSINESS;
  const canAdd = view.business.status === "active" && !view.lapsed && !full;
  const base = `/business/${businessId}`;

  return (
    <>
      {sp.retired ? <Notice tone="success" title={l("retired.done")} /> : null}

      {unread.length > 0 ? (
        <Section title={t("notices.title")} level={2}>
          <List>
            {unread.map((n) => (
              <li key={n.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">{t.has(`notices.kinds.${n.kind.replace(".", "_")}` as never) ? t(`notices.kinds.${n.kind.replace(".", "_")}` as never) : n.kind}</span>
                  {/* Release P: platform and monetization notices carry their own text, not a "reason" */}
                  {n.reason ? <span className={`ed-row__meta ${styles.reason}`}>{/^(platform|monetization)\./.test(n.kind) ? n.reason : t("notices.reason", { reason: n.reason })}</span> : null}
                  <span className="ed-row__meta ed-num">{formatDate(n.createdAt, ctx.locale)}</span>
                </div>
                {n.listingId ? (
                  <div className="ed-row__end">
                    <Link href={`${base}/listings/${n.listingId}`} className={buttonClassName({ size: "sm" })}>
                      {t("notices.openListing")}
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </List>
          <ActionForm action={dismissBusinessNotices} hidden={{ businessId }} refreshOnSuccess variant="quiet" block={false} submitLabel={t("notices.markRead")} pendingLabel={t("notices.marking")} />
        </Section>
      ) : null}

      <Section
        title={l("list.title")}
        level={2}
        actions={
          canAdd ? (
            <Link href={`${base}/listings/new`} className={buttonClassName({ variant: "primary" })}>
              <IconPlus size={18} />
              {l("list.add")}
            </Link>
          ) : undefined
        }
      >
        <p className="ed-muted">
          {l("list.count", { count: rows.length, max: MAX_LISTINGS_PER_BUSINESS })}
          {full ? ` ${l("list.full")}` : ""}
        </p>
        {rows.length === 0 ? (
          <EmptyState
            title={l("list.emptyTitle")}
            action={
              canAdd ? (
                <Link href={`${base}/listings/new`} className={buttonClassName({ variant: "secondary" })}>
                  {l("list.addFirst")}
                </Link>
              ) : undefined
            }
          >
            {l("list.emptyBody")}
          </EmptyState>
        ) : (
          <List>
            {rows.map(({ listing, pendingRevisionId, pendingSince, lastRejectionReason }) => (
              <li key={listing.id} className="ed-row">
                <div className="ed-row__main">
                  <Link href={`${base}/listings/${listing.id}`} className={`${styles.listingName} ${styles.rowLink}`}>
                    {listing.name}
                  </Link>
                  <span className="ed-row__meta">
                    {listing.status === "live" && pendingRevisionId
                      ? l("list.liveWithEdit", { date: formatDate(pendingSince!, ctx.locale) })
                      : listing.status === "pending" && pendingSince
                        ? l("list.pendingSince", { date: formatDate(pendingSince, ctx.locale) })
                        : listing.status === "suspended"
                          ? l("list.suspendedMeta")
                          : lastRejectionReason
                            ? l("list.rejectedMeta")
                            : l(`list.meta.${listing.status}`)}
                  </span>
                </div>
                <div className={`ed-row__end ${styles.tags}`}>
                  <Tag tone={STATUS_TONE[listing.status]}>{l(`status.${listing.status}`)}</Tag>
                  {listing.status === "live" && pendingRevisionId ? <Tag tone="attention">{l("status.editPending")}</Tag> : null}
                  {lastRejectionReason ? <Tag tone="danger">{l("status.rejected")}</Tag> : null}
                </div>
              </li>
            ))}
          </List>
        )}
      </Section>
    </>
  );
}
