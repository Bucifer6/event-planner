import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireRole } from './access';
import { scheduledDueAt } from './occasions';
import { confirmPreview, createPreview, getPreview } from './whatif';

// A2: seven launch templates (picnic, aniversare, nuntă, botez, Revelion, voiaj solo,
// voiaj de grup) seeded in packages/db. Template tasks auto-schedule at 12/9/6/3/1-month
// stages relative to the occasion date. Re-running a template shows a diff and creates
// no duplicates (unique (occasionId, templateTaskId)).

export const TEMPLATE_KINDS = [
  'picnic',
  'aniversare',
  'nunta',
  'botez',
  'revelion',
  'voiaj_solo',
  'voiaj_grup',
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export async function listTemplates() {
  return prisma.template.findMany({ include: { tasks: { orderBy: { sortOrder: 'asc' } } } });
}

export interface TemplateDiff {
  create: { templateTaskId: string; titleKey: string; dueAt: Date | null }[];
  skip: { taskId: string; title: string }[];
}

export async function computeTemplateDiff(occasionId: string, kind: string): Promise<TemplateDiff> {
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const template = await prisma.template.findUnique({
    where: { kind },
    include: { tasks: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!template) throw new AppError('NOT_FOUND', 'Template not found.');
  const existing = await prisma.task.findMany({
    where: { occasionId, templateTaskId: { not: null } },
  });
  const existingByTemplateTask = new Map(existing.map((t) => [t.templateTaskId as string, t]));
  const diff: TemplateDiff = { create: [], skip: [] };
  for (const tt of template.tasks) {
    const found = existingByTemplateTask.get(tt.id);
    if (found) {
      diff.skip.push({ taskId: found.id, title: found.title });
    } else {
      diff.create.push({
        templateTaskId: tt.id,
        titleKey: tt.titleKey,
        dueAt: occasion.dateStart ? scheduledDueAt(occasion.dateStart, tt.offsetMonths) : null,
      });
    }
  }
  return diff;
}

// First run applies directly; a re-run creates a What-if preview with the diff and
// applies only on explicit confirmation (principle 3).
export async function applyTemplate(
  occasionId: string,
  accountId: string,
  kind: string,
  idempotencyKey?: string
): Promise<{ applied: boolean; previewId?: string; diff: TemplateDiff }> {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const diff = await computeTemplateDiff(occasionId, kind);
  const existingCount = await prisma.task.count({
    where: { occasionId, templateTaskId: { not: null } },
  });
  if (existingCount > 0) {
    // Re-run: always show the diff as a What-if preview, apply only on confirm.
    const preview = await createPreview({
      occasionId,
      subject: 'template_reapply',
      delta: { kind, diff },
      proposedByAccountId: accountId,
      idempotencyKey,
    });
    return { applied: false, previewId: preview.id, diff };
  }
  if (diff.create.length === 0) {
    return { applied: false, diff };
  }
  await applyDiff(occasionId, accountId, kind, diff);
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'template_applied',
    objectType: 'Occasion',
    objectId: occasionId,
    after: {
      kind,
      created: diff.create.length,
      skipped: diff.skip.length,
      dateStart: occasion.dateStart,
    },
  });
  return { applied: true, diff };
}

export async function confirmTemplateReapply(previewId: string, accountId: string) {
  const preview = await getPreview(previewId);
  const delta = preview.delta as unknown as { kind: string; diff: TemplateDiff };
  const result = await confirmPreview(previewId, accountId, async () => {
    await applyDiff(preview.occasionId as string, accountId, delta.kind, delta.diff);
  });
  return result;
}

async function applyDiff(occasionId: string, accountId: string, kind: string, diff: TemplateDiff) {
  await prisma.$transaction(async (tx) => {
    for (const item of diff.create) {
      await tx.task.create({
        data: {
          occasionId,
          title: item.titleKey,
          dueAt: item.dueAt,
          templateTaskId: item.templateTaskId,
          createdById: accountId,
        },
      });
    }
  });
  void kind;
}
