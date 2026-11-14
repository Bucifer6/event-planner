import { writeFileSync } from "node:fs";
import { DESIGN_KEYS, STATIONERY_PIECES, layoutPiece, sceneToSvg, STATIONERY_DESIGNS, stationeryFontFamily, type KitTexts, type PieceKind } from "./src/stationerykit";
import { qrMatrix } from "./src/qr";
const texts: KitTexts = {
  kicker: "Împreună cu părinții și nașii noștri",
  names: "Ioana & Ștefan",
  wording: "avem deosebita plăcere de a vă invita să fiți alături de noi în ziua în care ne unim destinele",
  date: "Sâmbătă, 12 septembrie 2026",
  time: "ora 17:00",
  venue: "Conacul Țărănesc",
  address: "Str. Învățătorilor 14, Snagov, Ilfov",
  rsvp: "Vă rugăm să ne confirmați prezența până la 15 august",
  saveTheDate: "Rezervați data",
  menuTitle: "Meniu",
  menuBody: "Gustare\nPlatou rece cu brânzeturi și legume coapte\n\nPește\nȘalău cu sos de lămâie și capere\n\nFel principal\nMușchi de vită, piure de țelină, sos de vin roșu\n\nDesert\nTortul miresei",
  thanks: "Mulțumim\nVă mulțumim din suflet că ați fost alături de noi în cea mai frumoasă zi a noastră.",
};
console.log(stationeryFontFamily());
const only = process.argv[2];
const pieces = (process.argv[3] ? [process.argv[3]] : STATIONERY_PIECES) as PieceKind[];
for (const d of DESIGN_KEYS) {
  if (only && only !== "all" && d !== only) continue;
  const cws = STATIONERY_DESIGNS[d].colourways;
  for (const p of pieces) {
    const cw = p === "invitation" ? cws : [cws[0]!];
    for (const c of cw) {
    const scene = layoutPiece({ design: d, colourway: c, piece: p, texts, extra: { tableLabel: p === "table-card" ? "7" : undefined, tableWord: "Masa", placeName: "Alexandra Constantinescu", placeNote: "Masa 7 · +2 copii", qr: process.env.QR ? { matrix: qrMatrix("https://eventdesk.ro/g/q/abcdefghijklmnopqrstuvwxyz012345"), caption: "Familia Popescu" } : null } });
    writeFileSync(`/tmp/stprev/${d}-${p}-${c}.svg`, sceneToSvg(scene, { width: Math.round(scene.width * 2), pad: 14 }));
    if (scene.fit < 1 || scene.truncated) console.log(d, p, "fit", scene.fit, scene.truncated);
    }
  }
}
