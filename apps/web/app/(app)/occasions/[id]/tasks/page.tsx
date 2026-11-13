import { isManager } from "@ed/core/access";
import { getOccasionView } from "@ed/core/occasions";
import { canAddTasks, countTasks, queryTasks, TASK_STATUSES, toBoardView, toCalendarView, toListView, type TaskFilter, type TaskItem } from "@ed/core/tasks";
import { instantToDay, listTemplates } from "@ed/core/templates";
import { formatMonthYear, weekdayName } from "@ed/i18n/format";
import { buttonClassName, EmptyState, PageHeader, Section } from "@ed/ui";
import { IconChevronLeft, IconChevronRight } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import styles from "../../_components/planning.module.css";
import { StatusSelect } from "../../_components/StatusSelect";
import { QuickAddTask, TemplateRerun } from "../../_components/TaskForms";
import { TaskLine } from "../../_components/TaskLine";
import { dayKey, monthKey, orNotFound, parseMonth } from "../../_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("tasks"))("title") };
}

const VIEWS = ["list", "board", "calendar"] as const;
type View = (typeof VIEWS)[number];
const LIST_STEP = 100;
const BOARD_COLUMN_LIMIT = 40;

type Search = { view?: string; month?: string; limit?: string; priority?: string; mine?: string };

