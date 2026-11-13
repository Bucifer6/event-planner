import { and, eq, notInArray } from "drizzle-orm";
import type { OccasionKind } from "../schema/occasions";
import type { TaskStage } from "../schema/tasks";
import { templateTasks, templates } from "../schema/templates";
import type { Seed } from "./index";

// The seven occasion templates plus "blank" (A2). Each task is scheduled relative to the
// occasion date: `months` before it (the 12/9/6/3/1-month stages) and/or `days` from it
// (negative = before, positive = after). Keys are stable: they are how a re-run recognises a
// task that already exists — rename a title freely, never reuse or change a key.

type T = [key: string, stage: TaskStage, months: number, days: number, ro: string, en: string];
type Tpl = { kind: OccasionKind; ro: string; en: string; descRo: string; descEn: string; tasks: T[] };

const nunta: T[] = [
  ["buget", "m12", 12, 0, "Stabilește bugetul și cine contribuie", "Set the budget and who contributes"],
  ["lista-preliminara", "m12", 12, 0, "Fă lista preliminară de invitați", "Draft the guest list"],
  ["nasi", "m12", 12, 0, "Alege nașii și vorbește cu ei", "Choose the wedding godparents (nași) and ask them"],
  ["locatie", "m12", 12, 0, "Vizitează și rezervă locația petrecerii", "Visit and book the reception venue"],
  ["biserica", "m12", 12, 0, "Vorbește cu preotul și rezervă biserica", "Speak to the priest and book the church"],
  ["foto-video", "m12", 12, 0, "Rezervă fotograful și videograful", "Book the photographer and videographer"],
  ["muzica", "m12", 12, 0, "Rezervă formația sau DJ-ul", "Book the band or DJ"],
  ["rochie", "m9", 9, 0, "Alege rochia de mireasă", "Choose the wedding dress"],
  ["anunt-data", "m9", 9, 0, "Anunță data celor apropiați", "Tell family and close friends the date"],
  ["flori-decor", "m9", 9, 0, "Alege florăria și decorul", "Choose the florist and the decor"],
  ["cazare", "m9", 9, 0, "Rezervă cazare pentru invitații din alt oraș", "Book rooms for out-of-town guests"],
  ["costum", "m6", 6, 0, "Alege costumul mirelui", "Choose the groom's suit"],
  ["verighete", "m6", 6, 0, "Comandă verighetele", "Order the wedding rings"],
  ["invitatii-model", "m6", 6, 0, "Alege modelul și textul invitațiilor", "Choose the invitation design and wording"],
  ["tort", "m6", 6, 0, "Comandă tortul și candy bar-ul", "Order the cake and the candy bar"],
  ["transport", "m6", 6, 0, "Stabilește transportul în ziua nunții", "Arrange transport for the wedding day"],
  ["luna-de-miere", "m6", 6, 0, "Planifică luna de miere", "Plan the honeymoon"],
  ["invitatii-trimise", "m3", 3, 0, "Trimite invitațiile", "Send the invitations"],
  ["meniu", "m3", 3, 0, "Stabilește meniul la degustare", "Settle the menu at the tasting"],
  ["lumanari", "m3", 3, 0, "Comandă lumânările de cununie și buchetele", "Order the ceremony candles and the bouquets"],
  ["marturii", "m3", 3, 0, "Comandă mărturiile pentru invitați", "Order the guest favours"],
  ["coafura-machiaj", "m3", 3, 0, "Programează proba de coafură și machiaj", "Book the hair and make-up trial"],
  ["confirmari", "m1", 1, 0, "Sună invitații care nu au confirmat", "Call the guests who have not replied"],
  ["asezare", "m1", 1, 0, "Fă așezarea la mese", "Make the seating plan"],
  ["program", "m1", 1, 0, "Stabilește programul zilei cu locația, formația și fotograful", "Agree the day's schedule with the venue, band and photographer"],
  ["plati-finale", "m1", 1, 0, "Confirmă plățile rămase cu fiecare furnizor", "Confirm the remaining payments with each supplier"],
  ["stare-civila", "m1", 0, -14, "Fă certificatele prenupțiale și depune dosarul la starea civilă", "Get the pre-marital medical certificates and file the papers at the registry office"],
  ["ultima-proba", "m1", 0, -10, "Fă ultima probă la rochie și costum", "Have the final dress and suit fitting"],
  ["numar-final", "week", 0, -5, "Comunică locației numărul final de invitați", "Give the venue the final guest count"],
  ["plicuri", "week", 0, -2, "Pregătește plicurile pentru furnizori și preot", "Prepare the envelopes for the suppliers and the priest"],
  ["geanta", "week", 0, -1, "Pregătește geanta pentru ziua nunții: acte, verighete, trusă de urgență", "Pack the wedding-day bag: papers, rings, emergency kit"],
  ["returnari", "after", 0, 2, "Returnează ce ai închiriat", "Return everything that was hired"],
  ["multumiri", "after", 0, 7, "Trimite mulțumiri invitaților și furnizorilor", "Send thanks to guests and suppliers"],
  ["album", "after", 0, 30, "Alege fotografiile pentru album", "Choose the photos for the album"],
];

