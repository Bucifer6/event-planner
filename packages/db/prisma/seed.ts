// Seeds the seven launch templates (A2) with date-relative task stages (12/9/6/3/1 months).
// Task titles are i18n keys resolved from packages/i18n messages (L1: no hard-coded strings).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES: {
  kind: string;
  nameKey: string;
  tasks: { titleKey: string; offsetMonths: number }[];
}[] = [
  {
    kind: 'picnic',
    nameKey: 'templates.picnic.name',
    tasks: [
      { titleKey: 'templates.picnic.tasks.0', offsetMonths: 1 },
      { titleKey: 'templates.picnic.tasks.1', offsetMonths: 1 },
      { titleKey: 'templates.picnic.tasks.2', offsetMonths: 0 },
    ],
  },
  {
    kind: 'aniversare',
    nameKey: 'templates.aniversare.name',
    tasks: [
      { titleKey: 'templates.aniversare.tasks.0', offsetMonths: 3 },
      { titleKey: 'templates.aniversare.tasks.1', offsetMonths: 1 },
      { titleKey: 'templates.aniversare.tasks.2', offsetMonths: 1 },
      { titleKey: 'templates.aniversare.tasks.3', offsetMonths: 0 },
    ],
  },
  {
    kind: 'nunta',
    nameKey: 'templates.nunta.name',
    tasks: [
      { titleKey: 'templates.nunta.tasks.0', offsetMonths: 12 },
      { titleKey: 'templates.nunta.tasks.1', offsetMonths: 9 },
      { titleKey: 'templates.nunta.tasks.2', offsetMonths: 6 },
      { titleKey: 'templates.nunta.tasks.3', offsetMonths: 3 },
      { titleKey: 'templates.nunta.tasks.4', offsetMonths: 1 },
      { titleKey: 'templates.nunta.tasks.5', offsetMonths: 0 },
    ],
  },
  {
    kind: 'botez',
    nameKey: 'templates.botez.name',
    tasks: [
      { titleKey: 'templates.botez.tasks.0', offsetMonths: 6 },
      { titleKey: 'templates.botez.tasks.1', offsetMonths: 3 },
      { titleKey: 'templates.botez.tasks.2', offsetMonths: 1 },
      { titleKey: 'templates.botez.tasks.3', offsetMonths: 0 },
    ],
  },
  {
    kind: 'revelion',
    nameKey: 'templates.revelion.name',
    tasks: [
      { titleKey: 'templates.revelion.tasks.0', offsetMonths: 3 },
      { titleKey: 'templates.revelion.tasks.1', offsetMonths: 1 },
      { titleKey: 'templates.revelion.tasks.2', offsetMonths: 0 },
    ],
  },
  {
    kind: 'voiaj_solo',
    nameKey: 'templates.voiaj_solo.name',
    tasks: [
      { titleKey: 'templates.voiaj_solo.tasks.0', offsetMonths: 3 },
      { titleKey: 'templates.voiaj_solo.tasks.1', offsetMonths: 1 },
      { titleKey: 'templates.voiaj_solo.tasks.2', offsetMonths: 0 },
    ],
  },
  {
    kind: 'voiaj_grup',
    nameKey: 'templates.voiaj_grup.name',
    tasks: [
      { titleKey: 'templates.voiaj_grup.tasks.0', offsetMonths: 6 },
      { titleKey: 'templates.voiaj_grup.tasks.1', offsetMonths: 3 },
      { titleKey: 'templates.voiaj_grup.tasks.2', offsetMonths: 1 },
      { titleKey: 'templates.voiaj_grup.tasks.3', offsetMonths: 0 },
    ],
  },
];

async function main() {
  for (const t of TEMPLATES) {
    await prisma.template.upsert({
      where: { kind: t.kind },
      update: {},
      create: {
        kind: t.kind,
        nameKey: t.nameKey,
        tasks: {
          create: t.tasks.map((task, i) => ({ ...task, sortOrder: i })),
        },
      },
    });
  }
  await prisma.monetizationSwitch.upsert({
    where: { id: 'main' },
    update: {},
    create: { id: 'main', state: 'OFF' },
  });
  console.log(`Seeded ${TEMPLATES.length} templates; monetization switch OFF.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
