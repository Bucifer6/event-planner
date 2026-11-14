import { prisma } from '@eventdesk/db';
import { cache } from 'react';
import { appearanceKey, isAppearance } from './appearances';

export const getPlannerAppearance = cache(async () => {
  const setting = await prisma.platformSetting.findUnique({ where: { key: appearanceKey } });
  return isAppearance(setting?.value) ? setting.value : 'garden';
});
