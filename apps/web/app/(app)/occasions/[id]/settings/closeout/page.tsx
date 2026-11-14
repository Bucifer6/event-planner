import { getFreshAuthMethod } from "@ed/auth";
import { isManager } from "@ed/core/access";
import { isFreshAuth } from "@ed/core/accounts";
import { getCloseout, getLesson, listLessons, PRIVATE_REQUESTS_DAYS_AFTER_CLOSEOUT } from "@ed/core/closeout";
import { getOccasionView } from "@ed/core/occasions";
import { formatDate, formatMoney } from "@ed/i18n/format";
import { Card, Figure, List, Notice, PageHeader, Row, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FreshGate } from "@/app/(app)/account/_components/fresh-gate";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import styles from "../../budget/money.module.css";
import { CloseForm, LessonForm } from "../lifecycle/LifecycleForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("lifecycle"))("closeout.title") };
}

/**
 * Closeout (B10): what is still open — from every registered closeout section, each gating
 * its own money —, the lessons learned (kept on the account) and "Închide ocazia", which
 * opens a preview. Members can read; only owner / project manager can close.
 */
export default async function CloseoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("lifecycle");
  const all = await getTranslations();
  const closeout = await orNotFound(getCloseout(ctx, id));
  const [{ occasion, member }, lesson, fresh, method] = await Promise.all([getOccasionView(ctx, id), getLesson(ctx, id), isFreshAuth(ctx), getFreshAuthMethod(ctx)]);
  const past = (await listLessons(ctx, occasion.kind, { exceptOccasionId: id })).slice(0, 5);
  const locale = ctx.locale;
  const tz = occasion.timezone;
  const closed = occasion.status === "closed";
  const manager = isManager(member);
  const text = (value: string | { key: string; params?: Record<string, string | number> }): string =>
    typeof value === "string" ? value : all.has(value.key as never) ? all(value.key as never, value.params as never) : value.key;
  const title = (key: string) => (all.has(key as never) ? all(key as never) : key);

  return (
    <div className={styles.narrow}>
      <p style={{ marginBottom: "var(--s-3)" }}>
        <Link href={`/occasions/${id}/settings`}>{t("closeout.back")}</Link>
      </p>
      <PageHeader level={2} title={t("closeout.title")} description={t("closeout.description")} />

      {closed && occasion.closedAt ? (
        <Notice tone="success" title={t("closeout.closedTitle")}>
          {t("closeout.closedBody", { date: formatDate(occasion.closedAt, locale, tz) })}
        </Notice>
      ) : null}

      <Card framed className={styles.hero}>
        <Figure
          size="hero"
          label={t("closeout.hero.label", { date: formatDate(ctx.now, locale, tz) })}
          value={closeout.openItems}
          note={closeout.openItems === 0 ? t("closeout.hero.none") : closed ? undefined : t("closeout.hero.some")}
        />
      </Card>

      {!member.grants.finance ? <Notice>{t("closeout.noSections")}</Notice> : null}
      {closeout.sections
        .filter((s) => member.grants.finance || s.items.length > 0)
        .map((s) => (
          <Section key={s.key} title={title(s.titleKey)} level={3}>
            {s.items.length === 0 ? (
              <p className="ed-muted">{t("closeout.sectionEmpty")}</p>
            ) : (
              <List>
                {s.items.map((item) => (
                  <Row
                    key={item.key}
                    title={text(item.label)}
                    meta={item.noteKey ? title(item.noteKey) : undefined}
                    end={item.amountMinor !== null && item.amountMinor !== undefined ? <span className={styles.amount}>{formatMoney(item.amountMinor, item.currency ?? "RON", locale)}</span> : undefined}
                  />
                ))}
              </List>
            )}
          </Section>
        ))}

      <Section title={t("lessons.title")} level={3} id="lessons">
        <Stack gap={4}>
          <p style={{ maxWidth: "var(--measure)" }}>{t("lessons.intro")}</p>
          <LessonForm occasionId={id} initial={lesson?.body ?? ""} />
          {past.length > 0 ? (
            <Stack gap={2}>
              <p className="ed-label">{t("lessons.pastTitle")}</p>
              <List>
                {past.map((l) => (
                  <Row key={l.id} title={l.occasionTitle} meta={formatDate(l.updatedAt, locale)}>
                    <span className="ed-prose">{l.body}</span>
                  </Row>
                ))}
              </List>
            </Stack>
          ) : null}
        </Stack>
      </Section>

      {closed ? null : (
        <Section title={t("closeout.closeTitle")} level={3} id="close">
          <Stack gap={4}>
            <p style={{ maxWidth: "var(--measure)" }}>{t("closeout.closeIntro", { days: PRIVATE_REQUESTS_DAYS_AFTER_CLOSEOUT })}</p>
            {!manager ? (
              <Notice>{t("closeout.managersOnly")}</Notice>
            ) : fresh ? (
              <CloseForm occasionId={id} />
            ) : (
              <Stack gap={4}>
                <Notice title={t("settings.freshTitle")}>
                  {t("settings.freshBody")} <Link href="/account#fresh">{t("settings.freshLink")}</Link>
                </Notice>
                <FreshGate method={method} />
              </Stack>
            )}
          </Stack>
        </Section>
      )}
    </div>
  );
}