const botez: T[] = [
  ["nasi", "m3", 3, 0, "Alege nașii și vorbește cu ei", "Choose the godparents (nași) and ask them"],
  ["biserica", "m3", 3, 0, "Stabilește data cu preotul și rezervă biserica", "Agree the date with the priest and book the church"],
  ["restaurant", "m3", 3, 0, "Rezervă restaurantul pentru petrecere", "Book the restaurant for the party"],
  ["lista", "m3", 3, 0, "Fă lista de invitați", "Make the guest list"],
  ["fotograf", "m1", 1, 0, "Rezervă fotograful", "Book the photographer"],
  ["invitatii", "m1", 1, 0, "Trimite invitațiile", "Send the invitations"],
  ["trusou", "m1", 1, 0, "Stabilește cu nașii cine ia trusoul și lumânarea de botez", "Agree with the godparents who brings the christening set and candle"],
  ["tort-marturii", "m1", 1, 0, "Comandă tortul și mărturiile", "Order the cake and the favours"],
  ["hainute", "m1", 1, 0, "Alege hăinuțele de botez", "Choose the christening outfit"],
  ["meniu", "m1", 1, 0, "Stabilește meniul cu restaurantul", "Settle the menu with the restaurant"],
  ["numar-final", "week", 0, -5, "Confirmă restaurantului numărul final de invitați", "Give the restaurant the final guest count"],
  ["acte", "week", 0, -2, "Pregătește certificatul de naștere pentru biserică", "Have the birth certificate ready for the church"],
  ["geanta", "week", 0, -1, "Pregătește geanta pentru biserică: schimburi, prosop, scutece", "Pack the bag for church: spare clothes, towel, nappies"],
  ["certificat", "after", 0, 3, "Ridică certificatul de botez de la biserică", "Collect the christening certificate from the church"],
  ["multumiri", "after", 0, 7, "Trimite mulțumiri și fotografii invitaților", "Send thanks and photos to the guests"],
];

const aniversare: T[] = [
  ["buget", "m3", 3, 0, "Stabilește bugetul și câți invitați vor fi", "Set the budget and the number of guests"],
  ["loc", "m3", 3, 0, "Alege locul petrecerii și rezervă-l", "Choose the party venue and book it"],
  ["lista", "m1", 1, 0, "Fă lista de invitați", "Make the guest list"],
  ["invitatii", "m1", 1, 0, "Trimite invitațiile", "Send the invitations"],
  ["tema", "m1", 1, 0, "Alege tema și decorul", "Choose the theme and the decor"],
  ["tort", "m1", 1, 0, "Comandă tortul", "Order the cake"],
  ["meniu", "m1", 1, 0, "Stabilește meniul și băuturile", "Settle the food and drinks"],
  ["muzica", "m1", 1, 0, "Pregătește muzica: playlist sau DJ", "Sort out the music: playlist or DJ"],
  ["confirmari", "week", 0, -5, "Confirmă cine vine", "Confirm who is coming"],
  ["cumparaturi", "week", 0, -2, "Cumpără lumânări, baloane și ce mai lipsește", "Buy candles, balloons and anything still missing"],
  ["rezervare", "week", 0, -1, "Confirmă rezervarea și ora cu localul", "Confirm the booking and the time with the venue"],
  ["multumiri", "after", 0, 2, "Mulțumește invitaților și trimite fotografiile", "Thank the guests and share the photos"],
];

const picnic: T[] = [
  ["loc", "m1", 1, 0, "Alege locul și verifică dacă ai voie să faci grătar", "Choose the spot and check whether barbecues are allowed"],
  ["plan-b", "m1", 1, 0, "Stabilește data și un plan B pentru ploaie", "Fix the date and a plan B for rain"],
  ["invitati", "m1", 1, 0, "Invită lumea și află cine vine", "Invite people and find out who is coming"],
  ["cine-ce-aduce", "week", 0, -6, "Împarte cine ce aduce: mâncare, băuturi, pături", "Split who brings what: food, drinks, blankets"],
  ["masini", "week", 0, -3, "Stabilește cine cu cine merge cu mașina", "Sort out who rides with whom"],
  ["meteo", "week", 0, -2, "Verifică prognoza meteo", "Check the weather forecast"],
  ["cumparaturi", "week", 0, -1, "Cumpără mâncarea și băuturile", "Buy the food and drinks"],
  ["echipament", "week", 0, -1, "Pregătește lada frigorifică, păturile și sacii de gunoi", "Pack the cool box, blankets and rubbish bags"],
  ["jocuri", "week", 0, -1, "Încarcă boxa și ia jocuri: minge, cărți, badminton", "Charge the speaker and bring games: ball, cards, badminton"],
  ["cheltuieli", "after", 0, 1, "Împarte cheltuielile comune", "Split the shared costs"],
];

