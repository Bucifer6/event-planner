import { getPoll } from "@ed/core/polls";
import { getPreview, toPreviewView } from "@ed/core/whatif";
import { formatWeekdayDate } from "@ed/i18n/format";
import { BarList, EmptyState, Figure, List, Notice, PageHeader, Row, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getMember, isManager } from "@ed/core/access";
import { addPollDatesAction, closePollAction, confirmPollDateAction, removePollDateAction } from "@/app/actions/polls";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { PlannerForm } from "../guests/_components/form";
import styles from "../guests/_components/guests.module.css";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("polls"))("title") };
}

export default async function PollsPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("polls");
  const tc = await getTranslations("common");
  const [poll, member] = await Promise.all([getPoll(ctx, id), getMember(ctx, id)]);
  const canManage = !!member && isManager(member);
  const base = `/occasions/${id}/polls`;
  const previewId = typeof sp.preview === "string" ? sp.preview : null;
  const preview = previewId ? await getPreview(ctx, previewId).catch(() => null) : null;
  const day = (d: Date) => formatWeekdayDate(d, ctx.locale);
  const open = poll?.status === "open";
  const leader = poll?.options.find((o) => o.id === poll.leaderOptionId) ?? null;
  const chosen = poll?.options.find((o) => o.id === poll.chosenOptionId) ?? null;

  const addForm = canManage ? (
    <PlannerForm
      id="add-dates"
      action={addPollDatesAction}
      hidden={{ occasionId: id }}
      variant={poll ? "secondary" : "primary"}
      fields={[{ name: "dates", label: t("add.label"), hint: t("add.hint"), type: "date", required: true }]}
      submitLabel={t("add.submit")}
      pendingLabel={tc("status.saving")}
    />
  ) : null;

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />

      {preview && preview.state === "pending" ? (
        <PreviewPanel preview={toPreviewView(preview)} appliedHref={base} discardedHref={base} />
      ) : null}

      {!poll || poll.options.length === 0 ? (
        <Section>
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
          {addForm}
        </Section>
      ) : (
        <>
          <Section>
            <div className={styles.tally}>
              {poll.status === "confirmed" && chosen ? (
                <Notice tone="success" title={t("confirmed.title", { date: day(chosen.startsAt) })}>
                  {t("confirmed.body")}
                </Notice>
              ) : null}
              {poll.status === "closed" ? <Notice title={t("closed.title")}>{t("closed.body")}</Notice> : null}
              <Figure
                size="hero"
                label={t("hero.label")}
                value={leader ? leader.yes : 0}
                unit={leader ? t("hero.unit", { date: day(leader.startsAt) }) : undefined}
                note={
                  poll.householdsVoted > 0 ? t("hero.voted", { count: poll.householdsVoted }) : t("hero.noVotes")
                }
              />
              <BarList
                sort={false}
                items={poll.options.map((o) => ({
                  key: o.id,
                  label: day(o.startsAt),
                  value: o.yes,
                  display: t("tally", { yes: o.yes, maybe: o.maybe, no: o.no }),
                  highlight: o.id === poll.leaderOptionId,
                }))}
              />
              <p className="ed-small ed-muted">{t("noCapacity")}</p>
            </div>
          </Section>

          {canManage && open ? (
            <Section title={t("confirm.title")}>
              <p className="ed-muted">{t("confirm.body")}</p>
              <List>
                {poll.options.map((o) => (
                  <Row
                    key={o.id}
                    title={day(o.startsAt)}
                    meta={t("tally", { yes: o.yes, maybe: o.maybe, no: o.no })}
                    end={o.id === poll.leaderOptionId ? <Tag tone="accent">{t("leader")}</Tag> : null}
                  >
                    <div className={styles.inline}>
                      <PlannerForm
                        id={`confirm-${o.id}`}
                        action={confirmPollDateAction}
                        hidden={{ occasionId: id, pollId: poll.id, optionId: o.id }}
                        variant="secondary"
                        submitLabel={t("confirm.button")}
                        pendingLabel={tc("status.loading")}
                        redirectTo={`${base}?preview={previewId}`}
                      />
                      <PlannerForm
                        id={`rm-${o.id}`}
                        action={removePollDateAction}
                        hidden={{ occasionId: id, optionId: o.id }}
                        variant="danger-quiet"
                        submitLabel={t("remove")}
                        pendingLabel={tc("status.deleting")}
                      />
                    </div>
                  </Row>
                ))}
              </List>
            </Section>
          ) : null}

          {canManage && open ? (
            <Section title={t("add.title")}>
              {addForm}
              <PlannerForm
                id="close-poll"
                action={closePollAction}
                hidden={{ occasionId: id, pollId: poll.id }}
                variant="quiet"
                submitLabel={t("close.button")}
                pendingLabel={tc("status.saving")}
              />
            </Section>
          ) : null}
          {canManage && !open ? (
            <Section title={t("again.title")}>
              <p className="ed-muted">{t("again.body")}</p>
              {addForm}
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}
