import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { requireMember } from './access';

// A12 (release A "basic exports") + P16: exports contain own occasion data only —
// tasks and guest counts — never directory/Featured content and never another
// household's private data (D2).

export async function exportOccasionCsv(occasionId: string, accountId: string): Promise<string> {
  await requireMember(occasionId, accountId);
  const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
  const tasks = await prisma.task.findMany({
    where: { occasionId },
    include: { owner: true },
    orderBy: { createdAt: 'asc' },
  });
  const households = await prisma.household.findMany({
    where: { occasionId },
    include: { guests: true, responses: { orderBy: { submittedAt: 'desc' }, take: 1 } },
  });
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(
    `occasion,${esc(occasion.title)},kind,${esc(occasion.kind)},date,${occasion.dateStart?.toISOString() ?? ''}`
  );
  lines.push('');
  lines.push('tasks');
  lines.push('title,status,due,owner,done_checks,total_checks');
  for (const t of tasks) {
    const checks = await prisma.taskCheckItem.findMany({ where: { taskId: t.id } });
    const done = checks.filter((c) => c.done).length;
    lines.push(
      [
        esc(t.title),
        t.status,
        t.dueAt?.toISOString() ?? '',
        esc(t.owner?.customLabel ?? t.owner?.role ?? ''),
        done,
        checks.length,
      ].join(',')
    );
  }
  lines.push('');
  lines.push('households (counts only — children are never persons, A6)');
  lines.push('household,adults,children_count,guests');
  for (const h of households) {
    const r = h.responses[0];
    lines.push([esc(h.name), r?.adults ?? 0, r?.childrenCount ?? 0, h.guests.length].join(','));
  }
  return lines.join('\n');
}
