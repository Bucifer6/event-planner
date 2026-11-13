import type { TaskItem } from "@ed/core/tasks";
import { formatDate } from "@ed/i18n/format";
import { Tag } from "@ed/ui";
import { IconCalendar, IconPerson, IconTasks } from "@ed/ui/icons";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./planning.module.css";
import { plural } from "../_lib/plural";

/**
 * One task, the same wherever it appears (list group, board card, agenda, overview): title
 * linking to the task page, due date, accountable owner, checklist progress, and — in words,
 * with a mark — anything out of order. Never colour alone.
 */
export async function TaskLine({ task, timezone, end, compact }: { task: TaskItem; timezone: string; end?: ReactNode; compact?: boolean }) {
  const t = await getTranslations("tasks");
  const locale = (await getLocale()) as "ro" | "en";
  const done = task.status === "done";
  return (
    <div className={compact ? styles.boardCard : styles.taskRow} data-has-end={end ? "" : undefined}>
      <div className={styles.taskMain}>
        <Link href={`/occasions/${task.occasionId}/tasks/${task.id}`} className={styles.taskTitle} data-done={done ? "" : undefined}>
          {task.title}
        </Link>
        <div className={styles.taskMeta}>
          <span>
            <IconCalendar size={16} aria-hidden />
            {task.dueAt ? formatDate(task.dueAt, locale, timezone) : <em>{t("noDue")}</em>}
          </span>
          <span>
            <IconPerson size={16} aria-hidden />
            {task.ownerName ?? <em>{t("noOwner")}</em>}
          </span>
          {task.checklist.total > 0 ? (
            <span>
              <IconTasks size={16} aria-hidden />
              {t("checklistProgress", { done: task.checklist.done, total: task.checklist.total })}
            </span>
          ) : null}
          {task.children.total > 0 ? <span>{t("childrenProgress", { done: task.children.done, total: task.children.total })}</span> : null}
        </div>
        <TaskTags task={task} />
      </div>
      {end}
    </div>
  );
}

export async function TaskTags({ task }: { task: TaskItem }) {
  const t = await getTranslations("tasks");
  const locale = await getLocale();
  const tags: ReactNode[] = [];
  if (task.overdue) tags.push(<Tag key="overdue" tone="danger">{t("tags.overdue")}</Tag>);
  if (task.violations.includes("doneBeforeDependency")) tags.push(<Tag key="v1" tone="attention">{t("tags.doneBeforeDependency")}</Tag>);
  if (task.violations.includes("doneWithOpenChildren")) tags.push(<Tag key="v2" tone="attention">{t("tags.doneWithOpenChildren")}</Tag>);
  if (task.status !== "done" && task.blockedBy > 0) tags.push(<Tag key="blocked" tone="attention">{t(`tags.blocked.${plural(task.blockedBy, locale)}`, { count: task.blockedBy })}</Tag>);
  if (task.offer) tags.push(<Tag key="offer" tone="accent">{t("tags.offered")}</Tag>);
  if (tags.length === 0) return null;
  return <div className={styles.taskTags}>{tags}</div>;
}
