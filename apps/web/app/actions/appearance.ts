'use server';

import { prisma } from '@eventdesk/db';
import { requireStaff } from '@eventdesk/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appearanceKey, isAppearance } from '../lib/appearances';
import { currentStaff } from './console';

export async function saveAppearance(formData: FormData) {
  const session = await currentStaff();
  if (!session) redirect('/console/signin');
  const staff = await requireStaff(session.accountId, 'platform_admin');
  const appearance = formData.get('appearance');
  if (appearance !== 'garden' && !isAppearance(appearance)) {
    redirect('/console/appearance?error=invalid');
  }

  await prisma.$transaction([
    prisma.platformSetting.upsert({
      where: { key: appearanceKey },
      update: { value: appearance, updatedBy: staff.accountId },
      create: { key: appearanceKey, value: appearance, updatedBy: staff.accountId },
    }),
    prisma.auditLog.create({
      data: {
        actorId: staff.accountId,
        actorKind: 'staff',
        action: 'planner_appearance_changed',
        objectType: 'PlatformSetting',
        objectId: appearanceKey,
        after: { appearance },
      },
    }),
  ]);
  revalidatePath('/(app)', 'layout');
  redirect('/console/appearance?saved=1');
}
