import { counties, localities, type LocalityKind } from "../schema/directory";
import type { Seed } from "./index";

// Fixed geography (PRD §8 definitions): the 41 counties + București, and localities per county.
// County codes are the vehicle-plate codes (stable). Localities listed here are the county
// seats, the municipalities and the towns; for the proposed launch areas (București, Ilfov,
// Cluj) the list goes further (sectors; every Ilfov commune; the communes around Cluj-Napoca).
// The operator adds, renames, merges and retires entries from the console (W4) — a re-run of
// this seed only inserts what is missing and never overwrites a console edit.
//
// Entry syntax: "Name" = town · "*Name" = municipality · "+Name" = commune · first entry = county seat.

type CountySeed = { code: string; ro: string; en?: string; launch?: boolean; noSeat?: boolean; places: string[]; pages?: string[] };

export const GEOGRAPHY: CountySeed[] = [
  { code: "AB", ro: "Alba", places: ["*Alba Iulia", "*Aiud", "*Blaj", "*Sebeș", "Cugir", "Ocna Mureș", "Zlatna", "Câmpeni", "Teiuș", "Abrud", "Baia de Arieș"] },
  { code: "AR", ro: "Arad", places: ["*Arad", "Ineu", "Lipova", "Pecica", "Sântana", "Chișineu-Criș", "Curtici", "Nădlac", "Pâncota", "Sebiș"] },
  { code: "AG", ro: "Argeș", places: ["*Pitești", "*Câmpulung", "*Curtea de Argeș", "Mioveni", "Costești", "Topoloveni", "Ștefănești"] },
  { code: "BC", ro: "Bacău", places: ["*Bacău", "*Onești", "*Moinești", "Comănești", "Buhuși", "Dărmănești", "Târgu Ocna", "Slănic-Moldova"] },
  { code: "BH", ro: "Bihor", places: ["*Oradea", "*Salonta", "*Marghita", "*Beiuș", "Aleșd", "Valea lui Mihai", "Ștei", "Săcueni", "Nucet", "Vașcău"] },
  { code: "BN", ro: "Bistrița-Năsăud", places: ["*Bistrița", "Beclean", "Năsăud", "Sângeorz-Băi"] },
  { code: "BT", ro: "Botoșani", places: ["*Botoșani", "*Dorohoi", "Darabani", "Flămânzi", "Săveni", "Bucecea", "Ștefănești"] },
  { code: "BV", ro: "Brașov", places: ["*Brașov", "*Făgăraș", "*Săcele", "*Codlea", "Zărnești", "Râșnov", "Predeal", "Rupea", "Victoria", "Ghimbav"] },
  { code: "BR", ro: "Brăila", places: ["*Brăila", "Ianca", "Însurăței", "Făurei"] },
  { code: "B", ro: "București", en: "Bucharest", launch: true, noSeat: true, places: ["#Sectorul 1", "#Sectorul 2", "#Sectorul 3", "#Sectorul 4", "#Sectorul 5", "#Sectorul 6"], pages: ["Sectorul 1", "Sectorul 2", "Sectorul 3", "Sectorul 4", "Sectorul 5", "Sectorul 6"] },
  { code: "BZ", ro: "Buzău", places: ["*Buzău", "*Râmnicu Sărat", "Nehoiu", "Pătârlagele", "Pogoanele"] },
  { code: "CS", ro: "Caraș-Severin", places: ["*Reșița", "*Caransebeș", "Bocșa", "Oravița", "Moldova Nouă", "Oțelu Roșu", "Anina", "Băile Herculane"] },
  { code: "CL", ro: "Călărași", places: ["*Călărași", "*Oltenița", "Budești", "Fundulea", "Lehliu Gară"] },
  {
    code: "CJ",
    ro: "Cluj",
    launch: true,
    places: ["*Cluj-Napoca", "*Turda", "*Dej", "*Câmpia Turzii", "*Gherla", "Huedin", "+Florești", "+Apahida", "+Baciu", "+Gilău", "+Feleacu", "+Chinteni", "+Jucu", "+Bonțida"],
    pages: ["Cluj-Napoca", "Turda", "Dej", "Câmpia Turzii", "Gherla", "Florești"],
  },
  { code: "CT", ro: "Constanța", places: ["*Constanța", "*Mangalia", "*Medgidia", "Năvodari", "Cernavodă", "Ovidiu", "Eforie", "Techirghiol", "Murfatlar", "Hârșova", "Negru Vodă", "Băneasa"] },
  { code: "CV", ro: "Covasna", places: ["*Sfântu Gheorghe", "*Târgu Secuiesc", "Covasna", "Baraolt", "Întorsura Buzăului"] },
  { code: "DB", ro: "Dâmbovița", places: ["*Târgoviște", "*Moreni", "Pucioasa", "Găești", "Titu", "Fieni", "Răcari"] },
  { code: "DJ", ro: "Dolj", places: ["*Craiova", "*Băilești", "*Calafat", "Filiași", "Segarcea", "Dăbuleni", "Bechet"] },
  { code: "GL", ro: "Galați", places: ["*Galați", "*Tecuci", "Târgu Bujor", "Berești"] },
  { code: "GR", ro: "Giurgiu", places: ["*Giurgiu", "Bolintin-Vale", "Mihăilești"] },
  { code: "GJ", ro: "Gorj", places: ["*Târgu Jiu", "*Motru", "Rovinari", "Bumbești-Jiu", "Târgu Cărbunești", "Novaci", "Țicleni", "Tismana", "Turceni"] },
  { code: "HR", ro: "Harghita", places: ["*Miercurea Ciuc", "*Odorheiu Secuiesc", "*Gheorgheni", "*Toplița", "Cristuru Secuiesc", "Bălan", "Borsec", "Băile Tușnad", "Vlăhița"] },
  { code: "HD", ro: "Hunedoara", places: ["*Deva", "*Hunedoara", "*Petroșani", "*Vulcan", "*Lupeni", "*Orăștie", "*Brad", "Petrila", "Simeria", "Călan", "Hațeg", "Uricani", "Geoagiu", "Aninoasa"] },
  { code: "IL", ro: "Ialomița", places: ["*Slobozia", "*Fetești", "*Urziceni", "Țăndărei", "Amara", "Fierbinți-Târg", "Căzănești"] },
  { code: "IS", ro: "Iași", places: ["*Iași", "*Pașcani", "Hârlău", "Târgu Frumos", "Podu Iloaiei"] },
  {
    code: "IF",
    ro: "Ilfov",
    launch: true,
    noSeat: true,
    places: [
      "Buftea", "Voluntari", "Pantelimon", "Popești-Leordeni", "Bragadiru", "Chitila", "Otopeni", "Măgurele",
      "+1 Decembrie", "+Afumați", "+Balotești", "+Berceni", "+Brănești", "+Cernica", "+Chiajna", "+Ciolpani", "+Ciorogârla", "+Clinceni",
      "+Copăceni", "+Corbeanca", "+Cornetu", "+Dascălu", "+Dărăști-Ilfov", "+Dobroești", "+Domnești", "+Dragomirești-Vale", "+Găneasa",
      "+Glina", "+Grădiștea", "+Gruiu", "+Jilava", "+Moara Vlăsiei", "+Mogoșoaia", "+Nuci", "+Periș", "+Petrăchioaia", "+Snagov",
      "+Ștefăneștii de Jos", "+Tunari", "+Vidra",
    ],
    pages: ["Buftea", "Voluntari", "Pantelimon", "Popești-Leordeni", "Bragadiru", "Chitila", "Otopeni", "Măgurele"],
  },
  { code: "MM", ro: "Maramureș", places: ["*Baia Mare", "*Sighetu Marmației", "Borșa", "Baia Sprie", "Vișeu de Sus", "Târgu Lăpuș", "Seini", "Cavnic", "Săliștea de Sus", "Dragomirești", "Șomcuta Mare", "Tăuții-Măgherăuș", "Ulmeni"] },
  { code: "MH", ro: "Mehedinți", places: ["*Drobeta-Turnu Severin", "*Orșova", "Strehaia", "Vânju Mare", "Baia de Aramă"] },
  { code: "MS", ro: "Mureș", places: ["*Târgu Mureș", "*Reghin", "*Sighișoara", "*Târnăveni", "Luduș", "Sovata", "Iernut", "Miercurea Nirajului", "Sărmașu", "Ungheni", "Sângeorgiu de Pădure"] },
  { code: "NT", ro: "Neamț", places: ["*Piatra Neamț", "*Roman", "Târgu Neamț", "Bicaz", "Roznov"] },
  { code: "OT", ro: "Olt", places: ["*Slatina", "*Caracal", "Balș", "Corabia", "Scornicești", "Drăgănești-Olt", "Piatra-Olt", "Potcoava"] },
  { code: "PH", ro: "Prahova", places: ["*Ploiești", "*Câmpina", "Băicoi", "Breaza", "Mizil", "Comarnic", "Vălenii de Munte", "Boldești-Scăeni", "Urlați", "Sinaia", "Bușteni", "Azuga", "Slănic", "Plopeni"] },
  { code: "SM", ro: "Satu Mare", places: ["*Satu Mare", "*Carei", "Negrești-Oaș", "Tășnad", "Livada", "Ardud"] },
  { code: "SJ", ro: "Sălaj", places: ["*Zalău", "Șimleu Silvaniei", "Jibou", "Cehu Silvaniei"] },
  { code: "SB", ro: "Sibiu", places: ["*Sibiu", "*Mediaș", "Cisnădie", "Avrig", "Agnita", "Tălmaciu", "Dumbrăveni", "Copșa Mică", "Săliște", "Miercurea Sibiului", "Ocna Sibiului"] },
  { code: "SV", ro: "Suceava", places: ["*Suceava", "*Fălticeni", "*Rădăuți", "*Câmpulung Moldovenesc", "*Vatra Dornei", "Gura Humorului", "Siret", "Vicovu de Sus", "Dolhasca", "Liteni", "Salcea", "Solca", "Cajvana", "Frasin", "Broșteni", "Milișăuți"] },
  { code: "TR", ro: "Teleorman", places: ["*Alexandria", "*Roșiorii de Vede", "*Turnu Măgurele", "Zimnicea", "Videle"] },
  { code: "TM", ro: "Timiș", places: ["*Timișoara", "*Lugoj", "Sânnicolau Mare", "Jimbolia", "Recaș", "Făget", "Buziaș", "Deta", "Gătaia", "Ciacova"] },
  { code: "TL", ro: "Tulcea", places: ["*Tulcea", "Babadag", "Măcin", "Isaccea", "Sulina"] },
  { code: "VS", ro: "Vaslui", places: ["*Vaslui", "*Bârlad", "*Huși", "Negrești", "Murgeni"] },
  { code: "VL", ro: "Vâlcea", places: ["*Râmnicu Vâlcea", "*Drăgășani", "Băbeni", "Călimănești", "Horezu", "Brezoi", "Bălcești", "Berbești", "Băile Olănești", "Băile Govora", "Ocnele Mari"] },
  { code: "VN", ro: "Vrancea", places: ["*Focșani", "*Adjud", "Mărășești", "Panciu", "Odobești"] },
];

