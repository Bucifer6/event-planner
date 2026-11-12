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

// P2: the 21 fixed launch categories (ro names + en toggle) and geography picklists
// (41 counties + Bucharest; locality second picklist — no free text, P2 definitions).
const CATEGORIES: [string, string, string][] = [
  ['sali-evenimente', 'Săli de evenimente', 'Venues'],
  ['catering', 'Catering', 'Catering'],
  ['torturi-cofetarie', 'Torturi și cofetărie', 'Cakes and pastry'],
  ['baruri-mobile', 'Baruri mobile', 'Mobile bars'],
  ['trupe', 'Trupe (inclusiv lăutari)', 'Bands (incl. folk musicians)'],
  ['muzicieni-solisti', 'Muzicienți și soliști', 'Musicians and soloists'],
  ['dj', 'DJ', 'DJ'],
  ['fotografi', 'Fotografi', 'Photographers'],
  ['videografi', 'Videografi', 'Videographers'],
  ['floristi', 'Floriști', 'Florists'],
  ['decoratiuni-styling', 'Decorațiuni și styling', 'Decor and styling'],
  ['inchiriere-corturi', 'Închiriere corturi', 'Tent rental'],
  ['inchiriere-echipamente', 'Închiriere echipamente de petrecere', 'Party equipment rental'],
  ['transport', 'Transport autocare și microbuze', 'Coach and minibus transport'],
  ['cazare', 'Cazare', 'Accommodation'],
  ['animatori', 'Animatori', 'Entertainers'],
  ['coafura-makeup', 'Coafură și make-up', 'Hair and make-up'],
  ['invitatii-tipografie', 'Invitații și tipografie', 'Invitations and print'],
  ['masini-nunta', 'Mașini de nuntă', 'Wedding cars'],
  ['securitate', 'Securitate și personal de evenimente', 'Security and event staff'],
  ['sonorizare-av', 'Sonorizare, AV și lumini', 'Sound, AV and lighting'],
];

