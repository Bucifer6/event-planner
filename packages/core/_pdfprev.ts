import { writeFileSync } from "node:fs";
import { layoutPiece, drawSceneOnPdf, sceneToSvg, type KitTexts } from "./src/stationerykit";
import { newSheetDocument } from "./src/stationery";
import { qrMatrix } from "./src/qr";
const texts: KitTexts = { kicker: "Împreună cu părinții și nașii noștri", names: "Ioana & Ștefan", wording: "avem deosebita plăcere de a vă invita să fiți alături de noi în ziua în care ne unim destinele", date: "Sâmbătă, 12 septembrie 2026", time: "ora 17:00", venue: "Conacul Țărănesc", address: "Str. Învățătorilor 14, Snagov, Ilfov", rsvp: "Vă rugăm să ne confirmați prezența până la 15 august", saveTheDate: "Rezervați data", menuTitle: "Meniu", menuBody: "Gustare\nPlatou rece\n\nDesert\nTort", thanks: "Mulțumim\nVă mulțumim." };
const { doc, done } = await newSheetDocument({ title: "t", lang: "ro", createdAt: new Date() });
for (const [d, c] of [["classic", "ivoire"], ["botez", "ciel"], ["nocturne", "minuit"], ["modern", "ivoire"]] as const) {
  const scene = layoutPiece({ design: d, colourway: c, piece: "invitation", texts, extra: { qr: d === "classic" ? { matrix: qrMatrix("https://app.eventdesk.ro/g/q/abcdefghijklmnopqrstuvwxyz012345"), caption: "Familia Popescu" } : null } });
  drawSceneOnPdf(doc, scene, { bleedMm: 3, cropMarks: true, slug: "EventDesk.ro · Invitație A5 · 148 × 210 mm · bleed 3 mm · v1 · Culori RGB; conversia în CMYK se face la tipografie." });
  writeFileSync(`/tmp/stprev/pdfcmp-${d}.svg`, sceneToSvg(scene, { width: 600 }));
}
writeFileSync("/tmp/stprev/print.pdf", await done());
