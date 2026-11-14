import { getOccasionView } from "@ed/core/occasions";
import { canAddTasks, getTask, listAssignableMembers, listTaskOptions } from "@ed/core/tasks";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { DescriptionList, List, Notice, PageHeader, Row, Section, Stack, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskDirectoryLink } from "@/app/directory/_components/TaskDirectoryLink";
import { requireCtx } from "@/lib/ctx";
import { OfferActions, WithdrawOffer } from "../../../_components/OfferActions";
import { StatusSelect } from "../../../_components/StatusSelect";
import { Checklist, DependencyForm, OfferForm, QuickAddTask, RemoveDependency, TaskEditControls } from "../../../_components/TaskForms";
import { TaskTags } from "../../../_components/TaskLine";
import { orNotFound } from "../../../_lib/load";
import { plural } from "../../../_lib/plural";

export async function generateMetadata({ params }: { params: Promise<{ id: string; taskId: string }> }): Promise<Metadata> {
  const { taskId } = await params;
  try {
    return { title: (await getTask(await requireCtx(), taskId)).task.title };
  } catch {
    return {};
  }
}

/** One task: status, who is accountable, due date, checklist, child tasks, what it waits for. */
export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("tasks");
  const [{ occasion, member }, detail] = await Promise.all([orNotFound(getOccasionView(ctx, id)), orNotFound(getTask(ctx, taskId))]);
  const { task, can } = detail;
  if (task.occasionId !== occasion.id) notFound();
  const [members, options] = await Promise.all([listAssignableMembers(ctx, id), listTaskOptions(ctx, id)]);
  const tz = occasion.timezone;
  const base = `/occasions/${id}/tasks`;
  const taken = new Set([task.id, ...detail.dependsOn.map((d) => d.id)]);
  const openOffer = detail.delegations.find((d) => d.state === "offered");
  const lastDeclined = !openOffer && detail.delegations[0]?.state === "declined" ? detail.delegations[0] : null;
  const statusTag = (s: string) => <Tag tone={s === "done" ? "success" : "neutral"}>{t(`status.${s as "todo"}`)}</Tag>;

  return (
    <>
      <PageHeader
        level={2}
        eyebrow={<Link href={base}>{t("back")}</Link>}
        title={task.title}
        actions={
          can.edit ? (
            <TaskEditControls
              occasionId={id}
              taskId={task.id}
              title={task.title}
              initial={{
                title: task.title,
                dueOn: task.dueDay ?? "",
                notes: detail.notes ?? "",
                priorityIndex: task.priorityIndex === null ? "" : String(task.priorityIndex),
                parentId: task.parentId ?? "",
              }}
              priorities={occasion.priorities}
              parents={options.filter((o) => o.id !== task.id).map((o) => ({ id: o.id, title: o.title }))}
              ownedBySelf={task.ownerMemberId === member.id}
              hasOwner={task.ownerMemberId !== null}
            />
          ) : undefined
        }
      />

      <Stack gap={4}>
        {task.violations.includes("doneBeforeDependency") ? (
          <Notice tone="attention" title={t("violations.doneBeforeDependency.title")} role="status">
            {t("violations.doneBeforeDependency.body")}
          </Notice>
        ) : null}
        {task.violations.includes("doneWithOpenChildren") ? (
          <Notice tone="attention" title={t("violations.doneWithOpenChildren.title")} role="status">
            {t("violations.doneWithOpenChildren.body")}
          </Notice>
        ) : null}
        {task.status !== "done" && task.blockedBy > 0 ? (
          <Notice tone="attention" title={t(`violations.blocked.title.${plural(task.blockedBy, ctx.locale)}`, { count: task.blockedBy })} role="status">
            {t("violations.blocked.body")}
          </Notice>
        ) : null}

        <div style={{ maxWidth: 280 }}>
          <span className="ed-field__label">{t("fields.status")}</span>
          <StatusSelect occasionId={id} taskId={task.id} status={task.status} taskTitle={task.title} disabled={!can.progress} />
        </div>
        <TaskTags task={task} />
        {/* Release P (P7): one dismissible "Vezi firme de <categorie> în <zona>" link; names no business; renders nothing when not relevant or switched off. */}
        <TaskDirectoryLink occasionId={id} taskTitle={task.title} canManage={member.role === "owner" || member.role === "pm"} />

        <DescriptionList
          cols={2}
          items={[
            { term: t("fields.due"), value: task.dueAt ? formatDate(task.dueAt, ctx.locale, tz) : <em className="ed-muted">{t("noDue")}</em> },
            { term: t("fields.owner"), value: task.ownerName ?? <em className="ed-muted">{t("noOwner")}</em> },
            ...(task.stage ? [{ term: t("fields.stage"), value: t(`groups.${task.stage}`) }] : []),
            ...(task.priorityIndex !== null && occasion.priorities[task.priorityIndex]
              ? [{ term: t("fields.priority"), value: <Link href={`/occasions/${id}#brief`}>{occasion.priorities[task.priorityIndex]}</Link> }]
              : []),
            ...(detail.parent ? [{ term: t("fields.parent"), value: <Link href={`${base}/${detail.parent.id}`}>{detail.parent.title}</Link> }] : []),
          ]}
        />
        {detail.notes ? <p className="ed-prose" style={{ whiteSpace: "pre-wrap", maxWidth: "var(--measure)" }}>{detail.notes}</p> : null}
      </Stack>

      <div style={{ marginTop: "var(--s-5)" }}>
        <Section title={t("offer.title")} level={3}>
          {openOffer ? (
            <Notice tone="accent" title={can.decideOffer ? t("offer.toYouTitle", { from: openOffer.fromName ?? "" }) : t("offer.waitingTitle", { to: openOffer.toName ?? "" })} role="status">
              <Stack gap={3}>
                <span>{can.decideOffer ? t("offer.toYouBody") : t("offer.waitingBody", { date: formatDateTime(openOffer.createdAt, ctx.locale) })}</span>
                {can.decideOffer ? (
                  <OfferActions occasionId={id} delegationId={openOffer.id} taskTitle={task.title} fromName={openOffer.fromName ?? ""} />
                ) : openOffer.fromMemberId === member.id || member.role === "owner" || member.role === "pm" ? (
                  <WithdrawOffer occasionId={id} delegationId={openOffer.id} />
                ) : null}
              </Stack>
            </Notice>
          ) : (
            <Stack gap={3}>
              {lastDeclined ? (
                <Notice tone="attention" title={t("offer.declinedTitle", { to: lastDeclined.toName ?? "" })} role="status">
                  {t("offer.declinedBody", { reason: lastDeclined.declineReason ?? "", from: lastDeclined.fromName ?? "" })}
                </Notice>
              ) : null}
              {can.delegate ? <OfferForm occasionId={id} taskId={task.id} members={members.map((m) => ({ id: m.id, name: m.name, isSelf: m.isSelf }))} /> : <p className="ed-muted">{t("offer.none")}</p>}
            </Stack>
          )}
        </Section>

        <Section title={t("checklist.title")} level={3}>
          <Checklist occasionId={id} taskId={task.id} items={detail.checklist} canChange={can.progress} />
        </Section>

        <Section title={t("children.title")} level={3}>
          {detail.children.length > 0 ? (
            <List>
              {detail.children.map((child) => (
                <Row key={child.id} title={<Link href={`${base}/${child.id}`}>{child.title}</Link>} end={statusTag(child.status)} />
              ))}
            </List>
          ) : (
            <p className="ed-muted">{t("children.empty")}</p>
          )}
          {canAddTasks(member) && can.edit ? <QuickAddTask occasionId={id} parentId={task.id} /> : null}
        </Section>

        <Section title={t("dependencies.title")} level={3}>
          {detail.dependsOn.length > 0 ? (
            <List>
              {detail.dependsOn.map((dep) => (
                <Row
                  key={dep.id}
                  title={<Link href={`${base}/${dep.id}`}>{dep.title}</Link>}
                  end={
                    <>
                      {statusTag(dep.status)}
                      {can.edit ? <RemoveDependency occasionId={id} taskId={task.id} dependsOnTaskId={dep.id} title={dep.title} /> : null}
                    </>
                  }
                />
              ))}
            </List>
          ) : (
            <p className="ed-muted">{t("dependencies.empty")}</p>
          )}
          {can.edit ? <DependencyForm occasionId={id} taskId={task.id} options={options.filter((o) => !taken.has(o.id)).map((o) => ({ id: o.id, title: o.title }))} /> : null}
          {detail.requiredBy.length > 0 ? (
            <p className="ed-small ed-muted">
              {t("dependencies.requiredBy")}{" "}
              {detail.requiredBy.map((r, i) => (
                <span key={r.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`${base}/${r.id}`}>{r.title}</Link>
                </span>
              ))}
            </p>
          ) : null}
        </Section>
      </div>
    </>
  );
}