const COUNTIES: [string, string, string, string[]][] = [
  [
    'B',
    'București',
    'Bucharest',
    ['Sector 1', 'Sector 2', 'Sector 3', 'Sector 4', 'Sector 5', 'Sector 6'],
  ],
  [
    'IF',
    'Ilfov',
    'Ilfov',
    ['Otopeni', 'Voluntari', 'Buftea', 'Chiajna', ' Popești-Leordeni', 'Bragadiru'],
  ],
  ['CJ', 'Cluj', 'Cluj', ['Cluj-Napoca', 'Turda', 'Câmpia Turzii', 'Dej', 'Gherla']],
  ['AB', 'Alba', 'Alba', ['Alba Iulia', 'Sebeș', 'Aiud']],
  ['AR', 'Arad', 'Arad', ['Arad', 'Lipova']],
  ['AG', 'Argeș', 'Argeș', ['Pitești', 'Câmpulung', 'Curtea de Argeș']],
  ['BC', 'Bacău', 'Bacău', ['Bacău', 'Onești', 'Moinești']],
  ['BH', 'Bihor', 'Bihor', ['Oradea', 'Beiuș', 'Salonta']],
  ['BN', 'Bistrița-Năsăud', 'Bistrița-Năsăud', ['Bistrița', 'Năsăud']],
  ['BT', 'Botoșani', 'Botoșani', ['Botoșani', 'Dorohoi']],
  ['BR', 'Brăila', 'Brăila', ['Brăila', ' Ianca']],
  ['BV', 'Brașov', 'Brașov', ['Brașov', 'Făgăraș', 'Râșnov', 'Zărnești']],
  ['BZ', 'Buzău', 'Buzău', ['Buzău', 'Râmnicu Sărat']],
  ['CL', 'Călărași', 'Călărași', ['Călărași', 'Oltenița']],
  ['CS', 'Caraș-Severin', 'Caraș-Severin', ['Reșița', 'Caransebeș', 'Oțelu Roșu']],
  ['CT', 'Constanța', 'Constanța', ['Constanța', 'Mangalia', 'Năvodari', 'Eforie', 'Techirghiol']],
  ['CV', 'Covasna', 'Covasna', ['Sfântu Gheorghe', 'Târgu Secuiesc']],
  ['DB', 'Dâmbovița', 'Dâmbovița', ['Târgoviște', 'Moreni', 'Pucioasa']],
  ['DJ', 'Dolj', 'Dolj', ['Craiova', 'Calafat', 'Băilești']],
  ['GL', 'Galați', 'Galați', ['Galați', 'Tecuci', 'Târgu Bujor']],
  ['GR', 'Giurgiu', 'Giurgiu', ['Giurgiu', 'Bolintin-Vale']],
  ['GJ', 'Gorj', 'Gorj', ['Târgu Jiu', 'Motru', 'Rovinari']],
  ['HR', 'Harghita', 'Harghita', ['Miercurea Ciuc', 'Odorheiu Secuiesc', 'Gheorgheni']],
  ['HD', 'Hunedoara', 'Hunedoara', ['Deva', 'Hunedoara', 'Petroșani', 'Orăștie']],
  ['IL', 'Ialomița', 'Ialomița', ['Slobozia', 'Fetești', 'Urziceni']],
  ['IS', 'Iași', 'Iași', ['Iași', 'Pașcani', 'Hârlău']],
  ['MH', 'Mehedinți', 'Mehedinți', ['Drobeta-Turnu Severin', 'Orșova', 'Strehaia']],
  ['MM', 'Maramureș', 'Maramureș', ['Baia Mare', 'Sighetu Marmației', 'Borșa', 'Vișeu de Sus']],
  ['MS', 'Mureș', 'Mureș', ['Târgu Mureș', 'Reghin', 'Sighișoara', 'Târnăveni']],
  ['NT', 'Neamț', 'Neamț', ['Piatra Neamț', 'Roman', 'Târgu Neamț']],
  ['OT', 'Olt', 'Olt', ['Slatina', 'Caracal', 'Balș']],
  ['PH', 'Prahova', 'Prahova', ['Ploiești', 'Câmpina', 'Sinaia', 'Bușteni', 'Azuga']],
  ['SJ', 'Sălaj', 'Sălaj', ['Zalău', 'Jibou']],
  ['SB', 'Sibiu', 'Sibiu', ['Sibiu', 'Mediaș', 'Cisnădie', 'Avrig']],
  ['SM', 'Satu Mare', 'Satu Mare', ['Satu Mare', 'Carei', 'Negrești-Oaș']],
  [
    'SV',
    'Suceava',
    'Suceava',
    ['Suceava', 'Fălticeni', 'Rădăuți', 'Câmpulung Moldovenesc', 'Gura Humorului'],
  ],
  ['TL', 'Tulcea', 'Tulcea', ['Tulcea', 'Sulina', 'Măcin']],
  ['TM', 'Timiș', 'Timiș', ['Timișoara', 'Lugoj', 'Sânnicolau Mare']],
  ['TR', 'Teleorman', 'Teleorman', ['Alexandria', 'Roșiorii de Vede', 'Zimnicea']],
  ['VL', 'Vâlcea', 'Vâlcea', ['Râmnicu Vâlcea', 'Drăgășani', 'Călimănești', 'Băile Olănești']],
  ['VS', 'Vaslui', 'Vaslui', ['Vaslui', ' Bârlad', 'Huși']],
  ['VN', 'Vrancea', 'Vrancea', ['Focșani', 'Adjud', 'Mărășești']],
];

async function seedDirectory() {
  for (const [slug, nameRo, nameEn] of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug },
      update: { nameRo, nameEn },
      create: { slug, nameRo, nameEn, sortKey: CATEGORIES.findIndex((c) => c[0] === slug) },
    });
  }
  for (const [code, nameRo, nameEn, localities] of COUNTIES) {
    const county = await prisma.county.upsert({
      where: { code },
      update: { nameRo, nameEn },
      create: { code, nameRo, nameEn },
    });
    for (const loc of localities) {
      const name = loc.trim();
      await prisma.locality.upsert({
        where: { countyId_nameRo: { countyId: county.id, nameRo: name } },
        update: {},
        create: { countyId: county.id, nameRo: name, nameEn: name },
      });
    }
  }
  console.log(
    `Seeded ${CATEGORIES.length} categories and ${COUNTIES.length} counties (București + 41 județe).`
  );
}

await seedDirectory();

try {
  await main();
  await seedDirectory();
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