/**
 * A3: one set of task rows, three ways to look at it. List, Board and Calendar all read
 * through queryTasks and group the result — changing a task in one view changes it in all.
 */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const t = await getTranslations("tasks");
  const { occasion, member } = await orNotFound(getOccasionView(ctx, id));
  const tz = occasion.timezone;
  const base = `/occasions/${occasion.id}/tasks`;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "list";
  const priority = /^[0-2]$/.test(sp.priority ?? "") && occasion.priorities[Number(sp.priority)] ? Number(sp.priority) : undefined;
  const mine = sp.mine === "1";
  const scope: TaskFilter = { priorityIndex: priority, ownerMemberId: mine ? member.id : undefined };
  const today = instantToDay(ctx.now, tz);

  const href = (next: Partial<Search>) => {
    const q = new URLSearchParams();
    const merged = { view, priority: priority?.toString(), mine: mine ? "1" : undefined, ...next };
    if (merged.view && merged.view !== "list") q.set("view", merged.view);
    if (merged.priority) q.set("priority", merged.priority);
    if (merged.mine) q.set("mine", merged.mine);
    if (merged.month) q.set("month", merged.month);
    if (merged.limit) q.set("limit", merged.limit);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  const [counts, templates] = await Promise.all([
    countTasks(ctx, occasion.id),
    isManager(member) ? listTemplates(ctx) : Promise.resolve([]),
  ]);
  const canAdd = canAddTasks(member);
  const statusControl = (task: TaskItem) => (
    <StatusSelect occasionId={occasion.id} taskId={task.id} status={task.status} taskTitle={task.title} disabled={!canAdd && task.ownerMemberId !== member.id} />
  );

  let body: React.ReactNode;
  if (counts.total === 0) {
    body = <EmptyState title={t("empty.title")}>{canAdd ? t("empty.body") : t("empty.bodyReadOnly")}</EmptyState>;
  } else if (view === "list") {
    const limit = Math.min(Math.max(Number(sp.limit) || LIST_STEP, LIST_STEP), 500);
    const page = await queryTasks(ctx, occasion.id, { ...scope, limit });
    const groups = toListView(page.rows);
    body =
      page.rows.length === 0 ? (
        <EmptyState title={t("empty.filteredTitle")} action={<Link href={base} className={buttonClassName()}>{t("filters.clear")}</Link>}>
          {t("empty.filteredBody")}
        </EmptyState>
      ) : (
        <>
          {groups.map((group) => (
            <Section
              key={group.key}
              level={3}
              title={
                <>
                  {t(`groups.${group.key}`)}
                  <span className={styles.groupCount}>{group.tasks.length}</span>
                </>
              }
            >
              <div style={{ borderTop: "var(--hair) solid var(--line)" }}>
                {group.tasks.map((task) => (
                  <TaskLine key={task.id} task={task} timezone={tz} end={statusControl(task)} />
                ))}
              </div>
            </Section>
          ))}
          {page.hasMore ? (
            <p style={{ marginTop: "var(--s-4)" }}>
              <Link href={href({ limit: String(Math.min(limit + LIST_STEP, 500)) })} className={buttonClassName()} scroll={false}>
                {t("showMore", { shown: page.rows.length, total: page.total })}
              </Link>
            </p>
          ) : null}
        </>
      );
  } else if (view === "board") {
    // the same query, once per column, so every column is complete up to its limit
    const pages = await Promise.all(TASK_STATUSES.map((status) => queryTasks(ctx, occasion.id, { ...scope, statuses: [status], limit: BOARD_COLUMN_LIMIT })));
    const columns = toBoardView(pages.flatMap((p) => p.rows));
    body = (
      <div className="ed-board" role="list" aria-label={t("views.board")}>
        {columns.map((column, i) => (
          <section key={column.status} className="ed-board__col" role="listitem" aria-labelledby={`col-${column.status}`}>
            <div className="ed-board__head">
              <h3 id={`col-${column.status}`} className="ed-label">
                {t(`status.${column.status}`)}
              </h3>
              <span className="ed-board__count">{pages[i]!.total}</span>
            </div>
            {column.tasks.length === 0 ? <p className={styles.boardEmpty}>{t("boardEmpty")}</p> : null}
            {column.tasks.map((task) => (
              <TaskLine key={task.id} task={task} timezone={tz} compact end={statusControl(task)} />
            ))}
            {pages[i]!.hasMore ? (
              <p className="ed-small">
                <Link href={href({ view: "list" })}>{t("boardMore", { count: pages[i]!.total - column.tasks.length })}</Link>
              </p>
            ) : null}
          </section>
        ))}
      </div>
    );
  } else {
    const now = parseMonth(today.slice(0, 7))!;
    const { year, month } = parseMonth(sp.month) ?? now;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const page = await queryTasks(ctx, occasion.id, { ...scope, dueFrom: dayKey(year, month, 1), dueTo: dayKey(year, month, lastDay), limit: 500 });
    const days = toCalendarView(page.rows);
    const byDay = new Map(days.map((d) => [d.day, d.tasks]));
    const first = new Date(Date.UTC(year, month - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const cells: Array<{ day: number | null }> = [
      ...Array.from({ length: lead }, () => ({ day: null })),
      ...Array.from({ length: lastDay }, (_, i) => ({ day: i + 1 })),
    ];
    while (cells.length % 7 !== 0) cells.push({ day: null });
    const prev = month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
    const next = month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1);
    const occasionDay = occasion.startsAt ? instantToDay(occasion.startsAt, tz) : null;
    const title = formatMonthYear(first, ctx.locale, "UTC");
    body = (
      <div className="ed-stack" data-gap="3">
        <div className={styles.calNav}>
          <Link href={href({ month: prev })} className="ed-btn ed-btn--icon" aria-label={t("calendar.prev")} scroll={false}>
            <IconChevronLeft />
          </Link>
          <h3 className={styles.calTitle} aria-live="polite">
            {title}
          </h3>
          <Link href={href({ month: next })} className="ed-btn ed-btn--icon" aria-label={t("calendar.next")} scroll={false}>
            <IconChevronRight />
          </Link>
        </div>

        {/* phones: an agenda of the days that have something due */}
        {days.length === 0 ? (
          <p className={`ed-muted ${styles.agenda}`} style={{ padding: "var(--s-4) 0" }}>
            {t("calendar.emptyMonth")}
          </p>
        ) : (
          <ol className={styles.agenda}>
            {days.map((d) => {
              const date = new Date(`${d.day}T12:00:00Z`);
              return (
                <li key={d.day} className={styles.agendaDay}>
                  <div className={styles.agendaDate}>
                    <span className={styles.agendaNum}>{date.getUTCDate()}</span>
                    <span className={styles.agendaDow}>{weekdayName(((date.getUTCDay() + 6) % 7) + 1, ctx.locale).slice(0, 3)}</span>
                  </div>
                  <ul className={styles.agendaTasks}>
                    {d.tasks.map((task) => (
                      <li key={task.id}>
                        <TaskLine task={task} timezone={tz} compact end={statusControl(task)} />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}

        {/* wide screens: the month */}
        <div className={styles.month} role="grid" aria-label={title}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className={styles.dow} role="columnheader">
              {weekdayName(d, ctx.locale).slice(0, 3)}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (cell.day === null) return <div key={`x${i}`} className={styles.cell} data-outside="" role="gridcell" />;
            const key = dayKey(year, month, cell.day);
            const tasks = byDay.get(key) ?? [];
            return (
              <div key={key} className={styles.cell} role="gridcell" data-today={key === today ? "" : undefined} data-occasion={key === occasionDay ? "" : undefined}>
                <span className={styles.cellNum}>{cell.day}</span>
                {key === occasionDay ? <span className={styles.cellMark}>{t("calendar.occasionDay")}</span> : null}
                {tasks.slice(0, 3).map((task) => (
                  <Link
                    key={task.id}
                    href={`${base}/${task.id}`}
                    className={styles.cellTask}
                    data-done={task.status === "done" ? "" : undefined}
                    data-overdue={task.overdue ? "" : undefined}
                    title={task.title}
                  >
                    {task.title}
                  </Link>
                ))}
                {tasks.length > 3 ? <span className={styles.cellMore}>{t("calendar.more", { count: tasks.length - 3 })}</span> : null}
              </div>
            );
          })}
        </div>
        {page.hasMore ? <p className="ed-small ed-muted">{t("calendar.truncated")}</p> : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={counts.total > 0 ? t("summary", { done: counts.done, total: counts.total }) : undefined}
        actions={
          isManager(member) ? (
            <TemplateRerun
              occasionId={occasion.id}
              current={occasion.kind}
              templates={templates.filter((x) => x.kind !== "blank").map((x) => ({ kind: x.kind, name: ctx.locale === "en" ? x.nameEn : x.nameRo }))}
            />
          ) : undefined
        }
      />

      {canAdd ? (
        <div className="ed-stack" data-gap="2">
          <QuickAddTask occasionId={occasion.id} priorityIndex={priority} />
          <p className="ed-small">
            <Link href={`${base}/new`}>{t("add.withDetails")}</Link>
          </p>
        </div>
      ) : null}

      <div className={styles.viewbar} style={{ marginTop: "var(--s-5)" }}>
        <nav aria-label={t("views.label")}>
          <ul className="ed-tabs">
            {VIEWS.map((v) => (
              <li key={v}>
                <Link href={href({ view: v })} className="ed-tab" aria-current={v === view ? "page" : undefined} scroll={false}>
                  {t(`views.${v}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.segment} role="group" aria-label={t("filters.label")}>
          <Link href={href({ mine: undefined })} aria-current={!mine ? "true" : undefined} scroll={false}>
            {t("filters.all")}
          </Link>
          <Link href={href({ mine: "1" })} aria-current={mine ? "true" : undefined} scroll={false}>
            {t("filters.mine")}
          </Link>
        </div>
      </div>
      {priority !== undefined ? (
        <p className="ed-small" style={{ marginTop: "var(--s-3)" }}>
          {t("filters.priority", { text: occasion.priorities[priority] ?? "" })} · <Link href={href({ priority: undefined })}>{t("filters.clear")}</Link>
        </p>
      ) : null}

      <div className={styles.scroller} style={{ marginTop: "var(--s-4)" }}>{body}</div>
    </>
  );
}