const revelion: T[] = [
  ["unde", "m3", 3, 0, "Hotărăște unde faceți Revelionul: acasă, la restaurant sau la munte", "Decide where to spend New Year's Eve: at home, at a restaurant or in the mountains"],
  ["rezervare", "m3", 3, 0, "Rezervă cazarea sau masa (locurile bune se ocupă devreme)", "Book the rooms or the table (good places go early)"],
  ["cine-vine", "m1", 1, 0, "Stabilește cine vine și strânge avansul", "Confirm who is coming and collect the deposit"],
  ["meniu", "m1", 1, 0, "Stabilește meniul și cine ce gătește", "Settle the menu and who cooks what"],
  ["transport", "m1", 1, 0, "Stabilește transportul și cine conduce a doua zi", "Arrange transport and who drives the next day"],
  ["lista-cumparaturi", "m1", 1, 0, "Fă lista de cumpărături", "Write the shopping list"],
  ["bauturi", "week", 0, -5, "Cumpără băuturile și șampania", "Buy the drinks and the sparkling wine"],
  ["accesorii", "week", 0, -3, "Cumpără artificii de masă, confetti și accesorii", "Buy sparklers, confetti and party props"],
  ["mancare", "week", 0, -2, "Cumpără mâncarea", "Buy the food"],
  ["muzica", "week", 0, -2, "Pregătește muzica și boxa", "Prepare the music and the speaker"],
  ["traditii", "week", 0, -1, "Pregătește ce țineți la miezul nopții: struguri, vâsc, dorințe", "Prepare your midnight traditions: grapes, mistletoe, wishes"],
  ["returnari", "after", 0, 1, "Strânge și returnează ce ai împrumutat", "Tidy up and return what you borrowed"],
  ["cheltuieli", "after", 0, 2, "Împarte cheltuielile comune", "Split the shared costs"],
];

const voiajSolo: T[] = [
  ["destinatie", "m6", 6, 0, "Alege destinația și perioada", "Choose the destination and the dates"],
  ["buget", "m6", 6, 0, "Stabilește bugetul călătoriei", "Set the trip budget"],
  ["acte", "m3", 3, 0, "Verifică valabilitatea pașaportului sau a buletinului și dacă ai nevoie de viză", "Check your passport or ID is valid and whether you need a visa"],
  ["bilete", "m3", 3, 0, "Cumpără biletele de avion sau de tren", "Buy the flight or train tickets"],
  ["cazare", "m3", 3, 0, "Rezervă cazarea", "Book the accommodation"],
  ["asigurare", "m1", 1, 0, "Fă asigurarea de călătorie", "Take out travel insurance"],
  ["itinerar", "m1", 1, 0, "Schițează itinerarul pe zile", "Sketch the day-by-day itinerary"],
  ["rezervari", "m1", 1, 0, "Rezervă din timp ce se epuizează: muzee, excursii", "Pre-book what sells out: museums, day trips"],
  ["banca-roaming", "m1", 1, 0, "Verifică roamingul și anunță banca dacă pleci în afara UE", "Check roaming and tell your bank if you are leaving the EU"],
  ["contact", "week", 0, -2, "Trimite cuiva de încredere itinerarul și datele de contact", "Send your itinerary and contact details to someone you trust"],
  ["harti", "week", 0, -2, "Descarcă hărțile pentru folosire fără internet", "Download maps for offline use"],
  ["bagaj", "week", 0, -2, "Fă bagajul după listă", "Pack from your list"],
  ["check-in", "week", 0, -1, "Fă check-in online și salvează biletele pe telefon", "Check in online and save the tickets on your phone"],
  ["dupa", "after", 0, 3, "Sortează fotografiile și notează cheltuielile", "Sort the photos and note what you spent"],
];