/** "Câmpia Turzii" → "campia-turzii". Stable: used in public URLs. */
export function geoSlug(name: string): string {
  return name
    .replace(/[șş]/gi, "s")
    .replace(/[țţ]/gi, "t")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePlace(entry: string): { name: string; kind: LocalityKind } {
  if (entry.startsWith("*")) return { name: entry.slice(1), kind: "municipiu" };
  if (entry.startsWith("+")) return { name: entry.slice(1), kind: "comuna" };
  if (entry.startsWith("#")) return { name: entry.slice(1), kind: "sector" };
  return { name: entry, kind: "oras" };
}

/** Idempotent: inserts missing counties (by code) and localities (by county + slug) only. */
export const geographySeed: Seed = {
  name: "geography",
  run: async (db) => {
    const sorted = [...GEOGRAPHY].sort((a, b) => a.ro.localeCompare(b.ro, "ro"));
    let order = 0;
    for (const c of sorted) {
      order += 10;
      await db
        .insert(counties)
        .values({ code: c.code, slug: geoSlug(c.ro), nameRo: c.ro, nameEn: c.en ?? c.ro, sortOrder: order, launchArea: c.launch ?? false })
        .onConflictDoNothing({ target: counties.code });
      const rows = c.places.map((entry, i) => {
        const p = parsePlace(entry);
        return {
          countyCode: c.code,
          slug: geoSlug(p.name),
          nameRo: p.name,
          nameEn: p.kind === "sector" ? p.name.replace("Sectorul", "Sector") : null,
          kind: p.kind,
          countySeat: i === 0 && !c.noSeat,
          publicPage: (c.pages ?? []).includes(p.name),
          sortOrder: (i + 1) * 10,
        };
      });
      await db
        .insert(localities)
        .values(rows)
        .onConflictDoNothing({ target: [localities.countyCode, localities.slug] });
    }
  },
};
