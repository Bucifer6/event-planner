import { categories } from "../schema/directory";
import type { Seed } from "./index";

// The 21 launch categories, fixed by PRD P2 — Romanian names verbatim, English for the toggle.
// Slugs are stable (public URLs, the task-link mapping in @ed/core/directory): rename a
// category from the console (W4), never change a slug here.
export const LAUNCH_CATEGORIES: ReadonlyArray<readonly [slug: string, ro: string, en: string]> = [
  ["sali-de-evenimente", "Săli de evenimente", "Venues"],
  ["catering", "Catering", "Catering"],
  ["torturi-si-cofetarie", "Torturi și cofetărie", "Cakes and patisserie"],
  ["baruri-mobile", "Baruri mobile", "Mobile bars"],
  ["trupe", "Trupe (inclusiv lăutari)", "Bands (including lăutari)"],
  ["muzicieni-si-solisti", "Muzicieni și soliști", "Musicians and soloists"],
  ["dj", "DJ", "DJs"],
  ["fotografi", "Fotografi", "Photographers"],
  ["videografi", "Videografi", "Videographers"],
  ["floristi", "Floriști", "Florists"],
  ["decoratiuni-si-styling", "Decorațiuni și styling", "Decoration and styling"],
  ["inchiriere-corturi", "Închiriere corturi", "Marquee hire"],
  ["inchiriere-echipamente-de-petrecere", "Închiriere echipamente de petrecere", "Party equipment hire"],
  ["transport-autocare-si-microbuze", "Transport autocare și microbuze", "Coach and minibus transport"],
  ["cazare", "Cazare", "Accommodation"],
  ["animatori", "Animatori", "Entertainers"],
  ["coafura-si-make-up", "Coafură și make-up", "Hair and make-up"],
  ["invitatii-si-tipografie", "Invitații și tipografie", "Invitations and printing"],
  ["masini-de-nunta", "Mașini de nuntă", "Wedding cars"],
  ["securitate-si-personal-de-evenimente", "Securitate și personal de evenimente", "Security and event staff"],
  ["sonorizare-av-si-lumini", "Sonorizare, AV și lumini", "Sound, AV and lighting"],
];

/** Idempotent: inserts what is missing by slug; never overwrites console edits (W4). */
export const categoriesSeed: Seed = {
  name: "categories",
  run: async (db) => {
    let order = 0;
    for (const [slug, nameRo, nameEn] of LAUNCH_CATEGORIES) {
      order += 10;
      await db
        .insert(categories)
        .values({ slug, nameRo, nameEn, sortOrder: order })
        .onConflictDoNothing({ target: categories.slug });
    }
  },
};
