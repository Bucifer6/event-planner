import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { requireMember, requireRole } from './access';

// C-05: menus, per-guest meal choices (diet tags), and quantities that flow into
// order snapshots (B5 deltas) for the catering booking.

export async function createMenu(occasionId: string, accountId: string, name: string) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  return prisma.menu.create({ data: { occasionId, name: name.trim() || 'Meniu' } });
}

export async function addMenuItem(
  menuId: string,
  occasionId: string,
  accountId: string,
  input: { name: string; dietTags: string[] }
) {
  await requireRole(occasionId, accountId, ['owner', 'project_manager', 'workstream_lead']);
  const menu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  if (menu.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  if (!input.name.trim()) throw new AppError('INVALID_INPUT', 'Item name required.');
  return prisma.menuItem.create({
    data: { menuId, name: input.name.trim(), dietTags: input.dietTags },
  });
}

export async function setMealChoice(
  occasionId: string,
  accountId: string,
  householdId: string,
  itemId: string
) {
  await requireMember(occasionId, accountId);
  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  if (household.occasionId !== occasionId) throw new AppError('FORBIDDEN', 'Not on this occasion.');
  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { menu: true },
  });
  if (item.menu.occasionId !== occasionId)
    throw new AppError('FORBIDDEN', 'Item not on this occasion.');
  return prisma.mealChoice.upsert({
    where: { householdId_itemId: { householdId, itemId } },
    update: {},
    create: { householdId, itemId },
  });
}

// C-05: aggregate quantities per menu item -> for the order snapshot (B5 delta).
export async function menuQuantities(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  const choices = await prisma.mealChoice.findMany({
    where: { household: { occasionId } },
    include: { item: { include: { menu: true } } },
  });
  const byItem = new Map<string, { name: string; count: number; dietTags: string[] }>();
  for (const c of choices) {
    const cur = byItem.get(c.itemId) ?? { name: c.item.name, count: 0, dietTags: c.item.dietTags };
    cur.count++;
    byItem.set(c.itemId, cur);
  }
  return [...byItem.entries()].map(([itemId, v]) => ({ itemId, ...v }));
}

export async function listMenus(occasionId: string, accountId: string) {
  await requireMember(occasionId, accountId);
  return prisma.menu.findMany({
    where: { occasionId },
    include: { items: { include: { choices: true } } },
  });
}
