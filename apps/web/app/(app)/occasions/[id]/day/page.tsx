import { getDayView } from "@ed/core/eventday";
import { getReadiness, listEvidenceOptions, type ReadinessDecision } from "@ed/core/readiness";
import { formatDateTime, formatTime, formatWeekdayDate } from "@ed/i18n/format";
import { ExternalLink, SheetTrigger, Tag, type Tone } from "@ed/ui";
import { IconPlus } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { addDayItemAction, setDayDetailsAction } from "@/app/actions/eventday";
import { requireCtx } from "@/lib/ctx";
import { FormSheet } from "../guests/_components/form";
import { orNotFound } from "../../_lib/load";
import { AutoRefresh } from "./AutoRefresh";
import { DayBoard, type BoardItem } from "./DayBoard";
import { DayClock } from "./DayClock";
import styles from "./day.module.css";
import { ReadinessForm } from "./ReadinessForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("eventday"))("title") };
}

const DECISION_TONE: Record<ReadinessDecision["decision"], Tone> = { proceed: "success", conditions: "attention", hold: "danger" };
const DELIVERY_TONE: Record<string, Tone> = { expected: "neutral", partial: "attention", received: "success", returned: "success" };
const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/**
 * B7, B8: the day itself — "Minuit". One dark, quiet surface legible at arm's length: the
 * clock, the programme with exactly one "Acum" row, large tap targets to move a moment on,
 * today's deliveries, the numbers to call and the standing readiness decision. Every state
 * here is the status of the same task row the Tasks views show.
 */
