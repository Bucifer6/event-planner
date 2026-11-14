import { getOccasionView } from "@ed/core/occasions";
import { canAddTasks, listAssignableMembers, listTaskOptions } from "@ed/core/tasks";
import { PageHeader } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/ctx";
import { TaskForm } from "../../../_components/TaskForms";
import { orNotFound } from "../../../_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("tasks"))("new.title") };
}

export default async function NewTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("tasks");
  const { occasion, member } = await orNotFound(getOccasionView(ctx, id));
  if (!canAddTasks(member)) notFound();
  const [members, parents] = await Promise.all([listAssignableMembers(ctx, id), listTaskOptions(ctx, id)]);
  return (
    <div style={{ maxWidth: "var(--page-narrow)" }}>
      <PageHeader level={2} eyebrow={<Link href={`/occasions/${id}/tasks`}>{t("back")}</Link>} title={t("new.title")} description={t("new.description")} />
      <TaskForm
        occasionId={id}
        priorities={occasion.priorities}
        parents={parents.filter((p) => p.status !== "done").map((p) => ({ id: p.id, title: p.title }))}
        members={members.map((m) => ({ id: m.id, name: m.name, isSelf: m.isSelf }))}
      />
    </div>
  );
}
