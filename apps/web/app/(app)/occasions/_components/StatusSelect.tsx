"use client";

import type { TaskStatus } from "@ed/core/tasks";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { changeTaskStatus } from "@/app/actions/tasks";
import styles from "./planning.module.css";

const STATUSES: TaskStatus[] = ["todo", "doing", "waiting", "done"];

/**
 * Status of one task as a native select: the tap (and keyboard) path for moving a task
 * between board columns, and the same control in the list and on the task page — all of them
 * change the one task row. Says what is happening while it saves; an error is put in words.
 */
export function StatusSelect({
  occasionId,
  taskId,
  status,
  taskTitle,
  disabled,
}: {
  occasionId: string;
  taskId: string;
  status: TaskStatus;
  taskTitle: string;
  disabled?: boolean;
}) {
  const t = useTranslations("tasks");
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(status);
  const [seen, setSeen] = useState(status);
  if (seen !== status) {
    // the server sent a newer status (changed in another view): follow it
    setSeen(status);
    setValue(status);
  }

  return (
    <span className={styles.status}>
      <label className="ed-vh" htmlFor={id}>
        {t("status.label", { title: taskTitle })}
      </label>
      <select
        id={id}
        className="ed-select"
        value={value}
        disabled={disabled}
        aria-busy={pending || undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          const previous = value;
          setValue(next);
          setError(null);
          start(async () => {
            const res = await changeTaskStatus({ occasionId, taskId, status: next });
            if (!res.ok) {
              setValue(previous);
              setError(res.error.message);
            }
          });
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>
      <span className="ed-small ed-muted" aria-live="polite">
        {pending ? t("status.saving") : null}
      </span>
      {error ? (
        <span className="ed-field__error" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