export default async function DayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ day?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("eventday");
  const td = await getTranslations("deliveries");
  const tc = await getTranslations("common");
  const view = await orNotFound(getDayView(ctx, id, { day: sp.day }));
  const readiness = await getReadiness(ctx, id);
  const evidence = readiness.canDecide ? await listEvidenceOptions(ctx, id) : null;
  const tz = view.occasion.timezone;
  const base = `/occasions/${id}/day`;
  const tel = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

  const items: BoardItem[] = view.items.map((i) => ({
    taskId: i.taskId,
    title: i.title,
    state: i.state,
    startTime: i.startTime,
    contactPhone: i.contactPhone,
    ownerName: i.ownerName,
    canProgress: i.canProgress,
  }));

  const edit = Object.fromEntries(
    view.items
      .filter((i) => i.canEdit)
      .map((i) => [
        i.taskId,
        <FormSheet
          key={i.taskId}
          label={i.startTime ? t("item.editTime") : t("item.setTime")}
          title={t("item.detailsTitle", { title: i.title })}
          closeLabel={tc("actions.close")}
          variant="quiet"
          form={{
            id: `time-${i.taskId}`,
            action: setDayDetailsAction,
            hidden: { occasionId: id, taskId: i.taskId },
            optionalLabel: tc("optional"),
            submitLabel: tc("actions.save"),
            pendingLabel: tc("status.saving"),
            success: tc("status.saved"),
            fields: [
              { name: "startTime", label: t("item.time"), hint: t("item.timeHint"), defaultValue: i.startTime ?? "", maxLength: 5 },
              { name: "contactPhone", label: t("item.phone"), hint: t("item.phoneHint"), defaultValue: i.contactPhone ?? "", maxLength: 40 },
            ],
          }}
        />,
      ]),
  );

  const decisionBlock = (d: ReadinessDecision) => (
    <>
      <span className={styles.decisionWord}>{t(`readiness.decisions.${d.decision}`)}</span>
      <span className={styles.small}>{t("readiness.by", { name: d.decidedByName ?? "—", date: formatDateTime(d.decidedAt, ctx.locale) })}</span>
      {d.conditions ? (
        <p>
          <span className="ed-label">{t("readiness.conditionsLabel")}</span>
          <br />
          {d.conditions}
        </p>
      ) : null}
      {d.note ? <p className={styles.small}>{d.note}</p> : null}
      <ul className={styles.evidence} aria-label={t("readiness.evidence")}>
        {d.evidence.map((e, i) => (
          <li key={i}>
            {t(`readiness.evidenceTypes.${e.type}`)}:{" "}
            {e.type === "note" && e.url ? (
              <ExternalLink href={e.url}>{e.label}</ExternalLink>
            ) : e.type === "task" && e.refId ? (
              <Link href={`/occasions/${id}/tasks/${e.refId}`}>{e.label}</Link>
            ) : e.type === "delivery" ? (
              <Link href={`/occasions/${id}/deliveries`}>{e.label}</Link>
            ) : (
              e.label
            )}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div data-theme="dark" className={styles.surface}>
      <AutoRefresh seconds={30} />
      <header className={styles.top}>
        <div className={styles.clockRow}>
          <div className={styles.clockBlock}>
            <span className="ed-label">{t("title")}</span>
            <DayClock timeZone={tz} initial={formatTime(ctx.now, ctx.locale, tz)} label={t("clockLabel")} />
            <span className={styles.dayLine}>
              {view.day ? formatWeekdayDate(new Date(`${view.day}T12:00:00Z`), ctx.locale, "UTC") : t("noDate")}
              {view.day && !view.isToday ? ` · ${t("notToday")}` : ""}
            </span>
          </div>
          {view.readiness ? <Tag tone={DECISION_TONE[view.readiness.decision]}>{t(`readiness.decisions.${view.readiness.decision}`)}</Tag> : null}
        </div>
        {view.days.length > 1 ? (
          <nav className={styles.days} aria-label={t("daysNav")}>
            {view.days.map((d) => (
              <Link key={d} href={`${base}?day=${d}`} aria-current={d === view.day ? "page" : undefined}>
                {dayLabel(d)}
              </Link>
            ))}
          </nav>
        ) : null}
        <dl className={styles.counts}>
          {(["ready", "running", "waiting", "done"] as const).map((s) => (
            <div key={s}>
              <dt>{t(`states.${s}`)}</dt>
              <dd>{view.counts[s]}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className={styles.layout}>
        <div className={styles.col}>
          <section className={styles.block} aria-labelledby="day-programme">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle} id="day-programme">
                {t("programme.title")}
              </h2>
              {view.day && view.canAdd ? (
                <FormSheet
                  label={t("programme.add")}
                  title={t("programme.addTitle")}
                  closeLabel={tc("actions.close")}
                  icon={<IconPlus size={18} />}
                  intro={<p className={styles.small}>{t("programme.addIntro")}</p>}
                  form={{
                    id: "add-moment",
                    action: addDayItemAction,
                    hidden: { occasionId: id, day: view.day },
                    optionalLabel: tc("optional"),
                    submitLabel: t("programme.addSubmit"),
                    pendingLabel: tc("status.saving"),
                    success: tc("status.saved"),
                    fields: [
                      { name: "title", label: t("item.title"), hint: t("item.titleHint"), required: true, maxLength: 200 },
                      { name: "startTime", label: t("item.time"), hint: t("item.timeHint"), maxLength: 5 },
                      { name: "contactPhone", label: t("item.phone"), hint: t("item.phoneHint"), maxLength: 40 },
                    ],
                  }}
                />
              ) : null}
            </div>
            {!view.day ? (
              <p className={styles.empty}>
                {t("programme.noDate")} <Link href={`/occasions/${id}/settings`}>{t("programme.setDate")}</Link>
              </p>
            ) : items.length === 0 ? (
              <p className={styles.empty}>{t("programme.empty")}</p>
            ) : (
              <DayBoard
                occasionId={id}
                items={items}
                edit={edit}
                labels={{
                  states: { ready: t("states.ready"), running: t("states.running"), waiting: t("states.waiting"), done: t("states.done") },
                  now: t("now"),
                  start: t("actions.start"),
                  resume: t("actions.resume"),
                  finish: t("actions.finish"),
                  wait: t("actions.wait"),
                  reopen: t("actions.reopen"),
                  noTime: t("item.noTime"),
                  call: t("contacts.call"),
                  allDone: t("programme.allDone"),
                }}
              />
            )}
          </section>
        </div>

        <aside className={styles.col}>
          <section className={styles.block} aria-labelledby="day-readiness">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle} id="day-readiness">
                {t("readiness.title")}
              </h2>
            </div>
            {readiness.latest ? <div className={styles.decision}>{decisionBlock(readiness.latest)}</div> : <p className={styles.empty}>{t("readiness.none")}</p>}
            {readiness.canDecide && evidence ? (
              <div>
                <SheetTrigger label={readiness.latest ? t("readiness.again") : t("readiness.first")} title={t("readiness.formTitle")} closeLabel={tc("actions.close")}>
                  <ReadinessForm
                    occasionId={id}
                    options={evidence}
                    labels={{
                      decision: t("readiness.form.decision"),
                      hold: t("readiness.decisions.hold"),
                      proceed: t("readiness.decisions.proceed"),
                      conditions: t("readiness.decisions.conditions"),
                      conditionsField: t("readiness.form.conditions"),
                      conditionsHint: t("readiness.form.conditionsHint"),
                      note: t("readiness.form.note"),
                      evidenceTitle: t("readiness.form.evidenceTitle"),
                      evidenceHint: t("readiness.form.evidenceHint"),
                      tasks: t("readiness.form.tasks"),
                      deliveries: t("readiness.form.deliveries"),
                      acks: t("readiness.form.acks"),
                      noteEvidence: t("readiness.form.noteEvidence"),
                      noteLabel: t("readiness.form.noteLabel"),
                      noteUrl: t("readiness.form.noteUrl"),
                      noteUrlHint: t("readiness.form.noteUrlHint"),
                      submit: t("readiness.form.submit"),
                      pending: tc("status.saving"),
                      done: t("readiness.form.done"),
                      optional: tc("optional"),
                    }}
                  />
                </SheetTrigger>
              </div>
            ) : null}
            {readiness.history.length > 1 ? (
              <details className={styles.details}>
                <summary>{t("readiness.history", { count: readiness.history.length - 1 })}</summary>
                <ol className={styles.history}>
                  {readiness.history.slice(1).map((d) => (
                    <li key={d.id}>{decisionBlock(d)}</li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>

          <section className={styles.block} aria-labelledby="day-deliveries">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle} id="day-deliveries">
                {t("deliveries.title")}
              </h2>
              <Link href={`/occasions/${id}/deliveries`} className={styles.small}>
                {t("deliveries.all")}
              </Link>
            </div>
            {view.deliveries.length === 0 ? (
              <p className={styles.empty}>{t("deliveries.none")}</p>
            ) : (
              <ul className={styles.list}>
                {view.deliveries.map((d) => (
                  <li key={d.id}>
                    <div className={styles.itemHead}>
                      <span className={styles.itemTitle}>
                        {d.expectedFrom ? `${formatTime(d.expectedFrom, ctx.locale, tz)}${d.expectedTo ? `–${formatTime(d.expectedTo, ctx.locale, tz)}` : ""} · ` : ""}
                        {d.title}
                      </span>
                      <Tag tone={DELIVERY_TONE[d.state]}>{td(`states.${d.state}`)}</Tag>
                    </div>
                    <span className={styles.small}>{[td(`kinds.${d.kind}`), d.supplierName, d.place].filter(Boolean).join(" · ")}</span>
                    {d.items.length > 0 ? (
                      <span className={styles.small}>
                        {d.items.map((i) => `${i.receivedQty ?? "—"}/${i.expectedQty}${i.unit ? ` ${i.unit}` : ""} ${i.label}`).join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.block} aria-labelledby="day-contacts">
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle} id="day-contacts">
                {t("contacts.title")}
              </h2>
            </div>
            {view.contacts.length === 0 ? (
              <p className={styles.empty}>{t("contacts.none")}</p>
            ) : (
              <ul className={styles.calls}>
                {view.contacts.map((c) => (
                  <li key={c.key}>
                    <a className={styles.call} href={tel(c.phone)} aria-label={`${t("contacts.call")} ${c.name}, ${c.phone}`}>
                      <span className={styles.callName}>
                        {c.name}
                        {c.label ? <small>{c.label}</small> : null}
                      </span>
                      <span className={styles.callNumber}>{c.phone}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