const voiajGrup: T[] = [
  ["destinatie", "m6", 6, 0, "Stabilește cu tot grupul destinația și perioada", "Agree the destination and dates with the whole group"],
  ["buget", "m6", 6, 0, "Conveniți bugetul pe persoană", "Agree the budget per person"],
  ["acte", "m3", 3, 0, "Verifică actele tuturor: pașaport, buletin, viză", "Check everyone's papers: passport, ID, visa"],
  ["bilete", "m3", 3, 0, "Cumpără biletele de transport", "Buy the travel tickets"],
  ["cazare", "m3", 3, 0, "Rezervă cazarea pentru tot grupul", "Book accommodation for the whole group"],
  ["avans", "m3", 3, 0, "Strânge avansul de la fiecare", "Collect the deposit from everyone"],
  ["asigurare", "m1", 1, 0, "Faceți asigurarea de călătorie", "Take out travel insurance"],
  ["itinerar", "m1", 1, 0, "Schițează itinerarul și împarte cine ce organizează", "Sketch the itinerary and split who organises what"],
  ["transfer", "m1", 1, 0, "Rezervă mașina sau transferul de la aeroport", "Book the hire car or the airport transfer"],
  ["evidenta", "m1", 1, 0, "Stabiliți cum țineți evidența cheltuielilor comune", "Agree how you will track shared costs"],
  ["trimite-itinerar", "week", 0, -3, "Trimite tuturor itinerarul și adresele", "Send everyone the itinerary and the addresses"],
  ["intalnire", "week", 0, -2, "Stabilește locul și ora de întâlnire la plecare", "Fix the meeting place and time for departure"],
  ["check-in", "week", 0, -1, "Faceți check-in online", "Check in online"],
  ["cheltuieli", "after", 0, 3, "Împarte cheltuielile comune și închide conturile", "Split the shared costs and settle up"],
  ["album", "after", 0, 5, "Puneți fotografiile într-un album comun", "Put the photos in a shared album"],
];

export const TEMPLATE_SEED: Tpl[] = [
  { kind: "nunta", ro: "Nuntă", en: "Wedding", descRo: "De la buget și nași până la mulțumiri, pe etape.", descEn: "From budget and godparents to thank-yous, stage by stage.", tasks: nunta },
  { kind: "botez", ro: "Botez", en: "Christening", descRo: "Biserică, nași, petrecere și tot ce ține de ele.", descEn: "Church, godparents, the party and everything around them.", tasks: botez },
  { kind: "aniversare", ro: "Aniversare", en: "Birthday", descRo: "Loc, invitați, tort și muzică.", descEn: "Venue, guests, cake and music.", tasks: aniversare },
  { kind: "picnic", ro: "Picnic", en: "Picnic", descRo: "Loc, vreme și cine ce aduce.", descEn: "The spot, the weather and who brings what.", tasks: picnic },
  { kind: "revelion", ro: "Revelion", en: "New Year's Eve", descRo: "Rezervare, meniu și miezul nopții.", descEn: "Booking, menu and midnight.", tasks: revelion },
  { kind: "voiaj_solo", ro: "Voiaj solo", en: "Solo trip", descRo: "Acte, bilete, cazare și bagaj.", descEn: "Papers, tickets, a place to stay and packing.", tasks: voiajSolo },
  { kind: "voiaj_grup", ro: "Voiaj de grup", en: "Group trip", descRo: "Un plan comun, de la avans la împărțit cheltuielile.", descEn: "A shared plan, from deposits to settling up.", tasks: voiajGrup },
  { kind: "blank", ro: "De la zero", en: "Blank", descRo: "Fără sarcini pregătite: le adaugi tu.", descEn: "No prepared tasks: you add your own.", tasks: [] },
];

export const templatesSeed: Seed = {
  name: "templates",
  run: async (db) => {
    for (const [position, tpl] of TEMPLATE_SEED.entries()) {
      const [row] = await db
        .insert(templates)
        .values({ kind: tpl.kind, nameRo: tpl.ro, nameEn: tpl.en, descriptionRo: tpl.descRo, descriptionEn: tpl.descEn, position })
        .onConflictDoUpdate({
          target: templates.kind,
          set: { nameRo: tpl.ro, nameEn: tpl.en, descriptionRo: tpl.descRo, descriptionEn: tpl.descEn, position },
        })
        .returning({ id: templates.id });
      const templateId = row!.id;
      for (const [i, [key, stage, months, days, ro, en]] of tpl.tasks.entries()) {
        const values = { titleRo: ro, titleEn: en, stage, offsetMonths: months, offsetDays: days, position: i };
        await db
          .insert(templateTasks)
          .values({ templateId, key, ...values })
          .onConflictDoUpdate({ target: [templateTasks.templateId, templateTasks.key], set: values });
      }
      const keys = tpl.tasks.map((t) => t[0]);
      await db
        .delete(templateTasks)
        .where(
          keys.length > 0
            ? and(eq(templateTasks.templateId, templateId), notInArray(templateTasks.key, keys))
            : eq(templateTasks.templateId, templateId),
        );
    }
  },
};
