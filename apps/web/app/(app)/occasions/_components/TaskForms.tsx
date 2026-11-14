"use client";

import { Button, Checkbox, FocusFirstError, IconButton, Notice, SelectField, Sheet, SubmitButton, TextareaField, TextField } from "@ed/ui";
import { IconTrash } from "@ed/ui/icons";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { proposeTemplateAction } from "@/app/actions/occasions";
import {
  addChecklistItem,
  addTask,
  addTaskDependency,
  offerTaskAction,
  removeChecklistItem,
  removeTask,
  removeTaskDependency,
  saveTask,
  toggleChecklistItem,
} from "@/app/actions/tasks";
import styles from "./planning.module.css";
import { useForm } from "./useForm";

export type MemberOption = { id: string; name: string; isSelf: boolean };
export type TaskOption = { id: string; title: string };

/** The fast path: a title, optionally a date, one button. Everything else is on the task page. */
export function QuickAddTask({ occasionId, parentId, priorityIndex }: { occasionId: string; parentId?: string; priorityIndex?: number }) {
  const t = useTranslations("tasks");
  const formRef = useRef<HTMLFormElement>(null);
  const f = useForm(addTask, {
    refresh: true,
    onSuccess: () => {
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    },
  });
  const uid = parentId ?? "root";
  return (
    <form ref={formRef} action={f.formAction} noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}
      {priorityIndex !== undefined ? <input type="hidden" name="priorityIndex" value={priorityIndex} /> : null}
      {f.error && f.formLevel(["title", "dueOn"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <div className={styles.quickAdd}>
        <TextField
          id={`qa-title-${uid}`}
          name="title"
          label={parentId ? t("add.childTitle") : t("add.title")}
          placeholder={t("add.placeholder")}
          maxLength={200}
          required
          defaultValue={f.value("title")}
          error={f.fieldError("title")}
        />
        <TextField id={`qa-due-${uid}`} name="dueOn" type="date" label={t("fields.due")} defaultValue={f.value("dueOn")} error={f.fieldError("dueOn")} />
        <SubmitButton variant={parentId ? "secondary" : "primary"} pendingLabel={t("add.submitting")}>
          {t("add.submit")}
        </SubmitButton>
      </div>
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
    </form>
  );
}

type TaskValues = { title: string; dueOn: string; notes: string; priorityIndex: string; parentId: string };

/** Full form: a new task (own page) or editing one (in a sheet). */
export function TaskForm({
  occasionId,
  taskId,
  initial,
  priorities,
  parents,
  members,
  ownedBySelf,
  hasOwner,
  onDone,
}: {
  occasionId: string;
  taskId?: string;
  initial?: TaskValues;
  priorities: string[];
  parents: TaskOption[];
  members: MemberOption[];
  ownedBySelf?: boolean;
  hasOwner?: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("tasks");
  const c = useTranslations("common");
  const create = useForm(addTask);
  const edit = useForm(saveTask, { refresh: true, onSuccess: onDone });
  const f = taskId ? edit : create;
  const v = (name: keyof TaskValues) => f.value(name, initial?.[name] ?? "");
  const p = taskId ?? "new";

  return (
    <form action={f.formAction} className="ed-form" noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      {taskId ? <input type="hidden" name="taskId" value={taskId} /> : <input type="hidden" name="then" value="detail" />}
      {f.error && f.formLevel(["title", "dueOn", "notes", "priorityIndex", "parentId", "owner"]) ? <Notice tone="danger">{f.error.message}</Notice> : null}
      <TextField id={`t-title-${p}`} name="title" label={t("fields.title")} maxLength={200} required defaultValue={v("title")} error={f.fieldError("title")} />
      <TextField id={`t-due-${p}`} name="dueOn" type="date" label={t("fields.due")} optionalLabel={c("optional")} defaultValue={v("dueOn")} error={f.fieldError("dueOn")} />
      <SelectField
        id={`t-owner-${p}`}
        name="owner"
        label={t("fields.owner")}
        hint={taskId ? t("fields.ownerHintEdit") : t("fields.ownerHint")}
        defaultValue={f.value("owner", taskId ? "keep" : "me")}
        error={f.fieldError("owner")}
      >
        {taskId ? <option value="keep">{t("owner.keep")}</option> : null}
        {taskId && ownedBySelf ? null : <option value="me">{t("owner.me")}</option>}
        {taskId && !hasOwner ? null : <option value="none">{t("owner.none")}</option>}
        {taskId
          ? null
          : members
              .filter((m) => !m.isSelf)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {t("owner.offerTo", { name: m.name })}
                </option>
              ))}
      </SelectField>
      {priorities.length > 0 ? (
        <SelectField
          id={`t-priority-${p}`}
          name="priorityIndex"
          label={t("fields.priority")}
          hint={t("fields.priorityHint")}
          optionalLabel={c("optional")}
          defaultValue={v("priorityIndex")}
          error={f.fieldError("priorityIndex")}
        >
          <option value="">{t("fields.noPriority")}</option>
          {priorities.map((text, i) => (
            <option key={i} value={i}>
              {i + 1}. {text}
            </option>
          ))}
        </SelectField>
      ) : null}
      {parents.length > 0 ? (
        <SelectField
          id={`t-parent-${p}`}
          name="parentId"
          label={t("fields.parent")}
          hint={t("fields.parentHint")}
          optionalLabel={c("optional")}
          defaultValue={v("parentId")}
          error={f.fieldError("parentId")}
        >
          <option value="">{t("fields.noParent")}</option>
          {parents
            .filter((x) => x.id !== taskId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
        </SelectField>
      ) : null}
      <TextareaField id={`t-notes-${p}`} name="notes" label={t("fields.notes")} optionalLabel={c("optional")} rows={4} maxLength={4000} defaultValue={v("notes")} error={f.fieldError("notes")} />
      <FocusFirstError errors={f.error?.fieldErrors ?? null} />
      <SubmitButton block pendingLabel={c("status.saving")}>
        {taskId ? t("edit.submit") : t("new.submit")}
      </SubmitButton>
    </form>
  );
}

/** Edit and delete, each in a sheet. Deleting names the task on the button. */
export function TaskEditControls(props: {
  occasionId: string;
  taskId: string;
  title: string;
  initial: TaskValues;
  priorities: string[];
  parents: TaskOption[];
  ownedBySelf: boolean;
  hasOwner: boolean;
}) {
  const t = useTranslations("tasks");
  const c = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const del = useForm(removeTask);
  return (
    <>
      <Button type="button" onClick={() => setEditing(true)}>
        {t("edit.open")}
      </Button>
      <Button type="button" variant="danger-quiet" onClick={() => setDeleting(true)}>
        {t("delete.open")}
      </Button>
      <Sheet open={editing} onClose={() => setEditing(false)} title={t("edit.title")} closeLabel={c("actions.close")}>
        <TaskForm {...props} members={[]} onDone={() => setEditing(false)} />
      </Sheet>
      <Sheet open={deleting} onClose={() => setDeleting(false)} title={t("delete.title")} closeLabel={c("actions.close")}>
        <p>{t("delete.body", { title: props.title })}</p>
        {del.error ? <Notice tone="danger">{del.error.message}</Notice> : null}
        <form action={del.formAction} className="ed-form">
          <input type="hidden" name="occasionId" value={props.occasionId} />
          <input type="hidden" name="taskId" value={props.taskId} />
          <Button type="button" block onClick={() => setDeleting(false)}>
            {t("delete.keep")}
          </Button>
          <SubmitButton variant="danger" block pendingLabel={c("status.deleting")}>
            {t("delete.submit")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

/** Checklist: tick, add, remove. Each change is saved as it is made. */
export function Checklist({
  occasionId,
  taskId,
  items,
  canChange,
}: {
  occasionId: string;
  taskId: string;
  items: Array<{ id: string; label: string; done: boolean }>;
  canChange: boolean;
}) {
  const t = useTranslations("tasks.checklist");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const add = useForm(addChecklistItem, { refresh: true, onSuccess: () => formRef.current?.reset() });
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error?.message ?? null);
    });
  return (
    <div className="ed-stack" data-gap="3">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {items.length > 0 ? (
        <div aria-busy={pending || undefined} style={{ borderTop: "var(--hair) solid var(--line)" }}>
          {items.map((item) => (
            <div key={item.id} className={styles.checkRow}>
              <Checkbox
                label={item.label}
                defaultChecked={item.done}
                disabled={!canChange}
                onChange={(e) => {
                  const done = e.target.checked;
                  run(() => toggleChecklistItem({ occasionId, itemId: item.id, done }));
                }}
              />
              {canChange ? (
                <IconButton label={t("remove", { label: item.label })} onClick={() => run(() => removeChecklistItem({ occasionId, itemId: item.id }))}>
                  <IconTrash size={18} />
                </IconButton>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="ed-muted">{t("empty")}</p>
      )}
      {canChange ? (
        <form ref={formRef} action={add.formAction} className={styles.inlineAdd} noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          <input type="hidden" name="taskId" value={taskId} />
          <TextField id={`check-${taskId}`} name="label" label={t("addLabel")} maxLength={200} required defaultValue={add.value("label")} error={add.fieldError("label") ?? (add.error ? add.error.message : undefined)} />
          <SubmitButton variant="secondary" pendingLabel={t("adding")}>
            {t("add")}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

/** "This task waits for…": pick another task; loops are refused with words beside the field. */
export function DependencyForm({ occasionId, taskId, options }: { occasionId: string; taskId: string; options: TaskOption[] }) {
  const t = useTranslations("tasks.dependencies");
  const f = useForm(addTaskDependency, { refresh: true });
  if (options.length === 0) return null;
  return (
    <form action={f.formAction} className={styles.inlineAdd} noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="taskId" value={taskId} />
      <SelectField id={`dep-${taskId}`} name="dependsOnTaskId" label={t("addLabel")} defaultValue="" error={f.fieldError("dependsOnTaskId") ?? (f.error ? f.error.message : undefined)}>
        <option value="">{t("choose")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </SelectField>
      <SubmitButton variant="secondary" pendingLabel={t("adding")}>
        {t("add")}
      </SubmitButton>
    </form>
  );
}

export function RemoveDependency({ occasionId, taskId, dependsOnTaskId, title }: { occasionId: string; taskId: string; dependsOnTaskId: string; title: string }) {
  const t = useTranslations("tasks.dependencies");
  const [pending, start] = useTransition();
  return (
    <IconButton
      label={t("remove", { title })}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          await removeTaskDependency({ occasionId, taskId, dependsOnTaskId });
        })
      }
    >
      <IconTrash size={18} />
    </IconButton>
  );
}

/** A4: offer the task to a member. They become accountable only when they accept. */
export function OfferForm({ occasionId, taskId, members }: { occasionId: string; taskId: string; members: MemberOption[] }) {
  const t = useTranslations("tasks.offer");
  const f = useForm(offerTaskAction, { refresh: true });
  const others = members.filter((m) => !m.isSelf);
  if (others.length === 0) return <p className="ed-muted">{t("nobodyToOffer")}</p>;
  return (
    <form action={f.formAction} className={styles.inlineAdd} noValidate>
      <input type="hidden" name="occasionId" value={occasionId} />
      <input type="hidden" name="taskId" value={taskId} />
      <SelectField id={`offer-${taskId}`} name="toMemberId" label={t("toLabel")} hint={t("toHint")} defaultValue="" error={f.fieldError("toMemberId") ?? (f.error ? f.error.message : undefined)}>
        <option value="">{t("choose")}</option>
        {others.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectField>
      <SubmitButton variant="secondary" pendingLabel={t("offering")}>
        {t("submit")}
      </SubmitButton>
    </form>
  );
}

/** A2: apply or re-run a template. Always shown as a diff first — nothing is duplicated. */
export function TemplateRerun({ occasionId, templates, current }: { occasionId: string; templates: Array<{ kind: string; name: string }>; current: string }) {
  const t = useTranslations("templates");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const f = useForm(proposeTemplateAction);
  return (
    <>
      <Button type="button" variant="quiet" onClick={() => setOpen(true)}>
        {t("rerun.open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("rerun.title")} closeLabel={c("actions.close")}>
        <p>{t("rerun.body")}</p>
        <form action={f.formAction} className="ed-form" noValidate>
          <input type="hidden" name="occasionId" value={occasionId} />
          {f.error ? <Notice tone="danger">{f.error.message}</Notice> : null}
          <SelectField id="tpl-kind" name="kind" label={t("rerun.kindLabel")} defaultValue={current === "blank" ? templates[0]?.kind : current}>
            {templates.map((tpl) => (
              <option key={tpl.kind} value={tpl.kind}>
                {tpl.name}
              </option>
            ))}
          </SelectField>
          <SubmitButton block pendingLabel={t("rerun.submitting")}>
            {t("rerun.submit")}
          </SubmitButton>
        </form>
      </Sheet>
    </>
  );
}
